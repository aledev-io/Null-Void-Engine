"""Cluster de búsqueda (FTS + sweeper) (fase 6N.10).

Índice de nombres en memoria (O(1)) + índice de contenido FTS5 en background
con barrido periódico. Depende de _infra (BASE_CLOUD_ROOT, logger, _load_json)
y de _context (get_user_root, get_view_root). No depende de services.py. El
sweeper se lanza como hilo daemon al importar este módulo.
"""

import os
import re
import sqlite3
import subprocess
import threading
import time
import zipfile

from modules.session import session as sess
from . import _infra
from ._infra import logger, _load_json
from ._context import get_user_root, get_view_root

search_index = {}
index_lock = threading.Lock()

# Índice de contenido (FTS5): extrae texto plano de .txt/.md/.pdf/.docx y lo
# indexa en background para buscar DENTRO de los documentos, no solo por
# nombre. El barrido periódico + la reprogramación en cada mutación mantienen
# el índice al día sin bloquear peticiones.
_CONTENT_INDEX_SWEEP_SECONDS = 1200          # barrido completo cada 20 min
_CONTENT_EXTRACT_LIMIT = 20 * 1024 * 1024    # no indexar archivos > 20 MB
_CONTENT_TEXT_LIMIT = 256 * 1024             # máx. texto indexado por documento
_content_index_running = set()
_content_index_guard = threading.Lock()
_content_sweeper_started = False


def build_user_search_index(user_id):
    """ Escanea el disco una única vez al inicio para poblar el mapa de búsqueda O(1). """
    user_root = os.path.join(_infra.BASE_CLOUD_ROOT, user_id)
    if not os.path.exists(user_root):
        return

    local_index = {}
    for view_name in ('', '.computers'):
        target_scan = os.path.join(user_root, view_name)
        if not os.path.exists(target_scan):
            continue

        for root, dirs, files in os.walk(target_scan):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            rel_dir = os.path.relpath(root, target_scan).replace('\\', '/')
            if rel_dir == '.':
                rel_dir = ''

            for f in files:
                if f.startswith('.'):
                    continue
                local_index.setdefault(f.lower(), []).append({"name": f, "path": rel_dir, "is_dir": False, "view": "drive" if not view_name else "computers"})
            for d in dirs:
                if d.startswith('.'):
                    continue
                local_index.setdefault(d.lower(), []).append({"name": d, "path": rel_dir, "is_dir": True, "view": "drive" if not view_name else "computers"})

    with index_lock:
        search_index[user_id] = local_index


def invalidate_user_index(user_id):
    """ Borra el índice en memoria para obligar a una recarga limpia en la próxima búsqueda. """
    with index_lock:
        search_index.pop(user_id, None)
    # El contenido del usuario cambió: reprogramar el índice de texto completo
    _schedule_content_index(user_id)


def _ensure_fts_table():
    from src.core.database import get_db
    with get_db() as conn:
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS cloud_doc_fts USING fts5("
            "user_id UNINDEXED, view UNINDEXED, path, name, content)"
        )
        conn.commit()


