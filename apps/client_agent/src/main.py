# -*- coding: utf-8 -*-
import os
import sys
import time
import platform
import shutil
import subprocess
import threading
import json
import signal
import webbrowser
import hashlib
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


class CloudCertMismatchError(Exception):
    """El certificado TLS del servidor no coincide con AGENT_CERT_HASH."""


def load_agent_env():
    """Lee el .env del agente: AGENT_BOOTSTRAP_SERVERS y AGENT_CERT_HASH.

    AGENT_CERT_HASH es la huella SHA-256 del certificado TLS del servidor
    (la imprime el servidor al arrancar). Con ella, el agente rechaza
    cualquier servidor cuyo certificado no coincida (anti-MITM).
    """
    data = {}
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
                            data.setdefault('servers', [s.strip() for s in val.split(',') if s.strip()])
                        elif line.startswith('AGENT_CERT_HASH='):
                            val = line.split('=', 1)[1].strip().strip('"').strip("'")
                            if val:
                                data.setdefault('cert_hash', val.lower())
            except Exception:
                pass
    return data


_AGENT_ENV = load_agent_env()
BOOTSTRAP_SERVERS = _AGENT_ENV.get('servers', [])

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
    # El archivo contiene el token del dispositivo: solo lectura para el usuario.
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass


def get_device_name():
    return platform.node()


def peer_cert_fingerprint(res):
    """SHA-256 (hex, minúsculas) del certificado TLS presentado por el servidor."""
    try:
        conn = getattr(res.raw, "_connection", None)
        sock = getattr(conn, "sock", None) if conn else None
        der = sock.getpeercert(binary_form=True) if sock else None
        if not der:
            return None
        return hashlib.sha256(der).hexdigest()
    except Exception:
        return None


def _pinned_request(method, url, cert_hash, verify, **kw):
    """Realiza la petición y comprueba el certificado TLS contra el hash esperado.

    Si `cert_hash` está configurado y el certificado del servidor no coincide,
    lanza CloudCertMismatchError antes de devolver la respuesta.
    """
    res = requests.request(method, url, verify=verify, **kw)
    if cert_hash:
        fingerprint = peer_cert_fingerprint(res)
        if not fingerprint or fingerprint != cert_hash.lower():
            raise CloudCertMismatchError(
                "El certificado SSL del servidor no coincide con la huella "
                "AGENT_CERT_HASH configurada. Posible suplantación (MITM).")
    return res


