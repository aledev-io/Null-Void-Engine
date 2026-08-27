"""Infraestructura de bajo nivel de Cloud, dependencia-neutral (fase 6N.20).

Reúne constantes, primitivas de ruta/seguridad, persistencia JSON, cálculo de
tamaños, estado de tokens de descarga y el acceso al token de petición. NO
depende de services.py ni de ningún submodule de Cloud (solo stdlib, config y
core.cloud_paths). Las funciones de contexto de usuario/vistas/cuota viven en
_context.py; el negocio de cada cluster en su submodule.
"""

import json
import os
import shutil
import time
import uuid
import threading
import fcntl
import logging

from flask import request
from config.config import CONFIG
from core.cloud_paths import safe_join


# Raíz del módulo IA. Los consumidores y tests la leen/parchean; se lee en
# tiempo de llamada vía este módulo (o se re-exporta desde services.py).
AI_BASE_ROOT = os.path.join(CONFIG.DATA_DIR, 'ai')
os.makedirs(AI_BASE_ROOT, exist_ok=True)

# Configuración del logger para ver las alertas limpias en la terminal de Docker
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NullVoidCloud")

BASE_CLOUD_ROOT = os.path.join(CONFIG.DATA_DIR, 'Cloud')
os.makedirs(BASE_CLOUD_ROOT, exist_ok=True)

MAX_FILE_SIZE_PREVIEW = 100 * 1024 * 1024

user_size_cache = {}
cache_lock = threading.Lock()
CACHE_TTL = 10


class FileLock:
    def __init__(self, path):
        self.path = path
        self.fd = None

    def __enter__(self):
        self.fd = open(self.path, "a")
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        except OSError:
            pass
        return self.fd

    def __exit__(self, exc_type, exc, tb):
        try:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
        except OSError:
            pass
        if self.fd:
            self.fd.close()


download_tokens = {}
tokens_lock = threading.Lock()


def _cleanup_expired_tokens():
    now = time.time()
    expired = [tk for tk, info in download_tokens.items() if now > info.get('expires', 0)]
    for tk in expired:
        download_tokens.pop(tk, None)


# Hardening ZIP (CWE-400): chunks de I/O y cooperación con el event loop
_ZIP_CHUNK_BYTES = int(os.environ.get("ZIP_CHUNK_BYTES", str(2 * 1024 * 1024)))
# Límite de seguridad: tamaño total descomprimido máximo admitido por descompresión.
_MAX_UNCOMPRESSED_BYTES = int(os.environ.get("ZIP_MAX_UNCOMPRESSED_BYTES", str(10 * 1024 ** 3)))


def _yield_event_loop():
    """Cede el control al event loop (gevent/eventlet) en iteraciones largas;
    si no hay monkey-patch, un sleep(0) libera el GIL brevemente."""
    try:
        import eventlet
        eventlet.sleep(0)
        return
    except ImportError:
        pass
    try:
        import gevent
        gevent.sleep(0)
        return
    except ImportError:
        pass
    time.sleep(0)


def _unique_path(path):
    """Devuelve una ruta libre en el mismo directorio. Si ya existe,
    añade un sufijo numérico estilo SO: 'Archivo(1).txt', 'Archivo(2).txt'..."""
    if not os.path.exists(path):
        return path
    parent = os.path.dirname(path)
    base = os.path.basename(path)
    stem, ext = os.path.splitext(base)
    n = 1
    while True:
        candidate = os.path.join(parent, f"{stem}({n}){ext}")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def _reject_relative_segments(subpath, name):
    """Rechaza secuencias relativas ('.'/'..') en rutas de recursos compartidos."""
    for seg in (subpath or '').replace('\\', '/').split('/'):
        if seg in ('.', '..'):
            raise PermissionError("Acceso denegado a este recurso")
    if name:
        for seg in str(name).replace('\\', '/').split('/'):
            if seg in ('.', '..'):
                raise PermissionError("Acceso denegado a este recurso")


def _join_shared_child(shared_base, subpath, name):
    """Resuelve un descendiente del recurso compartido garantizando que el
    resultado quede estrictamente dentro del sandbox del recurso (shared_base)."""
    if not os.path.isdir(shared_base):
        raise PermissionError("Acceso denegado a este recurso")
    _reject_relative_segments(subpath, name)
    try:
        return safe_join(shared_base, subpath, name)
    except ValueError:
        raise PermissionError("Acceso denegado a este recurso")


