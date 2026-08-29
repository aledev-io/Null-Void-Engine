"""Fachada pública del módulo Cloud.

Re-exporta la infraestructura neutral (_infra), el contexto compartido
(_context) y los clusters de funcionalidad (_ai, _video, _download, _preview,
_search, _archive, _uploads, _sharing, _versions, _starred, _ops, _info), y
conserva el cluster Files (listado, papelera, subidas, borrados) y la
orquestación de negocio que le corresponde. No es importado por ningún
submodule de Cloud (no hay ciclo).
"""

import hashlib
import os
import shutil
import tempfile
import threading
import time
import uuid

from modules.session import session as sess
from . import repository
from . import _infra

# Infraestructura neutral (constantes, FileLock, JSON, tamaños, tokens, path).
from ._infra import (
    MAX_FILE_SIZE_PREVIEW,
    logger,
    FileLock,
    safe_join,
    get_token,
    get_dir_size,
    _path_size,
    get_folder_size_fast,
    get_disk_info,
    bump_size_cache,
    _load_json,
    _save_json,
    _update_json,
    ai_root_for_uid,
    _is_safe_path,
    _unique_path,
    _reject_relative_segments,
    _join_shared_child,
    _yield_event_loop,
    _ZIP_CHUNK_BYTES,
    _MAX_UNCOMPRESSED_BYTES,
    download_tokens,
    tokens_lock,
    _cleanup_expired_tokens,
    user_size_cache,
    cache_lock,
    CACHE_TTL,
)

# Contexto compartido de Cloud (raíces, vistas, cuota, protección, actividad,
# ámbito de agente). Re-exportado para preservar la API pública.
from ._context import (
    user_root_for_uid,
    get_user_root,
    get_view_root,
    get_user_quota,
    resolve_restore_destination,
    resolve_shared_path,
    _resolve_shared_or_recent_path,
    find_protected_ancestor,
    find_protected_ancestor_name,
    is_item_protected,
    resolve_protect_view,
    add_activity,
    resolve_agent_scope,
    _check_agent_scope,
)

# Helpers de subida migrados a _uploads (los usa el cluster Files y routes).
from ._uploads import (
    _validate_filename,
    _finalize_upload,
)

# Frontera de extracción: el cluster IA vive en _ai.py y se
# re-exporta aquí para no romper la API pública de cloud.services.
from ._ai import (
    get_ai_root,
    _ai_ref_from_row,
    _ai_ext_flags,
    ai_save_file_uid,
    ai_save_file,
    ai_download_file_by_uid,
    ai_download_file,
    ai_list_files,
    ai_get_refs_by_uid,
    ai_delete_file,
    ai_delete_files_by_uid,
    ai_trash_files_by_uid,
    ai_cleanup_attachments,
    ai_read_file_by_uid,
    ai_update_file_by_uid,
)

# Frontera de extracción: el cluster de vídeo vive en _video.py y
# se re-exporta aquí para no romper la API pública de cloud.services.
from ._video import (
    VIDEO_CACHE_MAX_MB,
    VIDEO_PREWARM_QUALITY,
    VIDEO_QUALITIES,
    VIDEO_HEIGHTS,
    stream_video,
)

# Frontera de extracción: el cluster de descargas/streaming ZIP
# vive en _download.py y se re-exporta aquí para no romper la API pública de
# cloud.services. _zip_stream/_iter_zip_entries también los usa el cluster
# _archive (zip_item/unzip_item), que sigue en este módulo.
from ._download import (
    get_download_token,
    get_multi_download_token,
    _iter_zip_entries,
    _zip_stream,
    download_file,
)

# Frontera de extracción: el cluster de previews/PDF vive en
# _preview.py y se re-exporta aquí para no romper la API pública de
# cloud.services.
from ._preview import (
    _pdf_thumbnail,
    _preview_placeholder,
    preview_file,
)

# Frontera de extracción: el cluster de búsqueda (FTS + sweeper)
# vive en _search.py y se re-exporta aquí para no romper la API pública de
# cloud.services. invalidate_user_index es llamado por otros clusters y por el
# cluster Files de este módulo.
from ._search import (
    build_user_search_index,
    invalidate_user_index,
    search_files,
    get_folders_tree,
    _safe_child_path,
    _content_index_running,
    _extract_text,
    _index_user_content,
    _schedule_content_index,
)