def perform_registration(test_urls, temp_token, device_name=None, local_dir=None):
    """Realiza la solicitud HTTP de registro al servidor Nube y guarda el config.json."""
    if not device_name:
        device_name = get_device_name()

    payload = {
        "device": device_name,
        "os": platform.system(),
        "temp_token": temp_token
    }
    
    last_err = "No se pudo conectar con los servidores."
    expected_cert_hash = _AGENT_ENV.get('cert_hash')
    for url in test_urls:
        reg_url = f"{url}/api/cloud/sync-agent/register"
        log(f"Probando conexión de registro con: {url}...")
        
        for verify_ssl in (True, False):
            try:
                res = _pinned_request("POST", reg_url, expected_cert_hash, verify_ssl,
                                      json=payload, timeout=5)
                if res.status_code == 200:
                    res_data = res.json()
                    fingerprint = res_data.get("server_fingerprint")
                    assigned_device_name = res_data.get("device_name", device_name)
                    saved_urls = [url] + [u for u in test_urls if u != url]
                    
                    config = {
                        "server_urls": saved_urls,
                        "device_token": res_data.get("device_token"),
                        "device_name": assigned_device_name,
                        "username": res_data.get("username", assigned_device_name.split("-PC")[0] if "-PC" in assigned_device_name else assigned_device_name),
                        "server_fingerprint": fingerprint,
                        "verify_ssl": verify_ssl
                    }
                    # Fija la huella TLS observada solo si la cadena SSL se
                    # validó correctamente (verify_ssl) o si venía en el .env.
                    observed_cert_hash = peer_cert_fingerprint(res)
                    if expected_cert_hash:
                        config["cert_hash"] = expected_cert_hash
                    elif observed_cert_hash and verify_ssl:
                        config["cert_hash"] = observed_cert_hash
                    if local_dir:
                        config["local_dir"] = local_dir
                    save_config(config)
                    log(f"Dispositivo vinculado con éxito a {url} como '{assigned_device_name}'")
                    return config, None
                else:
                    try:
                        err_msg = res.json().get("error", res.text)
                    except Exception:
                        err_msg = res.text
                    last_err = f"Servidor {url}: {err_msg}"
                    break
            except CloudCertMismatchError as e:
                last_err = f"Servidor {url}: {e}"
                break
            except requests.exceptions.SSLError:
                if verify_ssl:
                    continue
            except Exception as e:
                last_err = f"No se pudo conectar a {url}: {e}"
                break

    return None, last_err


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
                test_urls.append(custom_url)
            else:
                print("Opción inválida.")
                sys.exit(1)
        except ValueError:
            print("Opción inválida.")
            sys.exit(1)
    else:
        print("No se encontraron servidores de respaldo en la configuración.")
        custom_url = input("Introduce la URL completa de tu servidor (ej. https://192.168.1.50:5000): ").strip().rstrip("/")
        if not custom_url.startswith("http://") and not custom_url.startswith("https://"):
            print("ERROR: La URL debe empezar por http:// o https://")
            sys.exit(1)
        test_urls.append(custom_url)
    
    test_urls.extend([u for u in BOOTSTRAP_SERVERS if u not in test_urls])
    
    token = input("\nToken de enlace (generado en la web): ").strip()
    if not token:
        print("Token inválido.")
        sys.exit(1)

    print("\nBuscando servidor y registrando dispositivo...")
    cfg, err = perform_registration(test_urls, token)
    if cfg:
        return cfg
    print(f"\nError de registro: {err}")
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


