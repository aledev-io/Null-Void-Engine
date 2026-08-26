import json
import os
import queue
import re
import shutil
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from modules.session import session as sess
from config.config import CONFIG

TEMP_BACKUP_DIR = "/tmp/nullvoid_backups"
os.makedirs(TEMP_BACKUP_DIR, exist_ok=True)

ALLOWED_BACKUP_TYPES = ("full", "differential", "incremental")

# Límites y tuning anti-DoS (CWE-400). Configurables por variables de entorno.
CHUNK_BYTES = int(os.environ.get("BACKUP_CHUNK_BYTES", str(2 * 1024 * 1024)))
PROGRESS_EVERY_BYTES = max(
    CHUNK_BYTES,
    int(os.environ.get("BACKUP_PROGRESS_EVERY_BYTES", str(8 * 1024 * 1024))),
)
MAX_FILE_BYTES = int(os.environ.get("BACKUP_MAX_FILE_BYTES", str(16 * 1024 ** 3)))
MAX_TOTAL_BYTES = int(os.environ.get("BACKUP_MAX_TOTAL_BYTES", str(256 * 1024 ** 3)))
MAX_FILES = int(os.environ.get("BACKUP_MAX_FILES", "100000"))
MAX_TREE_DEPTH = int(os.environ.get("BACKUP_MAX_TREE_DEPTH", "64"))
# Anti zip-bomb: si un archivo >= SUSPICIOUS_MIN_BYTES comprime por debajo de
# SUSPICIOUS_RATIO, se cancela el respaldo (entrada imposible de remover del ZIP).
SUSPICIOUS_MIN_BYTES = int(os.environ.get("BACKUP_SUSPICIOUS_MIN_BYTES", str(128 * 1024 ** 2)))
SUSPICIOUS_RATIO = float(os.environ.get("BACKUP_SUSPICIOUS_RATIO", "0.001"))
# Hilos worker acotados: evita agotamiento de recursos con backups simultáneos.
BACKUP_WORKERS = max(1, int(os.environ.get("BACKUP_WORKERS", "2")))

_BACKUP_EXECUTOR = ThreadPoolExecutor(
    max_workers=BACKUP_WORKERS,
    thread_name_prefix="nv-bkp",
)

# Extensiones de contenido ya comprimido: se almacenan sin DEFLATE (CPU barato,
# evita trabajo inútil en media y formatos comprimidos).
_STORED_EXTS = {
    ".zip", ".rar", ".7z", ".gz", ".bz2", ".xz", ".zst", ".tar",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp",
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv",
    ".mp3", ".flac", ".ogg", ".aac", ".wma", ".opus",
    ".iso", ".dmg", ".exe", ".msi", ".apk", ".deb", ".rpm",
    ".docx", ".xlsx", ".pptx",
}

_ZIP64_LIMIT = zipfile.ZIP64_LIMIT


class _BackupCancelled(Exception):
    pass


class _BackupSuspiciousFile(Exception):
    pass


class _BackupLimitExceeded(Exception):
    pass


class _BackupError(Exception):
    pass