def _extract_text(fp, ext):
    """Extrae texto plano del documento. Devuelve None si el formato no se
    puede indexar o falla la extracción."""
    try:
        if ext in ('.txt', '.md', '.log', '.json', '.csv', '.ini', '.conf', '.py', '.sh', '.xml'):
            with open(fp, 'rb') as f:
                raw = f.read(_CONTENT_TEXT_LIMIT + 1)
            try:
                text = raw.decode('utf-8')
            except UnicodeDecodeError:
                text = raw.decode('latin-1', errors='replace')
            return text[:_CONTENT_TEXT_LIMIT]

        if ext == '.pdf':
            try:
                r = subprocess.run(['pdftotext', '-l', '10', fp, '-'],
                                   capture_output=True, timeout=30)
                if r.returncode == 0:
                    return r.stdout.decode('utf-8', errors='replace')[:_CONTENT_TEXT_LIMIT]
            except Exception:
                pass
            return None

        if ext == '.docx':
            try:
                with zipfile.ZipFile(fp) as zf:
                    xml = zf.read('word/document.xml').decode('utf-8', errors='replace')
                text = re.sub(r'<[^>]+>', ' ', xml)
                for ent, ch in (('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                                ('&quot;', '"'), ('&apos;', "'")):
                    text = text.replace(ent, ch)
                return re.sub(r'\s+', ' ', text).strip()[:_CONTENT_TEXT_LIMIT]
            except Exception:
                return None
    except OSError:
        return None
    return None


def _index_user_content(user_id):
    """Indexa (o re-indexa) el contenido de todos los documentos del usuario
    y elimina filas obsoletas de archivos borrados o renombrados."""
    user_root = os.path.join(_infra.BASE_CLOUD_ROOT, user_id)
    if not os.path.isdir(user_root):
        return
    try:
        _ensure_fts_table()
    except sqlite3.OperationalError:
        return

    from src.core.database import get_db
    indexed = set()
    texts = {}
    with get_db() as conn:
        for view_dir, view in (('', 'drive'), ('.computers', 'computers'),
                               ('.backups', 'backups'), ('.business', 'business')):
            target = os.path.join(user_root, view_dir)
            if not os.path.isdir(target):
                continue
            for root, dirs, files in os.walk(target):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                rel = os.path.relpath(root, target).replace('\\', '/')
                if rel == '.':
                    rel = ''
                for f in files:
                    if f.startswith('.'):
                        continue
                    fp = os.path.join(root, f)
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    if st.st_size > _CONTENT_EXTRACT_LIMIT:
                        continue
                    text = _extract_text(fp, os.path.splitext(f)[1].lower())
                    if text is None or not text.strip():
                        continue
                    indexed.add((view, rel, f))
                    texts[(view, rel, f)] = text

        # 1) eliminar filas de archivos que ya no existen (borrados/renombrados)
        for row in conn.execute(
                "SELECT view, path, name FROM cloud_doc_fts WHERE user_id = ?",
                (user_id,)).fetchall():
            if (row['view'], row['path'], row['name']) not in indexed:
                conn.execute(
                    "DELETE FROM cloud_doc_fts WHERE user_id = ? AND view = ? AND path = ? AND name = ?",
                    (user_id, row['view'], row['path'], row['name']))

        # 2) upsert del contenido actual
        for key in indexed:
            conn.execute(
                "DELETE FROM cloud_doc_fts WHERE user_id = ? AND view = ? AND path = ? AND name = ?",
                (user_id, key[0], key[1], key[2]))
            conn.execute(
                "INSERT INTO cloud_doc_fts (user_id, view, path, name, content) VALUES (?, ?, ?, ?, ?)",
                (user_id, key[0], key[1], key[2], texts[key]))
        conn.commit()


def _schedule_content_index(user_id):
    """Lanza el indexado de contenido en un hilo de fondo (uno a la vez por
    usuario; si ya hay uno en marcha, se descarta el encolado: el barrido
    periódico lo cubre)."""
    with _content_index_guard:
        if user_id in _content_index_running:
            return
        _content_index_running.add(user_id)

    def _worker():
        try:
            _index_user_content(user_id)
        except Exception as e:
            logger.error(f"[Cloud] Error indexando contenido de {user_id}: {e}")
        finally:
            with _content_index_guard:
                _content_index_running.discard(user_id)

    threading.Thread(target=_worker, daemon=True).start()


def _start_content_index_sweeper():
    """Barrido periódico: reindexa todos los usuarios (archivos nuevos,
    modificados o borrados fuera del flujo API, p. ej. por el agente)."""
    global _content_sweeper_started
    if _content_sweeper_started:
        return
    _content_sweeper_started = True

    def _loop():
        while True:
            time.sleep(_CONTENT_INDEX_SWEEP_SECONDS)
            try:
                for uid in os.listdir(_infra.BASE_CLOUD_ROOT):
                    if os.path.isdir(os.path.join(_infra.BASE_CLOUD_ROOT, uid)):
                        _schedule_content_index(uid)
            except Exception as e:
                logger.error(f"[Cloud] Error en barrido del índice de contenido: {e}")

    threading.Thread(target=_loop, daemon=True).start()


def search_files(query, token):
    """ Sustituye tu os.walk pesado por una consulta analítica en memoria de O(1). """
    user_root = get_user_root(token)
    if not user_root:
        return None
    user_id = os.path.basename(user_root)
    query = query.strip().lower()
    if not query:
        return []
    with index_lock:
        if user_id not in search_index:
            # El índice de nombres aún no está: se construye en background,
            # pero la búsqueda por contenido (FTS) sigue disponible ya.
            threading.Thread(target=build_user_search_index, args=(user_id,)).start()
            user_map = None
        else:
            user_map = search_index[user_id]

    starred_data = _load_json(user_root, '.starred.json')
    protected_data = _load_json(user_root, '.protected.json')
    current_user = sess.get_user(token)
    results = []

    if user_map is not None:
        with index_lock:
            for filename_lowercased, items in user_map.items():
                if query in filename_lowercased:
                    for item in items:
                        view_root = get_view_root(item['view'], token)
                        fp = os.path.join(view_root, item['path'], item['name'])
                        try:
                            info = os.stat(fp)
                            results.append({
                                "name": item['name'], "path": item['path'], "is_dir": item['is_dir'],
                                "size": info.st_size if not item['is_dir'] else 0, "mtime": info.st_mtime,
                                "ext": os.path.splitext(item['name'])[1].lower(), "owner": current_user,
                                "starred": {"name": item['name'], "path": item['path']} in starred_data,
                                "protected": {"name": item['name'], "path": item['path'], "view": item['view']} in protected_data,
                                "view": item['view'], "match_type": "name",
                            })
                        except OSError:
                            pass

    results.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))

    # Búsqueda por CONTENIDO (FTS5): coincide dentro de documentos indexados
    # (.txt/.md/.pdf/.docx) cuando la query no acierta solo por nombre.
    existing_keys = {(r['view'], r['path'], r['name']) for r in results}
    from src.core.database import get_db
    try:
        _ensure_fts_table()
        fts_q = '"' + query.replace('"', '""') + '"*'
        rows = get_db().execute(
            "SELECT view, path, name, snippet(cloud_doc_fts, 4, '', '', '…', 12) AS snip "
            "FROM cloud_doc_fts WHERE user_id = ? AND cloud_doc_fts MATCH ? "
            "ORDER BY rank LIMIT 30",
            (user_id, fts_q)).fetchall()
        for row in rows:
            key = (row['view'], row['path'], row['name'])
            if key in existing_keys:
                continue
            fp = os.path.join(get_view_root(row['view'], token), row['path'], row['name'])
            try:
                info = os.stat(fp)
            except OSError:
                continue
            results.append({
                "name": row['name'], "path": row['path'], "is_dir": False,
                "size": info.st_size, "mtime": info.st_mtime,
                "ext": os.path.splitext(row['name'])[1].lower(), "owner": current_user,
                "starred": {"name": row['name'], "path": row['path']} in starred_data,
                "protected": {"name": row['name'], "path": row['path'], "view": row['view']} in protected_data,
                "view": row['view'], "match_type": "content",
                "snippet": row['snip'] or '',
            })
            existing_keys.add(key)
    except sqlite3.OperationalError as e:
        logger.warning(f"[Cloud] FTS no disponible: {e}")

    results.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return results[:50]


