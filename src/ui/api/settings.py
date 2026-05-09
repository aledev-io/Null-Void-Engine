import os
import json
from flask import Blueprint, request, jsonify
from ui.session import session

settings_bp = Blueprint("settings", __name__)

def get_user_config_path(user_id):
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", f"config_{user_id}.json")

def load_settings(user_id):
    path = get_user_config_path(user_id)
    defaults = {
        "ui": {
            "theme": "dark",
            "brightness": 100,
            "zoom": 100
        },
        "backup": {
            "source": "",
            "destination": ""
        }
    }
    
    if not os.path.exists(path):
        return defaults
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return defaults

@settings_bp.route("/api/settings", methods=["GET"])
def get_settings():
    token = request.args.get("token") or request.cookies.get("token")
    uid = session.get_user_id(token)
    if not uid: return jsonify(error="No autorizado"), 401
    
    return jsonify(load_settings(uid))

def save_settings_internal(user_id, new_settings):
    path = get_user_config_path(user_id)
    try:
        current = load_settings(user_id)
        
        if "ui" in new_settings:
            current["ui"].update(new_settings["ui"])
        if "backup" in new_settings:
            current["backup"].update(new_settings["backup"])
            
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=4)
        return True
    except Exception as e:
        print(f"Error guardando ajustes para {user_id}: {e}")
        return False

@settings_bp.route("/api/settings", methods=["POST"])
def save_settings():
    token = request.args.get("token") or request.cookies.get("token")
    uid = session.get_user_id(token)
    if not uid: return jsonify(error="No autorizado"), 401
    
    new_settings = request.get_json()
    if save_settings_internal(uid, new_settings):
        return jsonify(ok=True)
    else:
        return jsonify(error="Error interno al guardar"), 500
