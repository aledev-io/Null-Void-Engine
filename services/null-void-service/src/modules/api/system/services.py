import json
import os
import random
import shlex
import signal
import subprocess
from flask import request
from modules.session import session as sess, audit
from werkzeug.security import generate_password_hash, check_password_hash
from config.config import CONFIG
from .repository import (
    ALL_MODULES, load_installed_modules, save_installed_modules,
    get_user_by_id, get_user_password, update_username, update_password,
    check_username_exists,
)

AVATARS_DIR = os.path.join(CONFIG.DATA_DIR, 'avatars')
os.makedirs(AVATARS_DIR, exist_ok=True)


def _safe_filename(basename):
    return "".join(c for c in basename if c.isalnum() or c in '._-').strip()


def _check_token():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    user_id = sess.get_user_id(token)
    return token, user, user_id


def get_installed_apps(token):
    user = sess.get_user(token)
    if not user:
        return None
    installed = load_installed_modules(user)
    apps = [m for m in ALL_MODULES if m["id"] in installed]
    if user == 'admin':
        apps.append({"id": "server_admin", "name": "Admin Servidor", "icon": "⚙️", "desc": "Administración del servidor y cuotas.", "core": True})
    return apps


def get_marketplace(token):
    user = sess.get_user(token)
    if not user:
        return None
    installed = load_installed_modules(user)
    data = []
    for m in ALL_MODULES:
        item = dict(m)
        item["installed"] = m["id"] in installed
        data.append(item)
    return data


def install_module(token, module_id):
    user = sess.get_user(token)
    if not user:
        return None
    installed = load_installed_modules(user)
    if module_id not in installed:
        installed.append(module_id)
        save_installed_modules(user, installed)
        audit.log("MODULE_INSTALL", user, request.remote_addr,
                  f"Módulo instalado: {module_id}")
    return True


def uninstall_module(token, module_id):
    user = sess.get_user(token)
    if not user:
        return None
    is_core = any(m["id"] == module_id and m.get("core") for m in ALL_MODULES)
    if is_core:
        return "No se puede desinstalar un módulo del sistema"
    installed = load_installed_modules(user)
    if module_id in installed:
        installed.remove(module_id)
        save_installed_modules(user, installed)
        audit.log("MODULE_UNINSTALL", user, request.remote_addr,
                  f"Módulo desinstalado: {module_id}")
    return True


def reorder_modules(token, new_order):
    user = sess.get_user(token)
    if not user:
        return None
    if not new_order:
        return "Lista de módulos vacía"
    save_installed_modules(user, new_order)
    return True


