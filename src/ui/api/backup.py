import os
import json
from flask import Blueprint, request, jsonify
from ui.session import session
from core.backup import realizar_backup

backup_bp = Blueprint("backup", __name__)

# Ruta al archivo de configuración
CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "user_config.json")

from ui.api.settings import load_settings, save_settings_internal

def get_backup_defaults(user_id):
    """Lee la configuración desde el JSON del usuario."""
    config = load_settings(user_id)
    return config.get("backup", {"source": "", "destination": ""})

def save_backup_config(user_id, source, destination):
    """Guarda la configuración actual en el archivo JSON del usuario."""
    save_settings_internal(user_id, {"backup": {"source": source, "destination": destination}})

@backup_bp.route("/api/config/backup", methods=["GET"])
def api_get_backup_config():
    token = request.args.get("token") or request.cookies.get("token")
    user_id = session.get_user_id(token)
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401
    
    return jsonify({"ok": True, "config": get_backup_defaults(user_id)})

@backup_bp.route("/api/backup", methods=["POST"])
def api_backup():
    token = request.args.get("token") or request.cookies.get("token")
    user_id = session.get_user_id(token)
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    data = request.get_json() or {}
    origen = data.get("source", "").strip()
    destino = data.get("destination", "").strip()
    
    if not origen or not destino:
        return jsonify({"ok": False, "error": "Faltan directorios de origen o destino."}), 400

    save_backup_config(user_id, origen, destino)

    result = realizar_backup(origen, destino)
    return jsonify({"ok": True, "result": result})

@backup_bp.route("/api/backup/browse", methods=["POST"])
def api_backup_browse():
    """Abre un diálogo nativo para seleccionar una carpeta."""
    token = request.args.get("token") or request.cookies.get("token")
    if not session.get_user_id(token):
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    import tkinter as tk
    from tkinter import filedialog
    
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        
        directory = filedialog.askdirectory(title="Seleccionar Carpeta")
        root.destroy()
        
        if directory:
            return jsonify({"ok": True, "path": directory})
        return jsonify({"ok": False, "error": "Cancelado"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500