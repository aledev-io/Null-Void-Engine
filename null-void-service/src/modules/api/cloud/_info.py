"""Cluster de Quota/Info extraído de cloud.services (fase 6N.17).

Información de cuota/almacenamiento, comprobación de capacidad y metadatos de
un archivo o su actividad.

Depende de _infra (get_dir_size, get_disk_info, _load_json, BASE_CLOUD_ROOT) y
de _context (get_user_root, get_user_quota, get_view_root,
_resolve_shared_or_recent_path). No depende de services.py.
"""

import os

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import repository
from . import _infra
from ._context import get_user_root, get_user_quota, get_view_root, _resolve_shared_or_recent_path
from ._infra import get_dir_size, get_disk_info, _load_json


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
    disk = get_disk_info(_infra.BASE_CLOUD_ROOT)
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


def get_item_activity(name, subpath, owner_id, token):
    current_uid = sess.get_user_id(token)
    if owner_id and str(owner_id) != str(current_uid):
        target_root = os.path.join(_infra.BASE_CLOUD_ROOT, str(owner_id))
    else:
        target_root = get_user_root(token)
        
    if not target_root:
        return []
    subpath = subpath.strip('/')
    all_activity = _load_json(target_root, '.activity.json')
    return [act for act in all_activity if act.get('name') == name and act.get('path') == subpath]
