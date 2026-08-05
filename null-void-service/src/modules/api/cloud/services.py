import io
import json
import os
import sys
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
import threading
import fcntl
import logging
import hashlib
import stat
from pathlib import Path
from flask import request, send_file, after_this_request
from modules.session import session as sess
from config.config import CONFIG
from . import repository

# Configuración del logger para ver las alertas limpias en la terminal de Docker
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("NullVoidCloud")

BASE_CLOUD_ROOT = os.path.join(CONFIG.DATA_DIR, 'Cloud')
CONFIG_PATH = os.path.join(CONFIG.DATA_DIR, 'cloud_config.json')
os.makedirs(BASE_CLOUD_ROOT, exist_ok=True)

MAX_FILE_SIZE_PREVIEW = 100 * 1024 * 1024

user_size_cache = {}
cache_lock = threading.Lock()
CACHE_TTL = 10

search_index = {}
index_lock = threading.Lock()
class FileLock:
    def __init__(self, path):
        self.path = path
        self.fd = None

    def __enter__(self):
        self.fd = open(self.path, "w")
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

_user_json_locks = {}
_global_lock_manager = threading.Lock()

def _get_user_lock(user_id) -> threading.Lock:
    with _global_lock_manager:
        if user_id not in _user_json_locks:
            _user_json_locks[user_id] = threading.Lock()
        return _user_json_locks[user_id]


# ── Hardening ZIP (CWE-400): chunks de I/O y cooperación con el event loop ──
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


def safe_join(base, *paths):
    base_abs = os.path.abspath(base)
    current = base_abs

    for p in paths:
        clean_p = str(p).replace('\\', '/').strip('/')
        if not clean_p or clean_p in ('.', '..'):
            continue
            
        next_path = os.path.abspath(os.path.join(current, clean_p))
        real_next = os.path.realpath(next_path)
        
        if os.path.commonpath([base_abs, real_next]) != base_abs:
            logger.error(f"[SECURITY][ALERT] Intento de escape perimetral hacia: {real_next}")
            raise ValueError("Acceso denegado: Violación de aislamiento de ruta lúdica")
            
        current = real_next

    return current


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


def require_access(user_id, owner_id=None, file_name=None):
    if owner_id and str(owner_id) != str(user_id):
        if not file_name or not repository.is_shared_with_user(owner_id, user_id, file_name):
            sys.stderr.write(f"[SECURITY][WARN] IDOR Interceptado: Usuario {user_id} intentó acceder a recurso de {owner_id}\n")
            raise PermissionError("Acceso denegado a este recurso")


def resolve_shared_path(current_uid, owner_id, name, subpath):
    parts = subpath.strip('/').split('/') if subpath else []
    if parts and parts[0]:
        top_name = parts[0]
        rest_path = '/'.join(parts[1:])
    else:
        top_name = name
        rest_path = ''
        
    shared_item = repository.get_shared_item(owner_id, current_uid, top_name)
    if not shared_item:
        sys.stderr.write(f"[SECURITY][WARN] IDOR Interceptado: Usuario {current_uid} intentó acceder a recurso de {owner_id}\n")
        raise PermissionError("Acceso denegado a este recurso")
        
    owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, owner_id))
    if shared_item['view'] == 'computers':
        owner_root = os.path.realpath(os.path.join(owner_root, '.computers'))
        
    if rest_path:
        return safe_join(owner_root, shared_item['file_path'], shared_item['file_name'], rest_path, name)
    elif top_name == name:
        return safe_join(owner_root, shared_item['file_path'], shared_item['file_name'])
    else:
        return safe_join(owner_root, shared_item['file_path'], shared_item['file_name'], name)

def get_token():
    if hasattr(request, 'user_token'):
        return request.user_token
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not token:
        auth = request.headers.get('Authorization')
        if auth and auth.startswith('Bearer '):
            token = auth.split(' ')[1]
    return token or request.args.get('token')


def _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view):
    if view in ('home', 'recent'):
        owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, str(owner_id)))
        fp = safe_join(owner_root, subpath, name)
        shared_in_path, inherited = repository.get_shares_in_path(owner_id, subpath)
        combined = shared_in_path.get(name, list(inherited))
        if not any(str(s['shared_with']) == str(current_uid) for s in combined):
            raise PermissionError("Acceso denegado")
        return fp
    return resolve_shared_path(current_uid, owner_id, name, subpath)


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


def get_user_root(token=None):
    if token is None:
        token = get_token()
    uid = sess.get_user_id(token) if token else None
    if not uid:
        return None
    safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_uid:
        safe_uid = "unknown"
    return safe_join(BASE_CLOUD_ROOT, safe_uid)


def get_view_root(view='drive', token=None):
    base_root = get_user_root(token)
    if not base_root:
        return None
    if view in ('computers', 'backups', 'business', 'trash'):
        return safe_join(base_root, f'.{view}')
    return base_root


def get_user_quota(token=None):
    if token is None:
        token = get_token()
    username = sess.get_user(token) if token else None
    if not username:
        return 10
    return repository.get_user_quota_from_db(username)


