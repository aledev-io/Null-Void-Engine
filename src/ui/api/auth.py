import uuid
from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from core.database import get_db
from ui.session import session, security, audit
from ui.users import load_users

from ui.api.cloud import init_user_cloud
from datetime import datetime, timedelta

auth_bp = Blueprint("auth", __name__)

@auth_bp.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    user = (data.get("username") or "").strip()
    pwd  = data.get("password") or ""
    ip   = request.remote_addr

    if security.is_blocked(ip):
        audit.log("BLOCK", user or "DESCONOCIDO", ip, "Intento de acceso desde IP bloqueada")
        return jsonify({"ok": False, "error": "Demasiados intentos. Bloqueado temporalmente (15 min)"}), 429

    # Obtener user_id y contraseña guardada de la BD
    user_id = None
    stored_password = None
    with get_db() as conn:
        row = conn.execute("SELECT user_id, password FROM users WHERE username = ?", (user,)).fetchone()
        if row:
            user_id = row['user_id']
            stored_password = row['password']

    # Verificación estricta (Solo Hash)
    if not stored_password or ":" not in stored_password:
        security.record_failure(ip)
        audit.log("FAIL", user, ip, "Usuario no existe o no tiene hash")
        return jsonify({"ok": False, "error": "Usuario o contraseña incorrectos"}), 401

    if not check_password_hash(stored_password, pwd):
        security.record_failure(ip)
        audit.log("FAIL", user, ip, "Contraseña incorrecta")
        return jsonify({"ok": False, "error": "Usuario o contraseña incorrectos"}), 401

    # Si el login es exitoso, reseteamos intentos para esa IP en la tabla hash
    security.reset(ip)
    audit.log("LOGIN", user, ip, "Inicio de sesión exitoso")

    token = session.create(user, user_id=user_id)
    response = jsonify({"ok": True, "user": user, "user_id": user_id, "token": token})
    # Duración de la cookie: 2 horas (igual al timeout de sesión)
    max_age = 7200
    response.set_cookie("token", token, httponly=True, samesite='Lax', max_age=max_age)
    response.set_cookie("user", user, httponly=False, samesite='Lax', max_age=max_age)
    return response

@auth_bp.route("/api/logout", methods=["POST"])
def api_logout():
    ip = request.remote_addr
    token = request.cookies.get("token") or request.args.get("token")
    user = session.get_user(token)
    if user:
        audit.log("LOGOUT", user, ip, "Cierre de sesión")
    session.destroy(token)
    response = jsonify({"ok": True})
    response.delete_cookie("token")
    response.delete_cookie("user")
    return response

@auth_bp.route("/api/online", methods=["GET"])
def api_online():
    token = request.cookies.get("token") or request.args.get("token")
    if not session.get_user(token):
        return jsonify(error="No autorizado"), 401
    return jsonify({
        "ok": True,
        "online": session.online_users(),
        "count": len(session.online_users())
    })

@auth_bp.route("/api/register", methods=["POST"])
def api_register():
    ip = request.remote_addr
    data = request.get_json(silent=True) or {}
    user = (data.get("username") or "").strip()
    pwd  = data.get("password") or ""

    if not user or not pwd:
        return jsonify({"ok": False, "error": "Usuario y contraseña requeridos"}), 400

    try:
        new_user_id = f"NV-{str(uuid.uuid4())[:8].upper()}"
        with get_db() as conn:
            # Evitar duplicados
            existing = conn.execute("SELECT username FROM users WHERE username = ?", (user,)).fetchone()
            if existing:
                return jsonify({"ok": False, "error": "Usuario ya existe"}), 409

            # Cifrar contraseña antes de guardar
            hashed_pwd = generate_password_hash(pwd)
            conn.execute("INSERT INTO users (username, password, user_id) VALUES (?, ?, ?)", 
                         (user, hashed_pwd, new_user_id))
            conn.commit()
            
            # Inicializar Cloud
            init_user_cloud(new_user_id)
            audit.log("REGISTER", user, ip, f"Nuevo usuario registrado con ID {new_user_id}")
    except Exception as e:
        return jsonify({"ok": False, "error": f"Error al registrar: {str(e)}"}), 500

    return jsonify({"ok": True, "msg": "Usuario creado", "user_id": new_user_id})

@auth_bp.route("/api/security/logs", methods=["GET"])
def api_security_logs():
    token = request.cookies.get("token") or request.args.get("token")
    if not session.get_user(token):
        return jsonify(error="No autorizado"), 401
    return jsonify(audit.get_logs())