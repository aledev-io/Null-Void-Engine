"""Cluster de operaciones de archivo (Rename/Copy/Move).
Depende de _context (_check_agent_scope, get_view_root, get_user_root,
resolve_protect_view, is_item_protected, _resolve_shared_or_recent_path,
add_activity), de _infra (_load_json, _unique_path, logger), y directamente de
_starred (_rename/_move_starred_entry) y _search (invalidate_user_index). No
depende de services.py.
"""

import os
import shutil

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import repository
from ._infra import _load_json, _unique_path, logger
from ._context import (
    _check_agent_scope,
    get_view_root,
    get_user_root,
    resolve_protect_view,
    is_item_protected,
    _resolve_shared_or_recent_path,
    add_activity,
)
from ._starred import _rename_starred_entry, _move_starred_entry
from ._search import invalidate_user_index


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
    unprotected_data = _load_json(base_root, '.unprotected.json')
    if is_item_protected(protected_data, view, subpath, old_name, unprotected_data):
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
        unprotected_data = _load_json(base_root, '.unprotected.json')
        resolved_view = resolve_protect_view(base_root, view, old_subpath, name)
        if is_item_protected(protected_data, resolved_view, old_subpath, name, unprotected_data):
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
