import io
import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
import threading
import fcntl
import logging
import hashlib
import stat
import struct
import zlib
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from flask import request, send_file, jsonify, Response
from modules.session import session as sess
from config.config import CONFIG
from . import repository

# Configuración del logger para ver las alertas limpias en la terminal de Docker
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NullVoidCloud")

BASE_CLOUD_ROOT = os.path.join(CONFIG.DATA_DIR, 'Cloud')
os.makedirs(BASE_CLOUD_ROOT, exist_ok=True)

MAX_FILE_SIZE_PREVIEW = 100 * 1024 * 1024

# Transcodificación de vídeo ASÍNCRONA: los archivos grandes (cientos de MB)
# tardan minutos en transcodificar; hacerlo síncrono en la petición colgaba el
# worker (Worker graceful timeout) y, al superar el timeout de 120s, caía en
# silencio al original — el selector de calidad "no cambiaba de resolución".
# Ahora el trabajo corre en un hilo de fondo, el endpoint responde al instante
# con 202 {status: processing} y el frontend hace polling hasta que el cache
# está listo.
_VIDEO_TRANSCODE_TIMEOUT = int(os.environ.get("VIDEO_TRANSCODE_TIMEOUT", "900"))
# Límite del caché de vídeo transcodificado (LRU). Al superarlo se eliminan
# las versiones más antiguas (por mtime); el archivo ORIGINAL de la nube nunca
# se toca.
VIDEO_CACHE_MAX_MB = int(os.environ.get("VIDEO_CACHE_MAX_MB", "5120"))
# Calidad que se genera automáticamente en segundo plano al abrir un vídeo
# (solo UNA, para no saturar CPU); el resto se genera bajo demanda.
VIDEO_PREWARM_QUALITY = os.environ.get("VIDEO_PREWARM_QUALITY", "720p").lower()
VIDEO_QUALITIES = ('2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p')
VIDEO_HEIGHTS = {'2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720,
                 '480p': 480, '360p': 360, '240p': 240, '144p': 144}
# 2 workers: si el usuario cambia de calidad rápidamente (p. ej. 360p y luego
# 720p), ambas transcodificaciones avanzan en paralelo en vez de encolarse.
_video_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="nv-video")
_video_jobs = {}
_video_jobs_lock = threading.Lock()
_video_cache_checked_at = 0.0

user_size_cache = {}
cache_lock = threading.Lock()
CACHE_TTL = 10

search_index = {}
index_lock = threading.Lock()
class FileLock:
    def __init__(self, path):
        self.path = path
        self.fd = None

    def __enter__(self):
        self.fd = open(self.path, "a")
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        except OSError:
            pass
        return self.fd

    def __exit__(self, exc_type, exc, tb):
        try:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
        except OSError:
            pass
        if self.fd:
            self.fd.close()

download_tokens = {}
tokens_lock = threading.Lock()

def _cleanup_expired_tokens():
    now = time.time()
    expired = [tk for tk, info in download_tokens.items() if now > info.get('expires', 0)]
    for tk in expired:
        download_tokens.pop(tk, None)

_user_json_locks = {}
_global_lock_manager = threading.Lock()

def _get_user_lock(user_id) -> threading.Lock:
    with _global_lock_manager:
        if user_id not in _user_json_locks:
            _user_json_locks[user_id] = threading.Lock()
        return _user_json_locks[user_id]


# Hardening ZIP (CWE-400): chunks de I/O y cooperación con el event loop
_ZIP_CHUNK_BYTES = int(os.environ.get("ZIP_CHUNK_BYTES", str(2 * 1024 * 1024)))
# Límite de seguridad: tamaño total descomprimido máximo admitido por descompresión.
_MAX_UNCOMPRESSED_BYTES = int(os.environ.get("ZIP_MAX_UNCOMPRESSED_BYTES", str(10 * 1024 ** 3)))

def _yield_event_loop():
    """Cede el control al event loop (gevent/eventlet) en iteraciones largas;
    si no hay monkey-patch, un sleep(0) libera el GIL brevemente."""
    try:
        import eventlet
        eventlet.sleep(0)
        return
    except ImportError:
        pass
    try:
        import gevent
        gevent.sleep(0)
        return
    except ImportError:
        pass
    time.sleep(0)


def safe_join(base, *paths):
    """Une rutas bajo `base` de forma segura. Cada segmento se limpia y
    normaliza por completo; las secuencias relativas ('.'/'..') que intenten
    escapar de la base o navegar a carpetas hermanas se rechazan con ValueError."""
    base_abs = os.path.realpath(os.path.abspath(base))
    current = base_abs

    for p in paths:
        for seg in str(p).replace('\\', '/').split('/'):
            seg = seg.strip()
            if not seg:
                continue
            if seg in ('.', '..'):
                logger.error(f"[SECURITY][ALERT] Intento de escape perimetral hacia: {seg}")
                raise ValueError("Acceso denegado: Violación de aislamiento de ruta lúdica")

            next_path = os.path.realpath(os.path.abspath(os.path.join(current, seg)))

            if os.path.commonpath([base_abs, next_path]) != base_abs:
                logger.error(f"[SECURITY][ALERT] Intento de escape perimetral hacia: {next_path}")
                raise ValueError("Acceso denegado: Violación de aislamiento de ruta lúdica")

            current = next_path

    return current


def _unique_path(path):
    """Devuelve una ruta libre en el mismo directorio. Si ya existe,
    añade un sufijo numérico estilo SO: 'Archivo(1).txt', 'Archivo(2).txt'..."""
    if not os.path.exists(path):
        return path
    parent = os.path.dirname(path)
    base = os.path.basename(path)
    stem, ext = os.path.splitext(base)
    n = 1
    while True:
        candidate = os.path.join(parent, f"{stem}({n}){ext}")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def require_access(user_id, owner_id=None, file_name=None):
    if owner_id and str(owner_id) != str(user_id):
        if not file_name or not repository.is_shared_with_user(owner_id, user_id, file_name):
            logger.warning(f"[SECURITY][WARN] IDOR Interceptado: Usuario {user_id} intentó acceder a recurso de {owner_id}")
            raise PermissionError("Acceso denegado a este recurso")


def _reject_relative_segments(subpath, name):
    """Rechaza secuencias relativas ('.'/'..') en rutas de recursos compartidos."""
    for seg in (subpath or '').replace('\\', '/').split('/'):
        if seg in ('.', '..'):
            raise PermissionError("Acceso denegado a este recurso")
    if name:
        for seg in str(name).replace('\\', '/').split('/'):
            if seg in ('.', '..'):
                raise PermissionError("Acceso denegado a este recurso")


def _join_shared_child(shared_base, subpath, name):
    """Resuelve un descendiente del recurso compartido garantizando que el
    resultado quede estrictamente dentro del sandbox del recurso (shared_base)."""
    if not os.path.isdir(shared_base):
        raise PermissionError("Acceso denegado a este recurso")
    _reject_relative_segments(subpath, name)
    try:
        return safe_join(shared_base, subpath, name)
    except ValueError:
        raise PermissionError("Acceso denegado a este recurso")


def resolve_shared_path(current_uid, owner_id, name, subpath):
    _reject_relative_segments(subpath, name)

    clean_subpath = (subpath or '').strip('/')
    parts = clean_subpath.split('/') if clean_subpath else []
    if parts and parts[0]:
        top_name = parts[0]
        rest_path = '/'.join(parts[1:])
    else:
        top_name = name
        rest_path = ''

    owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, str(owner_id)))

    # 1) Recurso compartido = el archivo EXACTO solicitado (p. ej. se compartió
    #    'Subcarpeta/video.mp4'): el registro guarda el nombre del archivo y su
    #    ruta; se verifica AMBOS (normalizados sin slashes iniciales/finales).
    exact = repository.get_shared_item(owner_id, current_uid, name)
    if exact:
        exact_path = (exact.get('file_path') or '').strip('/')
        if exact_path == clean_subpath:
            base = owner_root
            if exact.get('view') == 'computers':
                base = os.path.realpath(os.path.join(owner_root, '.computers'))
            elif exact.get('view') == 'ai':
                # Los archivos de IA viven en <DATA_DIR>/ai/<owner>/, no en el Cloud
                base = ai_root_for_uid(owner_id)
            return safe_join(base, exact_path, exact['file_name'])

    # 2) Recurso compartido = la carpeta (primer segmento de la ruta): el
    #    receptor navega dentro del sandbox de esa carpeta compartida.
    shared_item = repository.get_shared_item(owner_id, current_uid, top_name)
    if not shared_item:
        logger.warning(f"[SECURITY][WARN] IDOR Interceptado: Usuario {current_uid} intentó acceder a recurso de {owner_id}")
        raise PermissionError("Acceso denegado a este recurso")
    if shared_item.get('view') == 'ai':
        owner_root = ai_root_for_uid(owner_id)

    if shared_item['view'] == 'computers':
        owner_root = os.path.realpath(os.path.join(owner_root, '.computers'))

    # Raíz canónica del recurso compartido: único sandbox al que tiene acceso el receptor
    shared_base = safe_join(owner_root, (shared_item.get('file_path') or '').strip('/'), shared_item['file_name'])

    if rest_path:
        return _join_shared_child(shared_base, rest_path, name)
    elif top_name == name:
        return shared_base
    else:
        return _join_shared_child(shared_base, '', name)

def get_token():
    if hasattr(request, 'user_token'):
        return request.user_token
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not token:
        auth = request.headers.get('Authorization')
        if auth and auth.startswith('Bearer '):
            token = auth.split(' ')[1]
    return token or request.headers.get('X-Token')


def _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view):
    if view in ('home', 'recent'):
        _reject_relative_segments(subpath, name)
        owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, str(owner_id)))
        shared_in_path, inherited = repository.get_shares_in_path(owner_id, subpath)
        combined = shared_in_path.get(name, list(inherited))
        if not any(str(s['shared_with']) == str(current_uid) for s in combined):
            raise PermissionError("Acceso denegado")
        return safe_join(owner_root, subpath, name)
    return resolve_shared_path(current_uid, owner_id, name, subpath)


def _is_safe_path(base_root, target_path) -> bool:
    try:
        base_abs = os.path.abspath(base_root)
        target_abs = os.path.abspath(target_path)
        target_real = os.path.realpath(target_abs)
        
        if os.path.islink(target_abs) or (target_abs != target_real and not target_real.startswith(base_abs)):
            return False
            
        return os.path.commonpath([base_abs, target_real]) == base_abs
    except Exception:
        return False


def user_root_for_uid(uid):
    if not uid:
        return None
    safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_uid:
        safe_uid = "unknown"
    return safe_join(BASE_CLOUD_ROOT, safe_uid)


def get_user_root(token=None):
    if token is None:
        token = get_token()
    uid = sess.get_user_id(token) if token else None
    return user_root_for_uid(uid)


# ── Adjuntos del módulo de IA ────────────────────────────────────
# Los archivos adjuntos de la IA se guardan físicamente en
# <DATA_DIR>/ai/<uid>/ y su metadata vive en la tabla de Cloud
# ai_attachment_files (id uuid = FK usada por ai_messages.attachments).

AI_BASE_ROOT = os.path.join(CONFIG.DATA_DIR, 'ai')
os.makedirs(AI_BASE_ROOT, exist_ok=True)


def get_ai_root(token=None):
    if token is None:
        token = get_token()
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return None
    return ai_root_for_uid(uid)


def ai_root_for_uid(uid):
    if not uid:
        return None
    safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_uid:
        safe_uid = "unknown"
    return safe_join(AI_BASE_ROOT, safe_uid)


def _ai_ref_from_row(row):
    size = int(row['size'] or 0)
    return {
        "id": row['id'],
        "name": row['filename'],
        "size": size,
        "sizeLabel": f"{size/1024:.1f} KB",
        "type": row['mime'] or mimetypes.guess_type(row['filename'])[0] or "application/octet-stream",
        "isImage": bool(row['is_image']),
        "isText": bool(row['is_text']),
        "isAudio": bool(row['is_audio']),
    }


def _ai_ext_flags(filename):
    ext = os.path.splitext(filename)[1].lower()
    return {
        "mime": mimetypes.guess_type(filename)[0] or "application/octet-stream",
        "is_image": ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'),
        "is_text": ext in ('.txt', '.js', '.py', '.json', '.md', '.html', '.css', '.c', '.cpp', '.h', '.sh', '.sql', '.csv', '.ts', '.tsx', '.jsx', '.xml', '.yaml', '.yml', '.toml', '.ini'),
        "is_audio": ext in ('.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac'),
    }


def ai_save_file_uid(uid, filename, data: bytes, username=None, check_quota=True):
    """Guarda un adjunto de IA bajo <DATA_DIR>/ai/<uid>/ con dedup de nombres,
    registra su metadata en ai_attachment_files y devuelve el ref {id, ...}
    (id = uuid, la FK que se persiste en ai_messages)."""
    root = ai_root_for_uid(uid)
    if not root:
        return {"error": "Usuario inválido"}
    base = os.path.basename(str(filename).replace('\\', '/')).strip() or 'archivo'
    if not base or base in ('.', '..'):
        return {"error": "Nombre de archivo no válido"}
    stem, ext = os.path.splitext(base)
    if len(stem) > 120:
        base = stem[:120] + ext
    candidate = base
    counter = 1
    while True:
        try:
            path = safe_join(root, candidate)
        except ValueError:
            return {"error": "Nombre de archivo no válido"}
        if not os.path.exists(path):
            break
        stem, ext = os.path.splitext(base)
        candidate = f"{stem} ({counter}){ext}"
        counter += 1
    file_size = len(data)
    if check_quota:
        # Uso derivado mantenido por triggers (ai_storage_usage): evita el
        # escaneo de directorio on-demand que hacía get_dir_size.
        limit_bytes = repository.get_user_quota_by_uid(uid) * 1024 * 1024 * 1024
        if repository.get_ai_storage_usage(uid) + file_size > limit_bytes:
            return {"error": "Espacio insuficiente en Null-Void Cloud"}
    os.makedirs(root, exist_ok=True)
    tmp_path = path + '.part'
    with open(tmp_path, 'wb') as f:
        f.write(data)
    os.replace(tmp_path, path)
    flags = _ai_ext_flags(candidate)
    file_id = uuid.uuid4().hex
    repository.add_ai_attachment(uid, file_id, candidate, file_size, flags["mime"],
                                 flags["is_image"], flags["is_text"], flags["is_audio"])
    if username and uid:
        add_activity(username, uid, "Adjuntaste en IA", candidate, "")
    row = repository.get_ai_attachment(uid, file_id)
    return _ai_ref_from_row(row) if row else {"error": "No se pudo registrar el archivo"}


