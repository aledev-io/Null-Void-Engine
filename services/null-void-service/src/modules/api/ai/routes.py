from flask import Blueprint, jsonify, request, Response, stream_with_context, render_template, redirect, url_for, send_file
import os
from modules.session import session as sess
from core.database import get_db
from . import services, repository
from core.socket_ext import socketio
from flask_socketio import join_room, leave_room

ai_bp = Blueprint("ai_bp", __name__)


def _get_uid():
    token = request.cookies.get("token") or request.headers.get("X-Token")
    return sess.get_user_id(token)


def _get_user():
    token = request.cookies.get("token") or request.headers.get("X-Token")
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
    # SIN handle_heartbeat aquí: arrancar el contenedor Ollama (hasta 45s)
    # bloquearía el render de la página. El arranque perezoso ocurre bajo
    # demanda en /api/ai/models y /api/ai/chat.
    user = {"username": username, "user_id": user_id}
    return render_template("modules/ai.html", user=user, token=token)


@ai_bp.route("/api/ai/models")
def get_ai_models():
    uid = _get_uid() or request.remote_addr or "anonymous"
    # NUNCA arrancar el contenedor Ollama aquí: elegir un modelo no debe
    # cargar nada en memoria. La lista se sirve desde caché (con fallback a
    # caché vieja si el contenedor está parado) y el arranque perezoso del
    # contenedor + carga del modelo ocurre solo al enviar (/api/ai/chat).
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
    if not uid:
        return jsonify(error="No autorizado"), 401
    # El usuario está usando IA: asegurar contenedor activo (arranque perezoso)
    try:
        services.handle_heartbeat(uid)
    except Exception as e:
        return jsonify(error=f"El motor de IA no está disponible: {e}"), 503
    limited, retry_after = services.is_rate_limited(uid, request.remote_addr)
    if limited:
        return jsonify(
            error=f"Demasiadas peticiones. Espera {retry_after}s.",
            retry_after=retry_after,
        ), 429
    data = request.get_json(force=True) or {}
    error = services.validate_chat_payload(data)
    if error:
        return jsonify(error=error), 400
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

    from modules.storage import store
    # El contenido de la nota se persiste como archivo en <DATA_DIR>/ai/<uid>/
    # (gestión cloud); en la BD solo queda la FK.
    content = data.get("content", "")
    # El storage se resuelve acotado al usuario actual: un id de nota reutilizado
    # por otro usuario (o restos de una sesión anterior) no puede secuestrar la
    # nota ajena.
    storage = repository.get_note_storage(data["id"], uid)
    # El dueño real sale de la BD (no del cliente): un colaborador edita
    # sobre el archivo del dueño y no puede reasignar la nota a otro usuario.
    owner_uid = (storage or {}).get("user_id") or uid
    data["user_id"] = owner_uid
    file_id = (storage or {}).get("file_id")
    if file_id:
        updated = store.ai_update_file_by_uid(owner_uid, file_id, content.encode("utf-8"), check_quota=True)
        if isinstance(updated, dict) and "error" in updated:
            return jsonify(error=updated["error"]), 400
        if updated is None:
            return jsonify(error="Archivo de la nota no encontrado"), 404
    else:
        ref = store.ai_save_file_uid(owner_uid,
                                              repository.note_filename_for_title(data.get("title")),
                                              content.encode("utf-8"), check_quota=True)
        if isinstance(ref, dict) and "error" in ref:
            return jsonify(error=ref["error"]), 400
        if not isinstance(ref, dict) or not ref.get("id"):
            return jsonify(error="No se pudo guardar la nota"), 500
        file_id = ref["id"]
    data.pop("content", None)
    if not repository.save_note(data, file_id):
        return jsonify(error="El ID de la nota ya existe en otra cuenta"), 409
    return jsonify(ok=True)