def get_dir_size(path):
    """ Calcula el tamaño del directorio optimizado mediante caché atómica por usuario. """
    user_id = os.path.basename(path)
    now = time.time()
    
    with cache_lock:
        cache = user_size_cache.get(user_id)
        if cache and now - cache["time"] < CACHE_TTL:
            return cache["value"]

    # Si expiró el TTL, hacemos el walk físico
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
                sys.stderr.write(f"[OPERATIONAL][ERROR] Error al leer metadatos {filename}: {e}\n")
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
            sys.stderr.write(f"[OPERATIONAL][CRITICAL] Fallo de IO/Disco al guardar {filename}: {e}\n")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass


def add_activity(user, user_id, action, name, path="", owner_id=None):
    if not user_id:
        return
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
    os.makedirs(user_root, exist_ok=True)
    activity = _load_json(user_root, '.activity.json')
    activity.insert(0, {
        "user": user, "user_id": user_id, "action": action,
        "name": name, "path": path, "time": time.time(),
        "owner_id": owner_id,
    })
    _save_json(user_root, '.activity.json', activity[:50])

    if owner_id and str(owner_id) != str(user_id) and owner_id != 'null':
        owner_root = os.path.join(BASE_CLOUD_ROOT, str(owner_id))
        if os.path.exists(owner_root):
            owner_activity = _load_json(owner_root, '.activity.json')
            owner_activity.insert(0, {
                "user": user, "user_id": user_id, "action": action,
                "name": name, "path": path, "time": time.time(),
                "owner_id": owner_id,
            })
            _save_json(owner_root, '.activity.json', owner_activity[:50])
            try:
                from modules import socketio
                socketio.emit('activity_update', {'name': name, 'action': action, 'user': user}, room=f"user_{owner_id}")
            except Exception as e:
                pass


def list_recent(token):
    user_root = get_user_root(token)
    if not user_root:
        return None

    current_uid = sess.get_user_id(token)
    current_user = sess.get_user(token)
    filter_computers = request.args.get('filter_computers') == 'true'

    starred_data = _load_json(user_root, '.starred.json')
    protected_data = _load_json(user_root, '.protected.json')
    activity_data = _load_json(user_root, '.activity.json')

    recent_files = []
    for act in activity_data:
        if not act.get('name') or act['name'].startswith('.'):
            continue
        if act.get('user_id') != current_uid:
            continue

        owner_id = act.get('owner_id')
        is_shared = False
        
        try:
            if owner_id and str(owner_id) != str(current_uid):
                is_shared = True
                
                shared_in_path, inherited = repository.get_shares_in_path(owner_id, act['path'])
                combined = shared_in_path.get(act['name'], list(inherited))
                if not any(str(s['shared_with']) == str(current_uid) for s in combined):
                    raise PermissionError("Acceso denegado a este recurso")
                    
                fp = safe_join(BASE_CLOUD_ROOT, owner_id, act['path'], act['name'])
                base_scope = os.path.join(BASE_CLOUD_ROOT, owner_id)
            else:
                fp = safe_join(user_root, act['path'], act['name'])
                base_scope = user_root
                
            if not os.path.exists(fp):
                continue
        except (ValueError, PermissionError):
            continue

        is_comp = '.computers' in act['path']
        info = os.stat(fp)
        item_view = "computers" if is_comp else ("shared" if is_shared else "drive")
        owner_name = repository.get_username_by_id(owner_id) if is_shared else current_user

        target_owner_id = owner_id if is_shared else current_uid
        shared_in_path, inherited_shares = repository.get_shares_in_path(target_owner_id, act['path'])
        shared_users = shared_in_path.get(act['name'], list(inherited_shares))

        is_item_starred = False
        for s in starred_data:
            if s.get('name') == act['name'] and s.get('path') == act['path']:
                s_owner = s.get('owner_id')
                if (not owner_id and not s_owner) or (str(owner_id) == str(s_owner)) or (not s_owner):
                    is_item_starred = True
                    break

        recent_files.append({
            "name": act['name'], "path": act['path'],
            "is_dir": os.path.isdir(fp), "size": info.st_size,
            "mtime": info.st_mtime, "ext": os.path.splitext(act['name'])[1].lower(),
            "owner": owner_name, "owner_id": owner_id,
            "action_type": act['action'], "action_time": act['time'],
            "starred": is_item_starred,
            "protected": {"name": act['name'], "path": act['path'], "view": item_view} in protected_data,
            "view": item_view,
            "shared": len(shared_users) > 0,
            "shared_with": shared_users,
        })

    seen = set()
    unique = []
    for f in recent_files:
        key = (f['name'], f['path'])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    unique.sort(key=lambda x: x.get('action_time', x['mtime']), reverse=True)
    return unique[:20]