def _is_safe_path(base_root, target_path) -> bool:
    try:
        base_abs = os.path.abspath(base_root)
        target_abs = os.path.abspath(target_path)
        target_real = os.path.realpath(target_abs)

        if os.path.islink(target_abs) or (target_abs != target_real and not target_real.startswith(base_abs)):
            return False

        return os.path.commonpath([base_abs, target_real]) == base_abs
    except Exception:
        return False


def ai_root_for_uid(uid):
    if not uid:
        return None
    safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_uid:
        safe_uid = "unknown"
    return safe_join(AI_BASE_ROOT, safe_uid)


def get_token():
    if hasattr(request, 'user_token'):
        return request.user_token
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not token:
        auth = request.headers.get('Authorization')
        if auth and auth.startswith('Bearer '):
            token = auth.split(' ')[1]
    return token or request.headers.get('X-Token')


def get_dir_size(path):
    """ Calcula el tamaño del directorio optimizado mediante caché atómica por usuario. """
    user_id = os.path.basename(path)
    now = time.time()

    with cache_lock:
        cache = user_size_cache.get(user_id)
        if cache and now - cache["time"] < CACHE_TTL:
            return cache["value"]

    total = 0
    if os.path.exists(path):
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        pass

    with cache_lock:
        user_size_cache[user_id] = {"value": total, "time": now}

    return total


def _path_size(path):
    """Tamaño real de un archivo o carpeta (sin caché)."""
    if not os.path.exists(path):
        return 0
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    return total


def bump_size_cache(user_id, delta):
    """Ajusta el tamaño cacheado del usuario tras subir/borrar, refrescando su TTL.

    Evita que subidas en ráfaga se cuelen por encima de la cuota dentro de la
    ventana del caché (10s) y que borrados no liberen espacio hasta expirar.
    """
    with cache_lock:
        cache = user_size_cache.get(user_id)
        if cache:
            cache["value"] = max(0, cache["value"] + delta)
            cache["time"] = time.time()


def get_folder_size_fast(folder_path):
    """Calcula recursivamente el tamaño total acumulado de los archivos dentro de una carpeta."""
    total = 0
    if os.path.exists(folder_path) and os.path.isdir(folder_path):
        try:
            with os.scandir(folder_path) as it:
                for entry in it:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                        elif entry.is_dir(follow_symlinks=False):
                            total += get_folder_size_fast(entry.path)
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def get_disk_info(path):
    try:
        total, used, free = shutil.disk_usage(path)
        return {"total": total, "free": free, "used": used}
    except Exception:
        return {"total": 0, "free": 0, "used": 0}


def _load_json(user_root, filename):
    path = os.path.join(user_root, filename)
    lock_path = path + ".lock"

    if os.path.exists(path):
        with FileLock(lock_path):  # <-- Interceptado por Kernel Linux a nivel multi-proceso
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.error(f"[OPERATIONAL][ERROR] Error al leer metadatos {filename}: {e}")
                return []
    return []


def _save_json(user_root, filename, data):
    path = os.path.join(user_root, filename)
    lock_path = path + ".lock"

    with FileLock(lock_path):
        tmp_path = path + f".{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except OSError as e:
            logger.error(f"[OPERATIONAL][CRITICAL] Fallo de IO/Disco al guardar {filename}: {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


def _update_json(user_root, filename, update_fn, default=None):
    """Actualización atómica (leer → modificar → escribir) bajo FileLock.

    A diferencia de _load_json + _save_json por separado, mantiene el candado
    fcntl durante TODA la operación: dos peticiones simultáneas (o el agente de
    sincronización) que toquen el mismo metadato no pueden pisarse entre sí.
    update_fn recibe la lista actual y debe devolver la nueva lista.
    """
    path = os.path.join(user_root, filename)
    lock_path = path + ".lock"

    with FileLock(lock_path):
        data = list(default) if default is not None else []
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.error(f"[OPERATIONAL][ERROR] Error al leer metadatos {filename}: {e}")
                data = list(default) if default is not None else []
        try:
            new_data = update_fn(data)
        except Exception as e:
            logger.error(f"[OPERATIONAL][ERROR] Error al actualizar metadatos {filename}: {e}")
            return data
        tmp_path = path + f".{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp_path, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except OSError as e:
            logger.error(f"[OPERATIONAL][CRITICAL] Fallo de IO/Disco al guardar {filename}: {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
        return new_data
