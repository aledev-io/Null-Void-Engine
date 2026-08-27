"""Cluster IA extraído de cloud.services (fase 6N.6).

Gestiona los archivos adjuntos del módulo IA bajo <DATA_DIR>/ai/<uid> con su
metadata en la tabla ai_attachment_files. Depende de _infra (get_token,
ai_root_for_uid, _update_json), de _context (user_root_for_uid, add_activity) y
directamente de _search (invalidate_user_index). No depende de services.py.
"""

import logging
import mimetypes
import os
import shutil
import time
import uuid

from modules.session import session as sess
from . import repository
from core.cloud_paths import safe_join
from ._infra import ai_root_for_uid, _update_json, get_token
from ._context import user_root_for_uid, add_activity
from ._search import invalidate_user_index

logger = logging.getLogger("NullVoidCloud")

# <DATA_DIR>/ai/<uid>/ y su metadata vive en la tabla de Cloud
# ai_attachment_files (id uuid = FK usada por ai_messages.attachments).
# AI_BASE_ROOT vive en _infra (los consumidores/tests lo parchean vía
# _infra.AI_BASE_ROOT); se resuelve en tiempo de llamada.


def get_ai_root(token=None):
    if token is None:
        token = get_token()
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return None
    return ai_root_for_uid(uid)


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