def ai_save_file(token, filename, data: bytes, username=None, user_id=None):
    """Versión con token: resuelve el uid de la sesión y delega."""
    uid = user_id or (sess.get_user_id(token) if token else None)
    if not uid:
        return {"error": "No autorizado"}
    return ai_save_file_uid(uid, filename, data, username, check_quota=True)


def ai_download_file_by_uid(uid, file_id):
    row = repository.get_ai_attachment(uid, file_id)
    if row:
        try:
            path = safe_join(ai_root_for_uid(uid), row['filename'])
        except ValueError:
            return None
        return path if os.path.isfile(path) else None
    # Respaldo: tratar el id como nombre de archivo (datos legacy sin metadata)
    root = ai_root_for_uid(uid)
    if not root:
        return None
    try:
        path = safe_join(root, os.path.basename(str(file_id)))
    except ValueError:
        return None
    return path if os.path.isfile(path) else None


def ai_download_file(token, file_id):
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return None
    return ai_download_file_by_uid(uid, file_id)


def ai_list_files(token):
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return []
    return [_ai_ref_from_row(row) for row in repository.list_ai_attachments(uid)]


def ai_get_refs_by_uid(uid, ids):
    if not uid or not ids:
        return []
    rows = repository.get_ai_attachments_by_ids(uid, [i for i in ids if i])
    return [_ai_ref_from_row(row) for row in rows]


def ai_get_refs(token, ids):
    uid = sess.get_user_id(token) if token else None
    return ai_get_refs_by_uid(uid, ids)


def ai_delete_file(token, file_id):
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return False
    return ai_delete_files_by_uid(uid, [file_id]) > 0


def ai_delete_files_by_uid(uid, ids):
    """Elimina metadata + archivo físico de los adjuntos indicados."""
    if not uid or not ids:
        return 0
    rows = repository.get_ai_attachments_by_ids(uid, ids)
    root = ai_root_for_uid(uid)
    deleted = 0
    for row in rows:
        if root:
            try:
                path = safe_join(root, row['filename'])
            except ValueError:
                path = None
            if path and os.path.isfile(path):
                os.remove(path)
                deleted += 1
    deleted += repository.delete_ai_attachments_by_ids(uid, ids)
    return deleted


def ai_trash_files_by_uid(uid, ids):
    """Mueve los archivos adjuntos de IA a la papelera del usuario con origen 'Módulo de IA'."""
    if not uid or not ids:
        return 0
    rows = repository.get_ai_attachments_by_ids(uid, ids)
    if not rows:
        return 0

    base_root = user_root_for_uid(uid)
    if not base_root:
        return 0
    os.makedirs(base_root, exist_ok=True)

    trash_base = os.path.join(base_root, '.trash')
    os.makedirs(trash_base, exist_ok=True)
    ai_root = ai_root_for_uid(uid)

    trashed_count = 0
    new_entries = []

    for row in rows:
        filename = row['filename']
        # Soft delete en base de datos
        repository.trash_ai_attachment_by_filename(uid, filename)

        if ai_root:
            try:
                src_path = safe_join(ai_root, filename)
            except ValueError:
                src_path = None
            if src_path and os.path.isfile(src_path):
                new_trash_id = str(uuid.uuid4())
                dst_path = os.path.join(trash_base, new_trash_id)
                try:
                    shutil.move(src_path, dst_path)
                    trash_entry = {
                        "id": new_trash_id,
                        "name": filename,
                        "original_path": "",
                        "view": "ai",
                        "origin": "Módulo de IA",
                        "deleted_at": time.time(),
                    }
                    new_entries.append(trash_entry)
                    trashed_count += 1
                except Exception as e:
                    logger.warning(f"[OPERATIONAL][WARN] Error al mover adjunto IA {filename} a papelera: {e}")

    if new_entries:
        _update_json(base_root, '.trash.json', lambda d: list(d) + new_entries)
        invalidate_user_index(uid)

    return trashed_count


def ai_cleanup_attachments(uid, ids):
    """Mueve los adjuntos huérfanos a la papelera al eliminar sesiones de chat."""
    return ai_trash_files_by_uid(uid, ids)


def ai_read_file_by_uid(uid, file_id):
    """Devuelve el contenido (bytes) de un archivo de IA del usuario, o None."""
    row = repository.get_ai_attachment(uid, file_id)
    if not row:
        return None
    root = ai_root_for_uid(uid)
    if not root:
        return None
    try:
        path = safe_join(root, row['filename'])
    except ValueError:
        return None
    if not os.path.isfile(path):
        return None
    with open(path, 'rb') as f:
        return f.read()


def ai_read_file(token, file_id):
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return None
    return ai_read_file_by_uid(uid, file_id)


def ai_update_file_by_uid(uid, file_id, data: bytes, check_quota=True):
    """Sobrescribe el contenido de un archivo de IA preservando nombre y
    metadata (usado por notas y archivos generados). Devuelve el ref o None."""
    row = repository.get_ai_attachment(uid, file_id)
    if not row:
        return None
    root = ai_root_for_uid(uid)
    if not root:
        return None
    try:
        path = safe_join(root, row['filename'])
    except ValueError:
        return None
    if check_quota:
        # Uso derivado mantenido por triggers (ai_storage_usage)
        limit_bytes = repository.get_user_quota_by_uid(uid) * 1024 * 1024 * 1024
        if repository.get_ai_storage_usage(uid) + len(data) - int(row['size'] or 0) > limit_bytes:
            return {"error": "Espacio insuficiente en Null-Void Cloud"}
    os.makedirs(root, exist_ok=True)
    tmp_path = path + '.part'
    with open(tmp_path, 'wb') as f:
        f.write(data)
    os.replace(tmp_path, path)
    repository.update_ai_attachment_size(uid, file_id, len(data))
    # Si la fila estaba en la papelera del Cloud, se reactiva (el archivo
    # vuelve a estar gestionado tras una edición).
    repository.restore_ai_attachment_by_filename(uid, row['filename'])
    updated = repository.get_ai_attachment(uid, file_id)
    return _ai_ref_from_row(updated) if updated else None


def ai_update_file(token, file_id, data: bytes, check_quota=True):
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return None
    return ai_update_file_by_uid(uid, file_id, data, check_quota)


def find_protected_ancestor(protected_data, view, subpath, name):
    """ Devuelve la carpeta protegida más cercana que contiene al elemento (o None). """
    if not protected_data:
        return None
    subpath = (subpath or '').strip('/')
    parts = (subpath.split('/') if subpath else []) + [name]
    for i in range(len(parts)):
        entry = {"name": parts[i], "path": '/'.join(parts[:i]), "view": view}
        if entry in protected_data:
            return entry
    return None


def is_item_protected(protected_data, view, subpath, name):
    """ Un elemento está protegido si lo está él mismo o cualquiera de sus carpetas padre. """
    if not protected_data:
        return False
    subpath = (subpath or '').strip('/')
    parts = (subpath.split('/') if subpath else []) + [name]
    for i in range(len(parts)):
        ancestor = {"name": parts[i], "path": '/'.join(parts[:i]), "view": view}
        if ancestor in protected_data:
            return True
    return False


def resolve_protect_view(base_root, view, subpath, name):
    """ Normaliza vistas ambiguas (home/starred/recent/'') a la vista física real. """
    if view in ('home', 'starred', 'recent', '', None):
        subpath = (subpath or '').strip('/')
        if name and os.path.exists(os.path.join(base_root, subpath, name)):
            return 'drive'
        if name and os.path.exists(os.path.join(base_root, '.computers', subpath, name)):
            return 'computers'
        return 'drive'
    return view


def get_view_root(view='drive', token=None):
    base_root = get_user_root(token)
    if not base_root:
        return None
    if view == 'ai':
        # Los archivos de IA viven en <DATA_DIR>/ai/<uid>/ (misma metadata
        # ai_attachment_files que usan los adjuntos del chat).
        return ai_root_for_uid(sess.get_user_id(token) if token else None)
    if view in ('computers', 'backups', 'business', 'trash'):
        return safe_join(base_root, f'.{view}')
    return base_root


def get_user_quota(token=None):
    if token is None:
        token = get_token()
    username = sess.get_user(token) if token else None
    if not username:
        return 10
    quota = repository.get_user_quota_from_db(username)
    # Un 0 legado en la BD se trata como "sin asignar" para no bloquear subidas.
    if quota < 1:
        return 10
    return quota


def get_dir_size(path):
    """ Calcula el tamaño del directorio optimizado mediante caché atómica por usuario. """
    user_id = os.path.basename(path)
    now = time.time()
    
    with cache_lock:
        cache = user_size_cache.get(user_id)
        if cache and now - cache["time"] < CACHE_TTL:
            return cache["value"]

    total = 0
    if os.path.exists(path):
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        pass

    with cache_lock:
        user_size_cache[user_id] = {"value": total, "time": now}
        
    return total


def _path_size(path):
    """Tamaño real de un archivo o carpeta (sin caché)."""
    if not os.path.exists(path):
        return 0
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    return total


def bump_size_cache(user_id, delta):
    """Ajusta el tamaño cacheado del usuario tras subir/borrar, refrescando su TTL.

    Evita que subidas en ráfaga se cuelen por encima de la cuota dentro de la
    ventana del caché (10s) y que borrados no liberen espacio hasta expirar.
    """
    with cache_lock:
        cache = user_size_cache.get(user_id)
        if cache:
            cache["value"] = max(0, cache["value"] + delta)
            cache["time"] = time.time()


def get_folder_size_fast(folder_path):
    """Calcula recursivamente el tamaño total acumulado de los archivos dentro de una carpeta."""
    total = 0
    if os.path.exists(folder_path) and os.path.isdir(folder_path):
        try:
            with os.scandir(folder_path) as it:
                for entry in it:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                        elif entry.is_dir(follow_symlinks=False):
                            total += get_folder_size_fast(entry.path)
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def get_disk_info(path):
    try:
        total, used, free = shutil.disk_usage(path)
        return {"total": total, "free": free, "used": used}
    except Exception:
        return {"total": 0, "free": 0, "used": 0}


def _load_json(user_root, filename):
    path = os.path.join(user_root, filename)
    lock_path = path + ".lock"
    
    if os.path.exists(path):
        with FileLock(lock_path):  # <-- Interceptado por Kernel Linux a nivel multi-proceso
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.error(f"[OPERATIONAL][ERROR] Error al leer metadatos {filename}: {e}")
                return []
    return []


