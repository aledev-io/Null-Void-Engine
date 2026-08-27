"""Cluster de compartidos extraído de cloud.services (fase 6N.13).

Inicialización del Cloud de un usuario y lógica de compartición
(share/list with-me/subpath/by-me). Depende de _infra (_save_json, _load_json,
_reject_relative_segments, ai_root_for_uid, BASE_CLOUD_ROOT, logger) y de
_context (get_view_root, get_user_root). No depende de services.py.
"""

import os

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import repository
from . import _infra
from ._infra import (
    _save_json,
    _load_json,
    _reject_relative_segments,
    ai_root_for_uid,
    logger,
)
from ._context import get_view_root, get_user_root


def init_user_cloud(user_id):
    if not user_id:
        return
    user_root = os.path.join(_infra.BASE_CLOUD_ROOT, user_id)
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
                owner_root = os.path.realpath(os.path.join(_infra.BASE_CLOUD_ROOT, s['owner_id']))
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

    owner_root = os.path.realpath(os.path.join(_infra.BASE_CLOUD_ROOT, shared_item['owner_id']))
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

    owner_root = os.path.realpath(os.path.join(_infra.BASE_CLOUD_ROOT, current_uid))
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
