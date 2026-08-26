"""Gestión del ciclo de vida del contenedor Docker de Ollama y monitor de inactividad."""
import json
import os
import socket
import threading
import time
from typing import Dict, Tuple

import requests
from core.socket_ext import socketio
from ..clients import ollama_client

active_ai_users: Dict[str, float] = {}
container_running: bool = False
container_stopping: bool = False
ACTIVE_DOWNLOADS: Dict[str, dict] = {}

_last_ollama_log = 0.0


def _log_ollama(msg: str):
    global _last_ollama_log
    now = time.time()
    if now - _last_ollama_log > 60:
        _last_ollama_log = now
        print(msg)


def _docker_api(path: str, method: str = "POST") -> Tuple[bool, str]:
    """Llama a la API de Docker vía socket UNIX. Devuelve (ok, body_text)."""
    socket_path = "/var/run/docker.sock"
    if not os.path.exists(socket_path):
        return False, "docker.sock no disponible"
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(5)
            s.connect(socket_path)
            req = f"{method} /v1.41/{path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
            s.sendall(req.encode())
            
            chunks = []
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
                
            raw_response = b"".join(chunks).decode(errors="replace")
            head, _, body = raw_response.partition("\r\n\r\n")
            first_line = head.split("\r\n", 1)[0]
            ok = first_line.startswith("HTTP/1.1 20") or first_line.startswith("HTTP/1.1 30")
            return ok, body or first_line
    except Exception as e:
        return False, str(e)


def _start_ollama_container() -> bool:
    ok, resp = _docker_api("containers/ollama/start")
    if not ok:
        _log_ollama(f"Error starting ollama: {resp}")
    return ok


def _wait_ollama_ready(timeout: float = 45.0) -> bool:
    """Espera a que el servidor HTTP de Ollama acepte conexiones."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{ollama_client.OLLAMA_URL}/api/tags", timeout=2)
            if r.status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(1)
    return False


def _stop_ollama_container() -> bool:
    ok, resp = _docker_api("containers/ollama/stop")
    if not ok:
        _log_ollama(f"Error stopping ollama: {resp}")
    return ok


def _ollama_container_running() -> bool:
    """Estado real del contenedor vía Docker inspect (State.Running)."""
    ok, body = _docker_api("containers/ollama/json", method="GET")
    if not ok:
        return False
    try:
        data = json.loads(body)
        return bool(data.get("State", {}).get("Running"))
    except Exception as e:
        _log_ollama(f"Error inspect ollama json: {e}")
        return False


def _inactivity_watcher():
    global container_running, container_stopping
    from .concurrency import has_active_generations
    while True:
        time.sleep(5)
        now = time.time()

        for uid in list(active_ai_users.keys()):
            if now - active_ai_users[uid] > 60:
                del active_ai_users[uid]

        idle = (len(active_ai_users) == 0 and not has_active_generations())
        if container_running and idle and not ACTIVE_DOWNLOADS and not container_stopping:
            container_stopping = True
            try:
                ollama_client.unload_all_models()
                time.sleep(1)
                _stop_ollama_container()
            finally:
                container_running = False
                container_stopping = False


_watcher_thread = threading.Thread(target=_inactivity_watcher, daemon=True)
_watcher_thread.start()


def handle_heartbeat(uid: str = "anonymous") -> dict:
    global container_running, container_stopping
    active_ai_users[uid] = time.time()

    if container_stopping:
        for _ in range(15):
            time.sleep(0.1)
            if not container_stopping:
                break

    if _ollama_container_running() and not container_stopping:
        container_running = True
    elif _start_ollama_container():
        container_running = True
        if not _wait_ollama_ready():
            _log_ollama("Ollama no respondió tras arrancar el contenedor")
    return {"ok": True}


def pull_ai_model(model_name: str, uid: str = "anonymous") -> dict:
    from .models import _invalidate_models_cache
    handle_heartbeat(uid)
    if model_name in ACTIVE_DOWNLOADS:
        return {"status": "started", "model": model_name, "message": "Ya se está descargando."}

    ACTIVE_DOWNLOADS[model_name] = {"progress": "Iniciando descarga...", "status": "downloading"}

    def _pull_worker():
        try:
            for chunk in ollama_client.pull_model(model_name):
                try:
                    parsed = json.loads(chunk)
                    if "error" in parsed:
                        ACTIVE_DOWNLOADS[model_name] = {"status": "error", "message": parsed["error"]}
                        socketio.emit('model_pull_progress', {"model": model_name, "status": "error", "message": parsed["error"]})
                        break

                    status_text = parsed.get("status", "")
                    if "completed" in parsed and "total" in parsed:
                        completed_mb = parsed["completed"] / 1024 / 1024
                        total_mb = parsed["total"] / 1024 / 1024
                        status_text = f"{status_text} ({completed_mb:.1f}MB / {total_mb:.1f}MB)"

                    ACTIVE_DOWNLOADS[model_name]["progress"] = status_text
                    socketio.emit('model_pull_progress', {"model": model_name, "status": "downloading", "progress": status_text, "raw": parsed})
                except (json.JSONDecodeError, TypeError):
                    pass

            if model_name in ACTIVE_DOWNLOADS and ACTIVE_DOWNLOADS[model_name].get("status") != "error":
                ACTIVE_DOWNLOADS[model_name] = {"status": "success", "progress": "Descarga completada."}
                socketio.emit('model_pull_progress', {"model": model_name, "status": "success"})
                _invalidate_models_cache()
                time.sleep(5)
                if model_name in ACTIVE_DOWNLOADS:
                    del ACTIVE_DOWNLOADS[model_name]

        except Exception as e:
            ACTIVE_DOWNLOADS[model_name] = {"status": "error", "message": str(e)}
            socketio.emit('model_pull_progress', {"model": model_name, "status": "error", "message": str(e)})

    threading.Thread(target=_pull_worker, daemon=True).start()
    return {"status": "started", "model": model_name}


def delete_ai_model(model_name: str, uid: str = "anonymous") -> dict:
    from .models import _invalidate_models_cache
    handle_heartbeat(uid)
    result = ollama_client.delete_model(model_name)
    _invalidate_models_cache()
    return result