def _save_json(user_root, filename, data):
    path = os.path.join(user_root, filename)
    lock_path = path + ".lock"
    
    with FileLock(lock_path):
        tmp_path = path + f".{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except OSError as e:
            logger.error(f"[OPERATIONAL][CRITICAL] Fallo de IO/Disco al guardar {filename}: {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


def _update_json(user_root, filename, update_fn, default=None):
    """Actualización atómica (leer → modificar → escribir) bajo FileLock.

    A diferencia de _load_json + _save_json por separado, mantiene el candado
    fcntl durante TODA la operación: dos peticiones simultáneas (o el agente de
    sincronización) que toquen el mismo metadato no pueden pisarse entre sí.
    update_fn recibe la lista actual y debe devolver la nueva lista.
    """
    path = os.path.join(user_root, filename)
    lock_path = path + ".lock"

    with FileLock(lock_path):
        data = list(default) if default is not None else []
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.error(f"[OPERATIONAL][ERROR] Error al leer metadatos {filename}: {e}")
                data = list(default) if default is not None else []
        try:
            new_data = update_fn(data)
        except Exception as e:
            logger.error(f"[OPERATIONAL][ERROR] Error al actualizar metadatos {filename}: {e}")
            return data
        tmp_path = path + f".{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except OSError as e:
            logger.error(f"[OPERATIONAL][CRITICAL] Fallo de IO/Disco al guardar {filename}: {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
        return new_data


def _clean_starred_entry(base_root, name, subpath):
    """Elimina la entrada de destacados cuando un archivo o carpeta se elimina."""
    if not base_root or not name:
        return
    subpath = (subpath or '').strip('/')
    target_prefix = f"{subpath}/{name}" if subpath else name

    def _remove(starred_data):
        new_list = []
        for item in starred_data:
            item_name = item.get('name')
            item_path = (item.get('path') or '').strip('/')
            if item_name == name and item_path == subpath:
                continue
            if item_path == target_prefix or item_path.startswith(target_prefix + '/'):
                continue
            new_list.append(item)
        return new_list

    _update_json(base_root, '.starred.json', _remove)


def _rename_starred_entry(base_root, old_name, new_name, subpath):
    """Actualiza la entrada de destacados al renombrar un archivo o carpeta."""
    if not base_root or not old_name or not new_name:
        return
    subpath = (subpath or '').strip('/')
    old_prefix = f"{subpath}/{old_name}" if subpath else old_name
    new_prefix = f"{subpath}/{new_name}" if subpath else new_name

    def _update(starred_data):
        for item in starred_data:
            item_name = item.get('name')
            item_path = (item.get('path') or '').strip('/')
            if item_name == old_name and item_path == subpath:
                item['name'] = new_name
            elif item_path == old_prefix:
                item['path'] = new_prefix
            elif item_path.startswith(old_prefix + '/'):
                item['path'] = new_prefix + item_path[len(old_prefix):]
        return starred_data

    _update_json(base_root, '.starred.json', _update)


def _move_starred_entry(base_root, name, old_subpath, new_subpath):
    """Actualiza la entrada de destacados al mover un archivo o carpeta."""
    if not base_root or not name:
        return
    old_subpath = (old_subpath or '').strip('/')
    new_subpath = (new_subpath or '').strip('/')
    old_prefix = f"{old_subpath}/{name}" if old_subpath else name
    new_prefix = f"{new_subpath}/{name}" if new_subpath else name

    def _update(starred_data):
        for item in starred_data:
            item_name = item.get('name')
            item_path = (item.get('path') or '').strip('/')
            if item_name == name and item_path == old_subpath:
                item['path'] = new_subpath
            elif item_path == old_prefix:
                item['path'] = new_prefix
            elif item_path.startswith(old_prefix + '/'):
                item['path'] = new_prefix + item_path[len(old_prefix):]
        return starred_data

    _update_json(base_root, '.starred.json', _update)


def add_activity(user, user_id, action, name, path="", owner_id=None):
    if not user_id:
        return
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
    os.makedirs(user_root, exist_ok=True)
    entry = {
        "user": user, "user_id": user_id, "action": action,
        "name": name, "path": path, "time": time.time(),
        "owner_id": owner_id,
    }
    _update_json(user_root, '.activity.json', lambda acts: ([entry] + list(acts))[:50])

    if owner_id and str(owner_id) != str(user_id) and owner_id != 'null':
        owner_root = os.path.join(BASE_CLOUD_ROOT, str(owner_id))
        if os.path.exists(owner_root):
            _update_json(owner_root, '.activity.json', lambda acts: ([entry] + list(acts))[:50])
            try:
                from modules import socketio
                socketio.emit('activity_update', {'name': name, 'action': action, 'user': user}, room=f"user_{owner_id}")
            except Exception as e:
                pass


def list_recent(token):
    user_root = get_user_root(token)
    if not user_root:
        return None

    current_uid = sess.get_user_id(token)
    current_user = sess.get_user(token)
    filter_computers = request.args.get('filter_computers') == 'true'

    starred_data = _load_json(user_root, '.starred.json')
    protected_data = _load_json(user_root, '.protected.json')
    activity_data = _load_json(user_root, '.activity.json')

    recent_files = []
    for act in activity_data:
        if not act.get('name') or act['name'].startswith('.'):
            continue
        if act.get('user_id') != current_uid:
            continue

        owner_id = act.get('owner_id')
        is_shared = False
        
        try:
            if owner_id and str(owner_id) != str(current_uid):
                is_shared = True
                
                shared_in_path, inherited = repository.get_shares_in_path(owner_id, act['path'])
                combined = shared_in_path.get(act['name'], list(inherited))
                if not any(str(s['shared_with']) == str(current_uid) for s in combined):
                    raise PermissionError("Acceso denegado a este recurso")
                    
                fp = safe_join(BASE_CLOUD_ROOT, owner_id, act['path'], act['name'])
                base_scope = os.path.join(BASE_CLOUD_ROOT, owner_id)
            else:
                fp = safe_join(user_root, act['path'], act['name'])
                base_scope = user_root
                
            if not os.path.exists(fp):
                continue
        except (ValueError, PermissionError):
            continue

        is_comp = '.computers' in act['path']
        info = os.stat(fp)
        item_view = "computers" if is_comp else ("shared" if is_shared else "drive")
        owner_name = repository.get_username_by_id(owner_id) if is_shared else current_user

        target_owner_id = owner_id if is_shared else current_uid
        shared_in_path, inherited_shares = repository.get_shares_in_path(target_owner_id, act['path'])
        shared_users = shared_in_path.get(act['name'], list(inherited_shares))

        is_item_starred = False
        for s in starred_data:
            if s.get('name') == act['name'] and s.get('path') == act['path']:
                s_owner = s.get('owner_id')
                if (not owner_id and not s_owner) or (str(owner_id) == str(s_owner)) or (not s_owner):
                    is_item_starred = True
                    break

        recent_files.append({
            "name": act['name'], "path": act['path'],
            "is_dir": os.path.isdir(fp), "size": get_folder_size_fast(fp) if os.path.isdir(fp) else info.st_size,
            "mtime": info.st_mtime, "ext": os.path.splitext(act['name'])[1].lower(),
            "owner": owner_name, "owner_id": owner_id,
            "action_type": act['action'], "action_time": act['time'],
            "starred": is_item_starred,
            "protected": is_item_protected(protected_data, item_view, act['path'], act['name']),
            "view": item_view,
            "shared": len(shared_users) > 0,
            "shared_with": shared_users,
        })

    seen = set()
    unique = []
    for f in recent_files:
        key = (f['name'], f['path'])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    unique.sort(key=lambda x: x.get('action_time', x['mtime']), reverse=True)
    return unique[:20]


def resolve_agent_scope(token):
    """Si el token es de un agente (cloud_device_tokens), devuelve (device_name, user_id).
    Si es de sesión web (o inválido), devuelve (None, None)."""
    if not token:
        return None, None
    from src.core.database import get_db
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT d.name, d.user_id FROM cloud_device_tokens t "
                "JOIN cloud_devices d ON t.device_id = d.id WHERE t.token = ?",
                (token,)).fetchone()
        if row:
            return row['name'], row['user_id']
    except Exception:
        pass
    return None, None


def _check_agent_scope(view, subpath, token, name=''):
    """Un token de dispositivo solo puede tocar SU propia carpeta (.computers/<device>)."""
    dev_name, _ = resolve_agent_scope(token)
    if not dev_name:
        return True
    if view != 'computers':
        return False
    parts = [seg for seg in str(subpath or '').strip('/').split('/') if seg]
    if parts:
        return parts[0] == dev_name
    return name == dev_name


def list_files(view, subpath, token):
    if not _check_agent_scope(view, subpath, token):
        return None, None
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None

    try:
        target_path = safe_join(user_root, subpath.strip('/'))
    except ValueError:
        return None, None
        
    if not os.path.exists(target_path):
        return [], subpath

    base_root = get_user_root(token)
    protected_data = _load_json(base_root, '.protected.json')
    starred_data = _load_json(base_root, '.starred.json')
    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)

    files = []
    try:
        entries = os.listdir(target_path)
    except OSError as e:
        logger.error(f"[OPERATIONAL][ERROR] No se pudo leer el directorio {target_path}: {e}")
        return None, subpath

    shared_in_path, inherited_shares = repository.get_shares_in_path(current_uid, subpath)

    for name in entries:
        if name.startswith('.'):
            continue
        try:
            fp = os.path.join(target_path, name)
            if os.path.islink(fp):
                continue
            is_dir = os.path.isdir(fp)
            info = os.stat(fp)
            is_protected = is_item_protected(protected_data, resolve_protect_view(base_root, view, subpath, name), subpath, name)
            active_status = False
            if view == 'computers' and subpath == '':
                is_protected = True
                device_name = name.replace(' 💻', '')
                from src.core.database import get_db
                with get_db() as conn:
                    user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
                    if user_row:
                        uid = user_row['user_id']
                        dev = conn.execute("SELECT last_seen FROM cloud_devices WHERE user_id = ? AND name = ?", (uid, device_name)).fetchone()
                        if dev and time.time() - dev['last_seen'] < 15:
                            active_status = True
            is_starred = False
            for item in starred_data:
                if item.get('name') == name and item.get('path') == subpath:
                    item_owner = item.get('owner_id')
                    if (not item_owner) or (str(current_uid) == str(item_owner)):
                        is_starred = True
                        break

            shared_users = shared_in_path.get(name, list(inherited_shares))
            item_size = get_folder_size_fast(fp) if is_dir else info.st_size
            files.append({
                "name": name, "path": subpath, "is_dir": is_dir, "size": item_size,
                "mtime": info.st_mtime, "owner": "Yo", "owner_id": current_uid,
                "ext": os.path.splitext(name)[1].lower(),
                "protected": is_protected, "starred": is_starred, "active": active_status,
                "shared": len(shared_users) > 0, "shared_with": shared_users,
            })
        except OSError as e:
            logger.warning(f"[OPERATIONAL][WARN] Error al leer metadatos del archivo {name}: {e}")
            continue

    files.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return files, subpath


def list_trash(token, user_root):
    base_root = get_user_root(token)
    trash_data = _load_json(base_root, '.trash.json')
    trash_path = os.path.join(base_root, '.trash')

    files = []
    for item in trash_data:
        try:
            fp = safe_join(trash_path, item['id'])
            if os.path.exists(fp):
                info = os.stat(fp)
                origin = item.get('origin', '')
                if not origin and item.get('view') == 'computers' and not item.get('original_path'):
                    origin = item['name'].replace(' 💻', '')
                if not origin and item.get('view') == 'ai':
                    origin = 'Módulo de IA'
                files.append({
                    "id": item['id'], "name": item['name'],
                    "original_path": item['original_path'],
                    "origin": origin,
                    "is_dir": os.path.isdir(fp), "size": info.st_size,
                    "mtime": item['deleted_at'], "ext": os.path.splitext(item['name'])[1].lower(),
                    "owner": "Papelera", "view": item.get('view', 'drive'), "trash": True,
                })
        except ValueError:
            continue
    files.sort(key=lambda x: x['mtime'], reverse=True)
    return files, ''


def _validate_filename(filename):
    raw = filename.replace('\\', '/').split('/')[-1]
    safe = os.path.basename(raw)
    safe = "".join(c for c in safe if c.isprintable()).strip()
    invalid_chars = '<>:"/\\|?*'
    if not safe or any(c in invalid_chars for c in safe) or safe.startswith('.') or safe in ('.activity.json', '.trash.json', '.starred.json', '.protected.json'):
        return None
    return safe


def _finalize_upload(token, user_root, view, subpath, safe_filename, temp_path, overwrite_existing, file_size, existing_size=0, sha256_hex=None):
    """Paso final común de una subida (directa o por chunks):
    valida cuota, deduplica por hash en .pool y enlaza el archivo final,
    actualiza caché de tamaño, actividad y organización de facturas."""
    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(user_root)
    if current_usage - existing_size + file_size > limit_bytes:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        return False, "Espacio insuficiente en Null-Void Cloud"

    pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
    os.makedirs(pool_dir, exist_ok=True)

    if not sha256_hex:
        sha256_hash = hashlib.sha256()
        with open(temp_path, 'rb') as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                sha256_hash.update(chunk)
        sha256_hex = sha256_hash.hexdigest()

    pool_file_path = os.path.join(pool_dir, sha256_hex)
    if os.path.exists(pool_file_path):
        try:
            os.unlink(temp_path)
        except OSError:
            pass
    else:
        os.rename(temp_path, pool_file_path)

    try:
        target_dir = safe_join(user_root, subpath)
    except ValueError:
        return None, None
    final_file_path = safe_join(target_dir, safe_filename)

    if not overwrite_existing and os.path.exists(final_file_path):
        final_file_path = _unique_path(final_file_path)
    final_filename = os.path.basename(final_file_path)

    # overwrite: reemplazar in-place solo ahora que la cuota ya está validada
    if overwrite_existing:
        # Control de versiones: antes de desacoplar el hardlink del .pool,
        # conservar una copia (hardlink) en .versions/<clave>/v<ts>_<rand>.
        # El pool la mantiene viva (nlink>=2) mientras exista la versión, y
        # clean_pool la recoge cuando se borre la última versión.
        _snapshot_version(user_root, final_file_path, view, subpath, final_filename)
        try:
            os.unlink(final_file_path)
        except OSError:
            pass

    os.link(pool_file_path, final_file_path)

    # Si es una subida nueva (no sobrescritura intencional), limpiar cualquier residuo en .starred.json
    if not overwrite_existing:
        _clean_starred_entry(user_root, final_filename, subpath)

    # Refrescar el caché: la próxima subida ya ve el espacio consumido.
    user_id = os.path.basename(user_root)
    bump_size_cache(user_id, file_size - existing_size)

    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)
    add_activity(current_user, current_uid, "act_subiste", final_filename, subpath)

    # Organización automática de facturas: cualquier PDF subido a la vista
    # Facturación se clasifica por su fecha y se mueve a .business/YYYY/MM-MES
    if view == 'business' and final_filename.lower().endswith('.pdf'):
        try:
            from modules.api.invoices.services import organize_uploaded_pdf
            organize_uploaded_pdf(final_file_path, user_root)
            invalidate_user_index(current_uid)
        except Exception as e:
            logger.error(f"[Cloud] Error organizando factura {final_filename}: {e}")

    invalidate_user_index(current_uid)
    return True, None


def upload_file(view, subpath, token, file_storage, overwrite_existing=False):
    if not _check_agent_scope(view, subpath, token):
        return None, None
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None

    # Limpiar el subpath de caracteres de control (saltos de línea, etc.)
    subpath = "".join(c for c in subpath if c.isprintable()).strip('/')

    try:
        target_dir = safe_join(user_root, subpath)
    except ValueError:
        return None, None

    os.makedirs(target_dir, exist_ok=True)

    file_storage.seek(0, os.SEEK_END)
    file_size = file_storage.tell()
    file_storage.seek(0)

    safe_filename = _validate_filename(file_storage.filename)
    if not safe_filename:
        return False, "Nombre de archivo inválido o reservado"

    # Chequeo previo de cuota (evita escribir el temp si no cabe)
    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(user_root)

    existing_size = 0
    if overwrite_existing:
        try:
            if os.path.exists(safe_join(target_dir, safe_filename)):
                existing_size = os.path.getsize(safe_join(target_dir, safe_filename))
        except OSError:
            existing_size = 0
    if current_usage - existing_size + file_size > limit_bytes:
        return False, "Espacio insuficiente en Null-Void Cloud"

    pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
    os.makedirs(pool_dir, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(dir=pool_dir)
    sha256_hash = hashlib.sha256()

    with open(fd, 'wb') as f:
        while True:
            chunk = file_storage.read(65536)
            if not chunk:
                break
            f.write(chunk)
            sha256_hash.update(chunk)

    return _finalize_upload(token, user_root, view, subpath, safe_filename, temp_path,
                            overwrite_existing, file_size, existing_size, sha256_hash.hexdigest())


# Subidas reanudables por chunks (estilo TUS): el cliente crea una sesión,
# envía el archivo por fragmentos y la cierra al final. Si la conexión se
# corta, puede consultar el estado y reanudar desde el último byte recibido.
UPLOAD_CHUNK_SIZE = int(os.environ.get("UPLOAD_CHUNK_SIZE", str(8 * 1024 * 1024)))
_UPLOAD_STALE_HOURS = 24
_UPLOAD_DIR_NAME = '.uploads'


def _uploads_root(user_root):
    return os.path.join(user_root, _UPLOAD_DIR_NAME)


def _cleanup_stale_uploads(user_root):
    """Elimina sesiones de subida abandonadas (más de 24 h sin actividad)."""
    try:
        root = _uploads_root(user_root)
        if not os.path.isdir(root):
            return
        cutoff = time.time() - _UPLOAD_STALE_HOURS * 3600
        for entry in os.listdir(root):
            p = os.path.join(root, entry)
            try:
                if os.path.isdir(p) and os.path.getmtime(p) < cutoff:
                    shutil.rmtree(p, ignore_errors=True)
            except OSError:
                pass
    except OSError as e:
        logger.error(f"[Cloud] Error limpiando subidas obsoletas: {e}")


def _load_upload_meta(upload_root):
    with open(os.path.join(upload_root, 'meta.json'), 'r', encoding='utf-8') as f:
        return json.load(f)


def _save_upload_meta(upload_root, meta):
    tmp_path = os.path.join(upload_root, f"meta.{uuid.uuid4().hex}.tmp")
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False)
    os.replace(tmp_path, os.path.join(upload_root, 'meta.json'))


def _get_upload_dir(user_root, upload_id):
    root = _uploads_root(user_root)
    d = os.path.join(root, upload_id)
    real_root = os.path.realpath(root) + os.sep
    if not os.path.realpath(d).startswith(real_root):
        return None
    return d if os.path.isdir(d) else None


def create_upload_session(view, subpath, token, filename, size, overwrite=False):
    if not _check_agent_scope(view, subpath, token):
        return None, "Acceso denegado"
    user_root = get_view_root(view, token)
    if not user_root:
        return None, "Acceso denegado"

    subpath = "".join(c for c in subpath if c.isprintable()).strip('/')
    try:
        target_dir = safe_join(user_root, subpath)
    except ValueError:
        return None, "Ruta inválida"
    os.makedirs(target_dir, exist_ok=True)

    if not size or size <= 0:
        return None, "Tamaño de archivo inválido"
    MAX_SIZE = 50 * 1024 * 1024 * 1024
    if size > MAX_SIZE:
        return None, "El archivo supera el límite de 50GB"

    safe_filename = _validate_filename(filename)
    if not safe_filename:
        return None, "Nombre de archivo inválido o reservado"

    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(user_root)
    existing_size = 0
    if overwrite:
        try:
            if os.path.exists(safe_join(target_dir, safe_filename)):
                existing_size = os.path.getsize(safe_join(target_dir, safe_filename))
        except OSError:
            existing_size = 0
    if current_usage - existing_size + size > limit_bytes:
        return None, "Espacio insuficiente en Null-Void Cloud"

    _cleanup_stale_uploads(user_root)
    uploads_root = _uploads_root(user_root)
    os.makedirs(uploads_root, exist_ok=True)

    upload_id = uuid.uuid4().hex
    upload_root = os.path.join(uploads_root, upload_id)
    os.makedirs(upload_root, exist_ok=True)

    meta = {
        "upload_id": upload_id,
        "filename": safe_filename,
        "path": subpath,
        "view": view,
        "size": size,
        "received": 0,
        "overwrite": bool(overwrite),
        "created_at": time.time(),
        "last_active": time.time(),
    }
    _save_upload_meta(upload_root, meta)
    return upload_id, None


def get_upload_status(upload_id, token):
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"
    d = _get_upload_dir(user_root, upload_id)
    if not d:
        return None, "Sesión de subida no encontrada"
    meta = _load_upload_meta(d)
    return meta, None


def append_upload_chunk(upload_id, token, file_storage, offset):
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"
    d = _get_upload_dir(user_root, upload_id)
    if not d:
        return None, "Sesión de subida no encontrada"

    data_path = os.path.join(d, 'data.part')
    lock_path = data_path + '.lock'
    with FileLock(lock_path):
        meta = _load_upload_meta(d)
        if offset != meta["received"]:
            # El cliente se quedó atrás o repitió un chunk: informar del
            # offset real para que reanude desde ahí.
            return ("mismatch", meta["received"]), None

        file_storage.seek(0, os.SEEK_END)
        chunk_len = file_storage.tell()
        file_storage.seek(0)

        if chunk_len > UPLOAD_CHUNK_SIZE:
            return None, "Chunk demasiado grande"
        if meta["received"] + chunk_len > meta["size"]:
            return None, "El chunk excede el tamaño del archivo"

        if chunk_len:
            with open(data_path, 'ab') as f:
                while True:
                    buf = file_storage.read(65536)
                    if not buf:
                        break
                    f.write(buf)
            meta["received"] += chunk_len
            meta["last_active"] = time.time()
            _save_upload_meta(d, meta)

        return {"received": meta["received"]}, None


def complete_upload(upload_id, token):
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"
    d = _get_upload_dir(user_root, upload_id)
    if not d:
        return None, "Sesión de subida no encontrada"

    data_path = os.path.join(d, 'data.part')
    lock_path = data_path + '.lock'
    with FileLock(lock_path):
        meta = _load_upload_meta(d)
        if meta["received"] != meta["size"]:
            return None, "Subida incompleta"

        pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
        os.makedirs(pool_dir, exist_ok=True)
        temp_path = os.path.join(pool_dir, f"{upload_id}.part")
        shutil.move(data_path, temp_path)

        try:
            ok, err = _finalize_upload(token, user_root, meta["view"], meta["path"],
                                       meta["filename"], temp_path, meta["overwrite"],
                                       meta["size"])
        finally:
            if os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
            shutil.rmtree(d, ignore_errors=True)
    return ok, err


def abort_upload(upload_id, token):
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"
    d = _get_upload_dir(user_root, upload_id)
    if not d:
        return None, "Sesión de subida no encontrada"
    shutil.rmtree(d, ignore_errors=True)
    return True, None


# Control de versiones: cuando un archivo se sobrescribe (sync del agente o
# subida con overwrite), el contenido anterior se conserva como hardlink en
# .versions/<clave>/v<ts>_<rand>. Restaurar una versión vuelve a enlazar ese
# contenido como archivo actual (guardando a su vez la versión anterior).
_VERSIONS_DIR_NAME = '.versions'


def _versions_key(view, subpath, filename):
    return hashlib.sha1(f"{view}:{subpath}:{filename}".encode()).hexdigest()[:20]


def _versions_dir(user_root, view, subpath, filename, create=False):
    d = os.path.join(user_root, _VERSIONS_DIR_NAME, _versions_key(view, subpath, filename))
    if create:
        os.makedirs(d, exist_ok=True)
    return d


def _snapshot_version(user_root, abs_path, view, subpath, filename):
    """Guarda el contenido actual de abs_path como una versión (hardlink).

    No copia bytes: enlaza el archivo actual, que ya es un hardlink del .pool;
    el pool mantiene los datos vivos mientras exista la versión."""
    try:
        if not os.path.isfile(abs_path):
            return
        versions_root = os.path.join(user_root, _VERSIONS_DIR_NAME)
        os.makedirs(versions_root, exist_ok=True)
        key_dir = _versions_dir(user_root, view, subpath, filename, create=True)

        # meta.json (una vez): identifica el destino original para el listado
        meta_path = os.path.join(key_dir, 'meta.json')
        if not os.path.exists(meta_path):
            with FileLock(meta_path + '.lock'):
                if not os.path.exists(meta_path):
                    tmp_meta = meta_path + f".{uuid.uuid4().hex}.tmp"
                    try:
                        with open(tmp_meta, 'w', encoding='utf-8') as f:
                            json.dump({"view": view, "path": subpath, "name": filename}, f, ensure_ascii=False)
                        os.replace(tmp_meta, meta_path)
                    except OSError:
                        pass

        vname = f"v{int(time.time() * 1000)}_{uuid.uuid4().hex[:4]}"
        try:
            os.link(abs_path, os.path.join(key_dir, vname))
        except OSError as e:
            logger.warning(f"[OPERATIONAL][WARN] No se pudo guardar versión de {filename}: {e}")
    except Exception as e:
        logger.warning(f"[OPERATIONAL][WARN] Error en _snapshot_version de {filename}: {e}")


def _validate_version_id(vid):
    if not vid or not isinstance(vid, str):
        return False
    import re
    return bool(re.match(r'^v\d+_[0-9a-f]{4}$', vid))


def _version_entries(user_root, view, subpath, filename):
    key_dir = _versions_dir(user_root, view, subpath, filename)
    if not os.path.isdir(key_dir):
        return []
    entries = []
    try:
        for f in sorted(os.listdir(key_dir)):
            if not f.startswith('v') or f.endswith('.lock') or f.endswith('.tmp'):
                continue
            try:
                st = os.stat(os.path.join(key_dir, f))
                if os.path.isfile(os.path.join(key_dir, f)):
                    entries.append({"vid": f, "ts": int(f[1:].split('_')[0]) / 1000.0, "size": st.st_size})
            except OSError:
                continue
    except OSError:
        return []
    for i, e in enumerate(entries):
        e["n"] = i + 1
    return entries


def list_versions(view, subpath, name, token):
    if not _check_agent_scope(view, subpath, token, name):
        return None, "Acceso denegado"
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"
    return _version_entries(user_root, view, subpath.strip('/'), name), None


def restore_version(view, subpath, name, vid, token):
    if not _validate_version_id(vid):
        return None, "Versión inválida"
    if not _check_agent_scope(view, subpath, token, name):
        return None, "Acceso denegado"
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"

    subpath = subpath.strip('/')
    try:
        target_dir = safe_join(user_root, subpath)
    except ValueError:
        return None, "Ruta inválida"
    try:
        final_file_path = safe_join(target_dir, name)
    except ValueError:
        return None, "Ruta inválida"
    if not os.path.isfile(final_file_path):
        return None, "El archivo actual ya no existe"

    key_dir = _versions_dir(user_root, view, subpath, name)
    version_path = os.path.join(key_dir, vid)
    real_key = os.path.realpath(key_dir)
    if not os.path.realpath(version_path).startswith(os.path.realpath(real_key) + os.sep) or not os.path.isfile(version_path):
        return None, "Versión no encontrada"

    old_size = os.path.getsize(final_file_path)
    new_size = os.path.getsize(version_path)

    # Guardar la versión actual antes de reemplazarla
    _snapshot_version(user_root, final_file_path, view, subpath, name)
    os.unlink(final_file_path)
    os.link(version_path, final_file_path)

    user_id = os.path.basename(user_root)
    bump_size_cache(user_id, new_size - old_size)

    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)
    add_activity(current_user, current_uid, "act_restauraste_version", name, subpath)
    invalidate_user_index(current_uid)
    return True, None


def delete_version(view, subpath, name, vid, token):
    if not _validate_version_id(vid):
        return None, "Versión inválida"
    if not _check_agent_scope(view, subpath, token, name):
        return None, "Acceso denegado"
    user_root = get_user_root(token)
    if not user_root:
        return None, "Acceso denegado"

    key_dir = _versions_dir(user_root, view, subpath.strip('/'), name)
    version_path = os.path.join(key_dir, vid)
    real_key = os.path.realpath(key_dir)
    if not os.path.realpath(version_path).startswith(os.path.realpath(real_key) + os.sep) or not os.path.isfile(version_path):
        return None, "Versión no encontrada"
    try:
        os.unlink(version_path)
    except OSError:
        return None, "No se pudo eliminar la versión"
    return True, None


def make_dir(view, name, subpath, token):
    if not _check_agent_scope(view, subpath, token, name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    subpath = subpath.strip('/')
    
    name = "".join(c for c in name if c.isprintable()).strip()
    
    invalid_chars = '<>:"/\\|?*'
    if not name or any(c in invalid_chars for c in name) or name.startswith('.'):
        return "El nombre contiene caracteres no permitidos"

    try:
        target_path = safe_join(user_root, subpath, name)
    except ValueError:
        return None
        
    if os.path.exists(target_path):
        return "Ya existe una carpeta o archivo con ese nombre en esta ubicación"
        
    os.makedirs(target_path, exist_ok=True)
    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)
    add_activity(current_user, current_uid, "act_creaste_la_carpeta", name, subpath)
    invalidate_user_index(current_uid)
    return True


def delete_item(view, name, subpath, trash_id, token):
    if not _check_agent_scope(view, subpath, token, name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    subpath = subpath.strip('/')
    if view == 'trash':
        return delete_permanent(trash_id, token)

    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)

    if view == 'computers' and subpath == '':
        device_name = name.replace(' 💻', '')
        from src.core.database import get_db
        with get_db() as conn:
            conn.execute("DELETE FROM cloud_devices WHERE user_id = ? AND name = ?", (current_uid, device_name))
            conn.commit()

        base_root = get_user_root(token)
        trash_base = os.path.join(base_root, '.trash')
        os.makedirs(trash_base, exist_ok=True)

        # La carpeta real del dispositivo vive en <usuario>/.computers/<nombre>
        # (a veces con el sufijo legado ' 💻'); en ningún caso en la raíz.
        try:
            target_path = safe_join(user_root, name)
            if not os.path.exists(target_path):
                target_path = safe_join(user_root, device_name)
        except ValueError:
            target_path = None

        if target_path and os.path.exists(target_path):
            new_trash_id = str(uuid.uuid4())
            try:
                shutil.move(target_path, os.path.join(trash_base, new_trash_id))
                trash_entry = {"id": new_trash_id, "name": os.path.basename(target_path), "original_path": "", "view": "computers", "origin": device_name or os.path.basename(target_path), "deleted_at": time.time()}
                _update_json(base_root, '.trash.json', lambda d: list(d) + [trash_entry])
            except Exception:
                # Si el movimiento falla, no perdemos el dispositivo: la fila ya
                # se borró, pero la carpeta de datos queda en su sitio (visible).
                pass

        add_activity(current_user, current_uid, "act_desvinculaste_el_dispositivo", name, subpath)
        invalidate_user_index(current_uid)
        return True

    base_root = get_user_root(token)
    protected_data = _load_json(base_root, '.protected.json')
    view = resolve_protect_view(base_root, view, subpath, name)
    if is_item_protected(protected_data, view, subpath, name):
        return "Este elemento está protegido contra eliminación"

    try:
        target_path = safe_join(user_root, subpath, name)
        if not os.path.exists(target_path):
            return None
    except ValueError:
        return None

    if current_uid:
        recipients = repository.remove_shares_by_file(current_uid, name, subpath, view)
        # Tiempo real: los usuarios con los que estaba compartido pierden el
        # acceso al instante (su vista "Compartidos conmigo" se actualiza).
        if recipients:
            try:
                for uid in recipients:
                    socketio.emit('share_removed', {'name': name, 'by': current_uid, 'reason': 'deleted'}, room=f"user_{uid}")
            except Exception:
                pass

    if view == 'ai':
        # Los archivos de IA llevan su metadata en ai_attachment_files:
        # al moverlos a la papelera se hace soft-delete de la fila (trashed_at)
        # para poder reactivarla al restaurar.
        repository.trash_ai_attachment_by_filename(current_uid, name)

    new_trash_id = str(uuid.uuid4())
    trash_base = os.path.join(base_root, '.trash')
    os.makedirs(trash_base, exist_ok=True)
    
    shutil.move(target_path, os.path.join(trash_base, new_trash_id))

    trash_origin = "Módulo de IA" if view == 'ai' else (subpath.strip('/') if subpath else view)
    trash_entry = {"id": new_trash_id, "name": name, "original_path": subpath, "view": view, "origin": trash_origin, "deleted_at": time.time()}
    _update_json(base_root, '.trash.json', lambda d: list(d) + [trash_entry])
    _clean_starred_entry(base_root, name, subpath)
    invalidate_user_index(current_uid)
    return True