# Frontera de extracción: el cluster archive (ZIP/unzip) vive en
# _archive.py y se re-exporta aquí para no romper la API pública de
# cloud.services.
from ._archive import (
    zip_item,
    _zip_stream_write,
    unzip_item,
)

# Frontera de extracción: el cluster de subidas por chunks vive en
# _uploads.py y se re-exporta aquí para no romper la API pública de
# cloud.services (routes.py y test_cloud_upload_chunks.py usan UPLOAD_CHUNK_SIZE).
from ._uploads import (
    UPLOAD_CHUNK_SIZE,
    create_upload_session,
    get_upload_status,
    append_upload_chunk,
    complete_upload,
    abort_upload,
)

# Frontera de extracción: el cluster de compartidos vive en
# _sharing.py y se re-exporta aquí para no romper la API pública de
# cloud.services (routes.py, auth/services.py, __init__.py, tests).
from ._sharing import (
    init_user_cloud,
    share_file,
    list_shared_with_me,
    list_shared_subpath,
    list_shared_by_me,
)

# Frontera de extracción: el cluster de versionado vive en
# _versions.py y se re-exporta aquí para no romper la API pública de
# cloud.services. _snapshot_version también lo usa _uploads._finalize_upload.
from ._versions import (
    _VERSIONS_DIR_NAME,
    _versions_key,
    _versions_dir,
    _snapshot_version,
    _validate_version_id,
    _version_entries,
    list_versions,
    restore_version,
    delete_version,
)

# Frontera de extracción: el cluster Starred/Protection vive en
# _starred.py y se re-exporta aquí. Los helpers _clean/_rename/_move_starred_entry
# también viven en _starred (los usa el cluster Files de este módulo y _ops).
from ._starred import (
    toggle_star,
    toggle_protect,
    list_starred,
    _clean_starred_entry,
    _rename_starred_entry,
    _move_starred_entry,
)

# Frontera de extracción: el cluster Rename/Copy/Move vive en
# _ops.py y se re-exporta aquí para no romper la API pública de cloud.services.
from ._ops import (
    rename_item,
    copy_item,
    move_item,
)

# Frontera de extracción: el cluster Quota/Info vive en _info.py
# y se re-exporta aquí para no romper la API pública de cloud.services.
from ._info import (
    get_quota_info,
    _check_storage_capacity,
    get_file_info,
    get_item_activity,
)


def __getattr__(name):
    """Expone BASE_CLOUD_ROOT/AI_BASE_ROOT como alias dinámicos de _infra
    (única fuente de verdad), preservando la API pública del módulo."""
    if name in ("BASE_CLOUD_ROOT", "AI_BASE_ROOT"):
        return getattr(_infra, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def list_recent(token):
    user_root = get_user_root(token)
    if not user_root:
        return None

    current_uid = sess.get_user_id(token)
    current_user = sess.get_user(token)

    starred_data = _load_json(user_root, '.starred.json')
    protected_data = _load_json(user_root, '.protected.json')
    unprotected_data = _load_json(user_root, '.unprotected.json')
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

                fp = safe_join(_infra.BASE_CLOUD_ROOT, owner_id, act['path'], act['name'])
            else:
                fp = safe_join(user_root, act['path'], act['name'])

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
            "protected": is_item_protected(protected_data, item_view, act['path'], act['name'], unprotected_data),
            "protected_ancestor": find_protected_ancestor_name(protected_data, item_view, act['path'], act['name'], unprotected_data),
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
    unprotected_data = _load_json(base_root, '.unprotected.json')
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
            is_protected = is_item_protected(protected_data, resolve_protect_view(base_root, view, subpath, name), subpath, name, unprotected_data)
            protected_ancestor = find_protected_ancestor_name(protected_data, resolve_protect_view(base_root, view, subpath, name), subpath, name, unprotected_data)
            active_status = False
            if view == 'computers' and subpath == '':
                is_protected = True
                device_name = name.replace(' 💻', '')
                from core.database import get_db
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
                "protected": is_protected, "protected_ancestor": protected_ancestor, "starred": is_starred, "active": active_status,
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

    pool_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool')
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
        from core.database import get_db
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
    unprotected_data = _load_json(base_root, '.unprotected.json')
    view = resolve_protect_view(base_root, view, subpath, name)
    if is_item_protected(protected_data, view, subpath, name, unprotected_data):
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
                from core.socket_ext import socketio
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
        pool_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool')
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
