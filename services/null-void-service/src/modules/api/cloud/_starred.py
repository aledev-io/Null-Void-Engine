"""Cluster de Starred/Protection extraído de cloud.services (fase 6N.15).

Gestión de metadatos de marcado (estrella) y protección de archivos, persistidos
como JSON en .starred.json y .protected.json de la raíz del usuario.

Depende de _infra (_load_json, _save_json, _update_json, ai_root_for_uid) y de
_context (get_user_root, resolve_protect_view, find_protected_ancestor,
is_item_protected, _resolve_shared_or_recent_path). No depende de services.py.
Los helpers de actualización de .starred.json (_clean/_rename/_move_starred_entry)
viven aquí (los usa _ops y el cluster Files de services).
"""

import os

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import repository
from . import _infra
from ._infra import _load_json, _save_json, _update_json, ai_root_for_uid
from ._context import (
    get_user_root,
    resolve_protect_view,
    find_protected_ancestor,
    find_protected_ancestor_name,
    is_item_protected,
    _resolve_shared_or_recent_path,
)


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

    def _is_prot():
        return is_item_protected(
            _load_json(base_root, '.protected.json'),
            view, subpath, name,
            _load_json(base_root, '.unprotected.json'),
        )

    currently_protected = _is_prot()

    if currently_protected:
        # Desproteger: eliminar la protección propia y, si el elemento sigue
        # protegido por herencia (una carpeta superior bloqueada), añadir un
        # override a .unprotected.json para dejarlo efectivamente desbloqueado
        # sin tocar la entrada de la carpeta.
        _update_json(base_root, '.protected.json',
                     lambda d: [x for x in d if x != item_key])
        if _is_prot():
            _update_json(base_root, '.unprotected.json',
                         lambda d: d + [item_key] if item_key not in d else d)
    else:
        # Proteger: quitar el override (volver a la protección heredada) o, si
        # no hay ancestro protegido, añadir protección propia.
        _update_json(base_root, '.unprotected.json',
                     lambda d: [x for x in d if x != item_key])
        if not _is_prot():
            _update_json(base_root, '.protected.json',
                         lambda d: d + [item_key] if item_key not in d else d)

    return True, _is_prot()


def list_starred(token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    starred_data = _load_json(base_root, '.starred.json')
    protected_data = _load_json(base_root, '.protected.json')
    unprotected_data = _load_json(base_root, '.unprotected.json')
    current_uid = sess.get_user_id(token)
    files = []
    valid_starred = []
    for item in starred_data:
        try:
            if 'owner_id' in item and str(item['owner_id']) != str(current_uid):
                item_view = item.get('view', 'shared')
                fp = _resolve_shared_or_recent_path(current_uid, item['owner_id'], item['name'], item['path'], item_view)
                owner = repository.get_username_by_id(item['owner_id'])
                owner_id = item['owner_id']
                is_shared = True
            else:
                item_view = item.get('view', 'drive')
                if item_view == 'ai':
                    fp = safe_join(ai_root_for_uid(current_uid), item['path'], item['name'])
                else:
                    fp = safe_join(base_root, item['path'], item['name'])
                owner = sess.get_user(token) or "Usuario"
                owner_id = current_uid
                is_shared = False
        except (ValueError, PermissionError):
            if 'owner_id' not in item or str(item.get('owner_id')) == str(current_uid):
                try:
                    fp = safe_join(base_root, '.computers', item['path'], item['name'])
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
            "protected": is_item_protected(protected_data, item_view, item['path'], item['name'], unprotected_data),
            "protected_ancestor": find_protected_ancestor_name(protected_data, item_view, item['path'], item['name'], unprotected_data),
            "view": item_view,
            "is_shared": is_shared
        })

    # Auto-limpieza: si había elementos de archivos borrados, sanear .starred.json
    if len(valid_starred) != len(starred_data):
        _save_json(base_root, '.starred.json', valid_starred)

    return files