def list_files(view, subpath, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None

    try:
        target_path = safe_join(user_root, subpath.strip('/'))
    except ValueError:
        return None, None
        
    if not os.path.exists(target_path):
        return [], subpath

    base_root = get_user_root(token)
    protected_data = _load_json(base_root, '.protected.json')
    starred_data = _load_json(base_root, '.starred.json')
    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)

    files = []
    try:
        entries = os.listdir(target_path)
    except OSError as e:
        sys.stderr.write(f"[OPERATIONAL][ERROR] No se pudo leer el directorio {target_path}: {e}\n")
        return None, subpath

    shared_in_path, inherited_shares = repository.get_shares_in_path(current_uid, subpath)

    for name in entries:
        if name.startswith('.'):
            continue
        try:
            fp = os.path.join(target_path, name)
            if os.path.islink(fp):
                continue
            is_dir = os.path.isdir(fp)
            info = os.stat(fp)
            is_protected = {"name": name, "path": subpath, "view": view} in protected_data
            active_status = False
            if view == 'computers' and subpath == '':
                is_protected = True
                device_name = name.replace(' 💻', '')
                from src.core.database import get_db
                with get_db() as conn:
                    user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
                    if user_row:
                        uid = user_row['user_id']
                        dev = conn.execute("SELECT last_seen FROM cloud_devices WHERE user_id = ? AND name = ?", (uid, device_name)).fetchone()
                        if dev and time.time() - dev['last_seen'] < 15:
                            active_status = True
            is_starred = False
            for item in starred_data:
                if item.get('name') == name and item.get('path') == subpath:
                    item_owner = item.get('owner_id')
                    if (not owner_id and not item_owner) or \
                       (str(owner_id) == str(item_owner)) or \
                       (owner_id and str(owner_id) == str(current_uid) and not item_owner):
                        is_starred = True
                        break

            shared_users = shared_in_path.get(name, list(inherited_shares))
            files.append({
                "name": name, "path": subpath, "is_dir": is_dir, "size": info.st_size,
                "mtime": info.st_mtime, "owner": "Yo", "owner_id": current_uid,
                "ext": os.path.splitext(name)[1].lower(),
                "protected": is_protected, "starred": is_starred, "active": active_status,
                "shared": len(shared_users) > 0, "shared_with": shared_users,
            })
        except OSError as e:
            sys.stderr.write(f"[OPERATIONAL][WARN] Error al leer metadatos del archivo {name}: {e}\n")
            continue

    files.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return files, subpath


def list_trash(token, user_root):
    base_root = get_user_root(token)
    trash_data = _load_json(base_root, '.trash.json')
    trash_path = os.path.join(base_root, '.trash')

    files = []
    for item in trash_data:
        try:
            fp = safe_join(trash_path, item['id'])
            if os.path.exists(fp):
                info = os.stat(fp)
                files.append({
                    "id": item['id'], "name": item['name'],
                    "original_path": item['original_path'],
                    "is_dir": os.path.isdir(fp), "size": info.st_size,
                    "mtime": item['deleted_at'], "ext": os.path.splitext(item['name'])[1].lower(),
                    "owner": "Papelera", "view": item.get('view', 'drive'), "trash": True,
                })
        except ValueError:
            continue
    files.sort(key=lambda x: x['mtime'], reverse=True)
    return files, ''


def upload_file(view, subpath, token, file_storage):
    user_root = get_view_root(view, token)
    if not user_root:
        return None, None

    # Limpiar el subpath de caracteres de control (saltos de línea, etc.)
    subpath = "".join(c for c in subpath if c.isprintable()).strip('/')

    try:
        target_dir = safe_join(user_root, subpath)
    except ValueError:
        return None, None

    os.makedirs(target_dir, exist_ok=True)
    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(get_user_root(token))

    file_storage.seek(0, os.SEEK_END)
    file_size = file_storage.tell()
    file_storage.seek(0)

    raw_filename = file_storage.filename.replace('\\', '/').split('/')[-1]
    safe_filename = os.path.basename(raw_filename)
    
    safe_filename = "".join(c for c in safe_filename if c.isprintable()).strip()
    
    invalid_chars = '<>:"/\\|?*'
    if not safe_filename or any(c in invalid_chars for c in safe_filename) or safe_filename.startswith('.') or safe_filename in ('.activity.json', '.trash.json', '.starred.json', '.protected.json'):
        return False, "Nombre de archivo inválido o reservado"

    try:
        final_file_path = safe_join(target_dir, safe_filename)
    except ValueError:
        return None, None

    # Si ya existe, añadir sufijo numérico estilo SO: 'Archivo(1).txt'
    final_file_path = _unique_path(final_file_path)
    final_filename = os.path.basename(final_file_path)

    if current_usage + file_size > limit_bytes:
        return False, "Espacio insuficiente en Null-Void Cloud"

    pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
    os.makedirs(pool_dir, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(dir=pool_dir)
    sha256_hash = hashlib.sha256()

    with open(fd, 'wb') as f:
        while True:
            chunk = file_storage.read(65536)
            if not chunk:
                break
            f.write(chunk)
            sha256_hash.update(chunk)

    file_hash = sha256_hash.hexdigest()
    pool_file_path = os.path.join(pool_dir, file_hash)

    if os.path.exists(pool_file_path):
        os.unlink(temp_path)
    else:
        os.rename(temp_path, pool_file_path)

    os.link(pool_file_path, final_file_path)

    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)
    add_activity(current_user, current_uid, "act_subiste", final_filename, subpath)
    invalidate_user_index(current_uid)
    return True, None


