from flask import Blueprint, jsonify, request
from modules.session import session as sess
from core.limiter import limiter
from . import services

metrics_bp = Blueprint("metrics", __name__, url_prefix="/api/metrics")
limiter.exempt(metrics_bp)


def _check():
    token = request.cookies.get("token")
    if not token:
        token = request.cookies.get("token") or request.headers.get("X-Token")
    if not token:
        token = request.headers.get("X-Token")
    tab_id = request.args.get("tabId") or request.headers.get("X-Tab-Id")
    status = sess.validate(token, tab_id)
    if status == 401:
        return jsonify({"ok": False, "error": "No autorizado"}), 401
    if status == 403:
        return jsonify({"ok": False, "error": "Ya tienes una pestaña activa"}), 403
    return None


@metrics_bp.route("/live")
def live():
    err = _check()
    if err:
        return err
    data = services.get_live()
    users_count = len(sess.online_users())
    data["users"] = users_count
    return jsonify({"ok": True, **data})


@metrics_bp.route("/history")
def history():
    err = _check()
    if err:
        return err
    minutes = request.args.get("minutes", 5, type=int)
    return jsonify({"ok": True, "history": services.get_history(minutes)})


@metrics_bp.route("")
@metrics_bp.route("/")
def compat():
    return live()