def list_file_shares(name, subpath, token):
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return []
        
    shared_in_path, inherited = repository.get_shares_in_path(current_uid, subpath)
    combined = shared_in_path.get(name, list(inherited))
    
    result = []
    seen = set()
    for s in combined:
        uid = s['shared_with']
        if uid in seen:
            continue
        seen.add(uid)
        username = repository.get_username_by_id(uid)
        result.append({'user_id': uid, 'username': username or 'Usuario'})
    return result


def clean_pool_async():
    def _clean():
        pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
        if not os.path.exists(pool_dir):
            return
        try:
            for f in os.listdir(pool_dir):
                path = os.path.join(pool_dir, f)
                if os.path.isfile(path) and os.stat(path).st_nlink == 1:
                    os.unlink(path)
        except Exception as e:
            logger.error(f"Error en clean_pool: {e}")
            
    threading.Thread(target=_clean, daemon=True).start()

def delete_permanent(trash_id, token):
    if not trash_id:
        return None
    current_uid = sess.get_user_id(token)
    base_root = get_user_root(token)
    trash_base = os.path.join(base_root, '.trash')
    try:
        trash_path = safe_join(trash_base, trash_id)
    except ValueError:
        return None

    if os.path.exists(trash_path):
        if os.path.isdir(trash_path):
            freed = _path_size(trash_path)
            shutil.rmtree(trash_path)
        else:
            freed = os.path.getsize(trash_path)
            os.remove(trash_path)
    else:
        freed = 0
    bump_size_cache(current_uid, -freed)

    # Borrado en firme de un archivo de IA: eliminar también su metadata
    try:
        entry = next((i for i in _load_json(base_root, '.trash.json') if i['id'] == trash_id), None)
    except Exception:
        entry = None

    _update_json(base_root, '.trash.json', lambda d: [i for i in d if i['id'] != trash_id])

    if entry:
        _clean_starred_entry(base_root, entry.get('name', ''), entry.get('original_path', ''))
        if entry.get('view') == 'ai':
            repository.delete_ai_attachment_by_filename(current_uid, entry.get('name', ''))

    invalidate_user_index(current_uid)
    clean_pool_async()
    return True


def _relink_ai_attachment(uid, filename):
    """Re-vincula un archivo de IA restaurado sin fila de metadata activa
    (caso robusto: la fila se borró en firme o nunca existió). Si queda una
    fila en papelera se reactiva; si no, crea un registro nuevo con un uuid
    (los refs antiguos al uuid original no resuelven, pero el archivo vuelve
    a estar gestionado por el módulo)."""
    row = repository.get_ai_attachment_by_filename(uid, filename)
    if row:
        if row['trashed_at']:
            repository.restore_ai_attachment_by_filename(uid, filename)
        return row['id']
    flags = _ai_ext_flags(filename)
    try:
        with open(safe_join(ai_root_for_uid(uid), filename), 'rb') as fh:
            size = len(fh.read())
    except Exception:
        size = 0
    file_id = uuid.uuid4().hex
    repository.add_ai_attachment(uid, file_id, filename, size, flags["mime"],
                                 flags["is_image"], flags["is_text"], flags["is_audio"])
    return file_id


def restore_item(trash_id, token):
    if not trash_id:
        return None, "ID requerido"
    current_uid = sess.get_user_id(token)
    base_root = get_user_root(token)
    result = {"err": None}

    def _restore(data):
        item = next((i for i in data if i['id'] == trash_id), None)
        if not item:
            result["err"] = "Elemento no encontrado en papelera"
            return data

        view_root = get_view_root(item.get('view', 'drive'), token)
        try:
            target_dir = safe_join(view_root, item['original_path'])
            target_path = safe_join(target_dir, item['name'])
        except ValueError:
            result["err"] = "Ruta inválida detectada en el metadato de restauración"
            return data

        try:
            os.makedirs(target_dir, exist_ok=True)
            if os.path.exists(target_path):
                target_path = os.path.join(target_dir, f"Restaurado_{int(time.time())}_{item['name']}")
            shutil.move(os.path.join(base_root, '.trash', trash_id), target_path)
        except OSError as e:
            logger.error(f"[OPERATIONAL][ERROR] Error al restaurar {trash_id}: {e}")
            result["err"] = "Error al restaurar el elemento"
            return data

        if item.get('view') == 'ai' and current_uid:
            # Re-vincular la metadata de IA: si la fila sobrevive (soft-delete)
            # se reactiva siguiendo el nombre final del archivo; si no existe,
            # se crea un registro nuevo para que el archivo vuelva a estar
            # gestionado por el módulo.
            final_name = os.path.basename(target_path)
            if not repository.restore_ai_attachment_by_filename(current_uid, item['name'], final_name):
                try:
                    _relink_ai_attachment(current_uid, final_name)
                except ValueError:
                    pass

        return [i for i in data if i['id'] != trash_id]

    _update_json(base_root, '.trash.json', _restore)

    if result["err"]:
        return None, result["err"]
    invalidate_user_index(current_uid)
    return True, None


def empty_trash(token):
    base_root = get_user_root(token)
    trash_path = os.path.join(base_root, '.trash')
    current_uid = sess.get_user_id(token)
    # Limpiar también la metadata de los archivos de IA en la papelera
    try:
        for entry in _load_json(base_root, '.trash.json'):
            if entry.get('view') == 'ai' and current_uid:
                repository.delete_ai_attachment_by_filename(current_uid, entry.get('name', ''))
    except Exception:
        pass
    if os.path.exists(trash_path):
        freed = _path_size(trash_path)
        shutil.rmtree(trash_path)
    else:
        freed = 0
    os.makedirs(trash_path, exist_ok=True)
    _save_json(base_root, '.trash.json', [])
    bump_size_cache(current_uid, -freed)
    clean_pool_async()
    return True


def rename_item(view, old_name, new_name, subpath, token):
    if not _check_agent_scope(view, subpath, token, old_name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    if view == 'shared':
        return "No puedes renombrar archivos compartidos contigo"

    subpath = subpath.strip('/')

    base_root = get_user_root(token)
    view = resolve_protect_view(base_root, view, subpath, old_name)
    protected_data = _load_json(base_root, '.protected.json')
    if is_item_protected(protected_data, view, subpath, old_name):
        return "Este elemento está protegido: no puede renombrarse"

    # Limpiar el nuevo nombre de caracteres de control
    new_name = "".join(c for c in new_name if c.isprintable()).strip()
    
    invalid_chars = '<>:"/\\|?*'
    if not new_name or any(c in invalid_chars for c in new_name) or new_name.startswith('.'):
        return "El nombre contiene caracteres no permitidos"

    try:
        old_path = safe_join(user_root, subpath, old_name)
        new_path = safe_join(user_root, subpath, new_name)
    except ValueError:
        return None
        
    if not os.path.exists(old_path):
        return None
    if os.path.exists(new_path):
        return "Ya existe un elemento con ese nombre"

    os.rename(old_path, new_path)
    _rename_starred_entry(base_root, old_name, new_name, subpath)

    if view == 'ai':
        # La metadata de IA sigue al archivo renombrado; si no, las
        # descargas por uuid dejarían de resolver.
        repository.update_ai_attachment_filename(sess.get_user_id(token), old_name, new_name)

    add_activity(sess.get_user(token), sess.get_user_id(token), "act_renombraste", new_name, subpath)
    invalidate_user_index(sess.get_user_id(token))
    return True


def copy_item(view, name, old_subpath, new_subpath, owner_id, token, new_name=None):
    if not (_check_agent_scope(view, old_subpath, token, name) and _check_agent_scope(view, new_subpath, token)):
        return None
    if view == 'ai':
        # Copiar dentro de la carpeta de IA crearía archivos físicos sin
        # metadata (huérfanos). Copiar fuera rompería el vínculo del original.
        return "Los archivos de IA no pueden copiarse desde aquí"
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return None

    new_view = 'drive' if view == 'shared' else view
    user_root = get_view_root(new_view, token)
    if not user_root:
        return None

    old_subpath = old_subpath.strip('/')
    new_subpath = new_subpath.strip('/')
    dest_name = new_name or name

    try:
        if owner_id and str(owner_id) != str(current_uid):
            old_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, old_subpath, view)
        else:
            v_root = get_view_root(view, token)
            if not v_root:
                return None
            old_path = safe_join(v_root, old_subpath, name)

        new_path = safe_join(user_root, new_subpath, dest_name)
    except (ValueError, PermissionError):
        return "Operación rechazada: Rutas o permisos inválidos"

    if not os.path.exists(old_path):
        return "El archivo o carpeta de origen no existe"
    if old_path == new_path:
        return "La carpeta de destino es igual a la carpeta actual"
    
    if os.path.isdir(old_path):
        if os.path.commonpath([old_path, new_path]) == old_path:
            return "No se puede copiar un directorio dentro de sí mismo"
            
    # Si ya existe, añadir sufijo numérico estilo SO: 'Archivo(1).txt'
    new_path = _unique_path(new_path)

    try:
        if os.path.isdir(old_path):
            shutil.copytree(old_path, new_path)
        else:
            shutil.copy2(old_path, new_path)
    except Exception as e:
        logger.error(f"Error al copiar {old_path} -> {new_path}: {e}")
        return "Error al copiar el elemento"

    invalidate_user_index(current_uid)
    return True


def move_item(view, name, old_subpath, new_subpath, token):
    if not (_check_agent_scope(view, old_subpath, token, name) and _check_agent_scope(view, new_subpath, token)):
        return None
    if view == 'ai':
        # Los archivos de IA están vinculados a su metadata (ai_attachment_files):
        # moverlos fuera de <DATA_DIR>/ai/<uid>/ rompería los refs de los chats.
        return "Los archivos de IA no pueden moverse fuera de su carpeta"
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    old_subpath = old_subpath.strip('/')
    new_subpath = new_subpath.strip('/')

    base_root = get_user_root(token)
    if view not in ('computers', 'backups', 'business', 'trash'):
        protected_data = _load_json(base_root, '.protected.json')
        resolved_view = resolve_protect_view(base_root, view, old_subpath, name)
        if is_item_protected(protected_data, resolved_view, old_subpath, name):
            return "Este elemento está protegido: no puede moverse"

    try:
        old_path = safe_join(user_root, old_subpath, name)
        new_path = safe_join(user_root, new_subpath, name)
    except ValueError:
        return "Ruta inválida o fuera del directorio del usuario"

    if not os.path.exists(old_path):
        return "El archivo o carpeta de origen no existe"
    if old_path == new_path:
        return "La carpeta de destino es igual a la carpeta actual"
        
    if os.path.isdir(old_path):
        if os.path.commonpath([old_path, new_path]) == old_path:
            return "No se puede mover un directorio dentro de sí mismo"
            
    if os.path.exists(new_path):
        return "Ya existe un archivo o carpeta con ese nombre en el destino"

    shutil.move(old_path, new_path)
    _move_starred_entry(base_root, name, old_subpath, new_subpath)
    invalidate_user_index(sess.get_user_id(token))
    return True


def toggle_star(name, subpath, view, owner_id, token):
    base_root = get_user_root(token)
    if not base_root:
        return None, None
    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)
    result = {"is_starred": False}

    def _toggle(starred_data):
        match_idx = -1
        for idx, item in enumerate(starred_data):
            if item.get('name') == name and item.get('path') == subpath:
                item_owner = item.get('owner_id')
                if (not owner_id and not item_owner) or \
                   (str(owner_id) == str(item_owner)) or \
                   (not item_owner):
                    match_idx = idx
                    break

        if match_idx != -1:
            starred_data.pop(match_idx)
            result["is_starred"] = False
        else:
            new_item = {"name": name, "path": subpath}
            # Guardar la vista también para archivos propios no-'drive'
            # (p. ej. 'ai'): list_starred los resuelve en su raíz correcta.
            if view != 'drive':
                new_item["view"] = view
            if owner_id and str(owner_id) != str(current_uid):
                new_item["owner_id"] = owner_id
                new_item["view"] = view
            starred_data.append(new_item)
            result["is_starred"] = True
        return starred_data

    _update_json(base_root, '.starred.json', _toggle)
    return True, result["is_starred"]


def toggle_protect(name, subpath, view, token):
    base_root = get_user_root(token)
    if not base_root:
        return None, None
    subpath = subpath.strip('/')
    view = resolve_protect_view(base_root, view, subpath, name)

    item_key = {"name": name, "path": subpath, "view": view}
    result = {"is_prot": False, "ancestor": None}

    def _toggle(protected_data):
        # El elemento no tiene protección propia: si aparece como protegido es porque
        # una carpeta superior está bloqueada; sólo la carpeta raíz puede desbloquearse.
        if item_key not in protected_data:
            ancestor = find_protected_ancestor(protected_data, view, subpath, name)
            if ancestor:
                result["ancestor"] = ancestor
                return protected_data

        if item_key in protected_data:
            protected_data.remove(item_key)
            result["is_prot"] = False
        else:
            protected_data.append(item_key)
            result["is_prot"] = True
        return protected_data

    _update_json(base_root, '.protected.json', _toggle)

    if result["ancestor"]:
        return False, ('protected_ancestor', result["ancestor"]['name'])
    return True, result["is_prot"]