def make_dir(view, name, subpath, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    subpath = subpath.strip('/')
    
    name = "".join(c for c in name if c.isprintable()).strip()
    
    invalid_chars = '<>:"/\\|?*'
    if not name or any(c in invalid_chars for c in name) or name.startswith('.'):
        return "El nombre contiene caracteres no permitidos"

    try:
        target_path = safe_join(user_root, subpath, name)
    except ValueError:
        return None
        
    if os.path.exists(target_path):
        return "Ya existe una carpeta o archivo con ese nombre en esta ubicación"
        
    os.makedirs(target_path, exist_ok=True)
    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)
    add_activity(current_user, current_uid, "act_creaste_la_carpeta", name, subpath)
    invalidate_user_index(current_uid)
    return True


def delete_item(view, name, subpath, trash_id, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    subpath = subpath.strip('/')
    if view == 'trash':
        return delete_permanent(trash_id, token)

    current_user = sess.get_user(token)
    current_uid = sess.get_user_id(token)

    if view == 'computers' and subpath == '':
        device_name = name.replace(' 💻', '')
        from src.core.database import get_db
        with get_db() as conn:
            conn.execute("DELETE FROM cloud_devices WHERE user_id = ? AND name = ?", (current_uid, device_name))
            conn.commit()
        try:
            target_path = safe_join(user_root, name)
            if os.path.exists(target_path):
                shutil.rmtree(target_path)
            add_activity(current_user, current_uid, "act_desvinculaste_el_dispositivo", name, subpath)
            return True
        except ValueError:
            return None

    base_root = get_user_root(token)
    protected_data = _load_json(base_root, '.protected.json')
    if {"name": name, "path": subpath, "view": view} in protected_data:
        return "Este elemento está protegido contra eliminación"

    try:
        target_path = safe_join(user_root, subpath, name)
        if not os.path.exists(target_path):
            return None
    except ValueError:
        return None

    if current_uid:
        repository.remove_shares_by_file(current_uid, name, subpath, view)

    new_trash_id = str(uuid.uuid4())
    trash_base = os.path.join(base_root, '.trash')
    os.makedirs(trash_base, exist_ok=True)
    
    shutil.move(target_path, os.path.join(trash_base, new_trash_id))

    trash_data = _load_json(base_root, '.trash.json')
    trash_data.append({"id": new_trash_id, "name": name, "original_path": subpath, "view": view, "deleted_at": time.time()})
    _save_json(base_root, '.trash.json', trash_data)
    invalidate_user_index(current_uid)
    return True


def list_file_shares(name, subpath, token):
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return []
        
    shared_in_path, inherited = repository.get_shares_in_path(current_uid, subpath)
    combined = shared_in_path.get(name, list(inherited))
    
    result = []
    seen = set()
    for s in combined:
        uid = s['shared_with']
        if uid in seen:
            continue
        seen.add(uid)
        username = repository.get_username_by_id(uid)
        result.append({'user_id': uid, 'username': username or 'Usuario'})
    return result


def clean_pool_async():
    def _clean():
        pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
        if not os.path.exists(pool_dir):
            return
        try:
            for f in os.listdir(pool_dir):
                path = os.path.join(pool_dir, f)
                if os.path.isfile(path) and os.stat(path).st_nlink == 1:
                    os.unlink(path)
        except Exception as e:
            logger.error(f"Error en clean_pool: {e}")
            
    threading.Thread(target=_clean, daemon=True).start()

def delete_permanent(trash_id, token):
    if not trash_id:
        return None
    current_uid = sess.get_user_id(token)
    base_root = get_user_root(token)
    trash_base = os.path.join(base_root, '.trash')
    try:
        trash_path = safe_join(trash_base, trash_id)
    except ValueError:
        return None

    if os.path.exists(trash_path):
        if os.path.isdir(trash_path):
            shutil.rmtree(trash_path)
        else:
            os.remove(trash_path)

    trash_data = _load_json(base_root, '.trash.json')
    trash_data = [item for item in trash_data if item['id'] != trash_id]
    _save_json(base_root, '.trash.json', trash_data)
    invalidate_user_index(current_uid)
    clean_pool_async()
    return True


def restore_item(trash_id, token):
    if not trash_id:
        return None, "ID requerido"
    current_uid = sess.get_user_id(token)
    base_root = get_user_root(token)
    trash_data = _load_json(base_root, '.trash.json')
    item = next((i for i in trash_data if i['id'] == trash_id), None)
    if not item:
        return None, "Elemento no encontrado en papelera"

    view_root = get_view_root(item.get('view', 'drive'), token)
    
    try:
        target_dir = safe_join(view_root, item['original_path'])
        target_path = safe_join(target_dir, item['name'])
    except ValueError:
        return None, "Ruta inválida detectada en el metadato de restauración"

    os.makedirs(target_dir, exist_ok=True)
    if os.path.exists(target_path):
        target_path = os.path.join(target_dir, f"Restaurado_{int(time.time())}_{item['name']}")

    shutil.move(os.path.join(base_root, '.trash', trash_id), target_path)
    trash_data = [i for i in trash_data if i['id'] != trash_id]
    _save_json(base_root, '.trash.json', trash_data)
    invalidate_user_index(current_uid)
    return True, None


def empty_trash(token):
    base_root = get_user_root(token)
    trash_path = os.path.join(base_root, '.trash')
    if os.path.exists(trash_path):
        shutil.rmtree(trash_path)
    os.makedirs(trash_path, exist_ok=True)
    _save_json(base_root, '.trash.json', [])
    clean_pool_async()
    return True


def rename_item(view, old_name, new_name, subpath, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    if view == 'shared':
        return "No puedes renombrar archivos compartidos contigo"

    subpath = subpath.strip('/')
    
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
    add_activity(sess.get_user(token), sess.get_user_id(token), "act_renombraste", new_name, subpath)
    invalidate_user_index(sess.get_user_id(token))
    return True


def copy_item(view, name, old_subpath, new_subpath, owner_id, token, new_name=None):
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
            require_access(current_uid, owner_id, name)
            owner_root = os.path.join(BASE_CLOUD_ROOT, owner_id)
            if view == 'computers':
                owner_root = os.path.join(owner_root, '.computers')
            old_path = safe_join(owner_root, old_subpath, name)
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
        return f"Error al copiar: {str(e)}"

    invalidate_user_index(current_uid)
    return True


def move_item(view, name, old_subpath, new_subpath, token):
    user_root = get_view_root(view, token)
    if not user_root:
        return None

    old_subpath = old_subpath.strip('/')
    new_subpath = new_subpath.strip('/')

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
    invalidate_user_index(sess.get_user_id(token))
    return True


def toggle_star(name, subpath, view, owner_id, token):
    base_root = get_user_root(token)
    if not base_root:
        return None, None
    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)
    starred_data = _load_json(base_root, '.starred.json')
    
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
        is_starred = False
    else:
        new_item = {"name": name, "path": subpath}
        if owner_id and str(owner_id) != str(current_uid):
            new_item["owner_id"] = owner_id
            new_item["view"] = view
        starred_data.append(new_item)
        is_starred = True
        
    _save_json(base_root, '.starred.json', starred_data)
    return True, is_starred


def toggle_protect(name, subpath, view, token):
    base_root = get_user_root(token)
    if not base_root:
        return None, None
    subpath = subpath.strip('/')

    if view in ('home', 'starred', '', None):
        if os.path.exists(os.path.join(get_user_root(token), subpath, name)):
            view = 'drive'
        elif os.path.exists(os.path.join(get_user_root(token), '.computers', subpath, name)):
            view = 'computers'
        else:
            view = 'drive'

    protected_data = _load_json(base_root, '.protected.json')
    item_key = {"name": name, "path": subpath, "view": view}
    if item_key in protected_data:
        protected_data.remove(item_key)
        is_prot = False
    else:
        protected_data.append(item_key)
        is_prot = True
    _save_json(base_root, '.protected.json', protected_data)
    return True, is_prot


def list_starred(token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    starred_data = _load_json(base_root, '.starred.json')
    protected_data = _load_json(base_root, '.protected.json')
    current_uid = sess.get_user_id(token)
    files = []
    for item in starred_data:
        try:
            if 'owner_id' in item and str(item['owner_id']) != str(current_uid):
                item_view = item.get('view', 'shared')
                fp = _resolve_shared_or_recent_path(current_uid, item['owner_id'], item['name'], item['path'], item_view)
                is_comp = False
                owner = repository.get_username_by_id(item['owner_id'])
                owner_id = item['owner_id']
                is_shared = True
            else:
                fp = safe_join(base_root, item['path'], item['name'])
                is_comp = False
                item_view = "drive"
                owner = sess.get_user(token) or "Usuario"
                owner_id = current_uid
                is_shared = False
        except (ValueError, PermissionError):
            if 'owner_id' not in item or str(item.get('owner_id')) == str(current_uid):
                try:
                    fp = safe_join(base_root, '.computers', item['path'], item['name'])
                    is_comp = True
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
            
        info = os.stat(fp)
        files.append({
            "name": item['name'], "path": item['path'],
            "is_dir": os.path.isdir(fp), "size": info.st_size,
            "mtime": info.st_mtime, "owner": owner, "owner_id": owner_id,
            "ext": os.path.splitext(item['name'])[1].lower(),
            "starred": True,
            "protected": {"name": item['name'], "path": item['path'], "view": item_view} in protected_data,
            "view": item_view,
            "is_shared": is_shared
        })
    return files


def get_quota_info(token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    limit_gb = get_user_quota(token)
    used = get_dir_size(base_root)
    disk = get_disk_info(base_root)
    return {"used_bytes": used, "limit_gb": limit_gb, "disk_total": disk['total'], "disk_free": disk['free']}


def _check_storage_capacity(token, needed_bytes):
    """Comprueba si `needed_bytes` adicionales caben en la cuota del usuario
    y físicamente en el disco del servidor. Devuelve (ok, mensaje_error)."""
    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(get_user_root(token))
    if current_usage + needed_bytes > limit_bytes:
        return False, "Espacio insuficiente en Null-Void Cloud"
    disk = get_disk_info(BASE_CLOUD_ROOT)
    if disk['free'] < needed_bytes:
        return False, "Espacio insuficiente en el servidor"
    return True, None


def get_file_info(view, name, subpath, trash_id, owner_id, token):
    base_root = get_user_root(token)
    if not base_root:
        return None
    subpath = subpath.strip('/')
    current_uid = sess.get_user_id(token)

    try:
        if owner_id and str(owner_id) != str(current_uid):
            fp = _resolve_shared_or_recent_path(current_uid, owner_id, name, subpath, view)
            original_name = name
            username = repository.get_username_by_id(owner_id)
        elif view == 'trash' and trash_id:
            trash_base = os.path.join(base_root, '.trash')
            fp = safe_join(trash_base, trash_id)
            original_name = name
            trash_data = _load_json(base_root, '.trash.json')
            item = next((i for i in trash_data if i['id'] == trash_id), None)
            if item:
                original_name = item['name']
            username = sess.get_user(token) or "Usuario"
        else:
            v_root = get_view_root(view, token)
            try:
                fp = safe_join(v_root, subpath, name)
                if not os.path.exists(fp):
                    raise ValueError()
            except ValueError:
                alt = safe_join(base_root, '.computers', subpath, name)
                if os.path.exists(alt):
                    fp = alt
                else:
                    return None
            original_name = name
            username = sess.get_user(token) or "Usuario"
    except (ValueError, PermissionError):
        return None

    if not os.path.exists(fp):
        return None

    stat = os.stat(fp)

    # Para carpetas, el st_size es solo el tamaño de la entrada del directorio:
    # se recorre el contenido real (walk fresco, sin caché para no colisionar).
    if os.path.isdir(fp):
        size = 0
        for dirpath, _, filenames in os.walk(fp):
            for f in filenames:
                fpath = os.path.join(dirpath, f)
                if not os.path.islink(fpath):
                    try:
                        size += os.path.getsize(fpath)
                    except OSError:
                        pass
    else:
        size = stat.st_size

    shared_users_info = []
    if not owner_id or str(owner_id) == str(current_uid):
        direct_shares, inherited = repository.get_shares_in_path(current_uid, subpath)
        shared_list = direct_shares.get(original_name, list(inherited))
        for s in shared_list:
            uid = s['shared_with']
            uname = repository.get_username_by_id(uid)
            shared_users_info.append({'user_id': uid, 'username': uname or 'Usuario'})

    return {
        "name": original_name, "size": size, "mtime": stat.st_mtime,
        "ctime": stat.st_ctime, "is_dir": os.path.isdir(fp),
        "path": subpath, "owner": username, "owner_id": owner_id or current_uid, "shared_users": shared_users_info,
    }


def _pdf_thumbnail(target_path, size, mtime_ns):
    """Genera una miniatura PNG de la primera página de un PDF, con caché en disco.
    Renderiza SOLO la página 1 a baja resolución (96 DPI) para no cargar
    documentos pesados de golpe. Devuelve la ruta del PNG cacheado o None."""
    thumbs_dir = os.path.join(BASE_CLOUD_ROOT, '.pool', 'thumbs')
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

    add_activity(sess.get_user(token), sess.get_user_id(token), "act_abrio", name, subpath, owner_id)

    ext = os.path.splitext(name)[1].lower()
    if ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'):
        return send_file(target_path), None

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


def get_item_activity(name, subpath, owner_id, token):
    current_uid = sess.get_user_id(token)
    if owner_id and str(owner_id) != str(current_uid):
        target_root = os.path.join(BASE_CLOUD_ROOT, str(owner_id))
    else:
        target_root = get_user_root(token)
        
    if not target_root:
        return []
    subpath = subpath.strip('/')
    all_activity = _load_json(target_root, '.activity.json')
    return [act for act in all_activity if act.get('name') == name and act.get('path') == subpath]


def build_user_search_index(user_id):
    """ Escanea el disco una única vez al inicio para poblar el mapa de búsqueda O(1). """
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
    if not os.path.exists(user_root):
        return
        
    local_index = {}
    for view_name in ('', '.computers'):
        target_scan = os.path.join(user_root, view_name)
        if not os.path.exists(target_scan):
            continue
            
        for root, dirs, files in os.walk(target_scan):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            rel_dir = os.path.relpath(root, target_scan).replace('\\', '/')
            if rel_dir == '.':
                rel_dir = ''
                
            for f in files:
                if f.startswith('.'):
                    continue
                local_index.setdefault(f.lower(), []).append({"name": f, "path": rel_dir, "is_dir": False, "view": "drive" if not view_name else "computers"})
            for d in dirs:
                if d.startswith('.'):
                    continue
                local_index.setdefault(d.lower(), []).append({"name": d, "path": rel_dir, "is_dir": True, "view": "drive" if not view_name else "computers"})
                
    with index_lock:
        search_index[user_id] = local_index


def invalidate_user_index(user_id):
    """ Borra el índice en memoria para obligar a una recarga limpia en la próxima búsqueda. """
    with index_lock:
        search_index.pop(user_id, None)


def search_files(query, token):
    """ Sustituye tu os.walk pesado por una consulta analítica en memoria de O(1). """
    user_root = get_user_root(token)
    if not user_root:
        return None
    user_id = os.path.basename(user_root)
    query = query.strip().lower()
    if not query:
        return []
    with index_lock:
        if user_id not in search_index:
            threading.Thread(target=build_user_search_index, args=(user_id,)).start()
            return []
            
        user_map = search_index[user_id]

    starred_data = _load_json(user_root, '.starred.json')
    protected_data = _load_json(user_root, '.protected.json')
    current_user = sess.get_user(token)
    results = []

    with index_lock:
        for filename_lowercased, items in user_map.items():
            if query in filename_lowercased:
                for item in items:
                    view_root = get_view_root(item['view'], token)
                    fp = os.path.join(view_root, item['path'], item['name'])
                    try:
                        info = os.stat(fp)
                        results.append({
                            "name": item['name'], "path": item['path'], "is_dir": item['is_dir'],
                            "size": info.st_size if not item['is_dir'] else 0, "mtime": info.st_mtime,
                            "ext": os.path.splitext(item['name'])[1].lower(), "owner": current_user,
                            "starred": {"name": item['name'], "path": item['path']} in starred_data,
                            "protected": {"name": item['name'], "path": item['path'], "view": item['view']} in protected_data,
                            "view": item['view'],
                        })
                    except OSError:
                        pass

    results.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return results[:50]


def get_folders_tree(view, token):
    view_root = get_view_root(view, token)
    if not view_root:
        return None

    def build_tree(path, base_path, is_root=False, current_depth=0):
        if current_depth > 5:
            return None
            
        name = os.path.basename(path)
        if not is_root and name.startswith('.'):
            return None
        rel_path = os.path.relpath(path, base_path).replace('\\', '/')
        if rel_path == '.':
            rel_path = ''
        subdirs = []
        files = []
        try:
            for entry in os.scandir(path):
                if entry.name.startswith('.'):
                    continue
                if entry.is_dir() and not entry.is_symlink():
                    subtree = build_tree(entry.path, base_path, is_root=False, current_depth=current_depth + 1)
                    if subtree:
                        subdirs.append(subtree)
                elif entry.is_file() and not entry.is_symlink():
                    file_path = os.path.join(rel_path, entry.name).replace('\\', '/')
                    if file_path.startswith('/'):
                        file_path = file_path.lstrip('/')
                    try:
                        info = entry.stat()
                        size = info.st_size
                    except OSError:
                        size = 0
                    files.append({
                        "name": entry.name,
                        "path": file_path,
                        "size": size,
                        "ext": os.path.splitext(entry.name)[1].lower(),
                    })
            subdirs.sort(key=lambda x: x['name'].lower())
            files.sort(key=lambda x: x['name'].lower())
        except OSError as e:
            sys.stderr.write(f"[OPERATIONAL][WARN] No se pudo listar la rama {path}: {e}\n")
            
        return {"name": name or "Mi unidad", "path": rel_path, "subdirs": subdirs, "files": files}

    return build_tree(view_root, view_root, is_root=True)


def get_download_token(view, name, subpath, owner_id, trash_id, token):
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
        return None, "access_revoked"
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
                require_access(current_uid, owner_id, name)
                owner_root = os.path.join(BASE_CLOUD_ROOT, owner_id)
                if view == 'computers':
                    owner_root = os.path.join(owner_root, '.computers')
                target_path = safe_join(owner_root, subpath, name)
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

    def _purge_file(path):
        @after_this_request
        def remove_temporary(response):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError as e:
                sys.stderr.write(f"[OPERATIONAL][WARN] No se pudo limpiar el archivo temporal de descarga {path}: {e}\n")
            return response

    if info.get('multi'):
        temp_fd, temp_path = tempfile.mkstemp(suffix='.zip')
        os.close(temp_fd)
        _purge_file(temp_path)
        
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for item in info['items']:
                target = item['path']
                name = item['name']
                if not os.path.exists(target):
                    continue
                
                clean_arc_base = Path(name).name
                
                if item['is_dir']:
                    for root, dirs, files in os.walk(target):
                        for d in dirs:
                            full_d = os.path.join(root, d)
                            if not os.path.islink(full_d):
                                rel_path = os.path.normpath(os.path.relpath(full_d, target)).replace("..", "")
                                if not os.path.isabs(rel_path) and ".." not in rel_path:
                                    zf.write(full_d, os.path.join(clean_arc_base, rel_path))
                        for f in files:
                            full_f = os.path.join(root, f)
                            if not os.path.islink(full_f):
                                rel_path = os.path.normpath(os.path.relpath(full_f, target)).replace("..", "")
                                if not os.path.isabs(rel_path) and ".." not in rel_path:
                                    zf.write(full_f, os.path.join(clean_arc_base, rel_path))
                else:
                    if not os.path.islink(target):
                        zf.write(target, os.path.basename(clean_arc_base))
        return send_file(temp_path, as_attachment=True, download_name="Null-Void-Cloud-Files.zip"), None

    target = info['path']
    if not os.path.exists(target):
        return None, "No encontrado"

    force_dl = request.args.get('dl') == '1'
    clean_single_name = os.path.normpath(info['name']).lstrip("/").replace("..", "")

    if info.get('is_dir'):
        temp_fd, temp_path = tempfile.mkstemp(suffix='.zip')
        os.close(temp_fd)
        _purge_file(temp_path)
        
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(target):
                for d in dirs:
                    full_d = os.path.join(root, d)
                    if not os.path.islink(full_d):
                        rel_path = os.path.normpath(os.path.relpath(full_d, target)).replace("..", "")
                        if not os.path.isabs(rel_path) and ".." not in rel_path:
                            zf.write(full_d, rel_path)
                for f in files:
                    full_f = os.path.join(root, f)
                    if not os.path.islink(full_f):
                        rel_path = os.path.normpath(os.path.relpath(full_f, target)).replace("..", "")
                        if not os.path.isabs(rel_path) and ".." not in rel_path:
                            zf.write(full_f, rel_path)
        return send_file(temp_path, as_attachment=True, download_name=f"{clean_single_name}.zip"), None

    ext = os.path.splitext(clean_single_name)[1].lower()
    is_attachment = force_dl or (ext not in ('.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt'))
    return send_file(target, as_attachment=is_attachment, download_name=clean_single_name), None


def init_user_cloud(user_id):
    if not user_id:
        return
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
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
            owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, s['owner_id']))
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
        
    parts = subpath.strip('/').split('/')
    if not parts or not parts[0]:
        return None, None
        
    top_name = parts[0]
    rest_path = '/'.join(parts[1:])
    sys.stderr.write(f"[DEBUG-CLOUD] top_name={top_name}, rest_path={rest_path}\n")
    
    rows = repository.get_shared_with_me(current_uid)
    shared_item = next((s for s in rows if s['file_name'] == top_name), None)
    sys.stderr.write(f"[DEBUG-CLOUD] shared_item={shared_item}\n")
    if not shared_item:
        return None, None
        
    owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, shared_item['owner_id']))
    if shared_item['view'] == 'computers':
        owner_root = os.path.realpath(os.path.join(owner_root, '.computers'))
    sys.stderr.write(f"[DEBUG-CLOUD] owner_root={owner_root}\n")
        
    target_path = safe_join(owner_root, shared_item['file_path'], shared_item['file_name'], rest_path)
    sys.stderr.write(f"[DEBUG-CLOUD] target_path={target_path}, exists={os.path.exists(target_path)}, isdir={os.path.isdir(target_path)}\n")
    
    if not os.path.exists(target_path) or not os.path.isdir(target_path):
        return None, None
        
    starred_data = []
    base_root = get_user_root(token)
    if base_root:
        starred_data = _load_json(base_root, '.starred.json')

    files = []
    try:
        entries = os.listdir(target_path)
        sys.stderr.write(f"[DEBUG-CLOUD] entries={entries}\n")
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
    except Exception as e:
        sys.stderr.write(f"[DEBUG-CLOUD] Error listing: {e}\n")
        return None, None
        
    files.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return files, subpath

