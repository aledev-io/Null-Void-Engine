"""Cluster de descargas + streaming ZIP extraído de cloud.services (fase 6N.8).

Gestiona tokens de descarga (single/multi), streaming ZIP (DEFLATE con data
descriptors) y la descarga de archivos. Depende de _infra (tokens, JSON,
_ZIP_CHUNK_BYTES, _yield_event_loop, BASE_CLOUD_ROOT) y de _context
(get_view_root, get_user_root, _resolve_shared_or_recent_path, add_activity).
No depende de services.py.
"""

import logging
import os
import struct
import time
import uuid
import zlib
from pathlib import Path

from flask import request, Response, send_file
from modules.session import session as sess
from core.cloud_paths import safe_join
from . import _infra
from ._context import get_view_root, get_user_root, _resolve_shared_or_recent_path, add_activity
from ._infra import (
    _load_json,
    _cleanup_expired_tokens,
    tokens_lock,
    download_tokens,
    _ZIP_CHUNK_BYTES,
    _yield_event_loop,
)

logger = logging.getLogger("NullVoidCloud")


def get_download_token(view, name, subpath, owner_id, trash_id, token, is_preview=False):
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None
    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)
    target_path = None

    try:
        if owner_id and str(owner_id) != str(current_uid):
            target_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
        elif view == 'trash' and trash_id:
            base_user_root = get_user_root(token)
            trash_base = os.path.join(base_user_root, '.trash')
            target_path = safe_join(trash_base, trash_id)
        else:
            target_path = safe_join(user_root, subpath, name)
            if not os.path.exists(target_path):
                base_user_root = get_user_root(token)
                alt = safe_join(base_user_root, '.computers', subpath, name)
                if os.path.exists(alt):
                    target_path = alt
    except PermissionError:
        # Distinguir el motivo: si el recurso ya no existe (papelera del
        # dueño o desaparecido), el dueño se deshizo del archivo; si sigue
        # en su sitio, fue un "dejar de compartir" explícito.
        try:
            owner_root = os.path.realpath(os.path.join(_infra.BASE_CLOUD_ROOT, str(owner_id)))
            trash_data = _load_json(owner_root, '.trash.json') or []
            for t in trash_data:
                if (str(t.get('name')) == name
                        and (t.get('original_path') or '').strip('/') == subpath.strip('/')):
                    return None, "shared_file_gone"
            if os.path.exists(safe_join(owner_root, subpath, name)):
                return None, "access_revoked"
            return None, "shared_file_gone"
        except Exception:
            return None, "shared_file_gone"
    except ValueError:
        return None, None

    if not target_path or not os.path.exists(target_path):
        return None, None

    dl_token = str(uuid.uuid4())
    is_dir = os.path.isdir(target_path)

    with tokens_lock:
        _cleanup_expired_tokens()
        download_tokens[dl_token] = {
            "path": target_path, "name": name, "is_dir": is_dir, "expires": time.time() + 300, "bound_user_id": current_uid
        }

    if is_preview:
        add_activity(sess.get_user(token), sess.get_user_id(token), "act_abrio", name, subpath, owner_id)
    else:
        add_activity(sess.get_user(token), sess.get_user_id(token), "act_descargo", name, subpath, owner_id)
    return dl_token, None