def list_starred(token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    starred_data = _load_json(base_root, '.starred.json')
    protected_data = _load_json(base_root, '.protected.json')
    current_uid = sess.get_user_id(token)
    files = []
    valid_starred = []
    for item in starred_data:
        try:
            if 'owner_id' in item and str(item['owner_id']) != str(current_uid):
                item_view = item.get('view', 'shared')
                fp = _resolve_shared_or_recent_path(current_uid, item['owner_id'], item['name'], item['path'], item_view)
                is_comp = False
                owner = repository.get_username_by_id(item['owner_id'])
                owner_id = item['owner_id']
                is_shared = True
            else:
                item_view = item.get('view', 'drive')
                if item_view == 'ai':
                    fp = safe_join(ai_root_for_uid(current_uid), item['path'], item['name'])
                else:
                    fp = safe_join(base_root, item['path'], item['name'])
                is_comp = False
                owner = sess.get_user(token) or "Usuario"
                owner_id = current_uid
                is_shared = False
        except (ValueError, PermissionError):
            if 'owner_id' not in item or str(item.get('owner_id')) == str(current_uid):
                try:
                    fp = safe_join(base_root, '.computers', item['path'], item['name'])
                    is_comp = True
                    item_view = "computers"
                    owner = sess.get_user(token) or "Usuario"
                    owner_id = current_uid
                    is_shared = False
                except ValueError:
                    continue
            else:
                continue
                
        if not os.path.exists(fp):
            continue
            
        valid_starred.append(item)
        info = os.stat(fp)
        files.append({
            "name": item['name'], "path": item['path'],
            "is_dir": os.path.isdir(fp), "size": info.st_size,
            "mtime": info.st_mtime, "owner": owner, "owner_id": owner_id,
            "ext": os.path.splitext(item['name'])[1].lower(),
            "starred": True,
            "protected": is_item_protected(protected_data, item_view, item['path'], item['name']),
            "view": item_view,
            "is_shared": is_shared
        })

    # Auto-limpieza: si había elementos de archivos borrados, sanear .starred.json
    if len(valid_starred) != len(starred_data):
        _save_json(base_root, '.starred.json', valid_starred)

    return files


def get_quota_info(token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    limit_gb = get_user_quota(token)
    used = get_dir_size(base_root)
    disk = get_disk_info(base_root)
    return {"used_bytes": used, "limit_gb": limit_gb, "disk_total": disk['total'], "disk_free": disk['free']}


def _check_storage_capacity(token, needed_bytes):
    """Comprueba si `needed_bytes` adicionales caben en la cuota del usuario
    y físicamente en el disco del servidor. Devuelve (ok, mensaje_error)."""
    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(get_user_root(token))
    if current_usage + needed_bytes > limit_bytes:
        return False, "Espacio insuficiente en Null-Void Cloud"
    disk = get_disk_info(BASE_CLOUD_ROOT)
    if disk['free'] < needed_bytes:
        return False, "Espacio insuficiente en el servidor"
    return True, None


def get_file_info(view, name, subpath, trash_id, owner_id, token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)

    try:
        if owner_id and str(owner_id) != str(current_uid):
            fp = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
            original_name = name
            username = repository.get_username_by_id(owner_id)
        elif view == 'trash' and trash_id:
            trash_base = os.path.join(base_root, '.trash')
            fp = safe_join(trash_base, trash_id)
            original_name = name
            trash_data = _load_json(base_root, '.trash.json')
            item = next((i for i in trash_data if i['id'] == trash_id), None)
            if item:
                original_name = item['name']
            username = sess.get_user(token) or "Usuario"
        else:
            v_root = get_view_root(view, token)
            try:
                fp = safe_join(v_root, subpath, name)
                if not os.path.exists(fp):
                    raise ValueError()
            except ValueError:
                alt = safe_join(base_root, '.computers', subpath, name)
                if os.path.exists(alt):
                    fp = alt
                else:
                    return None
            original_name = name
            username = sess.get_user(token) or "Usuario"
    except (ValueError, PermissionError):
        return None

    if not os.path.exists(fp):
        return None

    stat = os.stat(fp)

    # Para carpetas, el st_size es solo el tamaño de la entrada del directorio:
    # se recorre el contenido real (walk fresco, sin caché para no colisionar).
    if os.path.isdir(fp):
        size = 0
        for dirpath, _, filenames in os.walk(fp):
            for f in filenames:
                fpath = os.path.join(dirpath, f)
                if not os.path.islink(fpath):
                    try:
                        size += os.path.getsize(fpath)
                    except OSError:
                        pass
    else:
        size = stat.st_size

    shared_users_info = []
    if not owner_id or str(owner_id) == str(current_uid):
        direct_shares, inherited = repository.get_shares_in_path(current_uid, subpath)
        shared_list = direct_shares.get(original_name, list(inherited))
        for s in shared_list:
            uid = s['shared_with']
            uname = repository.get_username_by_id(uid)
            shared_users_info.append({'user_id': uid, 'username': uname or 'Usuario'})

    return {
        "name": original_name, "size": size, "mtime": stat.st_mtime,
        "ctime": stat.st_ctime, "is_dir": os.path.isdir(fp),
        "path": subpath, "owner": username, "owner_id": owner_id or current_uid, "shared_users": shared_users_info,
    }


def _pdf_thumbnail(target_path, size, mtime_ns):
    """Genera una miniatura PNG de la primera página de un PDF, con caché en disco.
    Renderiza SOLO la página 1 a baja resolución (96 DPI) para no cargar
    documentos pesados de golpe. Devuelve la ruta del PNG cacheado o None."""
    thumbs_dir = os.path.join(BASE_CLOUD_ROOT, '.pool', 'thumbs')
    tmp_prefix = None
    try:
        os.makedirs(thumbs_dir, exist_ok=True)
        key = hashlib.sha256(f"{target_path}:{size}:{mtime_ns}".encode()).hexdigest()[:16]
        cache_path = os.path.join(thumbs_dir, f"{key}.png")
        if os.path.exists(cache_path):
            return cache_path

        tmp_prefix = os.path.join(thumbs_dir, f".tmp_{os.getpid()}_{uuid.uuid4().hex[:8]}")
        cmd = ['pdftoppm', '-f', '1', '-l', '1', '-png', '-singlefile', '-r', '96', target_path, tmp_prefix]
        subprocess.run(cmd, capture_output=True, timeout=30, check=True)
        result = tmp_prefix + '.png'
        if not os.path.exists(result):
            return None
        os.rename(result, cache_path)
        return cache_path
    except Exception:
        return None
    finally:
        if tmp_prefix:
            for leftover in (tmp_prefix, tmp_prefix + '.png'):
                if os.path.exists(leftover):
                    try:
                        os.unlink(leftover)
                    except OSError:
                        pass


def _preview_placeholder(ext=None):
    """SVG ligero con icono de documento: evita el icono de imagen rota cuando
    no se puede generar la miniatura (PDF enorme, timeout, binario ausente...)."""
    label = (ext or 'PDF').lstrip('.').upper()[:6]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">'
        '<rect width="160" height="120" rx="8" fill="#e8eaf0"/>'
        '<path d="M60 22 h28 l20 20 v56 a6 6 0 0 1-6 6 H60 a6 6 0 0 1-6-6 V28 a6 6 0 0 1 6-6z" fill="#ffffff" stroke="#c3c8d4"/>'
        '<path d="M88 22 v20 h20" fill="none" stroke="#c3c8d4"/>'
        f'<text x="80" y="92" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#8a92a6">{label}</text>'
        '</svg>'
    )


def preview_file(view, name, subpath, trash_id, owner_id, token):
    base_root = get_user_root(token)
    if not base_root:
        return None, None

    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)

    try:
        if owner_id and str(owner_id) != str(current_uid):
            target_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
        elif view == 'trash' and trash_id:
            target_path = safe_join(base_root, '.trash', trash_id)
        else:
            v_root = get_view_root(view, token)
            target_path = safe_join(v_root, subpath, name)
    except (ValueError, PermissionError):
        return None, None

    if not os.path.exists(target_path):
        return None, None

    preview_exts = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.pdf', '.mp4', '.webm', '.mov', '.avi', '.mkv')
    if os.path.getsize(target_path) > MAX_FILE_SIZE_PREVIEW:
        ext = os.path.splitext(name)[1].lower()
        if ext in preview_exts:
            return send_file(io.BytesIO(_preview_placeholder(ext).encode()), mimetype='image/svg+xml'), None
        return None, "Archivo demasiado grande para previsualizar de forma directa"

    # Las miniaturas (carga automática del navegador en listados/grid) NO
    # cuentan como "abriste el archivo": solo el preview intencional lo hace.
    if request.args.get('thumbnail') != '1':
        add_activity(sess.get_user(token), sess.get_user_id(token), "act_abrio", name, subpath, owner_id)

    ext = os.path.splitext(name)[1].lower()
    if ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'):
        resp = send_file(target_path)
        if ext == '.svg':
            # XSS almacenado: los SVG se sirven inline en el mismo origen;
            # el CSP bloquea scripts/eventos dentro del documento.
            resp.headers['Content-Security-Policy'] = (
                "default-src 'none'; script-src 'none'; object-src 'none'; img-src data:"
            )
        return resp, None

    if ext in ('.mp4', '.webm', '.mov', '.avi', '.mkv'):
        for attempt in [('00:00:01',), ('00:00:00',)]:
            try:
                cmd = ['ffmpeg', '-i', target_path, '-ss', attempt[0], '-vframes', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']
                result = subprocess.run(cmd, capture_output=True, check=True, timeout=5)
                return send_file(io.BytesIO(result.stdout), mimetype='image/jpeg'), None
            except Exception:
                continue
        return send_file(io.BytesIO(_preview_placeholder(ext).encode()), mimetype='image/svg+xml'), None

    if ext == '.pdf':
        st = os.stat(target_path)
        thumb = _pdf_thumbnail(target_path, st.st_size, st.st_mtime_ns)
        if thumb:
            return send_file(thumb, mimetype='image/png'), None
        return send_file(io.BytesIO(_preview_placeholder('pdf').encode()), mimetype='image/svg+xml'), None

    return None, "Tipo de archivo no previsualizable"


def get_item_activity(name, subpath, owner_id, token):
    current_uid = sess.get_user_id(token)
    if owner_id and str(owner_id) != str(current_uid):
        target_root = os.path.join(BASE_CLOUD_ROOT, str(owner_id))
    else:
        target_root = get_user_root(token)
        
    if not target_root:
        return []
    subpath = subpath.strip('/')
    all_activity = _load_json(target_root, '.activity.json')
    return [act for act in all_activity if act.get('name') == name and act.get('path') == subpath]


def build_user_search_index(user_id):
    """ Escanea el disco una única vez al inicio para poblar el mapa de búsqueda O(1). """
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
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
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
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
                for uid in os.listdir(BASE_CLOUD_ROOT):
                    if os.path.isdir(os.path.join(BASE_CLOUD_ROOT, uid)):
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


def get_download_token(view, name, subpath, owner_id, trash_id, token, is_preview=False):
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None
    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)
    target_path = None

    try:
        if owner_id and str(owner_id) != str(current_uid):
            target_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
        elif view == 'trash' and trash_id:
            base_user_root = get_user_root(token)
            trash_base = os.path.join(base_user_root, '.trash')
            target_path = safe_join(trash_base, trash_id)
        else:
            target_path = safe_join(user_root, subpath, name)
            if not os.path.exists(target_path):
                base_user_root = get_user_root(token)
                alt = safe_join(base_user_root, '.computers', subpath, name)
                if os.path.exists(alt):
                    target_path = alt
    except PermissionError:
        # Distinguir el motivo: si el recurso ya no existe (papelera del
        # dueño o desaparecido), el dueño se deshizo del archivo; si sigue
        # en su sitio, fue un "dejar de compartir" explícito.
        try:
            owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, str(owner_id)))
            trash_data = _load_json(owner_root, '.trash.json') or []
            for t in trash_data:
                if (str(t.get('name')) == name
                        and (t.get('original_path') or '').strip('/') == subpath.strip('/')):
                    return None, "shared_file_gone"
            if os.path.exists(safe_join(owner_root, subpath, name)):
                return None, "access_revoked"
            return None, "shared_file_gone"
        except Exception:
            return None, "shared_file_gone"
    except ValueError:
        return None, None

    if not target_path or not os.path.exists(target_path):
        return None, None

    dl_token = str(uuid.uuid4())
    is_dir = os.path.isdir(target_path)
    
    with tokens_lock:
        _cleanup_expired_tokens()
        download_tokens[dl_token] = {
            "path": target_path, "name": name, "is_dir": is_dir, "expires": time.time() + 300, "bound_user_id": current_uid
        }
        
    if is_preview:
        add_activity(sess.get_user(token), sess.get_user_id(token), "act_abrio", name, subpath, owner_id)
    else:
        add_activity(sess.get_user(token), sess.get_user_id(token), "act_descargo", name, subpath, owner_id)
    return dl_token, None


