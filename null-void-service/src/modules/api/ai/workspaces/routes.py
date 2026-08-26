"""Endpoints REST de Workspaces/Proyectos.

Mantiene las mismas rutas HTTP que el frontend espera:
/api/ai/workspaces, /api/ai/workspaces/<id>, .../<id>/files, ...
"""
from flask import Blueprint, jsonify, request
import os
from modules.session import session as sess
from . import repository
from . import services

workspaces_bp = Blueprint("ai_workspaces", __name__)


def _get_uid():
    token = request.cookies.get("token") or request.headers.get("X-Token")
    return sess.get_user_id(token)


def _get_user():
    token = request.cookies.get("token") or request.headers.get("X-Token")
    username = sess.get_user(token)
    user_id = sess.get_user_id(token)
    return username, user_id, token


@workspaces_bp.route("/api/ai/workspaces", methods=["GET"])
def list_workspaces():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    spaces = repository.get_workspaces(uid)
    return jsonify(spaces), 200


@workspaces_bp.route("/api/ai/workspaces", methods=["POST"])
def create_workspace():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    name = data.get("name")
    desc = data.get("description", "")
    if not name:
        return jsonify(error="El nombre es obligatorio"), 400
    wid = repository.create_workspace(uid, name, desc)
    return jsonify({"id": wid, "name": name, "description": desc}), 201


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>", methods=["DELETE"])
def delete_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    repository.delete_workspace(uid, workspace_id)
    return jsonify(success=True), 200


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>", methods=["PUT"])
def update_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    name = data.get("name")
    desc = data.get("description", "")
    if not name:
        return jsonify(error="El nombre es obligatorio"), 400
    repository.update_workspace(uid, workspace_id, name, desc)
    return jsonify(success=True), 200


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>/star", methods=["POST"])
def toggle_star_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    is_starred = 1 if data.get("is_starred") else 0
    repository.toggle_workspace_star(uid, workspace_id, is_starred)
    return jsonify(success=True, is_starred=is_starred), 200


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>/archive", methods=["POST"])
def toggle_archive_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    is_archived = 1 if data.get("is_archived") else 0
    repository.toggle_workspace_archive(uid, workspace_id, is_archived)
    return jsonify(success=True), 200


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>/files", methods=["GET"])
def list_workspace_files(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    enriched = services.list_workspace_files(workspace_id)
    return jsonify(enriched), 200


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>/files", methods=["POST"])
def upload_workspace_file(workspace_id):
    username, uid, token = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    from modules.api.cloud import services as cloud_services
    file = request.files.get('file')
    if file and file.filename:
        file.seek(0, os.SEEK_END)
        size = file.tell()
        file.seek(0)
        if size > 64 * 1024 * 1024:
            return jsonify(error="El archivo supera el límite de 64MB"), 400
        ref = cloud_services.ai_save_file(token, file.filename, file.read(), username, uid)
    else:
        # Compat: JSON {filename, content}
        data = request.json or {}
        filename = data.get("filename")
        content = data.get("content")
        if not filename or content is None:
            return jsonify(error="Faltan datos"), 400
        if not isinstance(content, str):
            content = str(content)
        ref = cloud_services.ai_save_file(token, filename, content.encode("utf-8"), username, uid)
    if "error" in ref:
        return jsonify(error=ref["error"]), 400
    fid = repository.add_workspace_file(workspace_id, ref["name"], ref["id"])
    return jsonify({"id": fid, "filename": ref["name"], "fileId": ref["id"]}), 201


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>/files/<file_id>/content", methods=["GET"])
def get_workspace_file_content_route(workspace_id, file_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    content = repository.get_workspace_file_content(file_id)
    return jsonify({"content": content}), 200


@workspaces_bp.route("/api/ai/workspaces/<workspace_id>/files/<file_id>", methods=["DELETE"])
def delete_workspace_file(workspace_id, file_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    owner_uid, attachment_id = repository.delete_workspace_file(file_id)
    if owner_uid and attachment_id:
        from modules.api.cloud import services as cloud_services
        cloud_services.ai_delete_files_by_uid(owner_uid, [attachment_id])
    return jsonify(success=True), 200
