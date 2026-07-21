import os
from flask import Blueprint, jsonify, request, send_file
from modules.session import session as sess
from config.config import CONFIG
from core import backup as backup_service

backup_bp = Blueprint("backup", __name__)


def _extract_token() -> str or None:
    return request.cookies.get("token") or request.headers.get("X-Token")


@backup_bp.route("/api/backup", methods=["POST"])
def api_backup():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    files = request.files.getlist("files")
    if not files:
        return jsonify({"ok": False, "error": "No se han seleccionado archivos."}), 400

    dest_mode = request.form.get("dest_mode", "download")
    cloud_path = request.form.get("cloud_path", "").strip("/")

    if dest_mode == "cloud":
        base_user_backups = os.path.join(CONFIG.DATA_DIR, "Cloud", user_id, ".backups")
        try:
            os.makedirs(base_user_backups, exist_ok=True)
        except Exception as e:
            return jsonify({"ok": False, "error": f"Error al inicializar búnker de copias: {str(e)}"}), 500

    result, error = backup_service.create_backup(files, dest_mode, cloud_path, token)
    if error:
        return jsonify({"ok": False, "error": error}), 400 if "inválida" in error or "Cloud" in error else 500

    return jsonify({"ok": True, **result})


@backup_bp.route("/api/backup/download/<string:filename>", methods=["GET"])
def api_backup_download(filename):
    token = _extract_token()
    if not token or not sess.get_user_id(token):
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    safe_filename = os.path.basename(filename)
    if not safe_filename.endswith(".zip") or safe_filename != filename:
        return jsonify({"ok": False, "error": "Solicitud inválida"}), 400

    zip_path = backup_service.get_zip_path(safe_filename)
    if not zip_path:
        return jsonify({"ok": False, "error": "Archivo no encontrado"}), 404

    clean_name = safe_filename.split("_", 1)[1] if "_" in safe_filename else safe_filename

    backup_service.cleanup_old_temp()

    return send_file(
        zip_path,
        as_attachment=True,
        download_name=clean_name,
        mimetype="application/zip",
    )