def get_multi_download_token(items, view, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None
    current_uid = sess.get_user_id(token)
    base_user_root = get_user_root(token)

    resolved = []
    for item in items:
        name = item.get('name')
        subpath = item.get('path', '').strip('/')
        owner_id = item.get('owner_id')

        try:
            if owner_id and str(owner_id) != str(current_uid):
                target_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
            else:
                target_path = safe_join(user_root, subpath, name)
                if not os.path.exists(target_path):
                    alt = safe_join(base_user_root, '.computers', subpath, name)
                    if os.path.exists(alt):
                        target_path = alt
                        
            if os.path.exists(target_path):
                resolved.append({"path": target_path, "name": name, "is_dir": os.path.isdir(target_path)})
        except (ValueError, PermissionError):
            continue

    if not resolved:
        return None, None

    dl_token = str(uuid.uuid4())
    
    with tokens_lock:
        _cleanup_expired_tokens()
        download_tokens[dl_token] = {"multi": True, "items": resolved, "expires": time.time() + 300, "bound_user_id": current_uid}
        
    add_activity(sess.get_user(token), sess.get_user_id(token), "act_descargo", f"{len(resolved)} archivos (ZIP)", "")
    return dl_token, None


def _iter_zip_entries(targets):
    """Genera (abs_path, arc_name) para cada archivo/carpeta de `targets`.

    Salta symlinks (CWE-22: evita incluir contenido externo al root) y
    normaliza las rutas relativas para que no puedan escaparse del ZIP.
    """
    for target, name in targets:
        clean_base = Path(name).name
        if os.path.isdir(target):
            for root, dirs, files in os.walk(target):
                # Omitir directorios symlink (podrían apuntar fuera del root)
                dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
                for d in dirs:
                    full_d = os.path.join(root, d)
                    rel = os.path.normpath(os.path.relpath(full_d, target)).replace("..", "")
                    if not os.path.isabs(rel) and ".." not in rel:
                        yield full_d, os.path.join(clean_base, rel)
                for f in files:
                    full_f = os.path.join(root, f)
                    if os.path.islink(full_f):
                        continue
                    rel = os.path.normpath(os.path.relpath(full_f, target)).replace("..", "")
                    if not os.path.isabs(rel) and ".." not in rel:
                        yield full_f, os.path.join(clean_base, rel)
        else:
            if not os.path.islink(target):
                yield target, clean_base


def _zip_stream(targets):
    """Generador de ZIP en streaming (DEFLATE + data descriptors).

    Los bytes del ZIP se producen a medida que se comprimen, sin almacenar
    el ZIP completo ni en disco ni en memoria: cada archivo se lee en chunks
    (con _yield_event_loop para no bloquear gevent) y se cede al navegador.
    Si el cliente cancela la descarga, el generador se cierra y se liberan
    los descriptores de archivo sin trabajo residual.

    `targets`: lista de (abs_path, arc_name).
    """
    central = []
    stream_offset = 0

    def _dos_time_date(ts):
        t = time.localtime(ts)
        return ((t.tm_hour << 11) | (t.tm_min << 5) | (t.tm_sec // 2),
                ((t.tm_year - 1980) << 9) | (t.tm_mon << 5) | t.tm_mday)

    for abs_path, arc_name in targets:
        try:
            st = os.stat(abs_path)
        except OSError:
            continue
        dos_time, dos_date = _dos_time_date(st.st_mtime)
        name_b = arc_name.encode('utf-8')

        if os.path.isdir(abs_path):
            if not name_b.endswith(b'/'):
                name_b += b'/'
            header = struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0x0800, 0,
                                 dos_time, dos_date, 0, 0, 0, len(name_b), 0)
            central.append((struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0x0800, 0,
                                        dos_time, dos_date, 0, 0, 0, len(name_b), 0, 0, 0, 0, 0,
                                        stream_offset), name_b))
            stream_offset += len(header) + len(name_b)
            yield header
            yield name_b
            continue

        entry_offset = stream_offset
        header = struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0x0800 | 0x0008, 8,
                             dos_time, dos_date, 0, 0, 0, len(name_b), 0)
        stream_offset += len(header) + len(name_b)
        yield header
        yield name_b

        crc = 0
        comp = zlib.compressobj(6, zlib.DEFLATED, -15)
        comp_size = 0
        try:
            with open(abs_path, 'rb') as f:
                while True:
                    data = f.read(_ZIP_CHUNK_BYTES)
                    if not data:
                        break
                    crc = zlib.crc32(data, crc)
                    out = comp.compress(data)
                    if out:
                        comp_size += len(out)
                        yield out
                    _yield_event_loop()
            tail = comp.flush()
            if tail:
                comp_size += len(tail)
                yield tail
        except OSError as e:
            logger.warning(f"[OPERATIONAL][WARN] Archivo omitido en ZIP por error de lectura: {abs_path}: {e}")

        crc &= 0xffffffff
        descriptor = struct.pack('<IIII', 0x08074b50, crc, comp_size, st.st_size)
        central.append((struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0x0800 | 0x0008, 8,
                                    dos_time, dos_date, crc, comp_size, st.st_size,
                                    len(name_b), 0, 0, 0, 0, 0, entry_offset), name_b))
        stream_offset += comp_size + len(descriptor)
        yield descriptor

    cd_offset = stream_offset
    cd_size = 0
    for rec, name in central:
        yield rec
        yield name
        cd_size += len(rec) + len(name)
    yield struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(central), len(central),
                      cd_size, cd_offset, 0)


def download_file(dl_token):
    current_token = request.cookies.get('token') or request.headers.get('X-Token')
    current_uid = sess.get_user_id(current_token) if current_token else None

    with tokens_lock:
        _cleanup_expired_tokens()
        if not dl_token or dl_token not in download_tokens:
            return None, "Token inválido o expirado"
        info = download_tokens[dl_token]
        
        if info.get("bound_user_id") and str(info["bound_user_id"]) != str(current_uid):
            return None, "Acceso denegado: Token no vinculado a su sesión"
            
        if time.time() > info['expires']:
            download_tokens.pop(dl_token, None)
            return None, "Token expirado"

    if info.get('multi'):
        targets = []
        for item in info['items']:
            target = item['path']
            name = item['name']
            if not os.path.exists(target):
                continue
            targets.append((target, name))
        return Response(_zip_stream(_iter_zip_entries(targets)),
                        mimetype='application/zip',
                        headers={'Content-Disposition': 'attachment; filename="Null-Void-Cloud-Files.zip"'}), None

    target = info['path']
    if not os.path.exists(target):
        return None, "No encontrado"

    force_dl = request.args.get('dl') == '1'
    clean_single_name = os.path.normpath(info['name']).lstrip("/").replace("..", "")

    if info.get('is_dir'):
        safe_zip_name = clean_single_name.replace('"', '').replace('\\', '').replace('/', '') or 'carpeta'
        return Response(_zip_stream(_iter_zip_entries([(target, clean_single_name)])),
                        mimetype='application/zip',
                        headers={'Content-Disposition': f'attachment; filename="{safe_zip_name}.zip"'}), None

    ext = os.path.splitext(clean_single_name)[1].lower()
    is_attachment = force_dl or (ext not in ('.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt'))
    return send_file(target, as_attachment=is_attachment, download_name=clean_single_name), None


def _transcode_video_worker(target, target_height, cache_dir, key, quality):
    """Transcodifica un vídeo a la calidad pedida en un hilo de fondo.

    Escribe primero a un .tmp y renombra al final (nunca se sirve un cache
    parcial). Si falla el primer intento con '-c:a copy' (audio no compatible
    con el contenedor mp4) reintenta con AAC.
    """
    tmp_target = os.path.join(cache_dir, f".tmp_{key}_{quality}.mp4")
    cached_file = os.path.join(cache_dir, f"{key}_{quality}.mp4")
    try:
        cmd = [
            'ffmpeg', '-y', '-i', target,
            '-vf', f'scale=-2:{target_height},format=yuv420p',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            tmp_target
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=_VIDEO_TRANSCODE_TIMEOUT)
        if result.returncode != 0:
            # Fallback si la copia de audio falla (p. ej. audio no-AAC para mp4)
            cmd_aac = [
                'ffmpeg', '-y', '-i', target,
                '-vf', f'scale=-2:{target_height},format=yuv420p',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                tmp_target
            ]
            result = subprocess.run(cmd_aac, capture_output=True, timeout=_VIDEO_TRANSCODE_TIMEOUT)

        if result.returncode == 0 and os.path.exists(tmp_target) and os.path.getsize(tmp_target) > 0:
            os.replace(tmp_target, cached_file)
        else:
            logger.warning(f"[VIDEO][WARN] FFmpeg transcode failed (code {result.returncode}): {result.stderr.decode('utf-8', errors='ignore')}")
            if os.path.exists(tmp_target):
                try:
                    os.unlink(tmp_target)
                except OSError:
                    pass
    except Exception as e:
        logger.warning(f"[VIDEO][WARN] Error al transcodificar video en calidad {quality}: {e}")
        if os.path.exists(tmp_target):
            try:
                os.unlink(tmp_target)
            except OSError:
                pass
    finally:
        with _video_jobs_lock:
            _video_jobs.pop(key, None)
        # Política LRU: tras cada transcode se comprueba el límite de caché.
        try:
            _cleanup_video_cache(cache_dir, force=True)
        except Exception:
            pass


def _source_video_height(target):
    """Altura del stream de vídeo del archivo, o 0 si no se puede conocer."""
    try:
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=height', '-of', 'csv=p=0', target],
            capture_output=True, text=True, timeout=15)
        if probe.returncode == 0 and probe.stdout.strip():
            return int(probe.stdout.strip().splitlines()[0])
    except Exception:
        pass
    return 0


def _video_cache_key(target, quality):
    try:
        st = os.stat(target)
    except OSError:
        return None, None
    key = hashlib.sha256(f"{target}:{st.st_size}:{st.st_mtime_ns}:{quality}".encode()).hexdigest()[:16]
    return key, st


def _cleanup_video_cache(cache_dir, force=False):
    """Política LRU: si el caché supera VIDEO_CACHE_MAX_MB se eliminan las
    versiones transcodificadas más antiguas (por mtime) hasta quedar bajo el
    límite. Nunca toca los .tmp en curso ni los originales de la nube."""
    global _video_cache_checked_at
    now = time.time()
    if not force and now - _video_cache_checked_at < 300:
        return
    try:
        entries = []
        total = 0
        for f in os.listdir(cache_dir):
            if f.startswith('.tmp_'):
                continue
            fp = os.path.join(cache_dir, f)
            try:
                sz = os.path.getsize(fp)
                mtime = os.path.getmtime(fp)
            except OSError:
                continue
            entries.append((mtime, fp, sz))
            total += sz
        limit = VIDEO_CACHE_MAX_MB * 1024 * 1024
        if total > limit:
            entries.sort()  # más antiguos primero (LRU)
            for _, fp, sz in entries:
                if total <= limit:
                    break
                try:
                    os.remove(fp)
                    total -= sz
                    logger.info(f"[VIDEO][INFO] Cache LRU: eliminado {os.path.basename(fp)} ({sz // 1024 // 1024} MB)")
                except OSError:
                    pass
        _video_cache_checked_at = now
    except Exception as e:
        logger.warning(f"[VIDEO][WARN] Limpieza de caché de vídeo falló: {e}")


def _maybe_prewarm_video(target):
    """Genera en segundo plano UNA calidad por defecto al abrir el vídeo, para
    que el selector tenga versiones disponibles sin procesar las 8 de golpe."""
    quality = VIDEO_PREWARM_QUALITY
    if quality not in VIDEO_QUALITIES:
        return
    try:
        cache_dir = os.path.join(BASE_CLOUD_ROOT, '.pool', 'video_cache')
        os.makedirs(cache_dir, exist_ok=True)
        source_height = _source_video_height(target)
        target_height = VIDEO_HEIGHTS[quality]
        if source_height and target_height >= source_height:
            return  # sin upscaling: no tiene sentido generar esta calidad
        key, _ = _video_cache_key(target, quality)
        if not key:
            return
        cached_file = os.path.join(cache_dir, f"{key}_{quality}.mp4")
        if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
            return
        with _video_jobs_lock:
            if key in _video_jobs:
                return
            _video_jobs[key] = True
            _video_executor.submit(
                _transcode_video_worker, target, target_height, cache_dir, key, quality)
    except Exception as e:
        logger.warning(f"[VIDEO][WARN] Prewarm de vídeo falló: {e}")


def stream_video(dl_token, quality='original', status_only=False, available_only=False):
    if not dl_token:
        return None, "Token requerido"

    with tokens_lock:
        info = download_tokens.get(dl_token)
        if not info:
            return None, "Token inválido o expirado"
            
        current_uid = sess.get_user_id(request.user_token) if hasattr(request, 'user_token') and request.user_token else None
        if not current_uid:
            token = request.cookies.get('token') or request.headers.get('X-Token')
            current_uid = sess.get_user_id(token) if token else None
            
        if info.get('bound_user_id') and str(info['bound_user_id']) != str(current_uid):
            return None, "Acceso denegado: Token no vinculado a su sesión"
            
        if time.time() > info['expires']:
            download_tokens.pop(dl_token, None)
            return None, "Token expirado"

    target = info['path']
    if not os.path.exists(target) or os.path.isdir(target):
        return None, "Archivo no encontrado"

    if not _is_safe_path(BASE_CLOUD_ROOT, target):
        return None, "Acceso denegado: Violación de aislamiento"

    ext = os.path.splitext(target)[1].lower()
    if ext not in ('.mp4', '.webm', '.mov', '.avi', '.mkv'):
        return send_file(target, conditional=True), None

    cache_dir = os.path.join(BASE_CLOUD_ROOT, '.pool', 'video_cache')

    # Verificación inteligente: devuelve las calidades ya generadas (cache) y
    # las que están transcodificándose, para que el selector solo muestre lo
    # que puede servirse al instante y no lance trabajo innecesario.
    if available_only:
        available = []
        processing = []
        skipped = []  # nunca se generarán (sin upscaling): el frontend no debe ofrecerlas
        try:
            os.makedirs(cache_dir, exist_ok=True)
            source_height = _source_video_height(target)
            for q in VIDEO_QUALITIES:
                if source_height and VIDEO_HEIGHTS[q] >= source_height:
                    skipped.append(q)
                    continue
                key, _ = _video_cache_key(target, q)
                if not key:
                    continue
                cached_file = os.path.join(cache_dir, f"{key}_{q}.mp4")
                if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
                    available.append(q)
                else:
                    with _video_jobs_lock:
                        if key in _video_jobs:
                            processing.append(q)
        except Exception as e:
            logger.warning(f"[VIDEO][WARN] Listado de calidades disponibles falló: {e}")
        return {"available": available, "processing": processing, "skipped": skipped}, None

    if quality == 'original':
        # Pre-warm: al abrir el vídeo se genera en segundo plano la calidad
        # por defecto (una sola; el resto se pide bajo demanda).
        _maybe_prewarm_video(target)
        return send_file(target, conditional=True), None

    if quality not in VIDEO_QUALITIES:
        return send_file(target, conditional=True), None

    target_height = VIDEO_HEIGHTS[quality]

    try:
        os.makedirs(cache_dir, exist_ok=True)
        key, _ = _video_cache_key(target, quality)
        cached_file = os.path.join(cache_dir, f"{key}_{quality}.mp4")

        if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
            return send_file(cached_file, mimetype='video/mp4', conditional=True), None

        if not shutil.which('ffmpeg'):
            return send_file(target, conditional=True), None

        # Sin upscaling: si la altura del origen es <= a la calidad pedida,
        # se sirve el original (transcodificar "hacia arriba" no aporta nada).
        source_height = _source_video_height(target)
        if source_height and target_height >= source_height:
            return send_file(target, conditional=True), None

        # Limpieza LRU (con throttling) antes de generar más caché.
        _cleanup_video_cache(cache_dir)

        # Lanza (o reutiliza) el trabajo de transcodificación en segundo plano.
        with _video_jobs_lock:
            if key not in _video_jobs:
                _video_jobs[key] = True
                _video_executor.submit(
                    _transcode_video_worker, target, target_height, cache_dir, key, quality)

        # Solo la primera petición espera un rato por si el archivo es pequeño
        # (UX ágil). El polling del frontend (status=1) responde al instante.
        if not status_only:
            deadline = time.time() + 5
            while time.time() < deadline:
                if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
                    break
                time.sleep(0.25)

        if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
            return send_file(cached_file, mimetype='video/mp4', conditional=True), None

        # Aún transcodificando: el frontend hace polling con status_only=1.
        return {"status": "processing", "quality": quality}, None
    except Exception as e:
        logger.warning(f"Error al transcodificar video local en calidad {quality}: {e}")
        return send_file(target, conditional=True), None