def get_multi_download_token(items, view, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None
    current_uid = sess.get_user_id(token)
    base_user_root = get_user_root(token)

    resolved = []
    for item in items:
        name = item.get('name')
        subpath = item.get('path', '').strip('/')
        owner_id = item.get('owner_id')

        try:
            if owner_id and str(owner_id) != str(current_uid):
                target_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
            else:
                target_path = safe_join(user_root, subpath, name)
                if not os.path.exists(target_path):
                    alt = safe_join(base_user_root, '.computers', subpath, name)
                    if os.path.exists(alt):
                        target_path = alt

            if os.path.exists(target_path):
                resolved.append({"path": target_path, "name": name, "is_dir": os.path.isdir(target_path)})
        except (ValueError, PermissionError):
            continue

    if not resolved:
        return None, None

    dl_token = str(uuid.uuid4())

    with tokens_lock:
        _cleanup_expired_tokens()
        download_tokens[dl_token] = {"multi": True, "items": resolved, "expires": time.time() + 300, "bound_user_id": current_uid}

    add_activity(sess.get_user(token), sess.get_user_id(token), "act_descargo", f"{len(resolved)} archivos (ZIP)", "")
    return dl_token, None


def _iter_zip_entries(targets):
    """Genera (abs_path, arc_name) para cada archivo/carpeta de `targets`.

    Salta symlinks (CWE-22: evita incluir contenido externo al root) y
    normaliza las rutas relativas para que no puedan escaparse del ZIP.
    """
    for target, name in targets:
        clean_base = Path(name).name
        if os.path.isdir(target):
            for root, dirs, files in os.walk(target):
                # Omitir directorios symlink (podrían apuntar fuera del root)
                dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
                for d in dirs:
                    full_d = os.path.join(root, d)
                    rel = os.path.normpath(os.path.relpath(full_d, target)).replace("..", "")
                    if not os.path.isabs(rel) and ".." not in rel:
                        yield full_d, os.path.join(clean_base, rel)
                for f in files:
                    full_f = os.path.join(root, f)
                    if os.path.islink(full_f):
                        continue
                    rel = os.path.normpath(os.path.relpath(full_f, target)).replace("..", "")
                    if not os.path.isabs(rel) and ".." not in rel:
                        yield full_f, os.path.join(clean_base, rel)
        else:
            if not os.path.islink(target):
                yield target, clean_base


def _zip_stream(targets):
    """Generador de ZIP en streaming (DEFLATE + data descriptors).

    Los bytes del ZIP se producen a medida que se comprimen, sin almacenar
    el ZIP completo ni en disco ni en memoria: cada archivo se lee en chunks
    (con _yield_event_loop para no bloquear gevent) y se cede al navegador.
    Si el cliente cancela la descarga, el generador se cierra y se liberan
    los descriptores de archivo sin trabajo residual.

    `targets`: lista de (abs_path, arc_name).
    """
    central = []
    stream_offset = 0

    def _dos_time_date(ts):
        t = time.localtime(ts)
        return ((t.tm_hour << 11) | (t.tm_min << 5) | (t.tm_sec // 2),
                ((t.tm_year - 1980) << 9) | (t.tm_mon << 5) | t.tm_mday)

    for abs_path, arc_name in targets:
        try:
            st = os.stat(abs_path)
        except OSError:
            continue
        dos_time, dos_date = _dos_time_date(st.st_mtime)
        name_b = arc_name.encode('utf-8')

        if os.path.isdir(abs_path):
            if not name_b.endswith(b'/'):
                name_b += b'/'
            header = struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0x0800, 0,
                                 dos_time, dos_date, 0, 0, 0, len(name_b), 0)
            central.append((struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0x0800, 0,
                                        dos_time, dos_date, 0, 0, 0, len(name_b), 0, 0, 0, 0, 0,
                                        stream_offset), name_b))
            stream_offset += len(header) + len(name_b)
            yield header
            yield name_b
            continue

        entry_offset = stream_offset
        header = struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0x0800 | 0x0008, 8,
                             dos_time, dos_date, 0, 0, 0, len(name_b), 0)
        stream_offset += len(header) + len(name_b)
        yield header
        yield name_b

        crc = 0
        comp = zlib.compressobj(6, zlib.DEFLATED, -15)
        comp_size = 0
        try:
            with open(abs_path, 'rb') as f:
                while True:
                    data = f.read(_ZIP_CHUNK_BYTES)
                    if not data:
                        break
                    crc = zlib.crc32(data, crc)
                    out = comp.compress(data)
                    if out:
                        comp_size += len(out)
                        yield out
                    _yield_event_loop()
            tail = comp.flush()
            if tail:
                comp_size += len(tail)
                yield tail
        except OSError as e:
            logger.warning(f"[OPERATIONAL][WARN] Archivo omitido en ZIP por error de lectura: {abs_path}: {e}")

        crc &= 0xffffffff
        descriptor = struct.pack('<IIII', 0x08074b50, crc, comp_size, st.st_size)
        central.append((struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, 0x0800 | 0x0008, 8,
                                    dos_time, dos_date, crc, comp_size, st.st_size,
                                    len(name_b), 0, 0, 0, 0, 0, entry_offset), name_b))
        stream_offset += comp_size + len(descriptor)
        yield descriptor

    cd_offset = stream_offset
    cd_size = 0
    for rec, name in central:
        yield rec
        yield name
        cd_size += len(rec) + len(name)
    yield struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(central), len(central),
                      cd_size, cd_offset, 0)


def download_file(dl_token):
    current_token = request.cookies.get('token') or request.headers.get('X-Token')
    current_uid = sess.get_user_id(current_token) if current_token else None

    with tokens_lock:
        _cleanup_expired_tokens()
        if not dl_token or dl_token not in download_tokens:
            return None, "Token inválido o expirado"
        info = download_tokens[dl_token]

        if info.get("bound_user_id") and str(info["bound_user_id"]) != str(current_uid):
            return None, "Acceso denegado: Token no vinculado a su sesión"

        if time.time() > info['expires']:
            download_tokens.pop(dl_token, None)
            return None, "Token expirado"

    if info.get('multi'):
        targets = []
        for item in info['items']:
            target = item['path']
            name = item['name']
            if not os.path.exists(target):
                continue
            targets.append((target, name))
        return Response(_zip_stream(_iter_zip_entries(targets)),
                        mimetype='application/zip',
                        headers={'Content-Disposition': 'attachment; filename="Null-Void-Cloud-Files.zip"'}), None

    target = info['path']
    if not os.path.exists(target):
        return None, "No encontrado"

    force_dl = request.args.get('dl') == '1'
    clean_single_name = os.path.normpath(info['name']).lstrip("/").replace("..", "")

    if info.get('is_dir'):
        safe_zip_name = clean_single_name.replace('"', '').replace('\\', '').replace('/', '') or 'carpeta'
        return Response(_zip_stream(_iter_zip_entries([(target, clean_single_name)])),
                        mimetype='application/zip',
                        headers={'Content-Disposition': f'attachment; filename="{safe_zip_name}.zip"'}), None

    ext = os.path.splitext(clean_single_name)[1].lower()
    is_attachment = force_dl or (ext not in ('.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt', '.md', '.json'))
    return send_file(target, as_attachment=is_attachment, download_name=clean_single_name), None
