from flask import jsonify, request, abort
from modules.session import session
from . import settings_bp
from .services import load_settings, save_settings_internal

@settings_bp.route("/api/settings", methods=["GET"])
def get_settings():
    token = request.cookies.get("token") or request.headers.get("X-Token")
    uid = session.get_user_id(token)
    if not uid: 
        return jsonify(error="No autorizado"), 401
    
    try:
        return jsonify(load_settings(uid))
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@settings_bp.route("/api/settings", methods=["POST"])
def save_settings():
    token = request.cookies.get("token") or request.headers.get("X-Token")
    uid = session.get_user_id(token)
    if not uid: 
        return jsonify(error="No autorizado"), 401
    
    try:
        new_settings = request.get_json()
        if save_settings_internal(uid, new_settings):
            return jsonify(ok=True)
        else:
            return jsonify(error="Error interno al guardar"), 500
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500
