from flask import Blueprint, jsonify, request, send_file
from modules.session import session as sess
from . import services, repository
from .connector import FOLDER_NAMES

mail_bp = Blueprint('mail', __name__, url_prefix='/api/mail')


def _get_uid():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    return sess.get_user_id(token)


def _get_user():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    return sess.get_user(token), sess.get_user_id(token)


@mail_bp.route('/folders', methods=['GET'])
def get_folders():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    mode = request.args.get('mode', 'google')
    force_refresh = request.args.get('refresh') == 'true'
    google_email = request.args.get('google_email')
    try:
        folders = services.get_folders(user_id, mode, force_refresh, google_email=google_email)
        return jsonify(folders=folders)
    except Exception as e:
        return jsonify(error=str(e)), 500


@mail_bp.route('/emails')
def get_folder_emails():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    folder = request.args.get('folder', 'inbox')
    mode = request.args.get('mode', 'google')
    force_refresh = request.args.get('refresh') == 'true'
    google_email = request.args.get('google_email')

    try:
        page = int(request.args.get('page', 1))
    except (ValueError, TypeError):
        page = 1
    try:
        data = services.get_emails(user_id, folder, mode, force_refresh, google_email=google_email, page=page)
        resp = {"emails": data["emails"], "has_more": data.get("has_more", False), "folder": folder, "folder_name": FOLDER_NAMES.get(folder, folder)}
        return jsonify(resp)
    except Exception as e:
        return jsonify(error=str(e)), 500


@mail_bp.route('/read')
def read_email_in_folder():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    folder = request.args.get('folder')
    msg_id = request.args.get('id')
    mode = request.args.get('mode', 'google')
    google_email = request.args.get('google_email')

    if not folder or not msg_id:
        return jsonify(error="Faltan parámetros."), 400

    try:
        result = services.read_email(user_id, folder, msg_id, mode, google_email=google_email)
        if result is None:
            return jsonify(error="Correo no encontrado."), 404
        return jsonify(result)
    except Exception as e:
        return jsonify(error=str(e)), 500


from core.socket_ext import socketio

@mail_bp.route('/send', methods=['POST'])
def send_email():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    username, _ = _get_user()

    if request.content_type and request.content_type.startswith('multipart/form-data'):
        to_email = request.form.get('to')
        subject = request.form.get('subject', '')
        body = request.form.get('body', '')
        mode = request.form.get('mode', 'google')
        is_scheduled = request.form.get('is_scheduled') == 'true'
        scheduled_at = request.form.get('scheduled_at')
        google_email = request.form.get('google_email')
        files = request.files.getlist('attachments')
    else:
        data = request.get_json() or {}
        to_email = data.get('to')
        subject = data.get('subject', '')
        body = data.get('body', '')
        mode = data.get('mode', 'google')
        is_scheduled = data.get('is_scheduled', False)
        scheduled_at = data.get('scheduled_at')
        google_email = data.get('google_email')
        files = []

    if not to_email:
        return jsonify(error="Destinatario (to) es requerido."), 400

    try:
        services.send_email(user_id, username, to_email, subject, body, files, mode, is_scheduled, scheduled_at, google_email=google_email)
        
        if mode == 'internal':
            socketio.emit('mail_updated', {}, room=f"user_{user_id}")
            recipient_id = services.get_recipient_id(to_email)
            if recipient_id:
                socketio.emit('mail_updated', {}, room=f"user_{recipient_id}")
                
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@mail_bp.route('/star', methods=['POST'])
def toggle_star():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    data = request.get_json()
    folder = data.get('folder')
    msg_id = data.get('id')
    star = data.get('star')
    mode = data.get('mode', 'google')
    google_email = data.get('google_email')

    if not folder or not msg_id:
        return jsonify(error="Faltan parámetros."), 400

    try:
        services.toggle_star(user_id, folder, msg_id, star, mode, google_email=google_email)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@mail_bp.route('/bulk', methods=['POST'])
def bulk_action():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    data = request.get_json()
    action = data.get('action')
    folder = data.get('folder')
    msg_ids = data.get('ids', [])
    mode = data.get('mode', 'google')
    google_email = data.get('google_email')

    if not action or not folder or not msg_ids:
        return jsonify(error="Faltan parámetros."), 400

    try:
        services.bulk_action(user_id, folder, action, msg_ids, mode, google_email=google_email)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@mail_bp.route('/empty_trash', methods=['POST'])
def empty_trash():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    data = request.get_json()
    mode = data.get('mode', 'google')
    google_email = data.get('google_email')

    try:
        services.empty_trash(user_id, mode, google_email=google_email)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500


@mail_bp.route('/config', methods=['GET', 'POST', 'DELETE'])
def manage_config():
    user_id = _get_uid()
    if not user_id:
        return jsonify(error="No autorizado"), 401

    username, _ = _get_user()

    if request.method == 'GET':
        return jsonify(services.get_config(user_id, username))

    data = request.get_json()
    email_addr = data.get('email', '').strip()
    
    if request.method == 'DELETE':
        if not email_addr:
            return jsonify(error="Debes proporcionar el correo a borrar."), 400
        services.remove_credentials(user_id, email_addr)
        return jsonify(ok=True)

    app_password = data.get('password', '').strip().replace(' ', '')

    if not email_addr or not app_password:
        return jsonify(error="Debes proporcionar tanto el correo como la contraseña de aplicación."), 400

    try:
        services.verify_credentials(email_addr, app_password)
    except Exception:
        return jsonify(
            error="Credenciales incorrectas o acceso denegado por Google. "
                  "Asegúrate de usar una Contraseña de Aplicación."
        ), 401

    services.save_credentials(user_id, email_addr, app_password)
    return jsonify(ok=True, email=email_addr)


@mail_bp.route('/attachment/<att_id>')
def download_attachment(att_id):
    user_id = _get_uid()
    if not user_id:
        return "No autorizado", 401

    username, _ = _get_user()
    internal_email = f"{username}@nullvoid"

    owner = repository.get_attachment_owner(att_id)
    if owner:
        if owner['user_id'] != user_id and owner['to_email'] != internal_email and owner['from_email'] != internal_email:
            return "Acceso denegado. Este archivo no te pertenece.", 403

    file_path = services.get_attachment_path(att_id)
    if not file_path:
        return "Archivo no encontrado", 404

    filename = request.args.get('filename', 'attachment')
    return send_file(file_path, as_attachment=True, download_name=filename)
