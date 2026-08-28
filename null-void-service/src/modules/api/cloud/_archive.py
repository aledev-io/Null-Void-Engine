"""Cluster archive (ZIP/unzip) extraído de cloud.services (fase 6N.11).

Comprime una carpeta/archivo a ZIP y descomprime ZIPs con protecciones anti
Zip-Slip / Zip-Bomb. Depende de _infra (logger, _unique_path, _ZIP_CHUNK_BYTES,
_yield_event_loop, _MAX_UNCOMPRESSED_BYTES, BASE_CLOUD_ROOT), de _context
(get_view_root, _check_agent_scope, add_activity) y directamente de _info
(_check_storage_capacity) y _search (invalidate_user_index). No depende de
services.py.
"""

import os
import shutil
import stat
import tempfile
import zipfile

from modules.session import session as sess
from core.cloud_paths import safe_join
from . import _infra
from ._infra import (
    logger,
    _unique_path,
    _ZIP_CHUNK_BYTES,
    _yield_event_loop,
    _MAX_UNCOMPRESSED_BYTES,
)
from ._context import _check_agent_scope, get_view_root, add_activity
from ._info import _check_storage_capacity
from ._search import invalidate_user_index


def zip_item(view, name, subpath, token, zip_name=None):
    if not _check_agent_scope(view, subpath, token, name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    subpath = subpath.strip('/')
    try:
        target_path = safe_join(user_root, subpath, name)
    except ValueError:
        return None

    if not os.path.exists(target_path):
        return "El elemento a zipear no existe"

    if not zip_name or not str(zip_name).strip():
        base = os.path.splitext(name)[0] if not os.path.isdir(target_path) else name
        zip_name = f"{base}.zip"
    else:
        zip_name = str(zip_name).strip()
        if not zip_name.lower().endswith('.zip'):
            zip_name += '.zip'

    try:
        dest_zip_path = safe_join(user_root, subpath, zip_name)
    except ValueError:
        return None

    if os.path.exists(dest_zip_path):
        return f"Ya existe un archivo llamado '{zip_name}' en esta ubicación"

    # Calcular tamaño total y nº de archivos a comprimir
    total_size = 0
    file_count = 0
    if os.path.isdir(target_path):
        for root, dirs, files in os.walk(target_path):
            for file in files:
                if file.startswith('.'):
                    continue
                fp = os.path.join(root, file)
                try:
                    total_size += os.path.getsize(fp)
                except OSError:
                    pass
                file_count += 1
    else:
        total_size = os.path.getsize(target_path)
        file_count = 1

    # Cota superior: el ZIP nunca supera la suma de archivos + cabeceras
    estimate = total_size + file_count * 64 + 1024
    ok, err = _check_storage_capacity(token, estimate)
    if not ok:
        return err

    # Crear el zip en temporal para medir su tamaño real
    pool_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool')
    os.makedirs(pool_dir, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(suffix='.zip', dir=pool_dir)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            if os.path.isdir(target_path):
                for root, dirs, files in os.walk(target_path):
                    # Omitir directorios symlink (podrían apuntar fuera del root)
                    dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
                    for file in files:
                        if file.startswith('.'):
                            continue
                        abs_file = os.path.join(root, file)
                        # Omitir archivos symlink (CWE-22: evita incluir contenido externo)
                        if os.path.islink(abs_file):
                            continue
                        rel_in_zip = os.path.relpath(abs_file, os.path.dirname(target_path))
                        _zip_stream_write(zf, abs_file, rel_in_zip)
            else:
                _zip_stream_write(zf, target_path, name)

        real_size = os.path.getsize(temp_path)
        ok, err = _check_storage_capacity(token, real_size)
        if not ok:
            return err

        shutil.move(temp_path, dest_zip_path)
        temp_path = None

        current_user = sess.get_user(token)
        current_uid = sess.get_user_id(token)
        add_activity(current_user, current_uid, "act_creaste_la_carpeta", zip_name, subpath)
        invalidate_user_index(current_uid)
        return True
    except Exception as e:
        if os.path.exists(dest_zip_path):
            try: os.unlink(dest_zip_path)
            except Exception: pass
        logger.error(f"Error al comprimir {dest_zip_path}: {e}")
        return "Error al comprimir el elemento"
    finally:
        if temp_path and os.path.exists(temp_path):
            try: os.unlink(temp_path)
            except Exception: pass


def _zip_stream_write(zf, abs_file, arc_name):
    """Escribe un archivo en el ZIP leyendo en chunks fijos y cediendo el
    event loop, para no bloquear el servidor con archivos/carpetas grandes."""
    with open(abs_file, 'rb') as src, zf.open(arc_name, 'w') as dst:
        while True:
            chunk = src.read(_ZIP_CHUNK_BYTES)
            if not chunk:
                break
            dst.write(chunk)
            _yield_event_loop()


def unzip_item(view, name, subpath, token):
    if not _check_agent_scope(view, subpath, token, name):
        return None
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    subpath = subpath.strip('/')
    try:
        target_path = safe_join(user_root, subpath, name)
    except ValueError:
        return None

    if not os.path.exists(target_path) or os.path.isdir(target_path):
        return "El archivo a unzipear no existe o es un directorio"

    if not name.lower().endswith('.zip'):
        return "El archivo seleccionado no es un archivo .zip"

    MAX_ZIP_FILES = 10000
    MAX_ZIP_RATIO = 100
    RESERVED_NAMES = ('.activity.json', '.trash.json', '.starred.json', '.protected.json', '.unprotected.json')

    try:
        with zipfile.ZipFile(target_path, 'r') as zf:
            dest_dir = safe_join(user_root, subpath)
            infolist = zf.infolist()

            # Límite de nº de elementos (Zip Bomb)
            if len(infolist) > MAX_ZIP_FILES:
                return f"El archivo zip contiene demasiados elementos (máximo {MAX_ZIP_FILES})."

            # Ratio de compresión agregado (Zip Bomb)
            total_uncompressed = sum(info.file_size for info in infolist)
            total_compressed = sum(info.compress_size for info in infolist)
            if total_compressed > 0 and (total_uncompressed / total_compressed) > MAX_ZIP_RATIO:
                return "El archivo zip tiene un ratio de compresión sospechoso (posible Zip Bomb)."

            # Límite de seguridad de tamaño descomprimido (CWE-400)
            if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
                return "El archivo comprimido supera la cuota o el límite de seguridad"

            # Comprobar cuota del usuario y disco físico con el tamaño real
            ok, err = _check_storage_capacity(token, total_uncompressed)
            if not ok:
                return "El archivo comprimido supera la cuota o el límite de seguridad"

            # Validar y filtrar todos los miembros antes de extraer
            members = []
            for info in infolist:
                name_norm = info.filename.replace('\\', '/')

                # Zip Slip: validar la ruta completa (con '..' intacto) antes de filtrar
                raw_path = os.path.abspath(os.path.join(dest_dir, name_norm))
                try:
                    inside = (os.path.commonpath([dest_dir, raw_path]) == dest_dir)
                except ValueError:
                    inside = False
                if not inside:
                    logger.error(
                        f"[SECURITY][ALERT] Zip Slip bloqueado en '{name}': miembro '{info.filename}' "
                        f"resuelve fuera del destino permitido ({dest_dir})"
                    )
                    return "El archivo zip contiene rutas no seguras (Zip Slip detectado)."

                # Ratio de compresión por archivo individual (Zip Bomb por miembro)
                if (info.compress_size > 0 and info.file_size >= 1024 * 1024
                        and info.file_size / info.compress_size > MAX_ZIP_RATIO):
                    logger.error(
                        f"[SECURITY][ALERT] Zip Bomb sospechosa en '{name}': miembro '{info.filename}' "
                        f"comprime {info.file_size / max(1, info.compress_size):.0f}:1"
                    )
                    return "El archivo zip tiene un ratio de compresión sospechoso (posible Zip Bomb)."

                parts = [p for p in name_norm.split('/') if p not in ('', '.')]
                if not parts:
                    continue
                # Omitir carpeta reservada de macOS
                if parts[0] == '__MACOSX':
                    continue
                # Omitir archivos o carpetas ocultos (empiezan por '.')
                if any(p.startswith('.') for p in parts):
                    continue
                # Omitir archivos reservados del sistema
                if parts[-1] in RESERVED_NAMES:
                    continue
                # Omitir enlaces simbólicos (evita symlink traversal)
                mode = (info.external_attr >> 16) & 0xFFFF
                if stat.S_ISLNK(mode):
                    continue

                member_path = os.path.abspath(os.path.join(dest_dir, *parts))
                members.append((info, member_path))

            # Extracción manual (sin extractall: no crea symlinks ni hardlinks)
            for info, member_path in members:
                if info.is_dir():
                    os.makedirs(member_path, exist_ok=True)
                    continue
                # Si ya existe, añadir sufijo numérico estilo SO: 'Archivo(1).txt'
                member_path = _unique_path(member_path)
                os.makedirs(os.path.dirname(member_path), exist_ok=True)
                with zf.open(info) as src, open(member_path, 'wb') as dst:
                    # Descompresión por chunks fijos, cediendo el event loop
                    while True:
                        chunk = src.read(_ZIP_CHUNK_BYTES)
                        if not chunk:
                            break
                        dst.write(chunk)
                        _yield_event_loop()

        current_user = sess.get_user(token)
        current_uid = sess.get_user_id(token)
        add_activity(current_user, current_uid, "act_subiste", f"Descomprimido: {name}", subpath)
        invalidate_user_index(current_uid)
        return True
    except Exception as e:
        logger.error(f"Error al descomprimir {name} en {subpath}: {e}")
        return "Error al descomprimir el archivo"
