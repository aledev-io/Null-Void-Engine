from flask import Blueprint, jsonify, request
import os
import signal
import json
from ui.session import session, audit

system_bp = Blueprint('system', __name__, url_prefix='/api/system')

MODULES_CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'modules.json')

import platform
system_name = platform.system()

# Catálogo completo de módulos disponibles
ALL_MODULES = [
    {"id": "monitor", "name": "Telemetría", "icon": "📊", "desc": "Monitorización en tiempo real.", "core": True},
    {"id": "calendar", "name": "Calendario", "icon": "📅", "desc": "Eventos y tareas.", "url": "/calendar", "core": True},
    {"id": "admin", "name": "Recordatorios", "icon": "🛡️", "desc": "Gestión del motor.", "core": True},
    {"id": "marketplace", "name": "Tienda Apps", "icon": "🏪", "desc": "Instala nuevos módulos.", "core": True},
    {"id": "invoices", "name": "ERP Facturación", "icon": "📑", "desc": "Facturas y OCR."},
    {"id": "transactions", "name": "Contabilidad", "icon": "💰", "desc": "Control de gastos."},
    {"id": "cloud", "name": "Null-Void Cloud", "icon": "📂", "desc": "Almacenamiento personal.", "core": True},
    {"id": "backups", "name": "Backups", "icon": "💾", "desc": "Respaldos del sistema.", "core": True},
]

# Registro del módulo de Excel (Presupuestos)
ALL_MODULES.insert(3, {"id": "budgets", "name": "Excel", "icon": "🧮", "desc": "Excel con Python."})

def load_installed_modules(username):
    from core.database import get_db
    try:
        with get_db() as conn:
            row = conn.execute("SELECT modules FROM users WHERE username = ?", (username,)).fetchone()
            if row and row['modules']:
                return json.loads(row['modules'])
    except Exception as e:
        print(f"[System] Error cargando módulos para {username}: {e}")
    
    # Fallback: todos los módulos core
    return [m["id"] for m in ALL_MODULES if m.get("core")]

def save_installed_modules(username, modules_list):
    from core.database import get_db
    try:
        with get_db() as conn:
            conn.execute("UPDATE users SET modules = ? WHERE username = ?", (json.dumps(modules_list), username))
            conn.commit()
    except Exception as e:
        print(f"[System] Error guardando módulos para {username}: {e}")

@system_bp.route('/apps', methods=['GET'])
def get_apps():
    token = request.cookies.get('token')
    user = session.get_user(token)
    if not user:
        return jsonify(error="No autorizado"), 401
        
    installed = load_installed_modules(user)
    # Solo devolver los que están en la lista de instalados
    return jsonify([m for m in ALL_MODULES if m["id"] in installed])

@system_bp.route('/marketplace', methods=['GET'])
def get_marketplace():
    token = request.cookies.get('token')
    user = session.get_user(token)
    if not user:
        return jsonify(error="No autorizado"), 401
        
    installed = load_installed_modules(user)
    # Devolver todos con su estado de instalación
    data = []
    for m in ALL_MODULES:
        item = m.copy()
        item["installed"] = m["id"] in installed
        data.append(item)
    return jsonify(data)

@system_bp.route('/marketplace/install', methods=['POST'])
def install_module():
    token = request.cookies.get('token')
    user = session.get_user(token)
    if not user:
        return jsonify(error="No autorizado"), 401

    module_id = request.get_json().get('id')
    installed = load_installed_modules(user)
    if module_id not in installed:
        installed.append(module_id)
        save_installed_modules(user, installed)
        audit.log("MODULE_INSTALL", user, request.remote_addr, f"Módulo instalado: {module_id}")
    return jsonify(ok=True)

@system_bp.route('/marketplace/uninstall', methods=['POST'])
def uninstall_module():
    token = request.cookies.get('token')
    user = session.get_user(token)
    if not user:
        return jsonify(error="No autorizado"), 401

    module_id = request.get_json().get('id')
    # No permitir desinstalar módulos core
    is_core = any(m["id"] == module_id and m.get("core") for m in ALL_MODULES)
    if is_core:
        return jsonify(error="No se puede desinstalar un módulo del sistema"), 400
        
    installed = load_installed_modules(user)
    if module_id in installed:
        installed.remove(module_id)
        save_installed_modules(user, installed)
        audit.log("MODULE_UNINSTALL", user, request.remote_addr, f"Módulo desinstalado: {module_id}")
    return jsonify(ok=True)

