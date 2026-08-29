"""Cluster de vídeo.

Transcodificación asíncrona (ffmpeg) y streaming de vídeo con caché LRU.
Depende de _infra (BASE_CLOUD_ROOT, _is_safe_path, tokens_lock,
download_tokens). No depende de services.py.
"""

import hashlib
import logging
import os
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from flask import send_file, request
from modules.session import session as sess
from . import _infra
from ._infra import _is_safe_path, tokens_lock, download_tokens

logger = logging.getLogger("NullVoidCloud")

# Transcodificación de vídeo ASÍNCRONA: los archivos grandes (cientos de MB)
# tardan minutos en transcodificar; hacerlo síncrono en la petición colgaba el
# worker (Worker graceful timeout) y, al superar el timeout de 120s, caía en
# silencio al original — el selector de calidad "no cambiaba de resolución".
# Ahora el trabajo corre en un hilo de fondo, el endpoint responde al instante
# con 202 {status: processing} y el frontend hace polling hasta que el cache
# está listo.
_VIDEO_TRANSCODE_TIMEOUT = int(os.environ.get("VIDEO_TRANSCODE_TIMEOUT", "900"))
# Límite del caché de vídeo transcodificado (LRU). Al superarlo se eliminan
# las versiones más antiguas (por mtime); el archivo ORIGINAL de la nube nunca
# se toca.
VIDEO_CACHE_MAX_MB = int(os.environ.get("VIDEO_CACHE_MAX_MB", "5120"))
# Calidad que se genera automáticamente en segundo plano al abrir un vídeo
# (solo UNA, para no saturar CPU); el resto se genera bajo demanda.
VIDEO_PREWARM_QUALITY = os.environ.get("VIDEO_PREWARM_QUALITY", "720p").lower()
VIDEO_QUALITIES = ('2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p')
VIDEO_HEIGHTS = {'2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720,
                 '480p': 480, '360p': 360, '240p': 240, '144p': 144}
# 2 workers: si el usuario cambia de calidad rápidamente (p. ej. 360p y luego
# 720p), ambas transcodificaciones avanzan en paralelo en vez de encolarse.
_video_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="nv-video")
_video_jobs = {}
_video_jobs_lock = threading.Lock()
_video_cache_checked_at = 0.0


def _transcode_video_worker(target, target_height, cache_dir, key, quality):
    """Transcodifica un vídeo a la calidad pedida en un hilo de fondo.

    Escribe primero a un .tmp y renombra al final (nunca se sirve un cache
    parcial). Si falla el primer intento con '-c:a copy' (audio no compatible
    con el contenedor mp4) reintenta con AAC.
    """
    tmp_target = os.path.join(cache_dir, f".tmp_{key}_{quality}.mp4")
    cached_file = os.path.join(cache_dir, f"{key}_{quality}.mp4")
    try:
        cmd = [
            'ffmpeg', '-y', '-i', target,
            '-vf', f'scale=-2:{target_height},format=yuv420p',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            tmp_target
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=_VIDEO_TRANSCODE_TIMEOUT)
        if result.returncode != 0:
            # Fallback si la copia de audio falla (p. ej. audio no-AAC para mp4)
            cmd_aac = [
                'ffmpeg', '-y', '-i', target,
                '-vf', f'scale=-2:{target_height},format=yuv420p',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                tmp_target
            ]
            result = subprocess.run(cmd_aac, capture_output=True, timeout=_VIDEO_TRANSCODE_TIMEOUT)

        if result.returncode == 0 and os.path.exists(tmp_target) and os.path.getsize(tmp_target) > 0:
            os.replace(tmp_target, cached_file)
        else:
            logger.warning(f"[VIDEO][WARN] FFmpeg transcode failed (code {result.returncode}): {result.stderr.decode('utf-8', errors='ignore')}")
            if os.path.exists(tmp_target):
                try:
                    os.unlink(tmp_target)
                except OSError:
                    pass
    except Exception as e:
        logger.warning(f"[VIDEO][WARN] Error al transcodificar video en calidad {quality}: {e}")
        if os.path.exists(tmp_target):
            try:
                os.unlink(tmp_target)
            except OSError:
                pass
    finally:
        with _video_jobs_lock:
            _video_jobs.pop(key, None)
        # Política LRU: tras cada transcode se comprueba el límite de caché.
        try:
            _cleanup_video_cache(cache_dir, force=True)
        except Exception:
            pass