@ai_bp.route("/api/ai/notes/<note_id>", methods=["DELETE"])
def delete_note(note_id):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    owner_uid, file_id = repository.delete_note(note_id, uid)
    if owner_uid and file_id:
        from modules.storage import store
        store.ai_delete_files_by_uid(owner_uid, [file_id])
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
    
    with repository.get_db() as conn:
        note_row = conn.execute("SELECT user_id FROM ai_notes WHERE id = ?", (note_id,)).fetchone()
        if not note_row:
            print(f"[SocketIO] note_update ignored: note {note_id} not found in DB")
            return
            
        owner_id = note_row[0]
        
        collab_rows = conn.execute("SELECT user_id FROM ai_note_collaborators WHERE note_id = ?", (note_id,)).fetchall()
        collaborators = [r[0] for r in collab_rows]
    
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

    with repository.get_db() as conn:
        note_row = conn.execute("SELECT user_id FROM ai_notes WHERE id = ?", (note_id,)).fetchone()
        if not note_row:
            return
            
        owner_id = note_row[0]
        
        collab_rows = conn.execute("SELECT user_id FROM ai_note_collaborators WHERE note_id = ?", (note_id,)).fetchall()
        collaborators = [r[0] for r in collab_rows]
    
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

    new_session_id = None
    if session_id:
        new_session_id = repository.clone_session_for_user(uid, session_id, friend_id, user_name)

    if not new_session_id and messages:
        new_session_id = repository.create_shared_session(
            friend_id, user_name, chat.get("title", "Chat compartido"), messages
        )

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


@ai_bp.route("/api/ai/keys/models", methods=["GET"])
def get_provider_models_suggestions():
    """Sugerencias de modelos (máx 5) para el autocomplete del diálogo de API keys."""
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    provider = (request.args.get("provider") or "").strip().lower()
    if not provider:
        return jsonify(models=[]), 200
    return jsonify(models=services.get_provider_model_suggestions(uid, provider)), 200

@ai_bp.route("/api/ai/keys", methods=["POST"])
def save_api_key():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    provider = data.get("provider")
    api_key = data.get("api_key")
    api_url = data.get("api_url")
    model = data.get("model")
    is_shared = data.get("is_shared", False)
    if not provider:
        return jsonify(error="Faltan parámetros"), 400

    # Edición sin clave: conservar la almacenada (la clave nunca se devuelve
    # al cliente, así que una edición nunca debe sobrescribirla con vacío).
    if not api_key:
        existing = repository.get_api_key(uid, provider)
        if not existing:
            return jsonify(error="Falta la API key"), 400
        api_key = existing["api_key"]

    repository.save_api_key(uid, provider, api_key, api_url, model, 1 if is_shared else 0)
    return jsonify(ok=True)


@ai_bp.route("/api/ai/keys/share", methods=["POST"])
def toggle_api_key_share():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    provider = data.get("provider")
    is_shared = data.get("is_shared", False)
    shared_with = data.get("shared_with_users", "*")
    if isinstance(shared_with, list):
        shared_with = ",".join([str(u).strip() for u in shared_with if u])
    if not provider:
        return jsonify(error="Faltan parámetros"), 400
    repository.toggle_api_key_sharing(uid, provider, 1 if is_shared else 0, shared_with or "*")
    return jsonify(ok=True)


@ai_bp.route("/api/ai/keys", methods=["DELETE"])
def delete_api_key():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    provider = data.get("provider")
    if not provider:
        return jsonify(error="Faltan parámetros"), 400
    repository.delete_api_key(uid, provider)
    return jsonify(ok=True)


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
    
    SID_TO_USER[request.sid] = {"note_id": note_id, "user_id": uid, "user_name": username}
    
    join_room(f"note_{note_id}")
    
    if note_id not in ACTIVE_NOTE_USERS:
        ACTIVE_NOTE_USERS[note_id] = {}
    ACTIVE_NOTE_USERS[note_id][uid] = username
    
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


def _ai_token():
    return request.cookies.get("token") or request.headers.get("X-Token")


@ai_bp.route("/api/ai/attachments/upload", methods=["POST"])
def upload_ai_attachment():
    username, uid, token = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify(error="No se recibió ningún archivo"), 400
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > 64 * 1024 * 1024:
        return jsonify(error="El archivo supera el límite de 64MB"), 400
    from modules.storage import store
    ref = store.ai_save_file(token, file.filename, file.read(), username, uid)
    if "error" in ref:
        return jsonify(error=ref["error"]), 400
    return jsonify(ref), 201


@ai_bp.route("/api/ai/attachments", methods=["GET"])
def list_ai_attachments():
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    from modules.storage import store
    return jsonify(store.ai_list_files(_ai_token())), 200


@ai_bp.route("/api/ai/attachments/<path:name>", methods=["GET"])
def download_ai_attachment(name):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    from modules.storage import store
    path = store.ai_download_file(_ai_token(), name)
    if not path:
        return jsonify(error="Archivo no encontrado"), 404
    return send_file(path, as_attachment=False, download_name=os.path.basename(name), conditional=True)