@system_bp.route('/reorder', methods=['POST'])
def reorder_modules():
    token = request.cookies.get('token')
    user = session.get_user(token)
    if not user:
        return jsonify(error="No autorizado"), 401

    data = request.get_json()
    new_order = data.get('modules', [])
    if not new_order:
        return jsonify({"ok": False, "error": "Lista de módulos vacía"}), 400
    
    save_installed_modules(user, new_order)
    return jsonify({"ok": True})

@system_bp.route('/shutdown', methods=['POST'])
def shutdown():
    # Eliminamos el check de sesión para permitir el apagado desde la pantalla de login
    # Dado que es una aplicación local, esto permite al usuario cerrar el servidor sin loguearse.
    
    # Intentamos apagar de forma segura
    # Usamos un hilo para dar tiempo a que se envíe la respuesta antes de matar el proceso
    import threading
    import time

    def delayed_shutdown():
        # Apagado inmediato y forzoso
        print("\n[!] Solicitud de apagado recibida. Cerrando terminal...")
        os._exit(0)

    try:
        audit.log("SHUTDOWN", "SYSTEM", request.remote_addr, "El servidor se está apagando")
        threading.Thread(target=delayed_shutdown).start()
        return jsonify(ok=True, message='Apagando servidor...')
    except Exception as e:
        return jsonify(error=str(e)), 500

AVATARS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data', 'avatars')
os.makedirs(AVATARS_DIR, exist_ok=True)

@system_bp.route('/user/avatar/upload', methods=['POST'])
def upload_avatar():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    current_user = session.get_user(token)
    if not current_user:
        return jsonify(error="No autenticado"), 401

    if 'avatar' not in request.files:
        return jsonify(error="No se encontró el archivo"), 400

    file = request.files['avatar']
    if file.filename == '':
        return jsonify(error="Nombre de archivo vacío"), 400

    # Guardar como <username>.png (o el formato original, pero mejor estandarizar)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.png', '.jpg', '.jpeg', '.gif', '.webp']:
        return jsonify(error="Formato no permitido"), 400

    save_path = os.path.join(AVATARS_DIR, f"{current_user}{ext}")
    
    # Eliminar otros formatos previos del mismo usuario
    for f in os.listdir(AVATARS_DIR):
        if f.startswith(f"{current_user}."):
            os.remove(os.path.join(AVATARS_DIR, f))
            
    file.save(save_path)
    return jsonify(ok=True, url=f"/api/system/user/avatar/{current_user}?v={int(os.path.getmtime(save_path))}")

@system_bp.route('/user/avatar/<username>', methods=['GET'])
def get_avatar(username):
    # Buscar el archivo del usuario
    for f in os.listdir(AVATARS_DIR):
        if f.startswith(f"{username}."):
            from flask import send_from_directory
            return send_from_directory(AVATARS_DIR, f)
    
    # Si no existe, devolver 404 (el frontend usará la inicial)
    return "No avatar", 404

