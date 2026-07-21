import os
import secrets
import time
from flask import request, jsonify, send_file

ACTIVE_DEVICES = {}
AGENT_TOKENS = {}


def get_server_fingerprint(username="", os_name=""):
    import hashlib
    from flask import current_app
    secret = current_app.config.get('SECRET_KEY', 'null-void-default-secret-key')
    payload = f"{secret}:{username}:{os_name}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def get_agent_token():
    token = request.headers.get('Authorization')
    if token and token.startswith('Bearer '):
        return token.split(' ')[1]
    q_token = request.args.get('token')
    if q_token:
        return q_token
    from .services import get_token as _get_flask_token
    return _get_flask_token()


def _get_user_root_by_username(username):
    from src.core.database import get_db
    from .services import BASE_CLOUD_ROOT
    from werkzeug.security import safe_join
    with get_db() as conn:
        user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (username,)).fetchone()
        if not user_row: return None
        uid = user_row['user_id']
        safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
        if not safe_uid: safe_uid = "unknown"
        return safe_join(BASE_CLOUD_ROOT, safe_uid)


def handle_ping(token, username, data):
    device = data.get('device', 'Mi Dispositivo').strip()
    os_name = data.get('os', 'Unknown')
    ip = request.remote_addr

    safe_device = "".join([c for c in device if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_device:
        safe_device = "PC"

    user_root = _get_user_root_by_username(username)
    if not user_root:
        return jsonify(error="User not found"), 404
    old_device_dir = os.path.normpath(os.path.join(user_root, '.computers', f"{safe_device} 💻"))
    device_dir = os.path.normpath(os.path.join(user_root, '.computers', safe_device))
    if os.path.exists(old_device_dir) and not os.path.exists(device_dir):
        try: os.rename(old_device_dir, device_dir)
        except Exception: pass
    os.makedirs(device_dir, exist_ok=True)

    from src.core.database import get_db
    with get_db() as conn:
        user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (username,)).fetchone()
        if user_row:
            uid = user_row['user_id']
            dev = conn.execute("SELECT id FROM cloud_devices WHERE user_id = ? AND name = ?", (uid, safe_device)).fetchone()
            if dev:
                conn.execute("UPDATE cloud_devices SET last_seen = ?, os = ?, ip_address = ? WHERE id = ?", (time.time(), os_name, ip, dev['id']))
            else:
                import uuid
                new_id = str(uuid.uuid4())
                conn.execute("INSERT INTO cloud_devices (id, user_id, name, os, last_seen, ip_address, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (new_id, uid, safe_device, os_name, time.time(), ip, '1.0.0', time.time()))
            conn.commit()

    return jsonify(status="ok", server_fingerprint=get_server_fingerprint(username, os_name))


def handle_disconnect(token, username, data):
    device = data.get('device', 'Mi Dispositivo').strip()
    safe_device = "".join([c for c in device if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_device:
        safe_device = "PC"

    from src.core.database import get_db
    with get_db() as conn:
        user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (username,)).fetchone()
        if user_row:
            uid = user_row['user_id']
            # We don't delete the device on disconnect, we just update last_seen to 0 so it shows offline
            conn.execute("UPDATE cloud_devices SET last_seen = 0 WHERE user_id = ? AND name = ?", (uid, safe_device))
            conn.commit()

    return jsonify(status="disconnected")


def handle_changes(token, username, data):
    device = data.get('device', 'Mi Dispositivo').strip()
    os_name = data.get('os', 'Unknown')
    safe_device = "".join([c for c in device if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_device:
        safe_device = "PC"

    user_root = _get_user_root_by_username(username)
    if not user_root:
        return jsonify(error="User not found"), 404
    device_dir = os.path.normpath(os.path.join(user_root, '.computers', safe_device))

    if not os.path.exists(device_dir):
        return jsonify(files={}, dirs=[])

    files = {}
    dirs = []
    for root, dirnames, filenames in os.walk(device_dir):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for d in dirnames:
            abs_d = os.path.join(root, d)
            rel_d = os.path.relpath(abs_d, device_dir).replace('\\', '/')
            dirs.append(rel_d)
        for fname in filenames:
            if fname.startswith('.'):
                continue
            abs_f = os.path.join(root, fname)
            rel_f = os.path.relpath(abs_f, device_dir).replace('\\', '/')
            try:
                files[rel_f] = os.path.getmtime(abs_f)
            except Exception:
                pass

    return jsonify(files=files, dirs=dirs, server_fingerprint=get_server_fingerprint(username, os_name))


def handle_download(token, username):
    device = request.args.get('device', '').strip()
    safe_device = "".join([c for c in device if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    rel_path = request.args.get('path', '').replace('\\', '/').lstrip('/')

    user_root = _get_user_root_by_username(username)
    if not user_root:
        return jsonify(error="User not found"), 404
    device_dir = os.path.normpath(os.path.join(user_root, '.computers', safe_device))
    target = os.path.normpath(os.path.join(device_dir, rel_path))

    if not target.startswith(device_dir):
        return jsonify(error="Acceso denegado"), 403
    if not os.path.isfile(target):
        return jsonify(error="Archivo no encontrado"), 404

    return send_file(target, as_attachment=True, download_name=os.path.basename(target))


def handle_generate_token(token, username):
    temp_token = secrets.token_hex(16)
    current_time = time.time()
    expired = [k for k, v in AGENT_TOKENS.items() if v["expires"] < current_time]
    for k in expired:
        del AGENT_TOKENS[k]

    AGENT_TOKENS[temp_token] = {"original_token": token, "expires": current_time + 300, "username": username}
    return jsonify(temp_token=temp_token)


def handle_register(data):
    temp_token = data.get("temp_token")
    if not temp_token or temp_token not in AGENT_TOKENS:
        return jsonify(error="Token temporal inválido o expirado. Vuelve a generar el comando desde la interfaz."), 401

    token_data = AGENT_TOKENS.pop(temp_token)
    if token_data["expires"] < time.time():
        return jsonify(error="Token temporal expirado."), 401

    original_token = token_data["original_token"]
    user_name = token_data["username"]

    device = data.get('device', 'Mi Dispositivo').strip()
    os_name = data.get('os', 'Unknown')
    ip = request.remote_addr

    safe_device = "".join([c for c in device if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_device:
        safe_device = "PC"

    # Generate permanent device token
    device_token = secrets.token_urlsafe(32)
    
    from src.core.database import get_db
    with get_db() as conn:
        user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (user_name,)).fetchone()
        if user_row:
            uid = user_row['user_id']
            
            # Auto-asignar nombre (Usuario-PCX)
            count_row = conn.execute("SELECT COUNT(*) as c FROM cloud_devices WHERE user_id = ?", (uid,)).fetchone()
            pc_count = count_row['c'] if count_row else 0
            safe_device = f"{user_name}-PC{pc_count + 1}"
            
            # Verificar si existe (por si acaso hay solapamiento)
            dev = conn.execute("SELECT id FROM cloud_devices WHERE user_id = ? AND name = ?", (uid, safe_device)).fetchone()
            if dev:
                device_id = dev['id']
                conn.execute("UPDATE cloud_devices SET os = ?, ip_address = ?, last_seen = ? WHERE id = ?", (os_name, ip, time.time(), device_id))
            else:
                import uuid
                device_id = str(uuid.uuid4())
                conn.execute("INSERT INTO cloud_devices (id, user_id, name, os, ip_address, last_seen, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (device_id, uid, safe_device, os_name, ip, time.time(), '1.0.0', time.time()))
            
            # Store new token
            conn.execute("INSERT INTO cloud_device_tokens (token, device_id, created_at) VALUES (?, ?, ?)",
                (device_token, device_id, time.time()))
            conn.commit()

    return jsonify(device_token=device_token, device_name=safe_device, server_fingerprint=get_server_fingerprint(user_name, os_name))


def _build_agent_script(server_url, token, device_name):
    return f'''# -*- coding: utf-8 -*-
import os, sys, time, platform, urllib3, subprocess, threading

print("\\n[Null-Void Sync] Preparando entorno y verificando dependencias...")
try:
    import requests
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    print("[Null-Void Sync] Instalando librerías requeridas (requests, watchdog)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "watchdog", "urllib3"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import requests
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

from queue import Queue

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SERVER_URL = "{server_url}"
TOKEN = "{token}"
DEVICE_NAME = "{device_name}"
_desktop = os.path.expanduser("~/Desktop")
if not os.path.exists(_desktop): _desktop = os.path.expanduser("~/Escritorio")
if not os.path.exists(_desktop): _desktop = os.path.expanduser("~")
LOCAL_DIR = os.path.join(_desktop, "Null-Void-Sync")
SCRIPT_PATH = os.path.abspath(__file__)

print("[Null-Void Sync] Iniciando agente para: " + DEVICE_NAME)
os.makedirs(LOCAL_DIR, exist_ok=True)

try:
    if platform.system() == "Windows": os.startfile(LOCAL_DIR)
    elif platform.system() == "Darwin": subprocess.Popen(["open", LOCAL_DIR])
    else: subprocess.Popen(["xdg-open", LOCAL_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except Exception: pass

def self_destruct():
    try: os.remove(SCRIPT_PATH)
    except Exception: pass

def send_ping():
    try:
        res = requests.post(SERVER_URL + "/api/cloud/sync-agent/ping",
            headers={{"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}},
            json={{"device": DEVICE_NAME, "os": platform.system()}}, timeout=5, verify=False)
        if res.status_code == 401:
            self_destruct(); sys.exit(1)
        return res.status_code == 200
    except: return False

def upload_file(local_path):
    try:
        rel_path = os.path.relpath(local_path, LOCAL_DIR).replace("\\\\", "/")
        server_subpath = DEVICE_NAME + " \\U0001f4bb"
        sub_dir = os.path.dirname(rel_path)
        if sub_dir: server_subpath += "/" + sub_dir
        filename = os.path.basename(rel_path)
        url = SERVER_URL + "/api/cloud/upload?path=" + requests.utils.quote(server_subpath) + "&view=computers"
        with open(local_path, "rb") as f:
            res = requests.post(url, headers={{"Authorization": "Bearer " + TOKEN}},
                files={{"file": (filename, f)}}, verify=False)
        return res.status_code in (200, 201)
    except: return False

def delete_file(rel_path):
    server_subpath = DEVICE_NAME + " \\U0001f4bb"
    sub_dir = os.path.dirname(rel_path)
    if sub_dir: server_subpath += "/" + sub_dir
    filename = os.path.basename(rel_path)
    try:
        res = requests.post(SERVER_URL + "/api/cloud/delete",
            headers={{"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}},
            json={{"path": server_subpath, "name": filename, "view": "computers"}}, verify=False)
        return res.status_code in (200, 204)
    except: return False

def create_dir(rel_path):
    server_subpath = DEVICE_NAME + " \\U0001f4bb"
    sub_dir = os.path.dirname(rel_path)
    if sub_dir: server_subpath += "/" + sub_dir
    name = os.path.basename(rel_path)
    try:
        res = requests.post(SERVER_URL + "/api/cloud/mkdir",
            headers={{"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}},
            json={{"path": server_subpath, "name": name, "view": "computers"}}, verify=False)
        return res.status_code in (200, 201)
    except: return False

def get_server_state():
    try:
        res = requests.post(SERVER_URL + "/api/cloud/sync-agent/changes",
            headers={{"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}},
            json={{"device": DEVICE_NAME}}, timeout=10, verify=False)
        if res.status_code == 200:
            data = res.json()
            return data.get("files", {{}}), set(data.get("dirs", []))
        return None, None
    except: return None, None

ignore_paths = set()

def download_file_from_server(rel_path):
    try:
        url = SERVER_URL + "/api/cloud/sync-agent/download"
        params = {{"device": DEVICE_NAME, "path": rel_path, "token": TOKEN}}
        res = requests.get(url, headers={{"Authorization": "Bearer " + TOKEN}}, params=params, timeout=30, verify=False)
        if res.status_code == 200:
            local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            ignore_paths.add(rel_path)
            with open(local_path, "wb") as f:
                f.write(res.content)
            threading.Timer(2.0, lambda r=rel_path: ignore_paths.discard(r)).start()
            return True
        return False
    except: return False

if not send_ping():
    print("[Null-Void Sync] No se pudo conectar al servidor.")
    self_destruct(); sys.exit(1)

upload_queue = Queue()
delete_queue = Queue()
mkdir_queue = Queue()

class SyncHandler(FileSystemEventHandler):
    def _get_rel(self, path):
        try: return os.path.relpath(path, LOCAL_DIR).replace("\\\\", "/")
        except: return None

    def on_created(self, event):
        rel = self._get_rel(event.src_path)
        if not rel or rel.startswith('.') or rel in ignore_paths: return
        if event.is_directory: mkdir_queue.put(rel)
        else: upload_queue.put(rel)

    def on_modified(self, event):
        rel = self._get_rel(event.src_path)
        if not rel or rel.startswith('.') or event.is_directory or rel in ignore_paths: return
        upload_queue.put(rel)

    def on_deleted(self, event):
        rel = self._get_rel(event.src_path)
        if not rel or rel.startswith('.') or rel in ignore_paths: return
        delete_queue.put(rel)

    def on_moved(self, event):
        old_rel = self._get_rel(event.src_path)
        new_rel = self._get_rel(event.dest_path)
        if old_rel and not old_rel.startswith('.') and old_rel not in ignore_paths:
            delete_queue.put(old_rel)
        if new_rel and not new_rel.startswith('.') and new_rel not in ignore_paths:
            if event.is_directory: mkdir_queue.put(new_rel)
            else: upload_queue.put(new_rel)

def local_worker():
    while True:
        while not delete_queue.empty():
            rel = delete_queue.get(); delete_file(rel); delete_queue.task_done()
        while not mkdir_queue.empty():
            rel = mkdir_queue.get(); create_dir(rel); mkdir_queue.task_done()
        while not upload_queue.empty():
            rel = upload_queue.get()
            abs_path = os.path.join(LOCAL_DIR, rel.replace("/", os.sep))
            if os.path.exists(abs_path) and not os.path.isdir(abs_path):
                time.sleep(0.5) # Wait for file write locks
                upload_file(abs_path)
            upload_queue.task_done()
        time.sleep(0.5)

threading.Thread(target=local_worker, daemon=True).start()

# Sync initial state (upload existing non-synced files on startup)
def initial_sync():
    srv_files, srv_dirs = get_server_state()
    if srv_files is None: return
    for root, dirs, files in os.walk(LOCAL_DIR):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for d in dirs:
            rel = os.path.relpath(os.path.join(root, d), LOCAL_DIR).replace("\\\\", "/")
            if rel not in srv_dirs: mkdir_queue.put(rel)
        for file in files:
            if file.startswith("."): continue
            fp = os.path.join(root, file)
            rel = os.path.relpath(fp, LOCAL_DIR).replace("\\\\", "/")
            local_mtime = os.path.getmtime(fp)
            if rel not in srv_files or local_mtime > srv_files[rel] + 2:
                upload_queue.put(rel)
initial_sync()

observer = Observer()
observer.schedule(SyncHandler(), LOCAL_DIR, recursive=True)
observer.start()

server_known_files = {{}}; server_known_dirs = set()
try:
    print("[Null-Void Sync] Escuchando cambios en tiempo real...")
    while True:
        if not send_ping(): time.sleep(5); continue
            
        srv_files, srv_dirs = get_server_state()
        if srv_files is not None:
            import shutil as _shutil
            for d in sorted(srv_dirs):
                local_d = os.path.join(LOCAL_DIR, d.replace("/", os.sep))
                if not os.path.exists(local_d):
                    ignore_paths.add(d); os.makedirs(local_d, exist_ok=True)
                    threading.Timer(2.0, lambda r=d: ignore_paths.discard(r)).start()
            
            for rel_path, srv_mtime in srv_files.items():
                local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
                local_mtime = os.path.getmtime(local_path) if os.path.exists(local_path) else None
                if local_mtime is None or srv_mtime > local_mtime + 2:
                    download_file_from_server(rel_path)

            for rel_path in list(server_known_files.keys()):
                if rel_path not in srv_files:
                    local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
                    if os.path.exists(local_path):
                        ignore_paths.add(rel_path); try: os.remove(local_path); except: pass
                        threading.Timer(2.0, lambda r=rel_path: ignore_paths.discard(r)).start()
            
            for d in list(server_known_dirs):
                if d not in srv_dirs:
                    local_d = os.path.join(LOCAL_DIR, d.replace("/", os.sep))
                    if os.path.isdir(local_d):
                        ignore_paths.add(d); try: _shutil.rmtree(local_d); except: pass
                        threading.Timer(2.0, lambda r=d: ignore_paths.discard(r)).start()
            
            server_known_dirs = srv_dirs; server_known_files = srv_files
            
        time.sleep(3)
except KeyboardInterrupt:
    try: requests.post(SERVER_URL + "/api/cloud/sync-agent/disconnect", headers={{"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}}, json={{"device": DEVICE_NAME}}, timeout=5, verify=False)
    except: pass
    observer.stop()
    self_destruct()
observer.join()
'''