def _source_video_height(target):
    """Altura del stream de vídeo del archivo, o 0 si no se puede conocer."""
    try:
        probe = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=height', '-of', 'csv=p=0', target],
            capture_output=True, text=True, timeout=15)
        if probe.returncode == 0 and probe.stdout.strip():
            return int(probe.stdout.strip().splitlines()[0])
    except Exception:
        pass
    return 0


def _video_cache_key(target, quality):
    try:
        st = os.stat(target)
    except OSError:
        return None, None
    key = hashlib.sha256(f"{target}:{st.st_size}:{st.st_mtime_ns}:{quality}".encode()).hexdigest()[:16]
    return key, st


def _cleanup_video_cache(cache_dir, force=False):
    """Política LRU: si el caché supera VIDEO_CACHE_MAX_MB se eliminan las
    versiones transcodificadas más antiguas (por mtime) hasta quedar bajo el
    límite. Nunca toca los .tmp en curso ni los originales de la nube."""
    global _video_cache_checked_at
    now = time.time()
    if not force and now - _video_cache_checked_at < 300:
        return
    try:
        entries = []
        total = 0
        for f in os.listdir(cache_dir):
            if f.startswith('.tmp_'):
                continue
            fp = os.path.join(cache_dir, f)
            try:
                sz = os.path.getsize(fp)
                mtime = os.path.getmtime(fp)
            except OSError:
                continue
            entries.append((mtime, fp, sz))
            total += sz
        limit = VIDEO_CACHE_MAX_MB * 1024 * 1024
        if total > limit:
            entries.sort()  # más antiguos primero (LRU)
            for _, fp, sz in entries:
                if total <= limit:
                    break
                try:
                    os.remove(fp)
                    total -= sz
                    logger.info(f"[VIDEO][INFO] Cache LRU: eliminado {os.path.basename(fp)} ({sz // 1024 // 1024} MB)")
                except OSError:
                    pass
        _video_cache_checked_at = now
    except Exception as e:
        logger.warning(f"[VIDEO][WARN] Limpieza de caché de vídeo falló: {e}")


def _maybe_prewarm_video(target):
    """Genera en segundo plano UNA calidad por defecto al abrir el vídeo, para
    que el selector tenga versiones disponibles sin procesar las 8 de golpe."""
    quality = VIDEO_PREWARM_QUALITY
    if quality not in VIDEO_QUALITIES:
        return
    try:
        cache_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool', 'video_cache')
        os.makedirs(cache_dir, exist_ok=True)
        source_height = _source_video_height(target)
        target_height = VIDEO_HEIGHTS[quality]
        if source_height and target_height >= source_height:
            return  # sin upscaling: no tiene sentido generar esta calidad
        key, _ = _video_cache_key(target, quality)
        if not key:
            return
        cached_file = os.path.join(cache_dir, f"{key}_{quality}.mp4")
        if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
            return
        with _video_jobs_lock:
            if key in _video_jobs:
                return
            _video_jobs[key] = True
            _video_executor.submit(
                _transcode_video_worker, target, target_height, cache_dir, key, quality)
    except Exception as e:
        logger.warning(f"[VIDEO][WARN] Prewarm de vídeo falló: {e}")