def upload_avatar(token, file_storage):
    user_id = sess.get_user_id(token)
    if not user_id:
        return None

    ext = os.path.splitext(file_storage.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
        return "Formato no permitido"

    safe_id = "".join(c for c in user_id if c.isalnum() or c in '._-')
    for f in os.listdir(AVATARS_DIR):
        if f.startswith(f"{safe_id}."):
            os.remove(os.path.join(AVATARS_DIR, f))

    save_path = os.path.join(AVATARS_DIR, f"{safe_id}{ext}")
    file_storage.save(save_path)
    return {"url": f"/api/system/user/avatar/{user_id}?v={int(os.path.getmtime(save_path))}"}


GROUPS_AVATAR_DIR = os.path.join(CONFIG.DATA_DIR, 'chat', 'groups')
os.makedirs(GROUPS_AVATAR_DIR, exist_ok=True)

def get_avatar_path(identifier):
    for f in os.listdir(AVATARS_DIR):
        if f.startswith(f"{identifier}."):
            return os.path.join(AVATARS_DIR, f)
            
    if os.path.exists(GROUPS_AVATAR_DIR):
        for f in os.listdir(GROUPS_AVATAR_DIR):
            if f.startswith(f"{identifier}."):
                return os.path.join(GROUPS_AVATAR_DIR, f)
                
    return None


def get_notifications_history(token):
    from core.database import DB_PATH
    _, user, user_id = _check_token()
    if not user:
        return None
    path = os.path.join(os.path.dirname(DB_PATH),
                        f'notifications_{user_id or "admin"}.json')
    if not os.path.exists(path):
        return []
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def delete_notification(token, notif_id):
    from core.database import DB_PATH
    _, user, user_id = _check_token()
    if not user:
        return None
    if not notif_id:
        return "ID faltante"
    
    path = os.path.join(os.path.dirname(DB_PATH), f'notifications_{user_id or "admin"}.json')
    if not os.path.exists(path):
        return True
        
    with open(path, 'r', encoding='utf-8') as f:
        history = json.load(f)
        
    # El notif_id que viene del frontend puede ser el timestamp
    new_history = [n for n in history if n.get('timestamp') != notif_id and n.get('id') != notif_id]
    
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(new_history, f, indent=2, ensure_ascii=False)
    return True


def clear_notifications(token):
    from core.database import DB_PATH
    _, user, user_id = _check_token()
    if not user:
        return None
        
    path = os.path.join(os.path.dirname(DB_PATH), f'notifications_{user_id or "admin"}.json')
    if not os.path.exists(path):
        return True
        
    with open(path, 'w', encoding='utf-8') as f:
        json.dump([], f, indent=2, ensure_ascii=False)
    return True


def get_user_info(token):
    user_id = sess.get_user_id(token)
    if not user_id:
        return None
    row = get_user_by_id(user_id)
    if row:
        return {"username": row['username'], "email": row['email'], "user_id": row['user_id']}
    return None


def update_user_profile(token, new_username):
    user_id = sess.get_user_id(token)
    current_user = sess.get_user(token)
    if not user_id:
        return None
    if not new_username:
        return "El nombre de usuario es obligatorio"

    if new_username != current_user and check_username_exists(new_username):
        suggestions = [
            f"{new_username}{random.randint(10,99)}",
            f"{new_username}{random.randint(100,999)}",
            f"{new_username}_{random.randint(1,9)}",
        ]
        return f"El nombre de usuario ya está en uso. Prueba con: {', '.join(suggestions)}"

    new_email = f"{new_username.lower().replace(' ', '')}@nullvoid"
    update_username(user_id, new_username, new_email)

    if new_username != current_user:
        # Migrar avatar legado si existe
        safe_old_user = "".join(c for c in current_user if c.isalnum() or c in '._-')
        safe_id = "".join(c for c in user_id if c.isalnum() or c in '._-')
        for ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
            old_path = os.path.join(AVATARS_DIR, f"{safe_old_user}{ext}")
            new_path = os.path.join(AVATARS_DIR, f"{safe_id}{ext}")
            if os.path.exists(old_path) and not os.path.exists(new_path):
                try:
                    os.rename(old_path, new_path)
                except Exception:
                    pass

        sessions = sess._sessions
        index = sess._user_index
        if token in sessions:
            sessions[token]['username'] = new_username
        if current_user in index:
            del index[current_user]
        index[new_username] = token
        sess._save()

    audit.log("PROFILE_UPDATE", new_username, request.remote_addr,
              "Perfil actualizado (Username modificado)")
    return True


def update_password(token, old_pass, new_pass):
    user_id = sess.get_user_id(token)
    current_user = sess.get_user(token)
    if not user_id:
        return None
    if not old_pass or not new_pass:
        return "Datos incompletos"

    stored = get_user_password(user_id)
    if not stored:
        return "Usuario no encontrado"

    if ":" in stored:
        valid = check_password_hash(stored, old_pass)
    else:
        valid = False

    if not valid:
        return "La contraseña actual es incorrecta"

    new_hashed = generate_password_hash(new_pass)
    update_password(user_id, new_hashed)
    audit.log("PASSWORD_CHANGE", current_user, request.remote_addr,
              "Contraseña actualizada exitosamente")
    return True


_REBOOT_CMD = ["sudo", "/sbin/reboot"]
_SHUTDOWN_CMD = ["sudo", "/sbin/shutdown", "-h", "now"]
_ALLOWED_ACTIONS = {"reboot": _REBOOT_CMD, "shutdown": _SHUTDOWN_CMD}


def system_action(action):
    if action not in _ALLOWED_ACTIONS:
        return None, "Acción no permitida"
    try:
        subprocess.run(_ALLOWED_ACTIONS[action], check=True, timeout=10)
        return True, None
    except subprocess.TimeoutExpired:
        return None, "Comando agotó el tiempo de espera"
    except subprocess.CalledProcessError as e:
        return None, f"Error ejecutando comando: {e}"
    except FileNotFoundError:
        return None, "Comando no disponible en el sistema"
    except Exception as e:
        return None, str(e)


def system_status():
    info = {
        "hostname": os.uname().nodename,
        "platform": os.uname().sysname,
        "release": os.uname().release,
        "python": __import__("sys").version,
    }
    daemons = {}
    for name in ["docker", "nginx", "postgresql", "redis-server", "ollama"]:
        try:
            r = subprocess.run(
                ["systemctl", "is-active", name],
                capture_output=True, text=True, timeout=5
            )
            daemons[name] = r.stdout.strip()
        except Exception:
            daemons[name] = "unknown"
    info["daemons"] = daemons
    return info

def get_all_users_admin():
    from core.database import get_db
    with get_db() as conn:
        users = conn.execute("SELECT username, email, quota_gb, user_id FROM users").fetchall()
    
    active_users = [u['username'] for u in sess.online_users()]
    
    result = []
    for u in users:
        result.append({
            "username": u["username"],
            "email": u["email"],
            "quota_gb": u["quota_gb"],
            "user_id": u["user_id"],
            "is_online": u["username"] in active_users,
            "last_activity": sess.get_last_activity(u["username"])
        })
    return result

def set_user_quota_admin(uid, quota):
    from core.database import get_db
    with get_db() as conn:
        conn.execute("UPDATE users SET quota_gb = ? WHERE user_id = ?", (quota, uid))
        conn.commit()
