"""Cluster de previews/PDF extraído de cloud.services (fase 6N.9).

Genera miniaturas (imágenes, vídeo, PDF) y placeholders SVG para la
previsualización de archivos. Depende de _infra (BASE_CLOUD_ROOT,
MAX_FILE_SIZE_PREVIEW) y de _context (get_user_root, get_view_root,
_resolve_shared_or_recent_path, add_activity). No depende de services.py.
"""

import hashlib
import io
import os
import subprocess
import uuid

from flask import request, send_file
from modules.session import session as sess
from core.cloud_paths import safe_join
from . import _infra
from ._context import get_user_root, get_view_root, _resolve_shared_or_recent_path, add_activity
from ._infra import MAX_FILE_SIZE_PREVIEW


def _pdf_thumbnail(target_path, size, mtime_ns):
    """Genera una miniatura PNG de la primera página de un PDF, con caché en disco.
    Renderiza SOLO la página 1 a baja resolución (96 DPI) para no cargar
    documentos pesados de golpe. Devuelve la ruta del PNG cacheado o None."""
    thumbs_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool', 'thumbs')
    tmp_prefix = None
    try:
        os.makedirs(thumbs_dir, exist_ok=True)
        key = hashlib.sha256(f"{target_path}:{size}:{mtime_ns}".encode()).hexdigest()[:16]
        cache_path = os.path.join(thumbs_dir, f"{key}.png")
        if os.path.exists(cache_path):
            return cache_path

        tmp_prefix = os.path.join(thumbs_dir, f".tmp_{os.getpid()}_{uuid.uuid4().hex[:8]}")
        cmd = ['pdftoppm', '-f', '1', '-l', '1', '-png', '-singlefile', '-r', '96', target_path, tmp_prefix]
        subprocess.run(cmd, capture_output=True, timeout=30, check=True)
        result = tmp_prefix + '.png'
        if not os.path.exists(result):
            return None
        os.rename(result, cache_path)
        return cache_path
    except Exception:
        return None
    finally:
        if tmp_prefix:
            for leftover in (tmp_prefix, tmp_prefix + '.png'):
                if os.path.exists(leftover):
                    try:
                        os.unlink(leftover)
                    except OSError:
                        pass


def _preview_placeholder(ext=None):
    """SVG ligero con icono de documento: evita el icono de imagen rota cuando
    no se puede generar la miniatura (PDF enorme, timeout, binario ausente...)."""
    label = (ext or 'PDF').lstrip('.').upper()[:6]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">'
        '<rect width="160" height="120" rx="8" fill="#e8eaf0"/>'
        '<path d="M60 22 h28 l20 20 v56 a6 6 0 0 1-6 6 H60 a6 6 0 0 1-6-6 V28 a6 6 0 0 1 6-6z" fill="#ffffff" stroke="#c3c8d4"/>'
        '<path d="M88 22 v20 h20" fill="none" stroke="#c3c8d4"/>'
        f'<text x="80" y="92" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#8a92a6">{label}</text>'
        '</svg>'
    )


def preview_file(view, name, subpath, trash_id, owner_id, token):
    base_root = get_user_root(token)
    if not base_root:
        return None, None

    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)

    try:
        if owner_id and str(owner_id) != str(current_uid):
            target_path = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
        elif view == 'trash' and trash_id:
            target_path = safe_join(base_root, '.trash', trash_id)
        else:
            v_root = get_view_root(view, token)
            target_path = safe_join(v_root, subpath, name)
    except (ValueError, PermissionError):
        return None, None

    if not os.path.exists(target_path):
        return None, None

    preview_exts = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.pdf', '.mp4', '.webm', '.mov', '.avi', '.mkv')
    if os.path.getsize(target_path) > MAX_FILE_SIZE_PREVIEW:
        ext = os.path.splitext(name)[1].lower()
        if ext in preview_exts:
            return send_file(io.BytesIO(_preview_placeholder(ext).encode()), mimetype='image/svg+xml'), None
        return None, "Archivo demasiado grande para previsualizar de forma directa"

    # Las miniaturas (carga automática del navegador en listados/grid) NO
    # cuentan como "abriste el archivo": solo el preview intencional lo hace.
    if request.args.get('thumbnail') != '1':
        add_activity(sess.get_user(token), sess.get_user_id(token), "act_abrio", name, subpath, owner_id)

    ext = os.path.splitext(name)[1].lower()
    if ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'):
        resp = send_file(target_path)
        if ext == '.svg':
            # XSS almacenado: los SVG se sirven inline en el mismo origen;
            # el CSP bloquea scripts/eventos dentro del documento.
            resp.headers['Content-Security-Policy'] = (
                "default-src 'none'; script-src 'none'; object-src 'none'; img-src data:"
            )
        return resp, None

    if ext in ('.mp4', '.webm', '.mov', '.avi', '.mkv'):
        for attempt in [('00:00:01',), ('00:00:00',)]:
            try:
                cmd = ['ffmpeg', '-i', target_path, '-ss', attempt[0], '-vframes', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']
                result = subprocess.run(cmd, capture_output=True, check=True, timeout=5)
                return send_file(io.BytesIO(result.stdout), mimetype='image/jpeg'), None
            except Exception:
                continue
        return send_file(io.BytesIO(_preview_placeholder(ext).encode()), mimetype='image/svg+xml'), None

    if ext == '.pdf':
        st = os.stat(target_path)
        thumb = _pdf_thumbnail(target_path, st.st_size, st.st_mtime_ns)
        if thumb:
            return send_file(thumb, mimetype='image/png'), None
        return send_file(io.BytesIO(_preview_placeholder('pdf').encode()), mimetype='image/svg+xml'), None

    return None, "Tipo de archivo no previsualizable"
