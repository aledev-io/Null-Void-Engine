from flask import Blueprint, jsonify, request, Response, stream_with_context, render_template, redirect, url_for
import subprocess
from modules.session import session as sess
from . import services, repository
from core.socket_ext import socketio
from flask_socketio import join_room, leave_room

ai_bp = Blueprint("ai_bp", __name__)


def _get_uid():
    token = request.cookies.get("token") or request.args.get("token")
    return sess.get_user_id(token)


def _get_user():
    token = request.cookies.get("token") or request.args.get("token")
    username = sess.get_user(token)
    user_id = sess.get_user_id(token)
    return username, user_id, token


@ai_bp.route("/api/ai/heartbeat", methods=["POST"])
def ai_heartbeat():
    uid = _get_uid() or request.remote_addr or "anonymous"
    return services.handle_heartbeat(uid), 200


@ai_bp.route("/ai")
@ai_bp.route("/ai/", defaults={'path': ''})
@ai_bp.route("/ai/<path:path>")
def ai_page(path=''):
    username, user_id, token = _get_user()
    if not username:
        return redirect(url_for("auth.index"))
    services.handle_heartbeat(user_id)
    user = {"username": username, "user_id": user_id}
    return render_template("modules/ai.html", user=user, token=token)


@ai_bp.route("/api/ai/models")
def get_ai_models():
    uid = _get_uid() or request.remote_addr or "anonymous"
    services.handle_heartbeat(uid)
    models, error = services.get_available_models(uid)
    status = 200 if not error else 500
    resp = {"models": models}
    if error:
        resp["error"] = error
    return jsonify(resp), status


@ai_bp.route("/api/ai/preferences", methods=["GET", "POST"])
def user_preferences():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    
    if request.method == "GET":
        default_model = repository.get_user_default_model(uid)
        return jsonify(default_model=default_model)
    else:
        data = request.get_json(force=True) or {}
        model_name = data.get("default_model")
        if model_name:
            repository.set_user_default_model(uid, model_name)
        return jsonify(success=True)


@ai_bp.route("/api/ai/pull_model", methods=["POST"])
def pull_model_route():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(force=True) or {}
    model_name = data.get("name")
    if not model_name:
        return jsonify(error="Falta el nombre del modelo"), 400
    try:
        resp = services.pull_ai_model(model_name, uid)
        return jsonify(resp), 200
    except Exception as e:
        return jsonify(error=str(e)), 500

@ai_bp.route("/api/ai/active_downloads", methods=["GET"])
def active_downloads_route():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    return jsonify(services.ACTIVE_DOWNLOADS), 200


@ai_bp.route("/api/ai/models/<path:model_name>", methods=["DELETE"])
def delete_model_route(model_name):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    try:
        result = services.delete_ai_model(model_name, uid)
        if "error" in result:
            return jsonify(error=result["error"]), 500
        return jsonify(status="success", message=result.get("message")), 200
    except Exception as e:
        return jsonify(error=str(e)), 500


@ai_bp.route("/api/ai/chat", methods=["POST"])
def ai_chat_proxy():
    uid = _get_uid()
    data = request.get_json(force=True)
    return Response(
        stream_with_context(services.stream_chat(uid, data)),
        mimetype="application/json",
    )


@ai_bp.route("/api/ai/sessions", methods=["GET"])
def list_sessions():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    return jsonify(repository.get_user_sessions(uid))


@ai_bp.route("/api/ai/cancel", methods=["POST"])
def cancel_chat():
    data = request.get_json(force=True)
    session_id = data.get("session_id")
    if session_id:
        services.cancel_generation(session_id)
    return jsonify(ok=True)


@ai_bp.route("/api/ai/generating", methods=["GET"])
def get_generating_status():
    """Check which sessions are currently generating."""
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    active = services.get_all_active_generations()
    return jsonify(active=active)


