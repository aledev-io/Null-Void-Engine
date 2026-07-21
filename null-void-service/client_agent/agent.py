# -*- coding: utf-8 -*-
import os
import sys
import time
import platform
import subprocess
import threading
import json
import signal
from queue import Queue

try:
    import requests
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    import urllib3
except ImportError:
    print("[Null-Void Sync] Faltan librerías. Por favor instala: requests, watchdog, urllib3")
    sys.exit(1)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def load_bootstrap_servers():
    servers = []
    env_paths = [
        '.env', 
        '../.env', 
        '../../.env',
        os.path.join(os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else __file__), '.env')
    ]
    for env_path in env_paths:
        if os.path.exists(env_path):
            try:
                with open(env_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('AGENT_BOOTSTRAP_SERVERS='):
                            val = line.split('=', 1)[1].strip().strip('"').strip("'")
                            servers = [s.strip() for s in val.split(',') if s.strip()]
                            return servers
            except Exception:
                pass
    return servers

BOOTSTRAP_SERVERS = load_bootstrap_servers()

CONFIG_DIR = os.path.expanduser("~/.nullvoid")
CONFIG_FILE = os.path.join(CONFIG_DIR, "sync_config.json")

_desktop = os.path.expanduser("~/Desktop")
if not os.path.exists(_desktop): _desktop = os.path.expanduser("~/Escritorio")
if not os.path.exists(_desktop): _desktop = os.path.expanduser("~")
LOCAL_DIR = os.path.join(_desktop, "Null-Void-Sync")


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def save_config(config):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f)


def get_device_name():
    return platform.node()


def register_agent():
    print("=" * 50)
    print("      Null-Void Engine - Sincronización")
    print("=" * 50)
    print("Entornos de conexión encontrados en la configuración:\n")
    
    test_urls = []
    
    if BOOTSTRAP_SERVERS:
        for i, url in enumerate(BOOTSTRAP_SERVERS):
            print(f"{i+1}. Conectar a {url}")
        manual_opt = len(BOOTSTRAP_SERVERS) + 1
        print(f"{manual_opt}. Introducir una URL manualmente")
        
        try:
            opcion = int(input(f"\nElige una opción (1-{manual_opt}): ").strip())
            if 1 <= opcion <= len(BOOTSTRAP_SERVERS):
                test_urls.append(BOOTSTRAP_SERVERS[opcion - 1])
            elif opcion == manual_opt:
                custom_url = input("Introduce la URL completa de tu servidor (ej. https://192.168.1.50:5000): ").strip().rstrip("/")
                if not custom_url.startswith("http://") and not custom_url.startswith("https://"):
                    print("ERROR: La URL debe empezar por http:// o https://")
                    sys.exit(1)
                elif custom_url.startswith("http://") and "127.0.0.1" not in custom_url and "localhost" not in custom_url:
                    print("ADVERTENCIA: Usar http:// fuera de localhost es inseguro, pero se permite para desarrollo.")
                test_urls.append(custom_url)
            else:
                print("Opción inválida.")
                sys.exit(1)
        except ValueError:
            print("Opción inválida.")
            sys.exit(1)
    else:
        print("No se encontraron servidores de respaldo en el archivo .env.")
        custom_url = input("Introduce la URL completa de tu servidor (ej. https://192.168.1.50:5000): ").strip().rstrip("/")
        if not custom_url.startswith("http://") and not custom_url.startswith("https://"):
            print("ERROR: La URL debe empezar por http:// o https://")
            sys.exit(1)
        elif custom_url.startswith("http://") and "127.0.0.1" not in custom_url and "localhost" not in custom_url:
            print("ADVERTENCIA: Usar http:// fuera de localhost es inseguro, pero se permite para desarrollo.")
        test_urls.append(custom_url)
    
    test_urls.extend([u for u in BOOTSTRAP_SERVERS if u not in test_urls])
    
    if not test_urls:
        print("URL inválida.")
        sys.exit(1)
        
    token = input("\nToken de enlace (generado en la web): ").strip()
    if not token:
        print("Token inválido.")
        sys.exit(1)

    print("\nBuscando servidor y registrando dispositivo...")
    for url in test_urls:
        print(f"Probando conexión con: {url}...")
        try:
            reg_url = f"{url}/api/cloud/sync-agent/register"
            data = {
                "temp_token": token,
                "device": platform.node(),  # El servidor lo ignorará y asignará Usuario-PCX
                "os": platform.system()
            }
            res = requests.post(reg_url, json=data, verify=True, timeout=5)
            if res.status_code == 200:
                res_data = res.json()
                fingerprint = res_data.get("server_fingerprint")
                assigned_device_name = res_data.get("device_name", platform.node())
                
                # We save all tried urls starting with the successful one
                saved_urls = [url] + [u for u in test_urls if u != url]
                
                config = {
                    "server_urls": saved_urls,
                    "device_token": res_data.get("device_token"),
                    "device_name": assigned_device_name,
                    "server_fingerprint": fingerprint,
                    "verify_ssl": True
                }
                save_config(config)
                print(f"¡Dispositivo vinculado con éxito a {url} como '{assigned_device_name}'!")
                return config
            else:
                print(f"Error devuelto por {url}: {res.text}")
        except requests.exceptions.SSLError:
            print(f"Advertencia: Certificado SSL no válido en {url}. Reintentando sin verificación estricta de seguridad...")
            try:
                res = requests.post(reg_url, json=data, verify=False, timeout=5)
                if res.status_code == 200:
                    res_data = res.json()
                    fingerprint = res_data.get("server_fingerprint")
                    assigned_device_name = res_data.get("device_name", platform.node())
                    saved_urls = [url] + [u for u in test_urls if u != url]
                    config = {
                        "server_urls": saved_urls,
                        "device_token": res_data.get("device_token"),
                        "device_name": assigned_device_name,
                        "server_fingerprint": fingerprint,
                        "verify_ssl": False
                    }
                    save_config(config)
                    print(f"¡Dispositivo vinculado con éxito a {url} (sin verificación SSL) como '{assigned_device_name}'!")
                    return config
                else:
                    print(f"Error devuelto por {url}: {res.text}")
            except Exception as e:
                print(f"No se pudo conectar a {url} en el reintento sin SSL.")
        except Exception as e:
            print(f"No se pudo conectar a {url}.")
            
    print("\nNinguno de los servidores proporcionó un registro exitoso.")
    sys.exit(1)