class SyncClient:
    def __init__(self, config):
        # Maneja tanto la versión vieja del config (server_url) como la nueva (server_urls)
        self.server_urls = config.get("server_urls", [config.get("server_url")])
        self.server_urls = [u for u in self.server_urls if u] + BOOTSTRAP_SERVERS
        self.server_urls = list(dict.fromkeys(self.server_urls))
        self.active_url = self.server_urls[0] if self.server_urls else None
        
        self.token = config["device_token"]
        self.device_name = config["device_name"]
        self.username = config.get("username", self.device_name.split("-PC")[0] if "-PC" in self.device_name else "Usuario")
        self.local_dir = config.get("local_dir", LOCAL_DIR)
        self.server_fingerprint = config.get("server_fingerprint")
        self.verify_ssl = config.get("verify_ssl", False)
        self.cert_hash = (config.get("cert_hash") or _AGENT_ENV.get('cert_hash') or "").lower() or None
        
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

        # Subidas fallidas pendientes de reintento: rel_path -> [proximo_intento, reintentos]
        self.failed_uploads = {}
        self.uploading = set()

        self.connected = False
        self.paused = True
        self.last_sync_time = None
        self.last_ping_error = None
        self.unlinked_from_server = False
        self.stats_lock = threading.Lock()
        self.stats = {"uploaded": 0, "downloaded": 0, "deleted": 0, "created_dirs": 0}

    def toggle_pause(self):
        self.paused = not self.paused
        state_str = "Pausada" if self.paused else "Reanudada"
        log(f"Sincronización {state_str}.")
        return self.paused

    def _request(self, method, url, **kw):
        """Petición HTTP con verificación de la huella TLS del servidor (si está fijada)."""
        return _pinned_request(method, url, self.cert_hash, self.verify_ssl, **kw)

    def _bump_stat(self, key):
        with self.stats_lock:
            self.stats[key] = self.stats.get(key, 0) + 1

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
        print(f"[Null-Void Sync] Directorio compartido: {self.local_dir}")
        os.makedirs(self.local_dir, exist_ok=True)
        
        try:
            if platform.system() == "Windows": os.startfile(self.local_dir)
            elif platform.system() == "Darwin": subprocess.Popen(["open", self.local_dir])
            else: subprocess.Popen(["xdg-open", self.local_dir], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception: pass

        if not self.send_ping():
            print("[Null-Void Sync] No se pudo conectar al servidor. Verifica la conexión.")
            sys.exit(1)

        self.initial_sync()

        self.worker_thread = threading.Thread(target=self.local_worker)
        self.worker_thread.start()

        self.observer = Observer()
        self.observer.schedule(SyncHandler(self), self.local_dir, recursive=True)
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
            self.connected = False
            self.stop_event.set()
            sys.exit(1)
        return True

    def send_ping(self):
        for url in self.server_urls:
            try:
                res = self._request("POST", f"{url}/api/cloud/sync-agent/ping",
                    headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                    json={"device": self.device_name, "os": platform.system(), "version": "1.0.0"}, timeout=5)
                if res.status_code == 401:
                    print(f"[Null-Void Sync] Token revocado en {url}. Por favor, vuelve a vincular el dispositivo.")
                    log("El dispositivo fue desvinculado de la cuenta (token revocado por el servidor).")
                    self.unlinked_from_server = True
                    if os.path.exists(CONFIG_FILE): os.remove(CONFIG_FILE)
                    self.connected = False
                    self.last_ping_error = "Token revocado"
                    self.stop_event.set()
                    return False
                if res.status_code == 200:
                    data = res.json()
                    self.active_url = url
                    self.verify_server_identity(data)
                    self.connected = True
                    self.last_ping_error = None
                    if data.get("has_update"):
                        new_ver = data.get("latest_version")
                        if getattr(self, "latest_version_available", None) != new_ver:
                            self.latest_version_available = new_ver
                            log(f"[ACTUALIZACIÓN] Nueva versión disponible en el servidor: v{self.latest_version_available}")
                    else:
                        self.latest_version_available = None
                    return True
            except Exception as e:
                self.last_ping_error = str(e)
                continue
        self.connected = False
        return False

    def upload_file(self, local_path):
        rel_path = None
        try:
            rel_path = os.path.relpath(local_path, self.local_dir).replace("\\", "/")
            if rel_path in self.uploading:
                return True  # ya hay una subida en vuelo de este archivo
            self.uploading.add(rel_path)
            server_subpath = self.device_name
            sub_dir = os.path.dirname(rel_path)
            if sub_dir: server_subpath += "/" + sub_dir
            filename = os.path.basename(rel_path)
            
            print(f"[Null-Void Sync] Uploading: {rel_path}")
            log(f"Detectado nuevo/modificado: {rel_path}. Subiendo...")
            url = f"{self.active_url}/api/cloud/upload?path={requests.utils.quote(server_subpath)}&view=computers&overwrite=true"
            with open(local_path, "rb") as f:
                res = self._request("POST", url, headers={"Authorization": f"Bearer {self.token}"},
                    files={"file": (filename, f)})
            
            success = res.status_code in (200, 201)
            if success:
                print(f"[Null-Void Sync] Successfully uploaded: {rel_path}")
                log(f"¡Archivo subido con éxito: {rel_path}!")
                self._bump_stat("uploaded")
                self.failed_uploads.pop(rel_path, None)
            else:
                try:
                    detail = res.json().get("error", res.text)
                except Exception:
                    detail = res.text
                print(f"[Null-Void Sync] Failed to upload {rel_path}: HTTP {res.status_code} - {detail}")
                log(f"Error al subir {rel_path}: HTTP {res.status_code} - {detail}")
                self.failed_uploads.setdefault(rel_path, [time.time() + 30, 0])
            return success
        except Exception as e:
            print(f"[Null-Void Sync] Error uploading {local_path}: {str(e)}")
            log(f"Excepción al subir {local_path}: {str(e)}")
            if rel_path:
                self.failed_uploads.setdefault(rel_path, [time.time() + 30, 0])
            return False
        finally:
            if rel_path:
                self.uploading.discard(rel_path)

    def delete_file(self, rel_path):
        server_subpath = self.device_name
        sub_dir = os.path.dirname(rel_path)
        if sub_dir: server_subpath += "/" + sub_dir
        filename = os.path.basename(rel_path)
        try:
            print(f"[Null-Void Sync] Deleting on server: {rel_path}")
            log(f"Detectado borrado: {rel_path}. Eliminando en el servidor...")
            res = self._request("POST", f"{self.active_url}/api/cloud/delete",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"path": server_subpath, "name": filename, "view": "computers"})
            success = res.status_code in (200, 204)
            if success:
                print(f"[Null-Void Sync] Deleted on server: {rel_path}")
                log(f"Borrado en servidor: {rel_path}")
                self._bump_stat("deleted")
            else:
                print(f"[Null-Void Sync] Error deleting {rel_path}: HTTP {res.status_code}")
                log(f"Error al borrar {rel_path}: HTTP {res.status_code}")
            return success
        except Exception as e:
            print(f"[Null-Void Sync] Error deleting {rel_path}: {str(e)}")
            log(f"Excepción al borrar {rel_path}: {str(e)}")
            return False

    def create_dir(self, rel_path):
        server_subpath = self.device_name
        sub_dir = os.path.dirname(rel_path)
        if sub_dir: server_subpath += "/" + sub_dir
        name = os.path.basename(rel_path)
        try:
            print(f"[Null-Void Sync] Creating directory on server: {rel_path}")
            log(f"Detectada nueva carpeta: {rel_path}. Creando en el servidor...")
            res = self._request("POST", f"{self.active_url}/api/cloud/mkdir",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"path": server_subpath, "name": name, "view": "computers"})
            success = res.status_code in (200, 201)
            if success:
                print(f"[Null-Void Sync] Directory created on server: {rel_path}")
                log(f"Carpeta creada en servidor: {rel_path}")
                self._bump_stat("created_dirs")
            else:
                print(f"[Null-Void Sync] Error creating directory {rel_path}: HTTP {res.status_code}")
                log(f"Error al crear carpeta {rel_path}: HTTP {res.status_code}")
            return success
        except Exception as e:
            print(f"[Null-Void Sync] Error creating directory {rel_path}: {str(e)}")
            log(f"Excepción al crear carpeta {rel_path}: {str(e)}")
            return False

    def get_server_state(self):
        try:
            res = self._request("POST", f"{self.active_url}/api/cloud/sync-agent/changes",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={"device": self.device_name, "os": platform.system()}, timeout=10)
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
            res = self._request("GET", url, headers={"Authorization": f"Bearer {self.token}"}, params=params, timeout=30)
            if res.status_code == 200:
                local_path = os.path.join(self.local_dir, rel_path.replace("/", os.sep))
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                self.ignore_path(rel_path, 3.0)
                with open(local_path, "wb") as f:
                    f.write(res.content)
                self._bump_stat("downloaded")
                return True
            return False
        except: return False

    def initial_sync(self):
        log("Iniciando sincronización manual...")
        srv_files, srv_dirs = self.get_server_state()
        if srv_files is None:
            log("No se pudo obtener el estado del servidor para sincronizar.")
            return
        self.server_known_files = srv_files
        self.server_known_dirs = srv_dirs
        for root, dirs, files in os.walk(self.local_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for d in dirs:
                rel = os.path.relpath(os.path.join(root, d), self.local_dir).replace("\\", "/")
                if rel not in srv_dirs: self.event_queue.put(("mkdir", rel))
            for file in files:
                if file.startswith("."): continue
                fp = os.path.join(root, file)
                rel = os.path.relpath(fp, self.local_dir).replace("\\", "/")
                local_mtime = os.path.getmtime(fp)
                if rel not in srv_files or local_mtime > srv_files[rel] + 2:
                    self.event_queue.put(("upload", rel))

        for srv_rel, srv_mtime in srv_files.items():
            local_fp = os.path.join(self.local_dir, srv_rel.replace("/", os.sep))
            if not os.path.exists(local_fp) or srv_mtime > os.path.getmtime(local_fp) + 2:
                self.download_file_from_server(srv_rel)

        self.last_sync_time = time.time()
        log("Sincronización manual completada.")
    def local_worker(self):
        import queue
        last_processed = {}
        while not self.stop_event.is_set():
            try:
                action, rel = self.event_queue.get(timeout=1.0)
                if self.paused:
                    self.event_queue.task_done()
                    continue
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
                    abs_path = os.path.join(self.local_dir, rel.replace("/", os.sep))
                    if os.path.exists(abs_path) and not os.path.isdir(abs_path):
                        if wait_for_file_stability(abs_path):
                            self.upload_file(abs_path)
                self.event_queue.task_done()
            except queue.Empty:
                pass

    def server_loop(self):
        print("[Null-Void Sync] Real-time background sync active.")
        try:
            while not self.stop_event.is_set():
                if self.paused:
                    time.sleep(1)
                    continue

                if not self.send_ping():
                    time.sleep(5)
                    continue
                
                srv_files, srv_dirs = self.get_server_state()
                if srv_files is not None:
                    import shutil
                    for d in sorted(srv_dirs):
                        local_d = os.path.join(self.local_dir, d.replace("/", os.sep))
                        if not os.path.exists(local_d):
                            self.ignore_path(d, 3.0); os.makedirs(local_d, exist_ok=True)
                    
                    for rel_path, srv_mtime in srv_files.items():
                        local_path = os.path.join(self.local_dir, rel_path.replace("/", os.sep))
                        local_mtime = os.path.getmtime(local_path) if os.path.exists(local_path) else None
                        if local_mtime is None or srv_mtime > local_mtime + 2:
                            self.download_file_from_server(rel_path)

                    for rel_path in list(self.server_known_files.keys()):
                        if rel_path not in srv_files:
                            local_path = os.path.join(self.local_dir, rel_path.replace("/", os.sep))
                            if os.path.exists(local_path):
                                self.ignore_path(rel_path, 3.0)
                                try: os.remove(local_path)
                                except: pass
                    
                    for d in list(self.server_known_dirs):
                        if d not in srv_dirs:
                            local_d = os.path.join(self.local_dir, d.replace("/", os.sep))
                            if os.path.isdir(local_d):
                                self.ignore_path(d, 3.0)
                                try: shutil.rmtree(local_d)
                                except: pass
                    
                    self.server_known_dirs = srv_dirs
                    self.server_known_files = srv_files
                    self.last_sync_time = time.time()
                
                self._retry_failed_uploads()
                
                time.sleep(3)
        except KeyboardInterrupt:
            self.stop_event.set()
        
        self.connected = False
        try: self._request("POST", f"{self.active_url}/api/cloud/sync-agent/disconnect", headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}, json={"device": self.device_name}, timeout=5)
        except: pass
        
        if self.observer: self.observer.stop()
        if self.observer: self.observer.join()
        self.worker_thread.join(timeout=2)

    def _retry_failed_uploads(self):
        """ Reintenta subidas fallidas con backoff (30s, 60s, 120s... tope 8 min). """
        now = time.time()
        for rel_path in list(self.failed_uploads.keys()):
            entry = self.failed_uploads[rel_path]
            if now < entry[0]:
                continue
            local_path = os.path.join(self.local_dir, rel_path.replace("/", os.sep))
            if not os.path.exists(local_path) or os.path.isdir(local_path):
                del self.failed_uploads[rel_path]
                continue
            if self.upload_file(local_path):
                del self.failed_uploads[rel_path]
            else:
                entry[1] += 1
                entry[0] = now + min(30 * (2 ** min(entry[1] - 1, 4)), 480)


