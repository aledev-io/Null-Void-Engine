"""Cluster de subidas reanudables por chunks extraído de cloud.services
(fase 6N.12).

Gestiona sesiones de subida por chunks (estilo TUS): crear sesión, consultar
estado, anexar chunks, completar y abortar. Depende de _infra (infraestructura),
de _context (raíces/vistas/cuota/ámbito) y directamente de _versions/_search
(_snapshot_version / invalidate_user_index). No depende de services.py.
"""

import hashlib
import json
import os
import shutil
import time
import uuid

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import _infra
from . import _context
from ._context import (
    get_user_root,
    get_view_root,
    get_user_quota,
    _check_agent_scope,
    add_activity,
)
from ._starred import _clean_starred_entry
from ._infra import (
    FileLock,
    logger,
    get_dir_size,
    _unique_path,
    bump_size_cache,
)
from ._versions import _snapshot_version
from ._search import invalidate_user_index

# Subidas reanudables por chunks (estilo TUS): el cliente crea una sesión,
# envía el archivo por fragmentos y la cierra al final. Si la conexión se
# corta, puede consultar el estado y reanudar desde el último byte recibido.
UPLOAD_CHUNK_SIZE = int(os.environ.get("UPLOAD_CHUNK_SIZE", str(8 * 1024 * 1024)))
_UPLOAD_STALE_HOURS = 24
_UPLOAD_DIR_NAME = '.uploads'


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

    pool_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool')
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

        pool_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool')
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
