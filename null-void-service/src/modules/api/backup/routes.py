import json
import os
import re
import shutil
import tempfile
import time
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


def _sanitize_exclude_exts(data):
    """
    Sanitiza extensiones excluidas del respaldo (defensa en profundidad;
    la normalización real ocurre en core.backup._normalize_exclude_exts).

    Acepta: lista o cadena separada por comas (".tmp", "log", "*.zip").
    Devuelve: lista de extensiones minúsculas con punto, máximo 30 ítems.
    """
    raw = data.get("exclude_exts")
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else str(raw).split(",")
    cleaned = []
    seen = set()
    for item in items:
        item = str(item).strip().lower()
        if not item:
            continue
        if item.startswith("*."):
            item = item[1:]
        if not item.startswith("."):
            item = "." + item
        if len(item) > 13 or not re.match(r"^\.[a-z0-9][a-z0-9_-]*$", item):
            continue
        if item in seen:
            continue
        seen.add(item)
        cleaned.append(item)
        if len(cleaned) >= 30:
            break
    return cleaned


def _sanitize_exclude_paths(data):
    """
    Sanitiza rutas excluidas del respaldo (defensa en profundidad; la
    normalización real ocurre en core.backup._normalize_exclude_paths).

    Acepta: lista de rutas relativas (ej. ['Asignaturas/1']).
    Rechaza: absolutas, '..', segmentos ocultos, duplicados. Máximo 20 rutas.
    """
    raw = data.get("exclude_paths")
    if not isinstance(raw, list):
        return []
    cleaned = []
    seen = set()
    for p in raw:
        p = str(p).strip()
        if not p:
            continue
        if (p.startswith("/") or "\\" in p or ":" in p
                or "\x00" in p or "~" in p):
            continue
        p = p.strip("/")
        if not p or p in seen:
            continue
        parts = [x.strip() for x in p.split("/") if x.strip() not in ("", ".")]
        if any(x == ".." or x.startswith(".") for x in parts):
            continue
        seen.add(p)
        cleaned.append(p)
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
    backup_type = backup_service.normalize_backup_type(request.form.get("backup_type", "full"))

    result, error = backup_service.create_backup(files, dest_mode, token, backup_type)
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
            for evt in backup_service.create_backup_stream(saved, upload_dir, dest_mode, token, backup_type):
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

    automations = backup_service.load_automations_config(user_id)
    return jsonify({
        "ok": True,
        "automations": automations,
        "automation": automations[0] if automations else None,
    })


@backup_bp.route("/api/backup/automation", methods=["POST"])
def api_backup_automation_post():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "")).strip()[:60]
    if not name:
        return jsonify({"ok": False, "error_code": "err_name_required", "error": "El nombre de la automatización es obligatorio."}), 400

    source_paths = _sanitize_source_paths(data)
    if not source_paths:
        return jsonify({"ok": False, "error_code": "err_no_sources", "error": "Selecciona al menos un elemento a respaldar."}), 400

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
    exclude_exts = _sanitize_exclude_exts(data)
    exclude_paths = _sanitize_exclude_paths(data)

    cfg = {
        "id": str(data.get("id", "")).strip(),
        "name": str(data.get("name", "")).strip(),
        "enabled": bool(data.get("enabled", False)),
        "frequency": frequency,
        "days": days,
        "time": time_str,
        "copies_limit": copies_limit,
        "backup_type": backup_type,
        "dest_mode": dest_mode,
        "source_paths": source_paths,
        "exclude_exts": exclude_exts,
        "exclude_paths": exclude_paths,
    }

    automations = backup_service.load_automations_config(user_id)
    rid = cfg["id"]
    if rid:
        for entry in automations:
            if entry.get("id") == rid:
                cfg["id"] = rid
                entry.update({k: v for k, v in cfg.items() if v is not None})
                break
        else:
            automations.append(cfg)
    else:
        cfg["id"] = "auto_" + str(int(time.time() * 1000))
        automations.append(cfg)

    backup_service.save_automations_config(user_id, automations)
    return jsonify({"ok": True, "automations": automations, "automation": cfg})


@backup_bp.route("/api/backup/automation/<automation_id>", methods=["DELETE"])
def api_backup_automation_delete(automation_id):
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    automations = backup_service.load_automations_config(user_id)
    remaining = [a for a in automations if a.get("id") != automation_id]
    if len(remaining) == len(automations):
        return jsonify({"ok": False, "error": "Automatización no encontrada"}), 404

    backup_service.save_automations_config(user_id, remaining)
    return jsonify({"ok": True, "automations": remaining})


@backup_bp.route("/api/backup/download/<string:filename>", methods=["GET"])
def api_backup_download(filename):
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    safe_filename = os.path.basename(filename)
    if not safe_filename.endswith(".zip") or safe_filename != filename:
        return jsonify({"ok": False, "error": "Solicitud inválida"}), 400

    # Garantizar pertenencia al usuario (Anti-IDOR)
    zip_path = backup_service.get_user_backup_path(user_id, safe_filename)
    if not zip_path or not os.path.exists(zip_path):
        return jsonify({"ok": False, "error": "Archivo no encontrado o no autorizado"}), 404

    clean_name = safe_filename.split("_", 1)[1] if "_" in safe_filename else safe_filename
    backup_service.cleanup_old_temp()

    from core.crypto_utils import decrypt_file, is_encrypted_file
    if not is_encrypted_file(zip_path):
        return send_file(
            zip_path,
            as_attachment=True,
            download_name=clean_name,
            mimetype="application/zip",
        )

    # Si está cifrado, descifrarlo en directorio temp y limpiar al cerrar la conexión (Anti-DoS)
    tmp_dir = tempfile.mkdtemp()
    decrypted_tmp = os.path.join(tmp_dir, clean_name)
    try:
        decrypt_file(zip_path, decrypted_tmp)
        resp = send_file(
            decrypted_tmp,
            as_attachment=True,
            download_name=clean_name,
            mimetype="application/zip",
        )

        @resp.call_on_close
        def _clean():
            shutil.rmtree(tmp_dir, ignore_errors=True)

        return resp
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return jsonify({"ok": False, "error": f"Error al preparar la descarga: {e}"}), 500



@backup_bp.route("/api/backup/restore", methods=["POST"])
def api_backup_restore():
    token = _extract_token()
    user_id = sess.get_user_id(token) if token else None
    if not user_id:
        return jsonify({"ok": False, "error": "No autorizado"}), 401

    data = request.get_json(silent=True) or {}
    filename = str(data.get("filename", "")).strip()
    target_path = str(data.get("target_path", "")).strip("/")

    if not filename:
        return jsonify({"ok": False, "error": "Nombre de archivo de respaldo requerido"}), 400

    target_segments = [seg for seg in target_path.split("/") if seg]
    if target_segments and any(
            seg == ".." or seg.startswith(".") or "\\" in seg or "\x00" in seg
            for seg in target_segments):
        return jsonify({"ok": False, "error": "Ruta de destino inválida."}), 400

    ok, result = backup_service.restore_backup(user_id, filename, target_path)
    if not ok:
        return jsonify({"ok": False, "error": result}), 400

    return jsonify({"ok": True, "details": result})



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

    backup_type = backup_service.normalize_backup_type(data.get("backup_type", "full"))
    exclude_exts = _sanitize_exclude_exts(data)
    exclude_paths = _sanitize_exclude_paths(data)

    def generate():
        for evt in backup_service.create_cloud_backup_stream(
                user_id, source_paths, dest_mode, backup_type,
                exclude_exts, exclude_paths):
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