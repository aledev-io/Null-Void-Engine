from flask import Blueprint, request, jsonify, render_template, redirect, url_for
from modules.session import session, security, audit
from . import services
from core.socket_ext import socketio
from config.config import CONFIG

auth_bp = Blueprint("auth", __name__)

@auth_bp.route('/')
def index():
    token = request.cookies.get('token')
    if token and session.get_user(token):
        return redirect(url_for('dashboard'))
    return render_template('auth/index.html')



def _extract_token() -> str or None:
    return request.cookies.get("token") or request.headers.get("X-Token")


@auth_bp.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    user = (data.get("username") or "").strip()
    pwd = data.get("password") or ""
    ip = request.remote_addr

    if len(user) < 3 or len(pwd) < 6:
        return jsonify({"ok": False, "error_code": "err_login_format", "error": "Acceso denegado. Comprueba que las credenciales cumplen con el formato requerido."}), 400

    if security.is_blocked(ip):
        audit.log("BLOCK", user or "DESCONOCIDO", ip, "Intento de acceso desde IP bloqueada")
        return jsonify({"ok": False, "error_code": "err_blocked", "error": "Demasiados intentos. Bloqueado temporalmente (15 min)"}), 429

    result, error = services.authenticate(user, pwd)
    if not result:
        security.record_failure(ip)
        audit.log("FAIL", user, ip, "Contraseña incorrecta" if "incorrectos" in error else error)
        return jsonify({"ok": False, "error_code": "err_invalid", "error": "Usuario o contraseña incorrectos"}), 401

    security.reset(ip)



    audit.log("LOGIN", result["username"], ip, "Inicio de sesión exitoso")

    # Notificar a las sesiones existentes para que se cierren antes de crear la nueva
    socketio.emit('force_logout', {}, room=f"user_{result['user_id']}")

    token = session.create(result["username"], user_id=result["user_id"])
    response = jsonify({
        "ok": True, "user": result["username"],
        "user_id": result["user_id"], "token": token,
    })
    # Cookies seguras: SameSite=Lax, Path='/', HttpOnly para el token.
    # secure se activa solo cuando la petición llegó realmente por TLS:
    # si USE_HTTPS=true pero los certs faltan y el engine cae a HTTP,
    # una cookie Secure no la enviaría el navegador y el login no funciona.
    _cookie_secure = request.is_secure
    response.set_cookie("token", token, httponly=True, secure=_cookie_secure,
                        samesite='Lax', path='/', max_age=86400)
    # 'user' es legible por JS (la UI la consulta); el token sigue siendo HttpOnly.
    response.set_cookie("user", result["username"], httponly=False, secure=_cookie_secure,
                        samesite='Lax', path='/', max_age=86400)
    return response


@auth_bp.route("/api/logout", methods=["POST"])
def api_logout():
    ip = request.remote_addr
    token = _extract_token()
    user = session.get_user(token) if token else None
    data = request.get_json(silent=True) or {}
    revoke_key = (data.get("revoke_key")
                  or request.form.get("revoke_key")
                  or request.args.get("revoke_key")
                  or "")

    if token:
        if revoke_key:
            # Soft destroy: página cerrándose, puede ser revocado
            session.soft_destroy(token, revoke_key)
        else:
            # Hard logout: el usuario ha cerrado sesión explícitamente
            if user:
                audit.log("LOGOUT", user, ip, "Cierre de sesión")
            session.destroy(token)
            
            fcm_token = data.get("fcm_token")
            if fcm_token:
                from core.database import get_db
                with get_db() as conn:
                    conn.execute("DELETE FROM fcm_subs WHERE token = ?", (fcm_token,))
            
            if user:
                socketio.emit('user_offline', {'username': user})

    response = jsonify({"ok": True})
    if not revoke_key:
        response.delete_cookie("token")
        response.delete_cookie("user")
    return response


@auth_bp.route("/api/logout/revoke", methods=["POST"])
def api_logout_revoke():
    token = _extract_token()
    data = request.get_json(silent=True) or {}
    revoke_key = data.get("revoke_key")
    if token and revoke_key and session.revoke_delete(token, revoke_key):
        return jsonify({"ok": True, "revoked": True})
    return jsonify({"ok": False, "revoked": False})


@auth_bp.route("/api/online", methods=["GET"])
def api_online():
    token = _extract_token()
    if not token or not session.get_user(token):
        return jsonify(error="No autorizado"), 401
    return jsonify({
        "ok": True,
        "online": session.online_users(),
        "count": len(session.online_users()),
    })


@auth_bp.route("/api/user/me", methods=["GET"])
def api_user_me():
    token = _extract_token()
    if not token:
        return jsonify(error="No autorizado"), 401
    user = session.get_user(token)
    user_id = session.get_user_id(token)
    if not user:
        return jsonify(error="No autorizado"), 401
        
    return jsonify({
        "username": user,
        "user_id": user_id,
        "avatar_url": f"/api/system/user/avatar/{user_id}" if user_id else None
    })


@auth_bp.route("/api/register", methods=["POST"])
def api_register():
    ip = request.remote_addr
    data = request.get_json(silent=True) or {}
    user = (data.get("username") or "").strip()
    pwd = data.get("password") or ""

    if len(user) < 3:
        return jsonify({"ok": False, "error_code": "err_user_short", "error": "El nombre de usuario es demasiado corto (mínimo 3 caracteres)"}), 400

    if len(pwd) < 6:
        return jsonify({"ok": False, "error_code": "err_pass_short", "error": "La contraseña es demasiado corta (mínimo 6 caracteres)"}), 400

    result, error = services.create_user(user, pwd)
    if not result:
        err_code = error.get("code") if isinstance(error, dict) else "err_server"
        err_msg = error.get("msg") if isinstance(error, dict) else error
        suggestions = error.get("suggestions") if isinstance(error, dict) else []
        return jsonify({"ok": False, "error_code": err_code, "error": err_msg, "suggestions": suggestions}), 409 if "uso" in err_msg else 500

    audit.log("REGISTER", user, ip, f"Nuevo usuario registrado con ID {result['user_id']}")
    return jsonify({"ok": True, "msg": "Usuario creado con éxito", "user_id": result["user_id"]})


@auth_bp.route("/api/security/logs", methods=["GET"])
def api_security_logs():
    token = _extract_token()
    if not token or not session.get_user(token):
        return jsonify(error="No autorizado"), 401
    return jsonify(audit.get_logs())