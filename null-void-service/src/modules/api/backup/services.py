from flask import Blueprint, jsonify, request, send_file
from modules.session import session as sess
from . import services
import os

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

    result, error = services.create_backup(files, dest_mode, cloud_path, token, user_id)
    if error:
        return jsonify({"ok": False, "error": error}), 400 if "inválida" in error or "limite" in error.lower() or "Cloud" in error else 500

    return jsonify({"ok": True, **result})


@backup_bp.route("/api/backup/download/<string:filename>", methods=["GET"])
def api_backup_download(filename):
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    safe_filename = os.path.basename(filename)
    if safe_filename != filename or not safe_filename.endswith(".zip") or "_" not in safe_filename:
        return jsonify({"ok": False, "error": "Solicitud inválida"}), 400

    prefix_uid = safe_filename.split("_", 1)[0]
    if not services.verify_owner(prefix_uid, user_id):
        return jsonify({"ok": False, "error": "Acceso denegado a este recurso"}), 403

    zip_path = services.get_zip_path(safe_filename)
    if not zip_path:
        return jsonify({"ok": False, "error": "Archivo no encontrado"}), 404

    clean_name = safe_filename.split("_", 1)[1]

    return send_file(
        zip_path,
        as_attachment=True,
        download_name=clean_name,
        mimetype="application/zip",
    )