@ai_bp.route("/api/ai/attachments/<path:name>", methods=["DELETE"])
def delete_ai_attachment(name):
    uid = _get_uid()
    if not uid:
        return jsonify(error="No autorizado"), 401
    from modules.storage import store
    if not store.ai_delete_file(_ai_token(), name):
        return jsonify(error="Archivo no encontrado"), 404
    return jsonify(success=True), 200


@ai_bp.route("/api/ai/files/generate", methods=["POST"])
def generate_ai_file():
    """La IA (o el cliente) genera un archivo: se guarda físicamente en
    <DATA_DIR>/ai/<uid>/ con metadata en Cloud, igual que los adjuntos.
    Acepta JSON {filename, content} o {filename, data} (base64)."""
    username, uid, token = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    filename = data.get("filename")
    if not filename:
        return jsonify(error="Falta el nombre del archivo"), 400
    from modules.storage import store
    import base64
    if data.get("data") is not None:
        try:
            payload = base64.b64decode(data["data"])
        except Exception:
            return jsonify(error="data base64 inválido"), 400
    else:
        content = data.get("content")
        if content is None:
            return jsonify(error="Falta content o data"), 400
        if isinstance(content, str):
            payload = content.encode("utf-8")
        elif isinstance(content, (bytes, bytearray)):
            payload = bytes(content)
        else:
            return jsonify(error="content debe ser texto o bytes"), 400
    ref = store.ai_save_file(token, filename, payload, username, uid)
    if "error" in ref:
        return jsonify(error=ref["error"]), 400
    return jsonify(ref), 201


@ai_bp.route("/api/ai/exports/conversation", methods=["POST"])
def export_conversation():
    """Exporta una conversación a un archivo de texto/markdown guardado en
    <DATA_DIR>/ai/<uid>/ con metadata en Cloud."""
    username, uid, token = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    session_id = data.get("session_id")
    fmt = (data.get("format") or "md").lower()
    if not session_id:
        return jsonify(error="Falta session_id"), 400
    if fmt not in ("md", "txt", "json"):
        return jsonify(error="Formato no soportado (md, txt o json)"), 400

    messages = repository.get_session_messages(uid, session_id)
    if not messages:
        return jsonify(error="Conversación vacía"), 404

    if fmt == "json":
        import json
        body = json.dumps(messages, ensure_ascii=False, indent=2)
    elif fmt == "txt":
        lines = []
        for m in messages:
            role_label = {"user": "Usuario", "assistant": "Asistente", "system": "Sistema"}.get(m.get("role"), m.get("role", ""))
            lines.append(f"[{role_label}]:\n{m.get('content', '')}\n")
        body = "\n".join(lines)
    else:
        lines = []
        for m in messages:
            role_label = {"user": "Usuario", "assistant": "Asistente", "system": "Sistema"}.get(m.get("role"), m.get("role", ""))
            lines.append(f"**{role_label}**:\n{m.get('content', '')}\n")
        body = "\n".join(lines)

    with get_db() as conn:
        row = conn.execute("SELECT title FROM ai_sessions WHERE id = ? AND user_id = ?", (session_id, uid)).fetchone()
    title = (row['title'] if row and row['title'] else "conversacion")[:60] or "conversacion"
    safe = "".join(c for c in title if c.isalnum() or c in ' ._-()').strip() or "conversacion"
    import time
    filename = f"{safe}_{time.strftime('%Y%m%d_%H%M%S')}.{fmt}"

    from modules.storage import store
    ref = store.ai_save_file(token, filename, body.encode("utf-8"), username, uid)
    if "error" in ref:
        return jsonify(error=ref["error"]), 400
    ref["content"] = body
    return jsonify(ref), 201


@ai_bp.route("/api/ai/exports/note", methods=["POST"])
def export_note():
    """Exporta una nota de IA a markdown guardado en <DATA_DIR>/ai/<uid>/."""
    username, uid, token = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json() or {}
    note_id = data.get("note_id")
    if not note_id:
        return jsonify(error="Falta note_id"), 400
    note = None
    for n in repository.get_user_notes(uid):
        if n["id"] == note_id:
            note = n
            break
    if not note:
        return jsonify(error="Nota no encontrada"), 404
    body = f"# {note.get('title') or 'Sin título'}\n\n{note.get('content') or ''}"

    from modules.storage import store
    ref = store.ai_save_file(token, repository.note_filename_for_title(note.get('title')),
                                      body.encode("utf-8"), username, uid)
    if "error" in ref:
        return jsonify(error=ref["error"]), 400
    return jsonify(ref), 201
