import os
import uuid
import shutil
import sys
import mimetypes
from functools import wraps
from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from modules.session import session as sess
from core.socket_ext import socketio
from core.notifications import notifier
from config.config import CONFIG
from . import services, repository
from core.limiter import limiter

chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')
limiter.exempt(chat_bp)


def _get_upload_dir() -> str:
    return os.path.join(CONFIG.DATA_DIR, 'chat_uploads')

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('token') or request.headers.get('X-Token')
        user_id = sess.get_user_id(token) if token else None
        if not user_id:
            return jsonify(error="No autorizado"), 401
        request.user_id = user_id
        request.user_token = token
        return f(*args, **kwargs)
    return decorated_function


@chat_bp.route('/conversations', methods=['GET'])
@login_required
def get_conversations():
    return jsonify(conversations=services.get_conversations(request.user_id))


@chat_bp.route('/messages', methods=['POST'])
@login_required
def get_messages():
    data = request.get_json() or {}
    contact_id = data.get('contact_id')
    if not contact_id:
        return jsonify(error="contact_id requerido"), 400
        
    try:
        before = float(data['before']) if 'before' in data and data['before'] is not None else None
    except (ValueError, TypeError):
        before = None

    try:
        limit = min(int(data.get('limit', 50)), 100)
    except (ValueError, TypeError):
        limit = 50
        
    return jsonify(messages=services.get_messages(request.user_id, contact_id, before, limit))


@chat_bp.route('/send', methods=['POST'])
@login_required
def send_message():
    user_id = request.user_id
    if request.is_json:
        data = request.get_json() or {}
        receiver_id = data.get('receiver_id')
        message = data.get('message', '').strip()
        file_path, file_name, file_size = None, None, None
    else:
        receiver_id = request.form.get('receiver_id')
        message = request.form.get('message', '').strip()
        
        file = request.files.get('file')
        if file and file.filename:
            file.seek(0, os.SEEK_END)
            size = file.tell()
            file.seek(0)
            
            mime_type, _ = mimetypes.guess_type(file.filename)
            mime_type = mime_type or file.content_type or ''
            is_media = mime_type.startswith(('image/', 'video/', 'audio/'))
            
            if is_media and size > 16 * 1024 * 1024:
                return jsonify(error="El archivo multimedia supera el límite de 16MB"), 400
            elif not is_media and size > 2 * 1024 * 1024 * 1024:
                return jsonify(error="El archivo supera el límite de 2GB"), 400
                
            file_name = secure_filename(file.filename)
            file_path = f"{str(uuid.uuid4())}_{file_name}"
            save_path = os.path.join(_get_upload_dir(), file_path)
            
            try:
                os.makedirs(os.path.dirname(save_path), exist_ok=True)
                file.save(save_path)
                file_size = os.path.getsize(save_path)
                
                # Integración con Cloud: Mensajeria
                try:
                    sender_data = sess.get_user(request.user_token)
                    receiver_data = repository.get_contact_by_id(receiver_id)
                    if sender_data and receiver_data:
                        sender_username = sender_data['username']
                        receiver_username = receiver_data['username']
                        
                        from modules.api.cloud.services import BASE_CLOUD_ROOT
                        def sanitize_uid(uid):
                            return "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip() or "unknown"
                        
                        sender_cloud_dir = os.path.join(BASE_CLOUD_ROOT, sanitize_uid(user_id), "Mensajeria", receiver_username)
                        receiver_cloud_dir = os.path.join(BASE_CLOUD_ROOT, sanitize_uid(receiver_id), "Mensajeria", sender_username)
                        
                        os.makedirs(sender_cloud_dir, exist_ok=True)
                        os.makedirs(receiver_cloud_dir, exist_ok=True)
                        
                        def link_or_copy(src, dst):
                            try:
                                os.link(src, dst)
                            except OSError:
                                shutil.copy2(src, dst)
                                
                        link_or_copy(save_path, os.path.join(sender_cloud_dir, file_name))
                        link_or_copy(save_path, os.path.join(receiver_cloud_dir, file_name))
                except Exception as ex:
                    sys.stderr.write(f"[CHAT][CLOUD_SYNC_ERROR] {ex}\n")
                    
            except (IOError, OSError) as e:
                sys.stderr.write(f"[CHAT][ERROR] Error al guardar adjunto: {e}\n")
                return jsonify(error="Error interno al procesar el archivo"), 500
        else:
            file_path, file_name, file_size = None, None, None

    result, error = services.send_message(user_id, receiver_id, message, file_path, file_name, file_size)
    if error:
        return jsonify(error=error), 404 if "encontrado" in error else 400

    socketio.emit('new_message', {**result, 'mine': False}, room=f"user_{result['receiver_id']}")
    socketio.emit('new_message', result, room=f"user_{user_id}")
    
    # Only notify if the receiver hasn't muted the sender
    if not repository.is_muted(receiver_id, user_id):
        sender = sess.get_user(request.user_token)
        if sender:
            notifier.notify_chat_message(sender['username'], receiver_id, message, file_name)
    
    return jsonify(ok=True, message=result)


