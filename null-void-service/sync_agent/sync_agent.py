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
    from src.modules.api.cloud.services import get_token as _get_flask_token
    return _get_flask_token()


def _get_user_root_by_username(username):
    from src.core.database import get_db
    from src.modules.api.cloud.services import BASE_CLOUD_ROOT
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

    client_ver = data.get('version', '1.0.0')
    latest_ver = "1.0.0"

    from src.core.database import get_db
    with get_db() as conn:
        user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (username,)).fetchone()
        if user_row:
            uid = user_row['user_id']
            dev = conn.execute("SELECT id FROM cloud_devices WHERE user_id = ? AND name = ?", (uid, safe_device)).fetchone()
            if dev:
                conn.execute("UPDATE cloud_devices SET last_seen = ?, os = ?, ip_address = ?, version = ? WHERE id = ?", (time.time(), os_name, ip, client_ver, dev['id']))
            else:
                import uuid
                new_id = str(uuid.uuid4())
                conn.execute("INSERT INTO cloud_devices (id, user_id, name, os, last_seen, ip_address, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (new_id, uid, safe_device, os_name, time.time(), ip, client_ver, time.time()))
            conn.commit()

    return jsonify(
        status="ok",
        server_fingerprint=get_server_fingerprint(username, os_name),
        latest_version=latest_ver,
        has_update=(client_ver != latest_ver)
    )


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

    device_token = secrets.token_urlsafe(32)
    
    from src.core.database import get_db
    with get_db() as conn:
        user_row = conn.execute("SELECT user_id FROM users WHERE username = ?", (user_name,)).fetchone()
        if user_row:
            uid = user_row['user_id']
            
            count_row = conn.execute("SELECT COUNT(*) as c FROM cloud_devices WHERE user_id = ?", (uid,)).fetchone()
            pc_count = count_row['c'] if count_row else 0
            safe_device = f"{user_name}-PC{pc_count + 1}"
            
            dev = conn.execute("SELECT id FROM cloud_devices WHERE user_id = ? AND name = ?", (uid, safe_device)).fetchone()
            if dev:
                device_id = dev['id']
                conn.execute("UPDATE cloud_devices SET os = ?, ip_address = ?, last_seen = ? WHERE id = ?", (os_name, ip, time.time(), device_id))
            else:
                import uuid
                device_id = str(uuid.uuid4())
                conn.execute("INSERT INTO cloud_devices (id, user_id, name, os, ip_address, last_seen, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (device_id, uid, safe_device, os_name, ip, time.time(), '1.0.0', time.time()))
            
            conn.execute("INSERT INTO cloud_device_tokens (token, device_id, created_at) VALUES (?, ?, ?)",
                (device_token, device_id, time.time()))
            conn.commit()

    return jsonify(device_token=device_token, device_name=safe_device, server_fingerprint=get_server_fingerprint(user_name, os_name))


def _build_agent_script(server_url, token, device_name):
    script_template = """# -*- coding: utf-8 -*-
import os, sys, time, platform, urllib3, subprocess, threading
from queue import Queue

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

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SERVER_URL = "__SERVER_URL__"
TOKEN = "__TOKEN__"
DEVICE_NAME = "__DEVICE_NAME__"
_desktop = os.path.expanduser("~/Desktop")
if not os.path.exists(_desktop): _desktop = os.path.expanduser("~/Escritorio")
if not os.path.exists(_desktop): _desktop = os.path.expanduser("~")
LOCAL_DIR = os.path.join(_desktop, "Null-Void-Sync")
SCRIPT_PATH = os.path.abspath(__file__)

ui_log_queue = Queue()

def log(msg):
    t_str = time.strftime("%H:%M:%S")
    full = f"[{t_str}] {msg}"
    print(f"[Null-Void Sync] {full}")
    try: ui_log_queue.put(full)
    except Exception: pass

log(f"Iniciando Agente de Sincronización para: {DEVICE_NAME}")
os.makedirs(LOCAL_DIR, exist_ok=True)

def open_local_folder():
    try:
        if platform.system() == "Windows": os.startfile(LOCAL_DIR)
        elif platform.system() == "Darwin": subprocess.Popen(["open", LOCAL_DIR])
        else: subprocess.Popen(["xdg-open", LOCAL_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception: pass

open_local_folder()

def self_destruct():
    try: os.remove(SCRIPT_PATH)
    except Exception: pass

def send_ping():
    try:
        res = requests.post(SERVER_URL + "/api/cloud/sync-agent/ping",
            headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
            json={"device": DEVICE_NAME, "os": platform.system()}, timeout=5, verify=False)
        if res.status_code == 401:
            log("Error 401: Dispositivo o token desvinculado. Autodestruyendo agente...")
            self_destruct(); sys.exit(1)
        return res.status_code == 200
    except: return False

def upload_file(local_path):
    try:
        rel_path = os.path.relpath(local_path, LOCAL_DIR).replace("\\\\", "/")
        server_subpath = DEVICE_NAME
        sub_dir = os.path.dirname(rel_path)
        if sub_dir: server_subpath += "/" + sub_dir
        filename = os.path.basename(rel_path)
        log(f"[SUBIENDO] {rel_path}")
        url = SERVER_URL + "/api/cloud/upload?path=" + requests.utils.quote(server_subpath) + "&view=computers"
        with open(local_path, "rb") as f:
            res = requests.post(url, headers={"Authorization": "Bearer " + TOKEN},
                files={"file": (filename, f)}, verify=False)
        if res.status_code in (200, 201):
            log(f"[OK] Subido: {rel_path}")
            return True
        return False
    except Exception as e:
        log(f"[ERROR] Subir {rel_path}: {e}")
        return False

def delete_file(rel_path):
    server_subpath = DEVICE_NAME
    sub_dir = os.path.dirname(rel_path)
    if sub_dir: server_subpath += "/" + sub_dir
    filename = os.path.basename(rel_path)
    try:
        log(f"[ELIMINANDO] {rel_path}")
        res = requests.post(SERVER_URL + "/api/cloud/delete",
            headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
            json={"path": server_subpath, "name": filename, "view": "computers"}, verify=False)
        return res.status_code in (200, 204)
    except Exception as e:
        log(f"[ERROR] Eliminar {rel_path}: {e}")
        return False

def create_dir(rel_path):
    server_subpath = DEVICE_NAME
    sub_dir = os.path.dirname(rel_path)
    if sub_dir: server_subpath += "/" + sub_dir
    name = os.path.basename(rel_path)
    try:
        log(f"[CREAR DIR] {rel_path}")
        res = requests.post(SERVER_URL + "/api/cloud/mkdir",
            headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
            json={"path": server_subpath, "name": name, "view": "computers"}, verify=False)
        return res.status_code in (200, 201)
    except Exception as e:
        return False

def get_server_state():
    try:
        res = requests.post(SERVER_URL + "/api/cloud/sync-agent/changes",
            headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
            json={"device": DEVICE_NAME}, timeout=10, verify=False)
        if res.status_code == 200:
            data = res.json()
            return data.get("files", {}), set(data.get("dirs", []))
        return None, None
    except: return None, None

ignore_paths = set()

def download_file_from_server(rel_path):
    try:
        log(f"[DESCARGANDO] {rel_path}")
        url = SERVER_URL + "/api/cloud/sync-agent/download"
        params = {"device": DEVICE_NAME, "path": rel_path, "token": TOKEN}
        res = requests.get(url, headers={"Authorization": "Bearer " + TOKEN}, params=params, timeout=30, verify=False)
        if res.status_code == 200:
            local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            ignore_paths.add(rel_path)
            with open(local_path, "wb") as f:
                f.write(res.content)
            log(f"[OK] Descargado: {rel_path}")
            threading.Timer(2.0, lambda r=rel_path: ignore_paths.discard(r)).start()
            return True
        return False
    except Exception as e:
        log(f"[ERROR] Descargar {rel_path}: {e}")
        return False

if not send_ping():
    log("No se pudo conectar al servidor de Null-Void.")
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
                time.sleep(0.5)
                upload_file(abs_path)
            upload_queue.task_done()
        time.sleep(0.5)

threading.Thread(target=local_worker, daemon=True).start()

def initial_sync():
    log("Iniciando sincronización de estado...")
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
    log("Sincronización inicial completada.")

threading.Thread(target=initial_sync, daemon=True).start()

observer = Observer()
observer.schedule(SyncHandler(), LOCAL_DIR, recursive=True)
observer.start()

def sync_loop():
    server_known_files = {}; server_known_dirs = set()
    log("Escuchando cambios en segundo plano...")
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

threading.Thread(target=sync_loop, daemon=True).start()

# GUI Desktop Application (HTML5/CSS3 Webview App)
def launch_gui():
    import socket
    from http.server import HTTPServer, BaseHTTPRequestHandler
    
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('127.0.0.1', 0))
        local_port = s.getsockname()[1]
        s.close()
    except Exception:
        local_port = 25433

    html_template = '''<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Null-Void Cloud Sync - {DEVICE_NAME}</title>
  <style>
    :root {
      --bg: #0b0f19; --surface: #111827; --surface-2: #1e293b; --border: #1f2937;
      --text: #f8fafc; --text-dim: #94a3b8; --text-faint: #64748b;
      --indigo: #6366f1; --indigo-hover: #4f46e5; --violet: #818cf8;
      --emerald: #10b981; --amber: #f59e0b; --console-bg: #030712; --console-fg: #34d399;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; user-select: none; }
    .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-svg { width: 26px; height: 26px; stroke: var(--violet); fill: none; stroke-width: 2; }
    .brand-title { font-weight: 700; font-size: 14px; }
    .brand-sub { font-size: 11px; color: var(--text-dim); }
    .status-pill { display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); font-size: 12px; font-weight: 600; color: var(--emerald); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--emerald); box-shadow: 0 0 8px var(--emerald); }
    .tab-bar { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 14px; gap: 4px; }
    .tab-btn { background: transparent; border: none; color: var(--text-dim); padding: 10px 14px; font-size: 12px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 6px; }
    .tab-btn.active { color: var(--violet); border-bottom-color: var(--indigo); }
    .view { flex: 1; display: none; flex-direction: column; padding: 16px; gap: 14px; overflow-y: auto; }
    .view.active { display: flex; }
    .view-iframe { padding: 0; overflow: hidden; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .card-label { font-size: 10px; font-weight: 700; color: var(--text-faint); text-transform: uppercase; margin-bottom: 8px; }
    .info-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
    .info-lbl { color: var(--text-dim); }
    .info-val { font-weight: 600; }
    .btn-row { display: flex; gap: 8px; }
    .btn { flex: 1; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-weight: 600; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-primary { background: var(--indigo); border-color: var(--indigo); color: #fff; }
    .console-wrap { flex: 1; display: flex; flex-direction: column; background: var(--console-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .console-toolbar { background: var(--surface); padding: 6px 12px; display: flex; justify-content: space-between; font-size: 11px; color: var(--text-dim); border-bottom: 1px solid var(--border); }
    .console-log { flex: 1; padding: 12px; font-family: monospace; font-size: 11px; color: var(--console-fg); overflow-y: auto; white-space: pre-wrap; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <header class="header">
    <div class="brand">
      <svg class="brand-svg" viewBox="0 0 24 24"><path d="M17.5 19C19.9853 19 22 16.9853 22 14.5C22 12.1564 20.2064 10.2314 17.9004 10.0242C17.4339 6.57723 14.4756 4 10.9 4C7.03401 4 3.9 7.13401 3.9 11C3.9 11.2372 3.91176 11.4716 3.93467 11.7027C2.2618 12.3059 1 13.9048 1 15.8C1 18.1196 2.88041 20 5.2 20H17.5Z"/></svg>
      <div><div class="brand-title">Null-Void Cloud</div><div class="brand-sub">Agente de Escritorio - {DEVICE_NAME}</div></div>
    </div>
    <div class="status-pill"><span class="status-dot"></span><span>Conectado</span></div>
  </header>

  <nav class="tab-bar">
    <button class="tab-btn active" onclick="switchTab('tab-dash', this)">Estado y Control</button>
    <button class="tab-btn" onclick="switchTab('tab-cloud', this)">Nube Integrada</button>
    <button class="tab-btn" onclick="switchTab('tab-logs', this)">Consola de Actividad</button>
  </nav>

  <main id="tab-dash" class="view active">
    <div class="card">
      <div class="card-label">Información de Conexión</div>
      <div class="info-row"><span class="info-lbl">Dispositivo</span><span class="info-val">{DEVICE_NAME}</span></div>
      <div class="info-row"><span class="info-lbl">Carpeta Local</span><span class="info-val">{LOCAL_DIR}</span></div>
      <div class="info-row"><span class="info-lbl">Servidor</span><span class="info-val">{SERVER_URL}</span></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="fetch('/api/open-folder', {method:'POST'})">Abrir Carpeta Local</button>
      <button class="btn" onclick="switchTab('tab-cloud', document.querySelectorAll('.tab-btn')[1])">Nube Web Integrada</button>
    </div>
    <div class="console-wrap" style="height:200px;">
      <div class="console-toolbar"><span>ACTIVIDAD EN TIEMPO REAL</span></div>
      <div id="miniLog" class="console-log"></div>
    </div>
  </main>

  <main id="tab-cloud" class="view view-iframe">
    <iframe src="{SERVER_URL}/cloud?view=computers"></iframe>
  </main>

  <main id="tab-logs" class="view">
    <div class="console-wrap">
      <div class="console-toolbar"><span>REGISTRO DE SINCRONIZACIÓN</span></div>
      <div id="fullLog" class="console-log"></div>
    </div>
  </main>

  <script>
    function switchTab(id, btn) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      btn.classList.add('active');
    }
    function pollLogs() {
      fetch('/api/logs').then(r => r.json()).then(d => {
        if(d.logs) {
          d.logs.forEach(m => {
            document.getElementById('miniLog').innerText += m + '\\n';
            document.getElementById('fullLog').innerText += m + '\\n';
          });
        }
      }).catch(() => {});
    }
    setInterval(pollLogs, 300);
  </script>
</body>
</html>'''

    class AgentUIHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args): pass
        def do_GET(self):
            if self.path == "/" or self.path.startswith("/?"):
                self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
                rendered = html_template.replace('{DEVICE_NAME}', DEVICE_NAME).replace('{LOCAL_DIR}', LOCAL_DIR).replace('{SERVER_URL}', SERVER_URL)
                self.wfile.write(rendered.encode('utf-8'))
            elif self.path == "/api/logs":
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
                logs = []
                while not ui_log_queue.empty():
                    try: logs.append(ui_log_queue.get_nowait())
                    except: break
                self.wfile.write(json.dumps({"logs": logs}).encode('utf-8'))
            else: self.send_response(404); self.end_headers()
        def do_POST(self):
            if self.path == "/api/open-folder":
                open_local_folder(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b'{"ok":true}')
            else: self.send_response(404); self.end_headers()

    server = HTTPServer(('127.0.0.1', local_port), AgentUIHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    local_app_url = f"http://127.0.0.1:{local_port}"

    try:
        import webview
        webview.create_window(f"Null-Void Cloud Sync — {DEVICE_NAME}", local_app_url, width=880, height=700, background_color="#0b0f19")
        webview.start()
    except Exception:
        opened = False
        import subprocess
        for browser in ['google-chrome', 'chrome', 'msedge', 'chromium', 'brave']:
            try:
                subprocess.Popen([browser, f"--app={local_app_url}"])
                opened = True
                break
            except Exception: continue
        if not opened:
            import webbrowser
            webbrowser.open(local_app_url)
        while True: time.sleep(1)
        root.mainloop()
    except Exception as e:
        log(f"Error en GUI: {e}. Modo consola activo.")
        while True: time.sleep(1)

launch_gui()
"""
    return script_template.replace("__SERVER_URL__", server_url).replace("__TOKEN__", token).replace("__DEVICE_NAME__", device_name)