@ai_bp.route("/api/ai/sessions/<session_id>/messages", methods=["GET"])
def get_session_messages(session_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    return jsonify(repository.get_session_messages(uid, session_id))


@ai_bp.route("/api/ai/sessions", methods=["POST"])
def create_session():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(force=True) or {}
    session_id = repository.create_session(
        uid, model=data.get("model"), title=data.get("title", "New Chat")
    )
    return jsonify({"session_id": session_id}), 201


@ai_bp.route("/api/ai/sessions/all", methods=["DELETE"])
def delete_all_sessions():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    affected = repository.delete_all_user_sessions(uid)
    for aff in affected:
        socketio.emit('chat_deleted', {'id': aff['session_id']}, room=f"user_{aff['user_id']}")
    return jsonify(ok=True)


@ai_bp.route("/api/ai/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    affected = repository.delete_session(uid, session_id)
    for aff in affected:
        socketio.emit('chat_deleted', {'id': aff['session_id']}, room=f"user_{aff['user_id']}")
    return jsonify(ok=True)


@ai_bp.route("/api/ai/notes", methods=["GET"])
def get_notes():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    notes = repository.get_user_notes(uid)
    return jsonify(notes=notes)

@ai_bp.route("/api/ai/notes", methods=["POST"])
def save_note():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    if "id" not in data:
        return jsonify(error="Falta ID de la nota"), 400
    
    if not data.get("user_id"):
        data["user_id"] = uid
    
    repository.save_note(data)
    return jsonify(ok=True)

@ai_bp.route("/api/ai/notes/<note_id>", methods=["DELETE"])
def delete_note(note_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    repository.delete_note(note_id, uid)
    return jsonify(ok=True)

@ai_bp.route("/api/ai/notes/share", methods=["POST"])
def share_note():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    friend_id = data.get("friend_id")
    note = data.get("note")
    if not friend_id or not note:
        return jsonify(error="Faltan parámetros"), 400
    
    user_name = _get_user()[0]
    note["shared_by"] = user_name or "Un amigo"
    
    if not data.get("friend_name"):
        friend_name = data.get("friend_name", "Amigo")
    else:
        friend_name = data.get("friend_name")
        
    repository.save_note(note)
    repository.share_note(note["id"], friend_id, friend_name)
    
    note["is_shared"] = True
    
    socketio.emit('note_shared', note, room=f"user_{friend_id}")
    return jsonify(ok=True)

@ai_bp.route("/api/ai/notes/unshare", methods=["POST"])
def unshare_note():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    friend_id = data.get("friend_id")
    note_id = data.get("note_id")
    if not friend_id or not note_id:
        return jsonify(error="Faltan parámetros"), 400
    
    # Remove from database
    repository.unshare_note(note_id, friend_id)
    
    socketio.emit('note_unshared', {"note_id": note_id}, room=f"user_{friend_id}")
    return jsonify(ok=True)

@socketio.on("note_update")
def handle_note_update(data):
    """
    Handle real-time note updates.
    """
    uid = _get_uid()
    if not uid:
        return

    note_id = data.get("id")
    if not note_id:
        return

    print(f"[SocketIO] note_update received for note {note_id} from {uid}")
    
    # Find the owner and collaborators from DB to broadcast correctly
    with repository.get_db() as conn:
        note_row = conn.execute("SELECT user_id FROM ai_notes WHERE id = ?", (note_id,)).fetchone()
        if not note_row:
            print(f"[SocketIO] note_update ignored: note {note_id} not found in DB")
            return
            
        owner_id = note_row[0]
        
        collab_rows = conn.execute("SELECT user_id FROM ai_note_collaborators WHERE note_id = ?", (note_id,)).fetchall()
        collaborators = [r[0] for r in collab_rows]
    
    # All users who should receive this update (excluding the sender)
    recipients = set(collaborators)
    recipients.add(owner_id)
    if uid in recipients:
        recipients.remove(uid)

    print(f"[SocketIO] note_update broadcasting to recipients: {recipients}")
    for friend_id in recipients:
        socketio.emit('note_update', data, room=f"user_{friend_id}")

@socketio.on("cursor_update")
def handle_cursor_update(data):
    """
    Handle real-time cursor updates.
    """
    uid = _get_uid()
    if not uid:
        return

    note_id = data.get("id")
    if not note_id:
        return

    # Find the owner and collaborators from DB to broadcast correctly
    with repository.get_db() as conn:
        note_row = conn.execute("SELECT user_id FROM ai_notes WHERE id = ?", (note_id,)).fetchone()
        if not note_row:
            return
            
        owner_id = note_row[0]
        
        collab_rows = conn.execute("SELECT user_id FROM ai_note_collaborators WHERE note_id = ?", (note_id,)).fetchall()
        collaborators = [r[0] for r in collab_rows]
    
    # All users who should receive this update (excluding the sender)
    recipients = set(collaborators)
    recipients.add(owner_id)
    if uid in recipients:
        recipients.remove(uid)

    for friend_id in recipients:
        socketio.emit('cursor_update', data, room=f"user_{friend_id}")

@ai_bp.route("/api/ai/chat/share", methods=["POST"])
def share_chat():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    friend_id = data.get("friend_id")
    chat = data.get("chat")
    if not friend_id or not chat:
        return jsonify(error="Faltan parámetros"), 400

    user_name = _get_user()[0] or "Un amigo"
    session_id = str(chat.get("id", ""))
    messages = chat.get("messages", [])

    # Try to clone from DB first (works when session exists in DB)
    new_session_id = None
    if session_id:
        new_session_id = repository.clone_session_for_user(uid, session_id, friend_id, user_name)

    # Fallback: create session in DB from the payload messages (for localStorage-only chats)
    if not new_session_id and messages:
        new_session_id = repository.create_shared_session(
            friend_id, user_name, chat.get("title", "Chat compartido"), messages
        )

    # Build payload for the recipient — include messages so client can load into localStorage
    shared_title = f"{chat.get('title', 'Chat')} (de {user_name})"
    shared_payload = {
        "id": new_session_id or session_id,
        "title": shared_title,
        "shared_by": user_name,
        "messages": messages,
    }
    socketio.emit('chat_shared', shared_payload, room=f"user_{friend_id}")
    return jsonify(ok=True)

@ai_bp.route("/api/ai/keys", methods=["GET"])
def get_api_keys():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    return jsonify(repository.get_user_api_keys(uid))

@ai_bp.route("/api/ai/keys", methods=["POST"])
def save_api_key():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    provider = data.get("provider")
    api_key = data.get("api_key")
    api_url = data.get("api_url")
    if not provider or not api_key:
        return jsonify(error="Faltan parámetros"), 400
    
    repository.save_api_key(uid, provider, api_key, api_url)
    return jsonify(ok=True)


# ---- Active Collaborators Tracking ----
ACTIVE_NOTE_USERS = {} # note_id -> {user_id: user_name}
SID_TO_USER = {}       # sid -> {"note_id": str, "user_id": str, "user_name": str}

@socketio.on("join_note")
def handle_join_note(data):
    uid = _get_uid()
    if not uid: return
    username, _, _ = _get_user()
    username = username or "Usuario"
    
    note_id = data.get("note_id")
    if not note_id: return
    
    # Track the user locally
    SID_TO_USER[request.sid] = {"note_id": note_id, "user_id": uid, "user_name": username}
    
    # Join socketio room
    join_room(f"note_{note_id}")
    
    # Update state
    if note_id not in ACTIVE_NOTE_USERS:
        ACTIVE_NOTE_USERS[note_id] = {}
    ACTIVE_NOTE_USERS[note_id][uid] = username
    
    # Broadcast to the note room
    socketio.emit('active_collaborators', {"users": ACTIVE_NOTE_USERS[note_id]}, room=f"note_{note_id}")

@socketio.on("leave_note")
def handle_leave_note(data):
    info = SID_TO_USER.pop(request.sid, None)
    if info:
        note_id = info["note_id"]
        uid = info["user_id"]
        leave_room(f"note_{note_id}")
        if note_id in ACTIVE_NOTE_USERS and uid in ACTIVE_NOTE_USERS[note_id]:
            del ACTIVE_NOTE_USERS[note_id][uid]
            socketio.emit('active_collaborators', {"users": ACTIVE_NOTE_USERS[note_id]}, room=f"note_{note_id}")

@socketio.on("disconnect")
def handle_disconnect():
    info = SID_TO_USER.pop(request.sid, None)
    if info:
        note_id = info["note_id"]
        uid = info["user_id"]
        if note_id in ACTIVE_NOTE_USERS and uid in ACTIVE_NOTE_USERS[note_id]:
            del ACTIVE_NOTE_USERS[note_id][uid]
            socketio.emit('active_collaborators', {"users": ACTIVE_NOTE_USERS[note_id]}, room=f"note_{note_id}")

# --- WORKSPACES ROUTES ---

@ai_bp.route("/api/ai/workspaces", methods=["GET"])
def list_workspaces():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    spaces = repository.get_workspaces(uid)
    return jsonify(spaces), 200

@ai_bp.route("/api/ai/workspaces", methods=["POST"])
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

@ai_bp.route("/api/ai/workspaces/<workspace_id>", methods=["DELETE"])
def delete_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    repository.delete_workspace(uid, workspace_id)
    return jsonify(success=True), 200

@ai_bp.route("/api/ai/workspaces/<workspace_id>", methods=["PUT"])
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

@ai_bp.route("/api/ai/workspaces/<workspace_id>/star", methods=["POST"])
def toggle_star_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    is_starred = 1 if data.get("is_starred") else 0
    repository.toggle_workspace_star(uid, workspace_id, is_starred)
    return jsonify(success=True, is_starred=is_starred), 200

@ai_bp.route("/api/ai/workspaces/<workspace_id>/archive", methods=["POST"])
def toggle_archive_workspace(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    is_archived = 1 if data.get("is_archived") else 0
    repository.toggle_workspace_archive(uid, workspace_id, is_archived)
    return jsonify(success=True), 200

@ai_bp.route("/api/ai/workspaces/<workspace_id>/files", methods=["GET"])
def list_workspace_files(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    # Note: ideally we check if workspace belongs to uid, but we assume it does for now
    files = repository.get_workspace_files(workspace_id)
    return jsonify(files), 200

@ai_bp.route("/api/ai/workspaces/<workspace_id>/files", methods=["POST"])
def upload_workspace_file(workspace_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    filename = data.get("filename")
    content = data.get("content")
    if not filename or content is None:
        return jsonify(error="Faltan datos"), 400
    fid = repository.add_workspace_file(workspace_id, filename, content)
    return jsonify({"id": fid, "filename": filename}), 201

@ai_bp.route("/api/ai/workspaces/<workspace_id>/files/<file_id>", methods=["DELETE"])
def delete_workspace_file(workspace_id, file_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    repository.delete_workspace_file(file_id)
    return jsonify(success=True), 200

