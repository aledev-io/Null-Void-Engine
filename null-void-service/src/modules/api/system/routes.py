import os
from flask import Blueprint, jsonify, request, send_from_directory
from modules.session import session as sess
from core.limiter import limiter
from . import services

system_bp = Blueprint('system', __name__, url_prefix='/api/system')


@system_bp.route('/apps', methods=['GET'])
def get_apps():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    apps = services.get_installed_apps(token)
    if apps is None:
        return jsonify(error="No autorizado"), 401
    return jsonify(apps)


@system_bp.route('/marketplace', methods=['GET'])
def get_marketplace():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    data = services.get_marketplace(token)
    if data is None:
        return jsonify(error="No autorizado"), 401
    return jsonify(data)


@system_bp.route('/marketplace/install', methods=['POST'])
def install_module():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    module_id = request.get_json().get('id')
    result = services.install_module(token, module_id)
    if result is None:
        return jsonify(error="No autorizado"), 401
    return jsonify(ok=True)
@system_bp.route('/settings/save', methods=['POST'])
def save_setting():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    data = request.get_json()
    key = data.get('key')
    value = data.get('value')
    result = services.save_setting(token, key, value)
    if 'error' in result:
        return jsonify(error=result['error']), 401 if result['error'] == 'No autorizado' else 400
    return jsonify(success=True)



@system_bp.route('/webpush/vapid_public_key', methods=['GET'])
def get_vapid_public_key():
    from core.webpush_utils import get_or_create_vapid_keys
    keys = get_or_create_vapid_keys()
    return jsonify({"public_key": keys['public_key']})


@system_bp.route('/webpush/subscribe', methods=['POST'])
def subscribe_webpush():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user_id = sess.get_user_id(token)
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.json
    subscription = data.get('subscription')
    if not subscription:
        return jsonify(error="Subscription info missing"), 400
        
    endpoint = subscription.get('endpoint')
    keys = subscription.get('keys', {})
    p256dh = keys.get('p256dh')
    auth = keys.get('auth')
    
    if not endpoint or not p256dh or not auth:
        return jsonify(error="Invalid subscription format"), 400
        
    import time
    from core.database import get_db
    import sqlite3
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO webpush_subs 
                   (user_id, endpoint, p256dh, auth, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, endpoint, p256dh, auth, time.time())
            )
            conn.commit()
        return jsonify(success=True)
    except sqlite3.IntegrityError as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"FOREIGN KEY constraint failed for user_id={repr(user_id)}: {str(e)}"), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=str(e)), 500

@system_bp.route('/fcm/subscribe', methods=['POST'])
def subscribe_fcm():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user_id = sess.get_user_id(token)
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.json
    fcm_token = data.get('token')
    
    if not fcm_token:
        return jsonify(error="Token missing"), 400
        
    import time
    from core.database import get_db
    import sqlite3
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO fcm_subs 
                   (user_id, token, created_at)
                   VALUES (?, ?, ?)""",
                (user_id, fcm_token, time.time())
            )
            conn.commit()
        return jsonify(success=True)
    except sqlite3.IntegrityError as e:
        return jsonify(error=f"Integrity Error: {str(e)}"), 500
    except Exception as e:
        return jsonify(error=str(e)), 500

@system_bp.route('/fcm/unsubscribe', methods=['POST'])
def unsubscribe_fcm():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user_id = sess.get_user_id(token)
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.json
    fcm_token = data.get('token')
    
    if not fcm_token:
        return jsonify(error="Token missing"), 400
        
    from core.database import get_db
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM fcm_subs WHERE token = ?", (fcm_token,))
            conn.commit()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@system_bp.route('/webpush/unsubscribe', methods=['POST'])
def unsubscribe_webpush():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user_id = sess.get_user_id(token)
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.json
    endpoint = data.get('endpoint')
    if not endpoint:
        return jsonify(error="Endpoint missing"), 400
        
    from core.database import get_db
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM webpush_subs WHERE user_id = ? AND endpoint = ?", (user_id, endpoint))
            conn.commit()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@system_bp.route('/marketplace/uninstall', methods=['POST'])
def uninstall_module():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    module_id = request.get_json().get('id')
    result = services.uninstall_module(token, module_id)
    if result is None:
        return jsonify(error="No autorizado"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@system_bp.route('/reorder', methods=['POST'])
def reorder_modules():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    data = request.get_json()
    new_order = data.get('modules', [])
    result = services.reorder_modules(token, new_order)
    if result is None:
        return jsonify(error="No autorizado"), 401
    if isinstance(result, str):
        return jsonify({"ok": False, "error": result}), 400
    return jsonify({"ok": True})


@system_bp.route('/user/avatar/upload', methods=['POST'])
def upload_avatar():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if 'avatar' not in request.files:
        return jsonify(error="No se encontró el archivo"), 400
    file = request.files['avatar']
    if file.filename == '':
        return jsonify(error="Nombre de archivo vacío"), 400
    result = services.upload_avatar(token, file)
    if result is None:
        return jsonify(error="No autenticado"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True, url=result["url"])


@system_bp.route('/user/avatar/<identifier>', methods=['GET'])
@limiter.exempt
def get_avatar(identifier):
    path = services.get_avatar_path(identifier)
    
    if not path:
        from core.database import get_db
        with get_db() as conn:
            # Maybe identifier is a username? Look up user_id
            row = conn.execute("SELECT user_id FROM users WHERE username = ?", (identifier,)).fetchone()
            if row:
                path = services.get_avatar_path(row['user_id'])
                
            # If still not found, maybe identifier is a user_id, and the file is saved as username (legacy)?
            if not path:
                row = conn.execute("SELECT username FROM users WHERE user_id = ?", (identifier,)).fetchone()
                if row:
                    path = services.get_avatar_path(row['username'])
                    
    if path:
        return send_from_directory(os.path.dirname(path), os.path.basename(path))
    return "", 204




@system_bp.route('/notifications/history', methods=['GET'])
@limiter.exempt
def get_notifications_history():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    result = services.get_notifications_history(token)
    if result is None:
        return jsonify(error="No autenticado"), 401
    return jsonify(result)


@system_bp.route('/notifications/delete', methods=['POST'])
def delete_notification():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    notif_id = request.get_json().get('id')
    result = services.delete_notification(token, notif_id)
    if result is None:
        return jsonify(error="No autenticado"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@system_bp.route('/notifications/clear', methods=['POST'])
def clear_notifications():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    result = services.clear_notifications(token)
    if result is None:
        return jsonify(error="No autenticado"), 401
    return jsonify(ok=True)


@system_bp.route('/user/info', methods=['GET'])
def get_user_info():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    info = services.get_user_info(token)
    if info is None:
        return jsonify(error="No autenticado"), 401
    return jsonify(info)


@system_bp.route('/user/update', methods=['POST'])
def update_user_profile():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    new_username = request.get_json().get('username')
    result = services.update_user_profile(token, new_username)
    if result is None:
        return jsonify(error="No autenticado"), 401
    if isinstance(result, str):
        return jsonify(error=result), 409 if "uso" in result else 400
    return jsonify(ok=True)


@system_bp.route('/user/password', methods=['POST'])
def update_password():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    data = request.get_json()
    result = services.update_password(
        token, data.get('old_password'), data.get('new_password')
    )
    if result is None:
        return jsonify(error="No autenticado"), 401
    if isinstance(result, str):
        status = 403 if "incorrecta" in result else 400
        return jsonify(error=result), status
    return jsonify(ok=True)


@system_bp.route('/reboot', methods=['POST'])
def reboot():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not sess.get_user(token):
        return jsonify(error="No autorizado"), 401
    ok, err = services.system_action("reboot")
    if not ok:
        return jsonify(error=err), 500
    return jsonify(ok=True)


@system_bp.route('/shutdown', methods=['POST'])
def shutdown():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not sess.get_user(token):
        return jsonify(error="No autorizado"), 401
    ok, err = services.system_action("shutdown")
    if not ok:
        return jsonify(error=err), 500
    return jsonify(ok=True)


@system_bp.route('/status', methods=['GET'])
def status():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not sess.get_user(token):
        return jsonify(error="No autorizado"), 401
    return jsonify(services.system_status())

@system_bp.route('/admin/users', methods=['GET'])
def get_all_users():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if sess.get_user(token) != 'admin':
        return jsonify(error="No autorizado"), 403
    return jsonify(services.get_all_users_admin())

@system_bp.route('/admin/user_quota', methods=['POST'])
def set_user_quota():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if sess.get_user(token) != 'admin':
        return jsonify(error="No autorizado"), 403
    data = request.get_json(silent=True) or {}
    uid = data.get('user_id')
    quota = data.get('quota')
    if not uid or quota is None:
        return jsonify(error="Faltan parámetros"), 400
    try:
        quota = int(quota)
    except:
        return jsonify(error="Cuota inválida"), 400
        
    services.set_user_quota_admin(uid, quota)
    from core.socket_ext import socketio
    socketio.emit('quota_updated', {}, room=f"user_{uid}")
    return jsonify(ok=True)
