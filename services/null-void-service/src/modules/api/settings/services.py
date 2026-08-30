import os
import json
from config.config import CONFIG

def get_user_config_path(user_id):
    return os.path.join(CONFIG.DATA_DIR, f"config_{user_id}.json")

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
    except (json.JSONDecodeError, OSError):
        return defaults

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