def wait_for_file_stability(abs_path, wait_time=0.5, retries=10):
    for _ in range(retries):
        try:
            size1 = os.path.getsize(abs_path)
            time.sleep(wait_time)
            size2 = os.path.getsize(abs_path)
            if size1 == size2:
                with open(abs_path, 'rb'): pass
                return True
        except Exception as e:
            print(f"[Null-Void Sync Debug] Error comprobando estabilidad de {abs_path}: {e}")
            pass
    print(f"[Null-Void Sync Debug] Archivo {abs_path} no alcanzó estabilidad.")
    return False


# --- Lógica de Sincronización ---
class SyncClient:
    def __init__(self, config):
        # Maneja tanto la versión vieja del config (server_url) como la nueva (server_urls)
        self.server_urls = config.get("server_urls", [config.get("server_url")])
        self.server_urls = [u for u in self.server_urls if u] + BOOTSTRAP_SERVERS
        # Filtramos duplicados manteniendo el orden
        self.server_urls = list(dict.fromkeys(self.server_urls))
        self.active_url = self.server_urls[0] if self.server_urls else None
        
        self.token = config["device_token"]
        self.device_name = config["device_name"]
        self.server_fingerprint = config.get("server_fingerprint")
        self.verify_ssl = config.get("verify_ssl", False)
        
        if not self.server_fingerprint:
            print("[Null-Void Sync] Error Crítico: No hay huella criptográfica del servidor en la configuración.")
            sys.exit(1)
        
        self.event_queue = Queue()
        
        self.ignored_events = {}
        self.ignore_lock = threading.Lock()
        
        self.server_known_files = {}
        self.server_known_dirs = set()
        self.observer = None
        self.stop_event = threading.Event()

    def ignore_path(self, rel_path, duration=3.0):
        with self.ignore_lock:
            self.ignored_events[rel_path] = time.time() + duration

    def is_ignored(self, rel_path):
        with self.ignore_lock:
            if rel_path in self.ignored_events:
                if time.time() < self.ignored_events[rel_path]:
                    return True
                else:
                    del self.ignored_events[rel_path]
            return False

    def start(self):
        print(f"\n[Null-Void Sync] Iniciando agente para: {self.device_name}")
        os.makedirs(LOCAL_DIR, exist_ok=True)
        
        try:
            if platform.system() == "Windows": os.startfile(LOCAL_DIR)
            elif platform.system() == "Darwin": subprocess.Popen(["open", LOCAL_DIR])
            else: subprocess.Popen(["xdg-open", LOCAL_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception: pass

        if not self.send_ping():
            print("[Null-Void Sync] No se pudo conectar al servidor. Verifica la conexión.")
            sys.exit(1)

        self.initial_sync()

        self.worker_thread = threading.Thread(target=self.local_worker)
        self.worker_thread.start()

        self.observer = Observer()
        self.observer.schedule(SyncHandler(self), LOCAL_DIR, recursive=True)
        self.observer.start()
        
        self.server_loop()

    def verify_server_identity(self, res_data):
        if not isinstance(res_data, dict): return True
        received_fingerprint = res_data.get("server_fingerprint")
        if received_fingerprint and received_fingerprint != self.server_fingerprint:
            print("\n" + "!" * 50)
            print("!!! ALERTA CRÍTICA DE SEGURIDAD (POSIBLE MITM) !!!")
            print("La huella criptográfica del servidor NO coincide.")
            print("Alguien está interceptando tu conexión o el servidor ha sido modificado.")
            print("Deteniendo la sincronización de inmediato para proteger tus archivos.")
            print("!" * 50 + "\n")
            self.stop_event.set()
            sys.exit(1)
        return True

    def send_ping(self):
        for url in self.server_urls:
            try:
                res = requests.post(f"{url}/api/cloud/sync-agent/ping",
                    headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                    json={"device": self.device_name, "os": platform.system()}, timeout=5, verify=self.verify_ssl)
                if res.status_code == 401:
                    print(f"[Null-Void Sync] Token revocado en {url}. Por favor, vuelve a vincular el dispositivo.")
                    if os.path.exists(CONFIG_FILE): os.remove(CONFIG_FILE)
                    self.stop_event.set()
                    return False
                if res.status_code == 200:
                    self.active_url = url  # Guardamos la URL que ha funcionado
                    self.verify_server_identity(res.json())
                    return True
            except: continue
        return False

    def upload_file(self, local_path):
        try:
            rel_path = os.path.relpath(local_path, LOCAL_DIR).replace("\\", "/")
            server_subpath = self.device_name
            sub_dir = os.path.dirname(rel_path)
            if sub_dir: server_subpath += "/" + sub_dir
            filename = os.path.basename(rel_path)
            
            print(f"[Null-Void Sync] Detectado nuevo/modificado: {rel_path}. Subiendo...")
            url = f"{self.active_url}/api/cloud/upload?path={requests.utils.quote(server_subpath)}&view=computers"
            with open(local_path, "rb") as f:
                res = requests.post(url, headers={"Authorization": f"Bearer {self.token}"},
                    files={"file": (filename, f)}, verify=self.verify_ssl)
            
            success = res.status_code in (200, 201)
            if success:
                print(f"[Null-Void Sync] ¡Archivo subido con éxito: {rel_path}!")
            else:
                print(f"[Null-Void Sync] Error al subir {rel_path}: HTTP {res.status_code}")
            return success
        except Exception as e:
            print(f"[Null-Void Sync] Excepción al subir {local_path}: {str(e)}")
            return False

    def delete_file(self, rel_path):
        server_subpath = self.device_name
        sub_dir = os.path.dirname(rel_path)
        if sub_dir: server_subpath += "/" + sub_dir
        filename = os.path.basename(rel_path)
        try:
            print(f"[Null-Void Sync] Detectado borrado: {rel_path}. Eliminando en el servidor...")
            res = requests.post(f"{self.active_url}/api/cloud/delete",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"path": server_subpath, "name": filename, "view": "computers"}, verify=self.verify_ssl)
            success = res.status_code in (200, 204)
            if success:
                print(f"[Null-Void Sync] ¡Borrado en servidor: {rel_path}!")
            else:
                print(f"[Null-Void Sync] Error al borrar {rel_path}: HTTP {res.status_code}")
            return success
        except Exception as e:
            print(f"[Null-Void Sync] Excepción al borrar {rel_path}: {str(e)}")
            return False

    def create_dir(self, rel_path):
        server_subpath = self.device_name
        sub_dir = os.path.dirname(rel_path)
        if sub_dir: server_subpath += "/" + sub_dir
        name = os.path.basename(rel_path)
        try:
            print(f"[Null-Void Sync] Detectada nueva carpeta: {rel_path}. Creando en el servidor...")
            res = requests.post(f"{self.active_url}/api/cloud/mkdir",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"path": server_subpath, "name": name, "view": "computers"}, verify=self.verify_ssl)
            success = res.status_code in (200, 201)
            if success:
                print(f"[Null-Void Sync] ¡Carpeta creada en servidor: {rel_path}!")
            else:
                print(f"[Null-Void Sync] Error al crear carpeta {rel_path}: HTTP {res.status_code}")
            return success
        except Exception as e:
            print(f"[Null-Void Sync] Excepción al crear carpeta {rel_path}: {str(e)}")
            return False

    def get_server_state(self):
        try:
            res = requests.post(f"{self.active_url}/api/cloud/sync-agent/changes",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"device": self.device_name, "os": platform.system()}, timeout=10, verify=self.verify_ssl)
            if res.status_code == 200:
                data = res.json()
                self.verify_server_identity(data)
                return data.get("files", {}), set(data.get("dirs", []))
            return None, None
        except: return None, None

    def download_file_from_server(self, rel_path):
        try:
            url = f"{self.active_url}/api/cloud/sync-agent/download"
            params = {"device": self.device_name, "path": rel_path, "token": self.token}
            res = requests.get(url, headers={"Authorization": f"Bearer {self.token}"}, params=params, timeout=30, verify=self.verify_ssl)
            if res.status_code == 200:
                local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                self.ignore_path(rel_path, 3.0)
                with open(local_path, "wb") as f:
                    f.write(res.content)
                return True
            return False
        except: return False

    def initial_sync(self):
        srv_files, srv_dirs = self.get_server_state()
        if srv_files is None: return
        self.server_known_files = srv_files
        self.server_known_dirs = srv_dirs
        for root, dirs, files in os.walk(LOCAL_DIR):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for d in dirs:
                rel = os.path.relpath(os.path.join(root, d), LOCAL_DIR).replace("\\", "/")
                if rel not in srv_dirs: self.event_queue.put(("mkdir", rel))
            for file in files:
                if file.startswith("."): continue
                fp = os.path.join(root, file)
                rel = os.path.relpath(fp, LOCAL_DIR).replace("\\", "/")
                local_mtime = os.path.getmtime(fp)
                if rel not in srv_files or local_mtime > srv_files[rel] + 2:
                    self.event_queue.put(("upload", rel))

    def local_worker(self):
        import queue
        last_processed = {}
        while not self.stop_event.is_set():
            try:
                action, rel = self.event_queue.get(timeout=1.0)
                now = time.time()
                cache_key = f"{action}_{rel}"
                
                if cache_key in last_processed and now - last_processed[cache_key] < 2.0:
                    self.event_queue.task_done()
                    continue
                    
                last_processed[cache_key] = now
                
                if action == "delete":
                    self.delete_file(rel)
                elif action == "mkdir":
                    self.create_dir(rel)
                elif action == "upload":
                    abs_path = os.path.join(LOCAL_DIR, rel.replace("/", os.sep))
                    if os.path.exists(abs_path) and not os.path.isdir(abs_path):
                        if wait_for_file_stability(abs_path):
                            self.upload_file(abs_path)
                self.event_queue.task_done()
            except queue.Empty:
                pass

    def server_loop(self):
        print("[Null-Void Sync] Escuchando cambios en tiempo real...")
        try:
            while not self.stop_event.is_set():
                if not self.send_ping():
                    time.sleep(5)
                    continue
                
                srv_files, srv_dirs = self.get_server_state()
                if srv_files is not None:
                    import shutil
                    for d in sorted(srv_dirs):
                        local_d = os.path.join(LOCAL_DIR, d.replace("/", os.sep))
                        if not os.path.exists(local_d):
                            self.ignore_path(d, 3.0); os.makedirs(local_d, exist_ok=True)
                    
                    for rel_path, srv_mtime in srv_files.items():
                        local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
                        local_mtime = os.path.getmtime(local_path) if os.path.exists(local_path) else None
                        if local_mtime is None or srv_mtime > local_mtime + 2:
                            self.download_file_from_server(rel_path)

                    for rel_path in list(self.server_known_files.keys()):
                        if rel_path not in srv_files:
                            local_path = os.path.join(LOCAL_DIR, rel_path.replace("/", os.sep))
                            if os.path.exists(local_path):
                                self.ignore_path(rel_path, 3.0)
                                try: os.remove(local_path)
                                except: pass
                    
                    for d in list(self.server_known_dirs):
                        if d not in srv_dirs:
                            local_d = os.path.join(LOCAL_DIR, d.replace("/", os.sep))
                            if os.path.isdir(local_d):
                                self.ignore_path(d, 3.0)
                                try: shutil.rmtree(local_d)
                                except: pass
                    
                    self.server_known_dirs = srv_dirs
                    self.server_known_files = srv_files
                
                time.sleep(3)
        except KeyboardInterrupt:
            self.stop_event.set()
        
        try: requests.post(f"{self.active_url}/api/cloud/sync-agent/disconnect", headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}, json={"device": self.device_name}, timeout=5, verify=self.verify_ssl)
        except: pass
        
        if self.observer: self.observer.stop()
        if self.observer: self.observer.join()
        self.worker_thread.join(timeout=2)