def list_shared_by_me(token):
    current_uid = sess.get_user_id(token)
    if not current_uid:
        return None
    rows = repository.get_shared_by_me(current_uid)
    files = []
    
    owner_root = os.path.realpath(os.path.join(BASE_CLOUD_ROOT, current_uid))
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
                    "owner": "Compartido con: " + s['shared_with_name'], "owner_id": current_uid,
                    "shared_with": s['shared_with'],
                    "is_dir": os.path.isdir(fp), "size": info.st_size,
                    "mtime": s['created_at'], "ext": os.path.splitext(s['file_name'])[1].lower(),
                    "view": s['view'], "is_shared": True,
                })
        except ValueError:
            continue
    return files


def zip_item(view, name, subpath, token, zip_name=None):
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

    # ── Calcular tamaño total y nº de archivos a comprimir ──
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

    # ── Crear el zip en temporal para medir su tamaño real ──
    pool_dir = os.path.join(BASE_CLOUD_ROOT, '.pool')
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
        return f"Error al comprimir: {str(e)}"
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
    RESERVED_NAMES = ('.activity.json', '.trash.json', '.starred.json', '.protected.json')

    try:
        with zipfile.ZipFile(target_path, 'r') as zf:
            dest_dir = safe_join(user_root, subpath)
            infolist = zf.infolist()

            # ── Límite de nº de elementos (Zip Bomb) ──
            if len(infolist) > MAX_ZIP_FILES:
                return f"El archivo zip contiene demasiados elementos (máximo {MAX_ZIP_FILES})."

            # ── Ratio de compresión agregado (Zip Bomb) ──
            total_uncompressed = sum(info.file_size for info in infolist)
            total_compressed = sum(info.compress_size for info in infolist)
            if total_compressed > 0 and (total_uncompressed / total_compressed) > MAX_ZIP_RATIO:
                return "El archivo zip tiene un ratio de compresión sospechoso (posible Zip Bomb)."

            # ── Límite de seguridad de tamaño descomprimido (CWE-400) ──
            if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
                return "El archivo comprimido supera la cuota o el límite de seguridad"

            # ── Comprobar cuota del usuario y disco físico con el tamaño real ──
            ok, err = _check_storage_capacity(token, total_uncompressed)
            if not ok:
                return "El archivo comprimido supera la cuota o el límite de seguridad"

            # ── Validar y filtrar todos los miembros antes de extraer ──
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

            # ── Extracción manual (sin extractall: no crea symlinks ni hardlinks) ──
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
        return f"Error al descomprimir: {str(e)}"