def stream_video(dl_token, quality='original', status_only=False, available_only=False):
    if not dl_token:
        return None, "Token requerido"

    with tokens_lock:
        info = download_tokens.get(dl_token)
        if not info:
            return None, "Token inválido o expirado"

        current_uid = sess.get_user_id(request.user_token) if hasattr(request, 'user_token') and request.user_token else None
        if not current_uid:
            token = request.cookies.get('token') or request.headers.get('X-Token')
            current_uid = sess.get_user_id(token) if token else None

        if info.get('bound_user_id') and str(info['bound_user_id']) != str(current_uid):
            return None, "Acceso denegado: Token no vinculado a su sesión"

        if time.time() > info['expires']:
            download_tokens.pop(dl_token, None)
            return None, "Token expirado"

    target = info['path']
    if not os.path.exists(target) or os.path.isdir(target):
        return None, "Archivo no encontrado"

    if not _is_safe_path(_infra.BASE_CLOUD_ROOT, target):
        return None, "Acceso denegado: Violación de aislamiento"

    ext = os.path.splitext(target)[1].lower()
    if ext not in ('.mp4', '.webm', '.mov', '.avi', '.mkv'):
        return send_file(target, conditional=True), None

    cache_dir = os.path.join(_infra.BASE_CLOUD_ROOT, '.pool', 'video_cache')

    # Verificación inteligente: devuelve las calidades ya generadas (cache) y
    # las que están transcodificándose, para que el selector solo muestre lo
    # que puede servirse al instante y no lance trabajo innecesario.
    if available_only:
        available = []
        processing = []
        skipped = []  # nunca se generarán (sin upscaling): el frontend no debe ofrecerlas
        try:
            os.makedirs(cache_dir, exist_ok=True)
            source_height = _source_video_height(target)
            for q in VIDEO_QUALITIES:
                if source_height and VIDEO_HEIGHTS[q] >= source_height:
                    skipped.append(q)
                    continue
                key, _ = _video_cache_key(target, q)
                if not key:
                    continue
                cached_file = os.path.join(cache_dir, f"{key}_{q}.mp4")
                if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
                    available.append(q)
                else:
                    with _video_jobs_lock:
                        if key in _video_jobs:
                            processing.append(q)
        except Exception as e:
            logger.warning(f"[VIDEO][WARN] Listado de calidades disponibles falló: {e}")
        return {"available": available, "processing": processing, "skipped": skipped}, None

    if quality == 'original':
        # Pre-warm: al abrir el vídeo se genera en segundo plano la calidad
        # por defecto (una sola; el resto se pide bajo demanda).
        _maybe_prewarm_video(target)
        return send_file(target, conditional=True), None

    if quality not in VIDEO_QUALITIES:
        return send_file(target, conditional=True), None

    target_height = VIDEO_HEIGHTS[quality]

    try:
        os.makedirs(cache_dir, exist_ok=True)
        key, _ = _video_cache_key(target, quality)
        cached_file = os.path.join(cache_dir, f"{key}_{quality}.mp4")

        if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
            return send_file(cached_file, mimetype='video/mp4', conditional=True), None

        if not shutil.which('ffmpeg'):
            return send_file(target, conditional=True), None

        # Sin upscaling: si la altura del origen es <= a la calidad pedida,
        # se sirve el original (transcodificar "hacia arriba" no aporta nada).
        source_height = _source_video_height(target)
        if source_height and target_height >= source_height:
            return send_file(target, conditional=True), None

        # Limpieza LRU (con throttling) antes de generar más caché.
        _cleanup_video_cache(cache_dir)

        # Lanza (o reutiliza) el trabajo de transcodificación en segundo plano.
        with _video_jobs_lock:
            if key not in _video_jobs:
                _video_jobs[key] = True
                _video_executor.submit(
                    _transcode_video_worker, target, target_height, cache_dir, key, quality)

        # Solo la primera petición espera un rato por si el archivo es pequeño
        # (UX ágil). El polling del frontend (status=1) responde al instante.
        if not status_only:
            deadline = time.time() + 5
            while time.time() < deadline:
                if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
                    break
                time.sleep(0.25)

        if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
            return send_file(cached_file, mimetype='video/mp4', conditional=True), None

        # Aún transcodificando: el frontend hace polling con status_only=1.
        return {"status": "processing", "quality": quality}, None
    except Exception as e:
        logger.warning(f"Error al transcodificar video local en calidad {quality}: {e}")
        return send_file(target, conditional=True), None