class SyncHandler(FileSystemEventHandler):
    def __init__(self, client):
        self.client = client

    def _get_rel(self, path):
        try: return os.path.relpath(path, LOCAL_DIR).replace("\\", "/")
        except: return None

    def on_created(self, event):
        rel = self._get_rel(event.src_path)
        if not rel or rel.startswith('.') or self.client.is_ignored(rel): return
        print(f"[Null-Void Sync Debug] Watchdog on_created: {rel}")
        if event.is_directory: self.client.event_queue.put(("mkdir", rel))
        else: self.client.event_queue.put(("upload", rel))

    def on_modified(self, event):
        rel = self._get_rel(event.src_path)
        if not rel or rel.startswith('.') or event.is_directory or self.client.is_ignored(rel): return
        print(f"[Null-Void Sync Debug] Watchdog on_modified: {rel}")
        self.client.event_queue.put(("upload", rel))

    def on_deleted(self, event):
        rel = self._get_rel(event.src_path)
        if not rel or rel.startswith('.') or self.client.is_ignored(rel): return
        print(f"[Null-Void Sync Debug] Watchdog on_deleted: {rel}")
        self.client.event_queue.put(("delete", rel))

    def on_moved(self, event):
        old_rel = self._get_rel(event.src_path)
        new_rel = self._get_rel(event.dest_path)
        if old_rel and not old_rel.startswith('.') and not self.client.is_ignored(old_rel):
            self.client.event_queue.put(("delete", old_rel))
        if new_rel and not new_rel.startswith('.') and not self.client.is_ignored(new_rel):
            if event.is_directory: self.client.event_queue.put(("mkdir", new_rel))
            else: self.client.event_queue.put(("upload", new_rel))


if __name__ == "__main__":
    config = load_config()
    if not config:
        config = register_agent()
        
    client = SyncClient(config)
    
    def signal_handler(sig, frame):
        try:
            print("\n[Null-Void Sync] Señal de apagado recibida. Cerrando hilos y conexiones con seguridad...")
        except Exception:
            pass
        client.stop_event.set()
        
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        client.start()
    except Exception as e:
        print(f"Error inesperado: {e}")
        client.stop_event.set()