@chat_bp.route('/download/<string:msg_id>')
@login_required
def download_file(msg_id):
    msg = repository.get_message_by_id(msg_id)
    if not msg or not msg['file_path']:
        return jsonify(error="Archivo no encontrado"), 404
    if msg['sender_id'] != request.user_id and msg['receiver_id'] != request.user_id:
        return jsonify(error="Acceso denegado a este recurso"), 403

    safe_filename = os.path.basename(msg['file_path'])
    return send_from_directory(_get_upload_dir(), safe_filename, as_attachment=True)


@chat_bp.route('/read', methods=['POST'])
@login_required
def mark_as_read():
    data = request.get_json() or {}
    contact_id = data.get('contact_id')
    if not contact_id:
        return jsonify(error="contact_id requerido"), 400
    changed, cid = services.mark_read(request.user_id, contact_id)
    if changed:
        socketio.emit('messages_read', {'reader_id': request.user_id}, room=f"user_{cid}")
    return jsonify(ok=True)


@chat_bp.route('/unread_count', methods=['GET'])
@login_required
def unread_count():
    return jsonify(count=services.get_unread_count(request.user_id))


@chat_bp.route('/new', methods=['POST'])
@login_required
def start_conversation():
    data = request.get_json() or {}
    contact_id = data.get('contact_id')
    if not contact_id:
        return jsonify(error="contact_id requerido"), 400
    contact = services.start_conversation(request.user_id, contact_id)
    if not contact:
        return jsonify(error="Usuario no encontrado"), 404
    return jsonify(ok=True, contact=contact)


@chat_bp.route('/users/search', methods=['GET'])
@login_required
def search_users():
    query = request.args.get('q', '').strip()
    if len(query) < 2:
        return jsonify(users=[])
    return jsonify(users=services.search_users(query, request.user_id))


@chat_bp.route('/poll', methods=['POST'])
@login_required
def poll_new_messages():
    data = request.get_json() or {}
    contact_id = data.get('contact_id')
    
    try:
        since = float(data.get('since', 0))
    except (ValueError, TypeError):
        since = 0.0
        
    return jsonify(messages=services.poll_messages(request.user_id, since, contact_id))


@chat_bp.route('/edit', methods=['POST'])
@login_required
def edit_message():
    user_id = request.user_id
    data = request.get_json() or {}
    msg_id = data.get('msg_id')
    new_text = (data.get('message') or '').strip()
    if not msg_id or not new_text:
        return jsonify(error="msg_id y message requeridos"), 400

    msg = repository.get_message_by_id(msg_id)
    if not msg or msg['sender_id'] != user_id:
        return jsonify(error="Acceso denegado"), 403

    result, error = services.edit_message(user_id, msg_id, new_text)
    if error:
        return jsonify(error=error), 400

    payload = {'msg_id': msg_id, 'message': new_text, 'edited_at': result['edited_at']}
    socketio.emit('message_edited', payload, room=f"user_{user_id}")
    if msg['receiver_id'] != user_id:
        socketio.emit('message_edited', payload, room=f"user_{msg['receiver_id']}")

    return jsonify(ok=True, edited_at=result['edited_at'])


@chat_bp.route('/delete_message', methods=['POST'])
@login_required
def delete_message():
    user_id = request.user_id
    data = request.get_json() or {}
    msg_id = data.get('msg_id')
    if not msg_id:
        return jsonify(error="msg_id requerido"), 400

    r = repository.get_message_by_id(msg_id)
    if not r or (r['sender_id'] != user_id and r['receiver_id'] != user_id):
        return jsonify(error="Mensaje no encontrado o acceso denegado"), 403

    delete_type = data.get('delete_type', 'for_me')
    delete_files = data.get('delete_files', False)

    ok, msg = services.delete_message(user_id, msg_id, delete_type, delete_files)
    if ok:
        socketio.emit('message_deleted', {'msg_id': msg_id}, room=f"user_{user_id}")
        if delete_type == 'for_everyone' and r['receiver_id'] != user_id:
            socketio.emit('message_deleted', {'msg_id': msg_id}, room=f"user_{r['receiver_id']}")
    return jsonify(ok=ok, msg=msg)


