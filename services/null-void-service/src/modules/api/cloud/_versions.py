"""Cluster de versionado.

Control de versiones de archivos: cuando un archivo se sobrescribe (sync del
agente o subida con overwrite), el contenido anterior se conserva como hardlink
en .versions/<clave>/v<ts>_<rand>. Restaurar una versión vuelve a enlazar ese
contenido como archivo actual (guardando a su vez la versión anterior).

Depende de _infra (FileLock, logger, bump_size_cache), de _context
(_check_agent_scope, get_user_root, add_activity) y directamente de _search
(invalidate_user_index). No depende de services.py.
"""

import hashlib
import json
import os
import re
import time
import uuid

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import _infra
from ._infra import FileLock, logger, bump_size_cache
from ._context import _check_agent_scope, get_user_root, add_activity
from ._search import invalidate_user_index


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
