from flask import Blueprint, request, jsonify
from ui.session import session
from core.dashboard import get_snapshot

metrics_bp = Blueprint("metrics", __name__)


@metrics_bp.route("/api/metrics")
def api_metrics():
    token = request.cookies.get("token")
    if not token:
        token = request.args.get("token")
    if not token:
        token = request.headers.get("X-Token")

    tab_id = request.args.get("tabId") or request.headers.get("X-Tab-Id")
    status = session.validate(token, tab_id)
    
    if status == 401:
        return jsonify({"ok": False, "error": "No autorizado"}), 401
    if status == 403:
        return jsonify({"ok": False, "error": "Ya tienes una pestaña activa"}), 403

    data = get_snapshot()
    return jsonify({"ok": True, **data})