@chat_bp.route('/delete_conversation', methods=['POST'])
@login_required
def delete_conversation():
    data = request.get_json() or {}
    contact_id = data.get('contact_id')
    ok, error = services.delete_conversation(request.user_id, contact_id)
    if not ok:
        return jsonify(error=error), 400
    return jsonify(success=True)


@chat_bp.route('/toggle_mute', methods=['POST'])
@login_required
def toggle_mute():
    data = request.get_json() or {}
    contact_id = data.get('contact_id')
    if not contact_id:
        return jsonify(error="Falta contact_id"), 400
    res, error = services.toggle_mute(request.user_id, contact_id)
    if error and 'No se pudo' in error:
        return jsonify(error=error), 400
    return jsonify(res)


@chat_bp.route('/forward', methods=['POST'])
@login_required
def forward_message():
    user_id = request.user_id
    data = request.get_json() or {}
    msg_id = data.get('msg_id')
    target = data.get('target_contact_id')
    if not msg_id or not target:
        return jsonify(error="msg_id y target_contact_id requeridos"), 400
        
    orig = repository.get_message_by_id(msg_id)
    if not orig or (orig['sender_id'] != user_id and orig['receiver_id'] != user_id):
        return jsonify(error="Acceso denegado al mensaje origen"), 403

    result, error = services.forward_message(user_id, msg_id, target)
    if error:
        return jsonify(error=error), 400
    socketio.emit('new_message', {**result, 'mine': False}, room=f"user_{target}")
    socketio.emit('new_message', result, room=f"user_{user_id}")
    return jsonify(ok=True, message=result)


@chat_bp.route('/forward/contacts', methods=['GET'])
@login_required
def forward_contacts():
    return jsonify(contacts=services.get_forward_contacts(request.user_id))


@chat_bp.route('/save_to_cloud', methods=['POST'])
@login_required
def save_message_to_cloud():
    user_id = request.user_id
    token = request.user_token
    data = request.get_json() or {}
    msg_id = data.get('msg_id')
    if not msg_id:
        return jsonify(error="msg_id requerido"), 400
        
    msg = repository.get_message_by_id(msg_id)
    if not msg:
        return jsonify(error="Mensaje no encontrado"), 404
    msg = dict(msg)
        
    if msg['sender_id'] != user_id and msg['receiver_id'] != user_id:
        return jsonify(error="No autorizado para acceder a este mensaje"), 403
        
    if not msg.get('file_path') or not msg.get('file_name'):
        return jsonify(error="El mensaje no contiene ningún archivo"), 400
        
    source_filename = os.path.basename(msg['file_path'])
    source_file_path = os.path.join(_get_upload_dir(), source_filename)
    if not os.path.exists(source_file_path):
        return jsonify(error="Archivo no encontrado en el servidor"), 404
        
    from modules.api.cloud import services as cloud_services
    cloud_root = cloud_services.get_view_root('drive', token)
    if not cloud_root:
        return jsonify(error="No se pudo acceder a tu almacenamiento en la nube"), 403
        
    dest_name = os.path.basename(msg['file_name'])
    dest_path = os.path.join(cloud_root, dest_name)
    
    file_size = os.path.getsize(source_file_path)
    limit_gb = cloud_services.get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = cloud_services.get_dir_size(cloud_services.get_user_root(token))
    
    if current_usage + file_size > limit_bytes:
        return jsonify(error="Espacio insuficiente en Null-Void Cloud"), 400
        
    base, ext = os.path.splitext(dest_name)
    counter = 1
    while os.path.exists(dest_path):
        dest_name = f"{base} ({counter}){ext}"
        dest_path = os.path.join(cloud_root, dest_name)
        counter += 1
        
    try:
        shutil.copy2(source_file_path, dest_path)
        username = sess.get_user(token)
        cloud_services.add_activity(username, user_id, "Guardaste desde chat", dest_name, "")
        return jsonify(ok=True, name=dest_name)
    except Exception as e:
        sys.stderr.write(f"[CHAT][ERROR] Error volcando a la nube: {e}\n")
        return jsonify(error="Error interno al transferir a la nube"), 500