def _safe_remove(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _qput(q, evt, cancel_event):
    """Inserta un evento en la cola de progreso respetando cancelación."""
    while not cancel_event.is_set():
        try:
            q.put(evt, timeout=0.25)
            return
        except queue.Full:
            continue


def _is_stored_ext(name):
    ext = os.path.splitext(name)[1].lower()
    return ext in _STORED_EXTS


def normalize_backup_type(value):
    """Normaliza un tipo de respaldo; cualquier valor no válido cae a 'full'."""
    return value if value in ALLOWED_BACKUP_TYPES else "full"


def _backup_meta_file(user_id):
    return os.path.join(CONFIG.DATA_DIR, "Cloud", user_id, ".backups", "backup_meta.json")


def backup_vault(user_id):
    """Ruta reservada e independiente para respaldos (carpeta oculta del servidor)."""
    return os.path.join(CONFIG.DATA_DIR, "Cloud", user_id, ".backups")


def load_backup_meta(user_id):
    """Registro de metadatos del usuario: fecha del último respaldo Completo y del último snapshot."""
    try:
        with open(_backup_meta_file(user_id), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_backup_meta(user_id, meta):
    path = _backup_meta_file(user_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def _update_backup_meta(user_id, backup_type):
    """Actualiza el registro tras un backup: 'full' renueva last_full; todo renueva last_snapshot."""
    now_ms = int(time.time() * 1000)
    meta = load_backup_meta(user_id)
    meta.setdefault("last_full", None)
    meta.setdefault("last_snapshot", None)
    if backup_type == "full":
        meta["last_full"] = now_ms
    meta["last_snapshot"] = now_ms
    save_backup_meta(user_id, meta)
    return meta


def _since_for_type(meta, backup_type):
    """Fecha de referencia (epoch ms) para filtrar archivos según el tipo de respaldo."""
    if backup_type == "differential":
        return meta.get("last_full")
    if backup_type == "incremental":
        return meta.get("last_snapshot")
    return None


def _build_manifest(backup_type, since_ms, saved):
    manifest = {
        "backup_type": backup_type,
        "created_at": datetime.now().isoformat(),
        "since_ms": since_ms,
        "since_iso": datetime.fromtimestamp(since_ms / 1000).isoformat() if since_ms else None,
        "files": saved,
    }
    return json.dumps(manifest, ensure_ascii=False, indent=2)


# Núcleo de compresión: I/O por chunks, escritura a .tmp + rename atómico,
# cancelación cooperativa y protección contra zip-bombs / límites (CWE-400).
def _zip_entries(zip_path, entries, manifest_json, q=None, cancel_event=None, total=0):
    """
    Comprime una lista de (arc_name, abs_path) en zip_path.

    - Lee/escribe en fragmentos fijos (CHUNK_BYTES) sin cargar archivos completos en RAM.
    - Escribe primero a zip_path + ".tmp" y renombra al final (nunca quedan ZIPs
      parciales con nombre final; si falla o se cancela, se elimina el .tmp).
    - Emite progreso periódico en la cola (si se provee) para alimentar SSE.
    - Cancela cooperativamente si cancel_event se activa.
    """
    tmp_path = zip_path + ".tmp"
    emit = (lambda evt: _qput(q, evt, cancel_event)) if q else (lambda evt: None)
    completed = 0
    total_bytes = 0
    try:
        os.makedirs(os.path.dirname(tmp_path), exist_ok=True)
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            if manifest_json:
                zf.writestr("manifest.json", manifest_json)
            for idx, (arc_name, abs_path) in enumerate(entries, 1):
                if cancel_event is not None and cancel_event.is_set():
                    raise _BackupCancelled()

                try:
                    fsize = os.path.getsize(abs_path)
                except OSError:
                    continue

                if fsize > MAX_FILE_BYTES:
                    emit({"type": "progress", "phase": "scan", "current": idx, "total": total,
                          "file": f"Saltando (excede límite): {arc_name}"})
                    continue
                if total_bytes + fsize > MAX_TOTAL_BYTES:
                    raise _BackupLimitExceeded(
                        "El tamaño total del respaldo excede el límite permitido por el servidor."
                    )
                if completed >= MAX_FILES:
                    raise _BackupLimitExceeded(
                        "Se alcanzó el límite de archivos del respaldo."
                    )

                compress_type = zipfile.ZIP_STORED if _is_stored_ext(arc_name) else zipfile.ZIP_DEFLATED
                before = os.path.getsize(tmp_path)

                with open(abs_path, "rb") as src:
                    zinfo = zipfile.ZipInfo.from_file(abs_path, arc_name)
                    zinfo.compress_type = compress_type
                    with zf.open(zinfo, "w", force_zip64=fsize >= _ZIP64_LIMIT) as dest:
                        written = 0
                        last_report = 0
                        while True:
                            if cancel_event is not None and cancel_event.is_set():
                                raise _BackupCancelled()
                            data = src.read(CHUNK_BYTES)
                            if not data:
                                break
                            dest.write(data)
                            written += len(data)
                            total_bytes += len(data)
                            if q and written - last_report >= PROGRESS_EVERY_BYTES:
                                last_report = written
                                emit({"type": "progress", "phase": "compress",
                                      "current": idx, "total": total, "file": arc_name,
                                      "bytes": written, "file_bytes": fsize})

                # Anti zip-bomb: ratio de compresión extremo en un archivo grande.
                compressed_delta = max(0, os.path.getsize(tmp_path) - before)
                if fsize >= SUSPICIOUS_MIN_BYTES and compressed_delta < fsize * SUSPICIOUS_RATIO:
                    raise _BackupSuspiciousFile(arc_name)

                completed += 1
                if q:
                    emit({"type": "progress", "phase": "compress",
                          "current": idx, "total": total, "file": arc_name,
                          "bytes": written, "file_bytes": fsize})

        os.replace(tmp_path, zip_path)
        return {"count": completed, "total_bytes": total_bytes}
    except Exception:
        # CWE-400: nunca dejar parciales (zip o .tmp) ante fallo o cancelación.
        _safe_remove(tmp_path)
        _safe_remove(zip_path)
        raise


# Resolución y recorrido de fuentes en Cloud (CWE-22).
def _cloud_root(user_id):
    return os.path.join(CONFIG.DATA_DIR, "Cloud", user_id)


def resolve_cloud_sources(user_id, source_paths):
    """
    Valida y resuelve rutas de origen dentro de Cloud/<user_id>/.

    Acepta rutas relativas y la cadena vacía '' (toda Mi unidad / la raíz).
    Rechaza: rutas absolutas, separadores alternativos, NUL, '~', '..' y
    cualquier segmento oculto. Tras realpath() (que resuelve symlinks), se
    vuelve a comprobar que el destino permanezca bajo el root asignado.
    """
    root = os.path.realpath(_cloud_root(user_id))
    resolved = []
    seen = set()
    for p in (source_paths or []):
        p = str(p).strip()
        if not p and p != "":
            continue
        if p in seen:
            continue
        # Rechazo explícito de rutas peligrosas o exóticas.
        if (p.startswith("/") or "\\" in p or ":" in p
                or "\x00" in p or "~" in p):
            continue
        p = p.strip("/")
        if p in seen:
            continue
        parts = [part.strip() for part in p.split("/") if part.strip() not in ("", ".")]
        if parts and any(part == ".." or part.startswith(".") for part in parts):
            continue
        try:
            abs_path = os.path.realpath(os.path.join(root, *parts)) if parts else root
        except (ValueError, OSError):
            continue
        if abs_path != root and not abs_path.startswith(root + os.sep):
            continue
        if not os.path.exists(abs_path):
            continue
        seen.add(p)
        resolved.append((p, abs_path))
    return resolved


def _excluded_path(rel, exclude_paths):
    """
    True si 'rel' (ruta relativa al Cloud, ej. 'Asignaturas/1/apuntes.pdf')
    coincide con una ruta excluida o vive dentro de una carpeta excluida.
    """
    if not exclude_paths:
        return False
    parts = rel.split("/") if rel else []
    for i in range(len(parts), 0, -1):
        if "/".join(parts[:i]) in exclude_paths:
            return True
    return False


def _normalize_exclude_paths(value):
    """
    Normaliza rutas excluidas (mismas reglas de seguridad que
    resolve_cloud_sources). Devuelve un conjunto de rutas relativas.
    La raíz '' no se acepta como exclusión (sería 'no respaldar nada').
    """
    if value is None:
        return set()
    raw_items = value if isinstance(value, list) else [value]
    excluded = set()
    for item in raw_items:
        p = str(item).strip()
        if not p:
            continue
        if (p.startswith("/") or "\\" in p or ":" in p
                or "\x00" in p or "~" in p):
            continue
        p = p.strip("/")
        if not p:
            continue
        parts = [part.strip() for part in p.split("/") if part.strip() not in ("", ".")]
        if any(part == ".." or part.startswith(".") for part in parts):
            continue
        excluded.add("/".join(parts))
    return excluded


def _walk_cloud_source(root_abs, rel_prefix, arc_prefix, depth=0, exclude_exts=None,
                       exclude_paths=None):
    """
    Recorre recursivamente una carpeta del Cloud omitiendo ocultos y symlinks
    (un symlink podría apuntar fuera del root). Profundidad acotada.

    exclude_exts: conjunto de extensiones (minúsculas, con punto, ej. {'.tmp'})
    cuyos archivos se omiten del respaldo.

    exclude_paths: conjunto de rutas relativas al Cloud (ej. {'A/1'}) cuyos
    archivos y subárboles completos se omiten.

    rel_prefix debe ser la ruta relativa al Cloud del bloque raíz ('' para
    Mi unidad), para que cada 'rel' generado sea comparable con exclude_paths.
    Devuelve (entries, skipped_count).
    """
    if depth > MAX_TREE_DEPTH:
        return [], 0
    entries = []
    skipped = 0
    try:
        for entry in os.scandir(root_abs):
            if entry.name.startswith(".") or entry.is_symlink():
                continue
            rel = os.path.join(rel_prefix, entry.name) if rel_prefix else entry.name
            arc = os.path.join(arc_prefix, entry.name) if arc_prefix else entry.name
            if entry.is_file():
                if (exclude_exts and os.path.splitext(entry.name)[1].lower() in exclude_exts) \
                        or _excluded_path(rel, exclude_paths):
                    skipped += 1
                    continue
                entries.append((arc, entry.path))
            elif entry.is_dir():
                if _excluded_path(rel, exclude_paths):
                    skipped += 1
                    continue
                sub_entries, sub_skipped = _walk_cloud_source(
                    entry.path, rel, arc, depth + 1, exclude_exts, exclude_paths)
                entries.extend(sub_entries)
                skipped += sub_skipped
    except OSError:
        pass
    return entries, skipped


# Consumidor de cola para streams SSE: mantiene el event loop vivo con
# heartbeats periódicos y responde a desconexiones del cliente (cancelación).
def _consume_job(q, future, cancel_event, zip_path):
    last_progress = None
    last_yield = time.monotonic()
    error_emitted = False
    try:
        while True:
            try:
                evt = q.get(timeout=0.5)
            except queue.Empty:
                if future.done():
                    break
                now = time.monotonic()
                if now - last_yield >= 2.0:
                    if last_progress:
                        hb = dict(last_progress)
                        hb["heartbeat"] = True
                        yield hb
                    else:
                        yield {"type": "progress", "phase": "scan", "current": 0, "total": 0, "file": ""}
                    last_yield = now
                continue
            if evt is None:
                break
            if evt.get("type") == "error":
                error_emitted = True
            if evt.get("type") == "progress":
                last_progress = evt
            last_yield = time.monotonic()
            yield evt
        # Drenar eventos residuales (el sentinel ya salió por get/Empty).
        while True:
            try:
                evt = q.get_nowait()
            except queue.Empty:
                break
            if evt is None:
                break
            if evt.get("type") == "error":
                error_emitted = True
            if evt.get("type") == "progress":
                last_progress = evt
            yield evt
        exc = future.exception()
        if exc is not None and not error_emitted:
            yield {"type": "error", "message": f"Error al generar el backup: {exc}"}
            error_emitted = True
    finally:
        # Desconexión del cliente o fin: cancelar worker y limpiar parciales.
        cancel_event.set()
        _safe_remove(zip_path + ".tmp")
        _safe_remove(zip_path + ".tmp_enc")
        if error_emitted:
            _safe_remove(zip_path)


# Worker de compresión que ejecuta la tarea pesada en un hilo secundario.
def _stream_worker(zip_path, entries, manifest_json, user_id, dest_mode, cloud_path,
                   backup_type, since_ms, zip_name, total, q, cancel_event):
    try:
        os.makedirs(os.path.dirname(zip_path), exist_ok=True)
        _zip_entries(zip_path, entries, manifest_json, q, cancel_event, total)
        _update_backup_meta(user_id, backup_type)
        if dest_mode == "cloud":
            from core.crypto_utils import encrypt_file
            encrypt_file(zip_path, zip_path)
            _enforce_copies_limit(user_id, cloud_path, 5)
            _qput(q, {"type": "done", "cloud": True, "zip_name": zip_name,
                      "backup_type": backup_type, "since": since_ms, "count": total}, cancel_event)
        else:
            _qput(q, {"type": "done", "cloud": False, "zip_name": zip_name,
                      "zip_url": f"/api/backup/download/{zip_name}",
                      "backup_type": backup_type, "since": since_ms, "count": total}, cancel_event)
    except _BackupCancelled:
        _qput(q, {"type": "error", "message": "Operación cancelada."}, cancel_event)
    except _BackupSuspiciousFile as e:
        _qput(q, {"type": "error",
                  "message": f"Archivo sospechoso omitido por compresión extrema ({e}); respaldo cancelado."},
              cancel_event)
    except _BackupLimitExceeded as e:
        _qput(q, {"type": "error", "message": str(e)}, cancel_event)
    except _BackupError as e:
        _qput(q, {"type": "error", "message": str(e)}, cancel_event)
    except Exception as e:
        _qput(q, {"type": "error", "message": f"Error al generar el backup: {str(e)}"}, cancel_event)
    finally:
        try:
            q.put_nowait(None)
        except Exception:
            pass


def _normalize_exclude_exts(value):
    """
    Normaliza una lista de extensiones excluidas (defensa en profundidad).

    Acepta: lista o cadena separada por comas. Cada ítem puede venir como
    ".tmp", "tmp" o "*.tmp". Devuelve un conjunto de extensiones minúsculas
    con punto ({"", ".tmp"}). Rechaza ítems con separadores, NUL o comodines
    distintos de un único '*' inicial. Máximo 30 extensiones.
    """
    if value is None:
        return set()
    raw_items = value if isinstance(value, list) else str(value).split(",")
    exts = set()
    for item in raw_items:
        item = str(item).strip().lower()
        if not item:
            continue
        if item.startswith("*."):
            item = item[1:]
        if not item.startswith("."):
            item = "." + item
        if len(item) > 13:
            continue
        if not re.match(r"^\.[a-z0-9][a-z0-9_-]*$", item):
            continue
        exts.add(item)
        if len(exts) >= 30:
            break
    return exts


def _cloud_stream_worker(user_id, source_paths, dest_mode, cloud_path, backup_type,
                         since_ms, zip_name, zip_path, q, cancel_event,
                         exclude_exts=None, exclude_paths=None):
    exclude_exts = _normalize_exclude_exts(exclude_exts)
    exclude_paths = _normalize_exclude_paths(exclude_paths)
    try:
        resolved = resolve_cloud_sources(user_id, source_paths)
        if not resolved:
            raise _BackupError("No se encontraron las carpetas seleccionadas.")

        # Poda de solapamientos: si ya se incluye una carpeta, sus rutas
        # internas son redundantes (evita entradas duplicadas en el ZIP).
        # Se ordenan por profundidad para que los ancestros (y la raíz '')
        # se procesen antes que sus contenidos.
        resolved = sorted(resolved, key=lambda r: (r[0].count("/"), r[0]))
        included_dirs = []
        kept = []
        for rel_path, abs_path in resolved:
            if os.path.isdir(abs_path):
                if any(abs_path == d or abs_path.startswith(d + os.sep) for d in included_dirs):
                    continue
                included_dirs.append(abs_path)
            else:
                if any(abs_path.startswith(d + os.sep) for d in included_dirs):
                    continue
            kept.append((rel_path, abs_path))

        all_files = []
        skipped_by_exclusion = 0
        for rel_path, abs_path in kept:
            if cancel_event.is_set():
                raise _BackupCancelled()
            if os.path.isfile(abs_path):
                # Archivo individual: conserva su ruta relativa en el ZIP
                # (Asignaturas/1/apuntes.pdf) para no perder estructura y
                # evitar colisiones entre archivos homónimos. Los archivos
                # elegidos uno a uno se incluyen siempre salvo que estén
                # excluidos explícitamente por el usuario.
                if _excluded_path(rel_path, exclude_paths):
                    skipped_by_exclusion += 1
                    continue
                all_files.append((rel_path, abs_path))
            elif os.path.isdir(abs_path):
                if _excluded_path(rel_path, exclude_paths):
                    skipped_by_exclusion += 1
                    continue
                folder_name = "Mi unidad" if rel_path == "" else (os.path.basename(abs_path) or "raiz")
                walked, walked_skipped = _walk_cloud_source(
                    abs_path, rel_path, folder_name, 0, exclude_exts, exclude_paths)
                all_files.extend(walked)
                skipped_by_exclusion += walked_skipped
            else:
                _qput(q, {"type": "progress", "phase": "scan", "current": 0, "total": 0,
                          "file": f"Saltando: {rel_path}"}, cancel_event)

        if skipped_by_exclusion:
            _qput(q, {"type": "progress", "phase": "scan", "current": 0, "total": 0,
                      "file": f"{skipped_by_exclusion} elemento(s) omitido(s) por reglas de exclusión."},
                  cancel_event)

        if len(all_files) > MAX_FILES:
            _qput(q, {"type": "progress", "phase": "scan", "current": MAX_FILES, "total": MAX_FILES,
                      "file": f"Se omite el exceso sobre {MAX_FILES} archivos."}, cancel_event)
            all_files = all_files[:MAX_FILES]

        total = len(all_files)
        if total == 0:
            raise _BackupError("Las carpetas seleccionadas no contienen archivos.")

        _qput(q, {"type": "progress", "phase": "scan", "current": total, "total": total,
                  "file": f"Empaquetando {total} archivos…"}, cancel_event)

        manifest_json = None
        if backup_type != "full":
            manifest_json = _build_manifest(backup_type, since_ms, [a for a, _ in all_files])
        _stream_worker(zip_path, all_files, manifest_json, user_id, dest_mode, cloud_path,
                       backup_type, since_ms, zip_name, total, q, cancel_event)
    except _BackupCancelled:
        _qput(q, {"type": "error", "message": "Operación cancelada."}, cancel_event)
    except _BackupSuspiciousFile as e:
        _qput(q, {"type": "error",
                  "message": f"Archivo sospechoso omitido por compresión extrema ({e}); respaldo cancelado."},
              cancel_event)
    except _BackupLimitExceeded as e:
        _qput(q, {"type": "error", "message": str(e)}, cancel_event)
    except _BackupError as e:
        _qput(q, {"type": "error", "message": str(e)}, cancel_event)
    except Exception as e:
        _qput(q, {"type": "error", "message": f"Error al generar el backup: {str(e)}"}, cancel_event)
    finally:
        try:
            q.put_nowait(None)
        except Exception:
            pass


# API pública (firmas y estructuras JSON inalteradas).
def create_backup(files, dest_mode, cloud_path, token, backup_type="full"):
    """
    Procesa la lista de archivos enviados desde el frontend, genera un ZIP
    (en worker secundario) y lo almacena en el búnker o lo prepara para descarga.

    backup_type: "full" (todos los archivos), "differential" o "incremental"
    (los ZIP parciales incluyen un manifest.json con la fecha de referencia).
    """
    backup_type = normalize_backup_type(backup_type)
    user_id = sess.get_user_id(token)
    if not user_id:
        return None, "No autorizado"

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"backup_{backup_type}_{timestamp}.zip"

    meta = load_backup_meta(user_id)
    since_ms = _since_for_type(meta, backup_type)

    with tempfile.TemporaryDirectory() as tmp_dir:
        saved = []
        for f in files:
            safe_name = os.path.basename(f.filename or "")
            if safe_name:
                f.save(os.path.join(tmp_dir, safe_name))
                saved.append(safe_name)

        if not saved:
            return None, "No se han seleccionado archivos."

        entries = [(n, os.path.join(tmp_dir, n)) for n in saved]
        dest = backup_vault(user_id) if dest_mode == "cloud" else os.path.join(TEMP_BACKUP_DIR, str(user_id))
        os.makedirs(dest, exist_ok=True)
        zip_path = os.path.join(dest, zip_name)

        manifest_json = None
        if backup_type != "full":
            manifest_json = _build_manifest(backup_type, since_ms, saved)

        cancel_event = threading.Event()
        future = _BACKUP_EXECUTOR.submit(
            _zip_entries, zip_path, entries, manifest_json, None, cancel_event, len(entries)
        )
        try:
            future.result()
        except _BackupCancelled:
            return None, "Operación cancelada."
        except _BackupLimitExceeded as e:
            return None, str(e)
        except _BackupSuspiciousFile as e:
            return None, f"Archivo sospechoso ({e}) omitido por compresión extrema."
        except Exception as e:
            _safe_remove(zip_path)
            _safe_remove(zip_path + ".tmp")
            return None, f"Error al generar el backup: {str(e)}"

        _update_backup_meta(user_id, backup_type)
        if dest_mode == "cloud":
            from core.crypto_utils import encrypt_file
            try:
                encrypt_file(zip_path, zip_path)
            except Exception:
                _safe_remove(zip_path)
                _safe_remove(zip_path + ".tmp_enc")
                return None, "Error al cifrar el respaldo."
            _enforce_copies_limit(user_id, cloud_path, 5)
            return {
                "cloud": True,
                "zip_name": zip_name,
                "backup_type": backup_type,
                "since": since_ms,
                "count": len(saved),
            }, None
        return {
            "cloud": False,
            "zip_name": zip_name,
            "zip_url": f"/api/backup/download/{zip_name}",
            "backup_type": backup_type,
            "since": since_ms,
            "count": len(saved),
        }, None


def create_backup_stream(file_names, upload_dir, dest_mode, cloud_path, token, backup_type="full"):
    """
    Generador SSE que crea el ZIP en un hilo secundario y emite progreso
    periódico, dejando el event loop libre para heartbeats y peticiones HTTP.

    Los archivos ya deben estar materializados en upload_dir.
    """
    backup_type = normalize_backup_type(backup_type)
    user_id = sess.get_user_id(token)
    if not user_id:
        yield {"type": "error", "message": "No autorizado"}
        return

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"backup_{backup_type}_{timestamp}.zip"
    total = len(file_names)
    meta = load_backup_meta(user_id)
    since_ms = _since_for_type(meta, backup_type)

    if not file_names:
        yield {"type": "error", "message": "No se han seleccionado archivos."}
        return

    yield {"type": "progress", "phase": "upload", "current": total, "total": total, "file": ""}

    dest = backup_vault(user_id) if dest_mode == "cloud" else os.path.join(TEMP_BACKUP_DIR, str(user_id))
    zip_path = os.path.join(dest, zip_name)
    entries = [(n, os.path.join(upload_dir, n)) for n in file_names]
    manifest_json = None
    if backup_type != "full":
        manifest_json = _build_manifest(backup_type, since_ms, file_names)

    cancel_event = threading.Event()
    q = queue.Queue(maxsize=256)
    future = _BACKUP_EXECUTOR.submit(
        _stream_worker, zip_path, entries, manifest_json, user_id, dest_mode, cloud_path,
        backup_type, since_ms, zip_name, total, q, cancel_event,
    )
    try:
        yield from _consume_job(q, future, cancel_event, zip_path)
    except GeneratorExit:
        cancel_event.set()
        raise


def _automation_file(user_id):
    return os.path.join(CONFIG.DATA_DIR, "Cloud", user_id, ".backups", "automation.json")


def load_automations_config(user_id):
    """Carga la lista de automatizaciones de respaldo del usuario.
    Soporta el formato antiguo (un único objeto) migrándolo a lista y
    garantiza que cada entrada tenga id y name."""
    try:
        with open(_automation_file(user_id), encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []

    if isinstance(data, list):
        automations = data
    elif isinstance(data, dict) and isinstance(data.get("automations"), list):
        automations = data["automations"]
    elif isinstance(data, dict) and data:
        automations = [data]
    else:
        return []

    for i, cfg in enumerate(automations):
        if not isinstance(cfg, dict):
            continue
        if not cfg.get("id"):
            cfg["id"] = f"auto_{i+1}"
        if not cfg.get("name"):
            cfg["name"] = f"Respaldo {i+1}"
    return automations


def save_automations_config(user_id, automations):
    """Persiste la lista de automatizaciones de respaldo del usuario."""
    path = _automation_file(user_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"automations": automations}, f, ensure_ascii=False, indent=2)


def load_automation_config(user_id):
    """Compatibilidad: devuelve la primera automatización (o {} si no hay)."""
    automations = load_automations_config(user_id)
def save_automation_config(user_id, cfg):
    """Compatibilidad: guarda una única configuración como lista."""
    save_automations_config(user_id, [cfg] if isinstance(cfg, dict) else cfg)


def get_user_backup_path(user_id, filename):
    """Obtiene la ruta de un archivo de respaldo garantizando pertenencia a user_id (Anti-IDOR)."""
    if not user_id or not filename:
        return None
    safe_filename = os.path.basename(filename)

    # 1. Buscar en el vault de la nube del usuario
    vault_dir = backup_vault(user_id)
    candidate_vault = os.path.join(vault_dir, safe_filename)
    if os.path.exists(candidate_vault):
        return candidate_vault

    # 2. Buscar en la carpeta temporal aislada del usuario
    user_temp_dir = os.path.join(TEMP_BACKUP_DIR, str(user_id))
    candidate_temp = os.path.join(user_temp_dir, safe_filename)
    if os.path.exists(candidate_temp):
        return candidate_temp

    return None


def get_zip_path(filename, user_id=None):
    if user_id:
        return get_user_backup_path(user_id, filename)
    safe_name = os.path.basename(filename)
    path = os.path.join(TEMP_BACKUP_DIR, safe_name)
    return path if os.path.exists(path) else None


def cleanup_old_temp():
    """Limpia ZIPs y .tmp huérfanos de más de 1 hora en el directorio temporal."""
    try:
        for root, dirs, files in os.walk(TEMP_BACKUP_DIR):
            for f in files:
                path = os.path.join(root, f)
                if os.path.isfile(path) and (time.time() - os.path.getmtime(path) > 3600):
                    if f.endswith(".zip") or f.endswith(".tmp") or f.startswith("backup_"):
                        try:
                            os.remove(path)
                        except OSError:
                            pass
    except Exception:
        pass


def create_cloud_backup_stream(user_id, source_paths, dest_mode, cloud_path,
                               backup_type="full", exclude_exts=None, exclude_paths=None):
    """
    Generador SSE que respalda carpetas/archivos del Cloud del usuario.

    exclude_exts: lista de extensiones (".tmp", "log", "*.zip", ...) que se
    omitirán del contenido de las carpetas marcadas.

    exclude_paths: lista de subrutas relativas que se ignorarán.
    """
    user_id = str(user_id)
    dest = backup_vault(user_id) if dest_mode == "cloud" else os.path.join(TEMP_BACKUP_DIR, user_id)
    os.makedirs(dest, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"backup_{backup_type}_{timestamp}.zip"
    zip_path = os.path.join(dest, zip_name)

    meta = load_backup_meta(user_id)
    since_ms = _since_for_type(meta, backup_type)

    q = queue.Queue()
    cancel_event = threading.Event()

    future = _BACKUP_EXECUTOR.submit(
        _cloud_stream_worker,
        user_id,
        source_paths,
        dest_mode,
        cloud_path,
        backup_type,
        since_ms,
        zip_name,
        zip_path,
        q,
        cancel_event,
        exclude_exts,
        exclude_paths,
    )

    return _consume_job(q, future, cancel_event, zip_path)


def _enforce_copies_limit(user_id, cloud_path, limit):
    """Conserva únicamente las `limit` copias más recientes por usuario."""
    try:
        dest = backup_vault(user_id)
        if not os.path.isdir(dest):
            return
        bkp_files = []
        for f in os.listdir(dest):
            if f.startswith("backup_") and (f.endswith(".zip") or f.endswith(".nvbak")):
                fp = os.path.join(dest, f)
                bkp_files.append((os.path.getmtime(fp), fp))
        bkp_files.sort(key=lambda x: x[0], reverse=True)
        for _, fp in bkp_files[limit:]:
            try:
                os.remove(fp)
            except OSError:
                pass
    except Exception:
        pass


def run_automated_backup(user_id, cfg):
    source_paths = cfg.get("source_paths") or []
    if not source_paths:
        return {"skipped": True, "reason": "no_source_paths"}
    dest_mode = cfg.get("dest_mode", "download")
    cloud_path = cfg.get("cloud_path", "")
    backup_type = normalize_backup_type(cfg.get("backup_type", "full"))
    limit = cfg.get("copies_limit", 5)
    exclude_exts = cfg.get("exclude_exts")
    exclude_paths = cfg.get("exclude_paths")
    events = list(create_cloud_backup_stream(
        user_id, source_paths, dest_mode, cloud_path, backup_type,
        exclude_exts, exclude_paths))
    last = events[-1] if events else {"type": "error", "message": "Sin eventos"}
    if last.get("type") == "done" and dest_mode == "cloud":
        _enforce_copies_limit(user_id, cloud_path, limit)
    return last


def restore_backup(user_id, filename, target_rel_path=""):
    """Descifra y restaura un archivo de copia de seguridad (ZIP/NVBAK) en la unidad Cloud del usuario."""
    from core.crypto_utils import decrypt_file
    from modules.api.cloud.services import resolve_restore_destination
    from werkzeug.security import safe_join

    target_rel_path = (target_rel_path or "").strip("/")
    rel_segments = [seg for seg in target_rel_path.split("/") if seg]
    if any(seg == ".." or seg.startswith(".") or "\\" in seg or "\x00" in seg
           for seg in rel_segments):
        return False, "Ruta de destino inválida."

    zip_path = get_user_backup_path(user_id, filename)
    if not zip_path or not os.path.exists(zip_path):
        return False, "Archivo de respaldo no encontrado o no pertenece a este usuario."

    user_cloud_root = resolve_restore_destination(str(user_id), "")
    if not user_cloud_root:
        return False, "Ruta de usuario inválida."

    if target_rel_path:
        target_dir = resolve_restore_destination(str(user_id), target_rel_path)
        if not target_dir:
            return False, "Ruta de destino inválida."
    else:
        target_dir = user_cloud_root

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_zip = os.path.join(tmp_dir, "decrypted.zip")
        try:
            decrypt_file(zip_path, tmp_zip)
        except Exception as e:
            return False, f"Error al descifrar el respaldo: {str(e)}"

        restored_count = 0
        total_bytes = 0
        try:
            with zipfile.ZipFile(tmp_zip, "r") as zf:
                infolist = zf.infolist()
                if len(infolist) > MAX_FILES:
                    return False, f"El respaldo excede el límite máximo de {MAX_FILES} archivos."

                for member in infolist:
                    if member.is_dir() or member.filename in ("manifest.json",):
                        continue
                    total_bytes += member.file_size
                    if total_bytes > MAX_TOTAL_BYTES:
                        return False, "La copia de seguridad excede el tamaño máximo total permitido."

                    # Prevenir Zip Slip
                    dest_file = safe_join(target_dir, member.filename)
                    if not dest_file or not os.path.realpath(dest_file).startswith(os.path.realpath(user_cloud_root)):
                        continue
                    os.makedirs(os.path.dirname(dest_file), exist_ok=True)
                    with zf.open(member) as src, open(dest_file, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    restored_count += 1
        except Exception as e:
            return False, f"Error al extraer el archivo de respaldo: {str(e)}"

    return True, {"restored_count": restored_count, "target_dir": target_rel_path or "/"}