@system_bp.route('/notifications/history', methods=['GET'])
def get_notifications_history():
    from ui.session import session as sess
    from core.database import DB_PATH
    
    token = request.cookies.get('token') or request.args.get('token')
    user = sess.get_user(token)
    user_id = sess.get_user_id(token)
    
    if not user:
        return jsonify(error="No autenticado"), 401

    try:
        # Ruta personalizada por ID de usuario
        user_history_path = os.path.join(os.path.dirname(DB_PATH), f'notifications_{user_id or "admin"}.json')
        
        if not os.path.exists(user_history_path):
            return jsonify([])
            
        with open(user_history_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return jsonify(data)
    except Exception as e:
        return jsonify(error=str(e)), 500


@system_bp.route('/notifications/delete', methods=['POST'])
def delete_notification():
    from core.notifications import HISTORY_PATH
    from ui.session import session as sess
    
    token = request.cookies.get('token') or request.args.get('token') or request.headers.get('X-Token')
    current_user = sess.get_user(token)
    
    if not current_user:
        return jsonify(error="No autenticado"), 401

    data = request.get_json()
    notif_id = data.get('id')
    if not notif_id:
        return jsonify(error="ID faltante"), 400

    try:
        if not os.path.exists(HISTORY_PATH):
            return jsonify(ok=True)
            
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history = json.load(f)
            
        # Filtrar: dejamos todas menos la que queremos borrar (y que pertenezca al usuario)
        new_history = [n for n in history if not (n.get('id') == notif_id and n.get('user') == current_user)]
        
        with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
            json.dump(new_history, f, indent=2, ensure_ascii=False)
            
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@system_bp.route('/notifications/clear', methods=['POST'])
def clear_notifications():
    from core.notifications import HISTORY_PATH
    from ui.session import session as sess
    
    token = request.cookies.get('token') or request.args.get('token') or request.headers.get('X-Token')
    current_user = sess.get_user(token)
    
    if not current_user:
        return jsonify(error="No autenticado"), 401

    try:
        if not os.path.exists(HISTORY_PATH):
            return jsonify(ok=True)
            
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history = json.load(f)
            
        # Filtrar: dejamos solo las que NO son del usuario actual
        new_history = [n for n in history if n.get('user') != current_user]
        
        with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
            json.dump(new_history, f, indent=2, ensure_ascii=False)
            
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500
@system_bp.route('/user/info', methods=['GET'])
def get_user_info():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    current_user = session.get_user(token)
    if not current_user:
        return jsonify(error="No autenticado"), 401

    from core.database import get_db
    with get_db() as conn:
        row = conn.execute("SELECT username, email, user_id FROM users WHERE username = ?", (current_user,)).fetchone()
        if row:
            return jsonify(username=row['username'], email=row['email'] or f"{row['username'].lower()}@null-void.app", user_id=row['user_id'])
    return jsonify(error="Usuario no encontrado"), 404

@system_bp.route('/user/update', methods=['POST'])
def update_user_profile():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    current_user = session.get_user(token)
    if not current_user:
        return jsonify(error="No autenticado"), 401

    data = request.get_json()
    new_username = data.get('username')
    new_email = data.get('email')

    if not new_username:
        return jsonify(error="El nombre de usuario es obligatorio"), 400

    from core.database import get_db
    try:
        with get_db() as conn:
            # Si el username cambia, verificar que no esté ocupado
            if new_username != current_user:
                existing = conn.execute("SELECT username FROM users WHERE username = ?", (new_username,)).fetchone()
                if existing:
                    return jsonify(error="El nombre de usuario ya está en uso"), 409
                
                # Actualizar nombre en la tabla users
                conn.execute("UPDATE users SET username = ?, email = ? WHERE username = ?", (new_username, new_email, current_user))
                
                # Actualizar la sesión activa
                session._sessions[token]['username'] = new_username
                if current_user in session._user_index:
                    del session._user_index[current_user]
                session._user_index[new_username] = token
                session._save()
            else:
                # Solo actualizar email
                conn.execute("UPDATE users SET email = ? WHERE username = ?", (new_email, current_user))
            
            conn.commit()
            audit.log("PROFILE_UPDATE", new_username, request.remote_addr, f"Perfil actualizado (Email: {new_email})")
            return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@system_bp.route('/user/password', methods=['POST'])
def update_password():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    current_user = session.get_user(token)
    if not current_user:
        return jsonify(error="No autenticado"), 401

    data = request.get_json()
    old_pass = data.get('old_password')
    new_pass = data.get('new_password')

    if not old_pass or not new_pass:
        return jsonify(error="Datos incompletos"), 400

    from werkzeug.security import generate_password_hash, check_password_hash
    from core.database import get_db
    with get_db() as conn:
        user_row = conn.execute("SELECT password FROM users WHERE username = ?", (current_user,)).fetchone()
        if not user_row:
            return jsonify(error="Usuario no encontrado"), 404
        
        stored_password = user_row['password']
        
        # Verificar contraseña actual (Solo Hash)
        if ":" in stored_password:
            valid = check_password_hash(stored_password, old_pass)
        else:
            valid = False

            
        if not valid:
            return jsonify(error="La contraseña actual es incorrecta"), 403
        
        # Cifrar la nueva contraseña
        new_hashed = generate_password_hash(new_pass)
        conn.execute("UPDATE users SET password = ? WHERE username = ?", (new_hashed, current_user))
        conn.commit()
        audit.log("PASSWORD_CHANGE", current_user, request.remote_addr, "Contraseña actualizada exitosamente")
        return jsonify(ok=True)