class SyncHandler(FileSystemEventHandler):
    def __init__(self, client):
        self.client = client

    def _get_rel(self, path):
        try: return os.path.relpath(path, self.client.local_dir).replace("\\", "/")
        except: return None

    def on_created(self, event):
        if self.client.paused: return
        rel = self._get_rel(event.src_path)
        if not rel or self.client.is_ignored(rel): return
        print(f"[Null-Void Sync Debug] Watchdog on_created: {rel}")
        if event.is_directory: self.client.event_queue.put(("mkdir", rel))
        else: self.client.event_queue.put(("upload", rel))

    def on_modified(self, event):
        if self.client.paused or event.is_directory: return
        rel = self._get_rel(event.src_path)
        if not rel or self.client.is_ignored(rel): return
        print(f"[Null-Void Sync Debug] Watchdog on_modified: {rel}")
        self.client.event_queue.put(("upload", rel))

    def on_deleted(self, event):
        if self.client.paused: return
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


ui_log_queue = Queue()

def log(msg):
    t_str = time.strftime("%H:%M:%S")
    full = f"[{t_str}] {msg}"
    print(f"[Null-Void Sync] {full}")
    try: ui_log_queue.put(full)
    except Exception: pass


def open_local_folder(path=None):
    target = path or LOCAL_DIR
    target = os.path.abspath(target)
    if not os.path.exists(target):
        try: os.makedirs(target, exist_ok=True)
        except Exception: pass

    folder_name = os.path.basename(target)

    def _do_open():
        try:
            if platform.system() == "Linux":
                res = subprocess.run(["wmctrl", "-a", folder_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1)
                if res.returncode == 0:
                    return
        except Exception: pass

        try:
            from PySide6 import QtGui, QtCore
            url = QtCore.QUrl.fromLocalFile(target)
            if QtGui.QDesktopServices.openUrl(url):
                return
        except Exception: pass

        try:
            if platform.system() == "Windows":
                os.startfile(target)
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                for opener in ["nautilus", "xdg-open", "dolphin", "thunar", "pcmanfm"]:
                    try:
                        p = subprocess.Popen([opener, target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        if p.poll() is None:
                            break
                    except Exception: continue
        except Exception as e:
            log(f"Error al abrir carpeta local: {e}")

    threading.Thread(target=_do_open, daemon=True).start()


def delete_config():
    if os.path.exists(CONFIG_FILE):
        try:
            os.remove(CONFIG_FILE)
            log("Configuración del token eliminada. Sesión desvinculada.")
        except Exception as e:
            log(f"Error al eliminar la configuración: {e}")


def launch_gui(client):
    try:
        try:
            from .ui.qt_gui import launch_native_qt_gui
        except ImportError:
            from src.ui.qt_gui import launch_native_qt_gui
        folder_opener = lambda: open_local_folder(client.local_dir)
        if launch_native_qt_gui(client, client.local_dir, folder_opener, ui_log_queue, logout_cb=delete_config):
            client.stop_event.set()
            return
    except Exception as e:
        log(f"GUI nativa Qt no disponible: {e}")

    log("Ejecutando en segundo plano...")
    while not client.stop_event.is_set():
        time.sleep(1)


if __name__ == "__main__":
    def signal_handler(sig, frame):
        try:
            log("Señal de apagado recibida. Cerrando hilos y conexiones...")
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    while True:
        config = load_config()
        if not config:
            try:
                try:
                    from .ui.qt_gui import register_agent_qt_gui
                except ImportError:
                    from src.ui.qt_gui import register_agent_qt_gui
                config = register_agent_qt_gui(BOOTSTRAP_SERVERS, get_device_name(), perform_registration)
            except Exception as e:
                log(f"Error al iniciar GUI nativa de registro: {e}")
                sys.exit(1)

        if not config:
            sys.exit(0)

        client = SyncClient(config)
        threading.Thread(target=client.start, daemon=True).start()
        launch_gui(client)

        # Si tras salir de la GUI la configuración fue eliminada (desvinculación), volver al wizard inicial
        if not os.path.exists(CONFIG_FILE):
            log("Dispositivo desvinculado. Volviendo a la pantalla de configuración inicial...")
            continue
        else:
            break
