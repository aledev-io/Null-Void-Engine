import json
import os
import re
import shutil
import tempfile
from flask import Blueprint, jsonify, request, send_file, Response
from modules.session import session as sess
from core import backup as backup_service

backup_bp = Blueprint("backup", __name__)

ALLOWED_FREQUENCIES = {"daily", "weekly", "monthly"}


def _sanitize_source_paths(data):
    """
    Sanitiza rutas de origen enviadas por el cliente (defensa en profundidad;
    la validación real de resolución ocurre en core.backup.resolve_cloud_sources).

    Acepta: lista de rutas relativas y la cadena vacía '' (Mi unidad / la raíz).
    Rechaza: no-listas, duplicados, rutas absolutas, separadores alternativos,
    NUL, '~', '..' y segmentos ocultos. Máximo 20 rutas.
    """
    source_paths = data.get("source_paths")
    if not isinstance(source_paths, list):
        return []
    cleaned = []
    seen = set()
    for p in source_paths:
        p = str(p).strip()
        if not p and p != "":
            continue
        if p in seen:
            continue
        if (p.startswith("/") or "\\" in p or ":" in p
                or "\x00" in p or "~" in p):
            continue
        p = p.strip("/")
        if p in seen:
            continue
        parts = [x.strip() for x in p.split("/") if x.strip() not in ("", ".")]
        if parts and any(x == ".." or x.startswith(".") for x in parts):
            continue
        seen.add(p)
        cleaned.append(p)
    # '' (raíz) siempre primero: hace redundantes las rutas internas.
    cleaned = sorted(cleaned, key=lambda x: (x != "", x))
    return cleaned[:20]


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
    backup_type = backup_service.normalize_backup_type(request.form.get("backup_type", "full"))

    result, error = backup_service.create_backup(files, dest_mode, cloud_path, token, backup_type)
    if error:
        return jsonify({"ok": False, "error": error}), 400 if "inválida" in error or "Cloud" in error else 500

    return jsonify({"ok": True, **result})


@backup_bp.route("/api/backup/stream", methods=["POST"])
def api_backup_stream():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    files = request.files.getlist("files")
    if not files:
        return jsonify({"ok": False, "error": "No se han seleccionado archivos."}), 400

    dest_mode = request.form.get("dest_mode", "download")
    cloud_path = request.form.get("cloud_path", "").strip("/")
    backup_type = backup_service.normalize_backup_type(request.form.get("backup_type", "full"))

    # Materializamos los archivos aquí (contexto de request vivo): los FileStorage
    # se cierran cuando el contexto se desapila, antes de consumirse el generador SSE.
    upload_dir = tempfile.mkdtemp(prefix="nv_bkp_")
    saved = []
    try:
        for f in files:
            safe_name = os.path.basename(f.filename or "")
            if not safe_name:
                continue
            f.save(os.path.join(upload_dir, safe_name))
            saved.append(safe_name)
    except Exception as e:
        shutil.rmtree(upload_dir, ignore_errors=True)
        return jsonify({"ok": False, "error": f"Error al recibir los archivos: {str(e)}"}), 400

    if not saved:
        shutil.rmtree(upload_dir, ignore_errors=True)
        return jsonify({"ok": False, "error": "No se han seleccionado archivos."}), 400

    def generate():
        try:
            for evt in backup_service.create_backup_stream(saved, upload_dir, dest_mode, cloud_path, token, backup_type):
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
        finally:
            shutil.rmtree(upload_dir, ignore_errors=True)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@backup_bp.route("/api/backup/meta", methods=["GET"])
def api_backup_meta():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    meta = backup_service.load_backup_meta(user_id)
    return jsonify({"ok": True, "meta": {
        "last_full": meta.get("last_full"),
        "last_snapshot": meta.get("last_snapshot"),
    }})


@backup_bp.route("/api/backup/automation", methods=["GET"])
def api_backup_automation_get():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    cfg = backup_service.load_automation_config(user_id)
    source_paths = cfg.get("source_paths", [])
    return jsonify({"ok": True, "automation": {
        "enabled": bool(cfg.get("enabled", False)),
        "frequency": cfg.get("frequency", "daily"),
        "days": cfg.get("days", []),
        "time": cfg.get("time", "02:00"),
        "copies_limit": int(cfg.get("copies_limit", 5)),
        "backup_type": cfg.get("backup_type", "full"),
        "dest_mode": cfg.get("dest_mode", "download"),
        "cloud_path": cfg.get("cloud_path", ""),
        "source_paths": source_paths,
    }})


@backup_bp.route("/api/backup/automation", methods=["POST"])
def api_backup_automation_post():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    data = request.get_json(silent=True) or {}
    frequency = data.get("frequency", "daily")
    if frequency not in ALLOWED_FREQUENCIES:
        return jsonify({"ok": False, "error": "Frecuencia inválida."}), 400

    days = data.get("days", [])
    if not isinstance(days, list) or any(not isinstance(d, int) or d < 0 or d > 6 for d in days):
        days = []

    time_str = str(data.get("time", "02:00")).strip()
    if not re.match(r"^\d{1,2}:\d{2}$", time_str):
        time_str = "02:00"
    time_str = time_str.zfill(5)

    try:
        copies_limit = max(1, min(50, int(data.get("copies_limit", 5))))
    except (TypeError, ValueError):
        copies_limit = 5

    dest_mode = data.get("dest_mode", "download")
    if dest_mode not in ("download", "cloud"):
        dest_mode = "download"

    backup_type = backup_service.normalize_backup_type(data.get("backup_type", "full"))
    source_paths = _sanitize_source_paths(data)

    cfg = {
        "enabled": bool(data.get("enabled", False)),
        "frequency": frequency,
        "days": days,
        "time": time_str,
        "copies_limit": copies_limit,
        "backup_type": backup_type,
        "dest_mode": dest_mode,
        "cloud_path": str(data.get("cloud_path", "")).strip("/"),
        "source_paths": source_paths,
    }
    backup_service.save_automation_config(user_id, cfg)
    return jsonify({"ok": True, "automation": cfg})


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


@backup_bp.route("/api/backup/cloud", methods=["POST"])
def api_backup_cloud():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    data = request.get_json(silent=True) or {}
    source_paths = _sanitize_source_paths(data)
    if not source_paths:
        return jsonify({"ok": False, "error": "No se han seleccionado carpetas de origen."}), 400

    dest_mode = data.get("dest_mode", "download")
    if dest_mode not in ("download", "cloud"):
        dest_mode = "download"

    cloud_path = str(data.get("cloud_path", "")).strip("/")
    backup_type = backup_service.normalize_backup_type(data.get("backup_type", "full"))

    def generate():
        for evt in backup_service.create_cloud_backup_stream(user_id, source_paths, dest_mode, cloud_path, backup_type):
            yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )