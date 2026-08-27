"""Contexto compartido de Cloud: raíces de usuario, vistas, cuota, compartición,
protección, actividad y ámbito de agente (fase 6N.20).

Depende de _infra (infraestructura neutral), del repositorio de Cloud y de la
sesión. NO importa services.py ni ningún submodule de Cloud a nivel de módulo.
Los únicos imports perezosos legítimos son core.database (get_db) y socketio.
"""

import os
import time

from modules.session import session as sess
from core.cloud_paths import (
    safe_join,
    resolve_restore_destination as _core_resolve_restore_destination,
    user_root_for_uid as _core_user_root_for_uid,
)
from . import repository
from . import _infra


def user_root_for_uid(uid):
    """Compat: delega en core.cloud_paths inyectando el BASE_CLOUD_ROOT de Cloud."""
    return _core_user_root_for_uid(uid, _infra.BASE_CLOUD_ROOT)


def get_user_root(token=None):
    if token is None:
        token = _infra.get_token()
    uid = sess.get_user_id(token) if token else None
    return user_root_for_uid(uid)


def get_view_root(view='drive', token=None):
    base_root = get_user_root(token)
    if not base_root:
        return None
    if view == 'ai':
        # Los archivos de IA viven en <DATA_DIR>/ai/<uid>/ (misma metadata
        # ai_attachment_files que usan los adjuntos del chat).
        return _infra.ai_root_for_uid(sess.get_user_id(token) if token else None)
    if view in ('computers', 'backups', 'business', 'trash'):
        return safe_join(base_root, f'.{view}')
    return base_root


def get_user_quota(token=None):
    if token is None:
        token = _infra.get_token()
    username = sess.get_user(token) if token else None
    if not username:
        return 10
    quota = repository.get_user_quota_from_db(username)
    # Un 0 legado en la BD se trata como "sin asignar" para no bloquear subidas.
    if quota < 1:
        return 10
    return quota


def resolve_restore_destination(uid, target_rel_path):
    """Compat: delega en core.cloud_paths inyectando el BASE_CLOUD_ROOT de Cloud."""
    return _core_resolve_restore_destination(uid, target_rel_path, _infra.BASE_CLOUD_ROOT)


def resolve_shared_path(current_uid, owner_id, name, subpath):
    _infra._reject_relative_segments(subpath, name)

    clean_subpath = (subpath or '').strip('/')
    parts = clean_subpath.split('/') if clean_subpath else []
    if parts and parts[0]:
        top_name = parts[0]
        rest_path = '/'.join(parts[1:])
    else:
        top_name = name
        rest_path = ''

    owner_root = os.path.realpath(os.path.join(_infra.BASE_CLOUD_ROOT, str(owner_id)))

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
                base = _infra.ai_root_for_uid(owner_id)
            return safe_join(base, exact_path, exact['file_name'])

    # 2) Recurso compartido = la carpeta (primer segmento de la ruta): el
    #    receptor navega dentro del sandbox de esa carpeta compartida.
    shared_item = repository.get_shared_item(owner_id, current_uid, top_name)
    if not shared_item:
        _infra.logger.warning(f"[SECURITY][WARN] IDOR Interceptado: Usuario {current_uid} intentó acceder a recurso de {owner_id}")
        raise PermissionError("Acceso denegado a este recurso")
    if shared_item.get('view') == 'ai':
        owner_root = _infra.ai_root_for_uid(owner_id)

    if shared_item['view'] == 'computers':
        owner_root = os.path.realpath(os.path.join(owner_root, '.computers'))

    # Raíz canónica del recurso compartido: único sandbox al que tiene acceso el receptor
    shared_base = safe_join(owner_root, (shared_item.get('file_path') or '').strip('/'), shared_item['file_name'])

    if rest_path:
        return _infra._join_shared_child(shared_base, rest_path, name)
    elif top_name == name:
        return shared_base
    else:
        return _infra._join_shared_child(shared_base, '', name)


def _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view):
    if view in ('home', 'recent'):
        _infra._reject_relative_segments(subpath, name)
        owner_root = os.path.realpath(os.path.join(_infra.BASE_CLOUD_ROOT, str(owner_id)))
        shared_in_path, inherited = repository.get_shares_in_path(owner_id, subpath)
        combined = shared_in_path.get(name, list(inherited))
        if not any(str(s['shared_with']) == str(current_uid) for s in combined):
            raise PermissionError("Acceso denegado")
        return safe_join(owner_root, subpath, name)
    return resolve_shared_path(current_uid, owner_id, name, subpath)


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


def add_activity(user, user_id, action, name, path="", owner_id=None):
    if not user_id:
        return
    user_root = os.path.join(_infra.BASE_CLOUD_ROOT, user_id)
    os.makedirs(user_root, exist_ok=True)
    entry = {
        "user": user, "user_id": user_id, "action": action,
        "name": name, "path": path, "time": time.time(),
        "owner_id": owner_id,
    }
    _infra._update_json(user_root, '.activity.json', lambda acts: ([entry] + list(acts))[:50])

    if owner_id and str(owner_id) != str(user_id) and owner_id != 'null':
        owner_root = os.path.join(_infra.BASE_CLOUD_ROOT, str(owner_id))
        if os.path.exists(owner_root):
            _infra._update_json(owner_root, '.activity.json', lambda acts: ([entry] + list(acts))[:50])
            try:
                from modules import socketio
                socketio.emit('activity_update', {'name': name, 'action': action, 'user': user}, room=f"user_{owner_id}")
            except Exception as e:
                pass


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