def init_user_cloud(user_id):
    if not user_id:
        return
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
    os.makedirs(user_root, exist_ok=True)
    os.makedirs(os.path.join(user_root, '.computers'), exist_ok=True)
    os.makedirs(os.path.join(user_root, '.trash'), exist_ok=True)
    for f in ('.activity.json', '.starred.json', '.protected.json', '.trash.json'):
        p = os.path.join(user_root, f)
        if not os.path.exists(p):
            _save_json(user_root, f, [])


def share_file(name, subpath, view, shared_with, token):
    current_uid = sess.get_user_id(token)
    if not current_uid or not name or not shared_with:
        return False
    if view == 'shared':
        return False
    
    v_root = get_view_root(view, token)
    if not v_root:
        return False
    subpath = subpath.strip('/')
    try:
        target_path = safe_join(v_root, subpath, name)
        if not os.path.exists(target_path):
            return False
    except ValueError:
        return False

    repository.share_file_with_users(current_uid, name, subpath, view, shared_with)
    return True


def list_shared_with_me(token):
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return None
    rows = repository.get_shared_with_me(current_uid)
    files = []
    starred_data = []
    base_root = get_user_root(token)
    if base_root:
        starred_data = _load_json(base_root, '.starred.json')

    for s in rows:
        try:
            if s['view'] == 'ai':
                owner_root = ai_root_for_uid(s['owner_id'])
            else:
                owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, s['owner_id']))
                if s['view'] == 'computers':
                    owner_root = os.path.realpath(os.path.join(owner_root, '.computers'))
            fp = safe_join(owner_root, s['file_path'], s['file_name'])
            
            if os.path.exists(fp):
                info = os.stat(fp)
                is_starred = False
                for item in starred_data:
                    if item.get('name') == s['file_name'] and item.get('path') == s['file_path']:
                        item_owner = item.get('owner_id')
                        if (not item_owner and not s['owner_id']) or str(item_owner) == str(s['owner_id']):
                            is_starred = True
                            break

                files.append({
                    "id": s['id'], "name": s['file_name'], "path": s['file_path'],
                    "owner": s['owner_name'], "owner_id": s['owner_id'],
                    "is_dir": os.path.isdir(fp), "size": info.st_size,
                    "mtime": s['created_at'], "ext": os.path.splitext(s['file_name'])[1].lower(),
                    "view": "shared", "is_shared": True, "starred": is_starred,
                })
        except ValueError:
            continue
    return files


def list_shared_subpath(subpath, token):
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return None, None

    subpath = (subpath or '').strip('/')
    if not subpath:
        return None, None

    try:
        _reject_relative_segments(subpath, None)
    except PermissionError:
        return None, None

    parts = subpath.split('/')
    top_name = parts[0]
    rest_path = '/'.join(parts[1:])

    rows = repository.get_shared_with_me(current_uid)
    shared_item = next((s for s in rows if s['file_name'] == top_name), None)
    if not shared_item:
        return None, None

    owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, shared_item['owner_id']))
    if shared_item['view'] == 'computers':
        owner_root = os.path.realpath(os.path.join(owner_root, '.computers'))

    try:
        target_path = safe_join(owner_root, shared_item['file_path'], shared_item['file_name'], rest_path)
    except ValueError:
        return None, None

    if not os.path.exists(target_path) or not os.path.isdir(target_path):
        return None, None

    starred_data = []
    base_root = get_user_root(token)
    if base_root:
        starred_data = _load_json(base_root, '.starred.json')

    files = []
    try:
        entries = os.listdir(target_path)
    except OSError as e:
        logger.error(f"No se pudo listar el directorio compartido: {e}")
        return None, None

    for name in entries:
        if name.startswith('.'):
            continue
        fp = os.path.join(target_path, name)
        if os.path.islink(fp): continue
        is_dir = os.path.isdir(fp)
        info = os.stat(fp)

        is_starred = False
        for item in starred_data:
            if item.get('name') == name and item.get('path') == subpath:
                item_owner = item.get('owner_id')
                if (not item_owner and not shared_item['owner_id']) or str(item_owner) == str(shared_item['owner_id']):
                    is_starred = True
                    break

        files.append({
            "name": name, "path": subpath, "is_dir": is_dir, "size": info.st_size,
            "mtime": info.st_mtime, "owner": shared_item['owner_name'],
            "owner_id": shared_item['owner_id'],
            "ext": os.path.splitext(name)[1].lower(),
            "view": "shared", "is_shared": True, "starred": is_starred
        })

    files.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return files, subpath

def list_shared_by_me(token):
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return None
    rows = repository.get_shared_by_me(current_uid)
    files = []
    
    owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, current_uid))
    for s in rows:
        try:
            curr_root = owner_root
            if s['view'] == 'computers':
                curr_root = os.path.realpath(os.path.join(curr_root, '.computers'))
            fp = safe_join(curr_root, s['file_path'], s['file_name'])
            
            if os.path.exists(fp):
                info = os.stat(fp)
                files.append({
                    "id": s['id'], "name": s['file_name'], "path": s['file_path'],
                    "owner": s['shared_with_name'], "owner_id": current_uid,
                    "shared_with": s['shared_with'], "shared_with_name": s['shared_with_name'],
                    "is_dir": os.path.isdir(fp), "size": info.st_size,
                    "mtime": s['created_at'], "ext": os.path.splitext(s['file_name'])[1].lower(),
                    "view": s['view'], "is_shared": True,
                })
        except ValueError:
            continue
    return files


def zip_item(view, name, subpath, token, zip_name=None):
    if not _check_agent_scope(view, subpath, token, name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None
        
    subpath = subpath.strip('/')
    try:
        target_path = safe_join(user_root, subpath, name)
    except ValueError:
        return None
        
    if not os.path.exists(target_path):
        return "El elemento a zipear no existe"
        
    if not zip_name or not str(zip_name).strip():
        base = os.path.splitext(name)[0] if not os.path.isdir(target_path) else name
        zip_name = f"{base}.zip"
    else:
        zip_name = str(zip_name).strip()
        if not zip_name.lower().endswith('.zip'):
            zip_name += '.zip'
            
    try:
        dest_zip_path = safe_join(user_root, subpath, zip_name)
    except ValueError:
        return None
        
    if os.path.exists(dest_zip_path):
        return f"Ya existe un archivo llamado '{zip_name}' en esta ubicación"

    # Calcular tamaño total y nº de archivos a comprimir
    total_size = 0
    file_count = 0
    if os.path.isdir(target_path):
        for root, dirs, files in os.walk(target_path):
            for file in files:
                if file.startswith('.'):
                    continue
                fp = os.path.join(root, file)
                try:
                    total_size += os.path.getsize(fp)
                except OSError:
                    pass
                file_count += 1
    else:
        total_size = os.path.getsize(target_path)
        file_count = 1

    # Cota superior: el ZIP nunca supera la suma de archivos + cabeceras
    estimate = total_size + file_count * 64 + 1024
    ok, err = _check_storage_capacity(token, estimate)
    if not ok:
        return err

    # Crear el zip en temporal para medir su tamaño real
    pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
    os.makedirs(pool_dir, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(suffix='.zip', dir=pool_dir)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            if os.path.isdir(target_path):
                for root, dirs, files in os.walk(target_path):
                    # Omitir directorios symlink (podrían apuntar fuera del root)
                    dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
                    for file in files:
                        if file.startswith('.'):
                            continue
                        abs_file = os.path.join(root, file)
                        # Omitir archivos symlink (CWE-22: evita incluir contenido externo)
                        if os.path.islink(abs_file):
                            continue
                        rel_in_zip = os.path.relpath(abs_file, os.path.dirname(target_path))
                        _zip_stream_write(zf, abs_file, rel_in_zip)
            else:
                _zip_stream_write(zf, target_path, name)

        real_size = os.path.getsize(temp_path)
        ok, err = _check_storage_capacity(token, real_size)
        if not ok:
            return err

        shutil.move(temp_path, dest_zip_path)
        temp_path = None

        current_user = sess.get_user(token)
        current_uid = sess.get_user_id(token)
        add_activity(current_user, current_uid, "act_creaste_la_carpeta", zip_name, subpath)
        invalidate_user_index(current_uid)
        return True
    except Exception as e:
        if os.path.exists(dest_zip_path):
            try: os.unlink(dest_zip_path)
            except Exception: pass
        logger.error(f"Error al comprimir {dest_zip_path}: {e}")
        return "Error al comprimir el elemento"
    finally:
        if temp_path and os.path.exists(temp_path):
            try: os.unlink(temp_path)
            except Exception: pass


def _zip_stream_write(zf, abs_file, arc_name):
    """Escribe un archivo en el ZIP leyendo en chunks fijos y cediendo el
    event loop, para no bloquear el servidor con archivos/carpetas grandes."""
    with open(abs_file, 'rb') as src, zf.open(arc_name, 'w') as dst:
        while True:
            chunk = src.read(_ZIP_CHUNK_BYTES)
            if not chunk:
                break
            dst.write(chunk)
            _yield_event_loop()


def unzip_item(view, name, subpath, token):
    if not _check_agent_scope(view, subpath, token, name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None
        
    subpath = subpath.strip('/')
    try:
        target_path = safe_join(user_root, subpath, name)
    except ValueError:
        return None
        
    if not os.path.exists(target_path) or os.path.isdir(target_path):
        return "El archivo a unzipear no existe o es un directorio"
        
    if not name.lower().endswith('.zip'):
        return "El archivo seleccionado no es un archivo .zip"

    MAX_ZIP_FILES = 10000
    MAX_ZIP_RATIO = 100
    RESERVED_NAMES = ('.activity.json', '.trash.json', '.starred.json', '.protected.json')

    try:
        with zipfile.ZipFile(target_path, 'r') as zf:
            dest_dir = safe_join(user_root, subpath)
            infolist = zf.infolist()

            # Límite de nº de elementos (Zip Bomb)
            if len(infolist) > MAX_ZIP_FILES:
                return f"El archivo zip contiene demasiados elementos (máximo {MAX_ZIP_FILES})."

            # Ratio de compresión agregado (Zip Bomb)
            total_uncompressed = sum(info.file_size for info in infolist)
            total_compressed = sum(info.compress_size for info in infolist)
            if total_compressed > 0 and (total_uncompressed / total_compressed) > MAX_ZIP_RATIO:
                return "El archivo zip tiene un ratio de compresión sospechoso (posible Zip Bomb)."

            # Límite de seguridad de tamaño descomprimido (CWE-400)
            if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
                return "El archivo comprimido supera la cuota o el límite de seguridad"

            # Comprobar cuota del usuario y disco físico con el tamaño real
            ok, err = _check_storage_capacity(token, total_uncompressed)
            if not ok:
                return "El archivo comprimido supera la cuota o el límite de seguridad"

            # Validar y filtrar todos los miembros antes de extraer
            members = []
            for info in infolist:
                name_norm = info.filename.replace('\\', '/')

                # Zip Slip: validar la ruta completa (con '..' intacto) antes de filtrar
                raw_path = os.path.abspath(os.path.join(dest_dir, name_norm))
                try:
                    inside = (os.path.commonpath([dest_dir, raw_path]) == dest_dir)
                except ValueError:
                    inside = False
                if not inside:
                    logger.error(
                        f"[SECURITY][ALERT] Zip Slip bloqueado en '{name}': miembro '{info.filename}' "
                        f"resuelve fuera del destino permitido ({dest_dir})"
                    )
                    return "El archivo zip contiene rutas no seguras (Zip Slip detectado)."

                # Ratio de compresión por archivo individual (Zip Bomb por miembro)
                if (info.compress_size > 0 and info.file_size >= 1024 * 1024
                        and info.file_size / info.compress_size > MAX_ZIP_RATIO):
                    logger.error(
                        f"[SECURITY][ALERT] Zip Bomb sospechosa en '{name}': miembro '{info.filename}' "
                        f"comprime {info.file_size / max(1, info.compress_size):.0f}:1"
                    )
                    return "El archivo zip tiene un ratio de compresión sospechoso (posible Zip Bomb)."

                parts = [p for p in name_norm.split('/') if p not in ('', '.')]
                if not parts:
                    continue
                # Omitir carpeta reservada de macOS
                if parts[0] == '__MACOSX':
                    continue
                # Omitir archivos o carpetas ocultos (empiezan por '.')
                if any(p.startswith('.') for p in parts):
                    continue
                # Omitir archivos reservados del sistema
                if parts[-1] in RESERVED_NAMES:
                    continue
                # Omitir enlaces simbólicos (evita symlink traversal)
                mode = (info.external_attr >> 16) & 0xFFFF
                if stat.S_ISLNK(mode):
                    continue

                member_path = os.path.abspath(os.path.join(dest_dir, *parts))
                members.append((info, member_path))

            # Extracción manual (sin extractall: no crea symlinks ni hardlinks)
            for info, member_path in members:
                if info.is_dir():
                    os.makedirs(member_path, exist_ok=True)
                    continue
                # Si ya existe, añadir sufijo numérico estilo SO: 'Archivo(1).txt'
                member_path = _unique_path(member_path)
                os.makedirs(os.path.dirname(member_path), exist_ok=True)
                with zf.open(info) as src, open(member_path, 'wb') as dst:
                    # Descompresión por chunks fijos, cediendo el event loop
                    while True:
                        chunk = src.read(_ZIP_CHUNK_BYTES)
                        if not chunk:
                            break
                        dst.write(chunk)
                        _yield_event_loop()

        current_user = sess.get_user(token)
        current_uid = sess.get_user_id(token)
        add_activity(current_user, current_uid, "act_subiste", f"Descomprimido: {name}", subpath)
        invalidate_user_index(current_uid)
        return True
    except Exception as e:
        logger.error(f"Error al descomprimir {name} en {subpath}: {e}")
        return "Error al descomprimir el archivo"

# Barrido periódico del índice de contenido (hilo daemon al cargar el módulo)
_start_content_index_sweeper()