def _safe_child_path(view_root, rel_path):
    """
    Resuelve una ruta relativa dentro del root de una vista. Rechaza rutas
    absolutas, '..', segmentos ocultos y cualquier escape del root.
    Devuelve la ruta absoluta validada o None.
    """
    if not rel_path:
        return view_root
    if (rel_path.startswith("/") or "\\" in rel_path or ":" in rel_path
            or "\x00" in rel_path or "~" in rel_path):
        return None
    parts = [p for p in rel_path.split("/") if p not in ("", ".")]
    if any(p == ".." or p.startswith(".") for p in parts):
        return None

    abs_path = os.path.realpath(os.path.join(view_root, *parts))
    if abs_path != os.path.realpath(view_root) and not abs_path.startswith(
            os.path.realpath(view_root) + os.sep):
        return None
    return abs_path if os.path.isdir(abs_path) else None


def get_folders_tree(view, token, path=None):
    """
    Árbol de carpetas con carga perezosa: devuelve UN SOLO nivel del árbol.

    - path=None/'' : el nodo raíz de la vista con sus hijos inmediatos.
    - path='A/B'   : el nodo de esa carpeta con sus hijos inmediatos.

    Cada subcarpeta se devuelve como stub {name, path, has_subdirs,
    subdirs: [], files: []}; el cliente solicita su contenido al expandirla.
    Así se evita recorrer y hacer stat() de TODO el drive por cada apertura
    del selector (antes el árbol completo viajaba en un único JSON y se
    cortaba a 5 niveles de profundidad).
    """
    view_root = get_view_root(view, token)
    if not view_root:
        return None

    target = _safe_child_path(view_root, path or "")
    if target is None:
        return None

    name = os.path.basename(target)
    rel_path = os.path.relpath(target, view_root).replace('\\', '/')
    if rel_path == '.':
        rel_path = ''

    subdirs = []
    files = []
    has_subdirs = False
    has_children = False
    try:
        for entry in os.scandir(target):
            if entry.name.startswith('.'):
                continue
            if entry.is_dir() and not entry.is_symlink():
                child_rel = os.path.join(rel_path, entry.name).replace('\\', '/')
                child_has_subdirs = False
                child_has_children = False
                try:
                    for e in os.scandir(entry.path):
                        if not e.name.startswith('.') and not e.is_symlink():
                            child_has_children = True
                            if e.is_dir():
                                child_has_subdirs = True
                            if child_has_subdirs and child_has_children:
                                break
                except OSError:
                    pass
                subdirs.append({
                    "name": entry.name,
                    "path": child_rel,
                    "has_subdirs": child_has_subdirs,
                    "has_children": child_has_children,
                    "subdirs": [],
                    "files": [],
                })
                has_subdirs = True
                has_children = True
            elif entry.is_file() and not entry.is_symlink():
                file_path = os.path.join(rel_path, entry.name).replace('\\', '/')
                if file_path.startswith('/'):
                    file_path = file_path.lstrip('/')
                try:
                    size = entry.stat().st_size
                except OSError:
                    size = 0
                files.append({
                    "name": entry.name,
                    "path": file_path,
                    "size": size,
                    "ext": os.path.splitext(entry.name)[1].lower(),
                })
                has_children = True
        subdirs.sort(key=lambda x: x['name'].lower())
        files.sort(key=lambda x: x['name'].lower())
    except OSError as e:
        logger.warning(f"[OPERATIONAL][WARN] No se pudo listar la rama {target}: {e}")

    return {
        "name": name or "Mi unidad",
        "path": rel_path,
        "has_subdirs": has_subdirs,
        "has_children": has_children,
        "subdirs": subdirs,
        "files": files,
    }


# Barrido periódico del índice de contenido (hilo daemon al cargar el módulo)
_start_content_index_sweeper()
