import os
import sys
import glob
import logging
from functools import wraps
from flask import Blueprint, jsonify, request, send_file
from modules.session import session as sess
from core.socket_ext import socketio
from . import services, repository

logger = logging.getLogger("NullVoidCloud")

service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../'))
if service_dir not in sys.path:
    sys.path.insert(0, service_dir)

import sync_agent

from core.limiter import limiter

cloud_bp = Blueprint('cloud', __name__, url_prefix='/api/cloud')
limiter.exempt(cloud_bp)


def get_user_from_token(token):
    if not token: return None, None
    user_id = sess.get_user_id(token)
    if user_id: return user_id, sess.get_user(token)
    from core.database import get_db
    with get_db() as conn:
        row = conn.execute("SELECT u.user_id, u.username FROM cloud_device_tokens t JOIN cloud_devices d ON t.device_id = d.id JOIN users u ON d.user_id = u.user_id WHERE t.token = ?", (token,)).fetchone()
        if row: return row['user_id'], row['username']
    return None, None


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('token') or request.headers.get('X-Token')
        if not token:
            auth = request.headers.get('Authorization')
            if auth and auth.startswith('Bearer '):
                token = auth.split(' ')[1]
        user_id, username = get_user_from_token(token)
        if not user_id:
            return jsonify(error="No autorizado"), 401
        request.user_id = user_id
        request.user_token = token
        request.username = username
        return f(*args, **kwargs)
    return decorated_function


@cloud_bp.route('/recent', methods=['GET'])
@login_required
def list_recent():
    files = services.list_recent(request.user_token)
    return jsonify(files=files or [])


@cloud_bp.route('/files', methods=['GET'])
@login_required
def list_files():
    view = request.args.get('view', 'drive')
    subpath = request.args.get('path', '')
    token = request.user_token
    
    if view == 'trash':
        files, cp = services.list_trash(token, services.get_user_root(token))
        return jsonify(files=files, current_path=cp)
        
    if view == 'shared' and subpath:
        files, cp = services.list_shared_subpath(subpath, token)
        if files is None:
            return jsonify(error="Ruta compartida no encontrada"), 404
        return jsonify(files=files, current_path=cp)
        
    files, cp = services.list_files(view, subpath, token)
    if files is None:
        return jsonify(error="Acceso denegado"), 403
    return jsonify(files=files, current_path=cp)


@cloud_bp.route('/upload', methods=['POST'])
@login_required
def upload_file():
    view = request.form.get('view') or request.args.get('view') or 'drive'
    subpath = request.form.get('path') or request.args.get('path') or ''
    
    if 'file' not in request.files:
        return jsonify(error="No hay archivo"), 400
        
    MAX_SIZE = 50 * 1024 * 1024 * 1024
    if request.content_length and request.content_length > MAX_SIZE:
        return jsonify(error="El archivo supera el límite de 50GB"), 413
        
    file = request.files['file']
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    
    if size > MAX_SIZE:
        return jsonify(error="El archivo supera el límite de 50GB"), 413
        
    overwrite = request.form.get('overwrite') == 'true' or request.args.get('overwrite') == 'true'
    ok, err = services.upload_file(view, subpath, request.user_token, file, overwrite_existing=overwrite)
    if ok is None:
        return jsonify(error="Acceso denegado"), 403
    if err:
        return jsonify(error=err), 400
    return jsonify(ok=True)


@cloud_bp.route('/mkdir', methods=['POST'])
@login_required
def make_dir():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    subpath = data.get('path', '')
    
    if not name or not str(name).strip():
        return jsonify(error="El nombre no puede estar vacío"), 400
        
    result = services.make_dir(view, str(name).strip(), subpath, request.user_token)
    if result is None:
        return jsonify(error="No autorizado"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@cloud_bp.route('/delete', methods=['POST'])
@login_required
def delete_item():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    subpath = data.get('path', '')
    trash_id = data.get('id')
    
    result = services.delete_item(view, name, subpath, trash_id, request.user_token)
    if result is None:
        return jsonify(error="No autorizado o no encontrado"), 404
    if isinstance(result, str):
        return jsonify(error=result), 403
    return jsonify(ok=True, trashed=True)


@cloud_bp.route('/restore', methods=['POST'])
@login_required
def restore_item():
    data = request.get_json(silent=True) or {}
    ok, err = services.restore_item(data.get('id'), request.user_token)
    if ok is None:
        return jsonify(error=err), 400 if err else 404
    return jsonify(ok=True)


@cloud_bp.route('/empty_trash', methods=['POST'])
@login_required
def empty_trash():
    services.empty_trash(request.user_token)
    return jsonify(ok=True)


@cloud_bp.route('/rename', methods=['POST'])
@login_required
def rename_item():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    subpath = data.get('path', '')
    
    if not new_name or not str(new_name).strip():
        return jsonify(error="El nombre no puede estar vacío"), 400
        
    result = services.rename_item(view, old_name, str(new_name).strip(), subpath, request.user_token)
    if result is None:
        return jsonify(error="No autorizado o archivo no encontrado"), 404
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@cloud_bp.route('/move', methods=['POST'])
@login_required
def move_item():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    old_path = data.get('old_path', '')
    new_path = data.get('new_path', '')
    
    if not name:
        return jsonify(error="Falta el nombre del archivo"), 400
        
    result = services.move_item(view, name, old_path, new_path, request.user_token)
    if result is None:
        return jsonify(error="No autorizado o sesión expirada"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@cloud_bp.route('/copy', methods=['POST'])
@login_required
def copy_item():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    old_path = data.get('old_path', '')
    new_path = data.get('new_path', '')
    new_name = data.get('new_name')
    
    if not name:
        return jsonify(error="Falta el nombre del archivo"), 400
        
    result = services.copy_item(view, name, old_path, new_path, request.user_id, request.user_token, new_name)
    if result is None:
        return jsonify(error="No autorizado o sesión expirada"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@cloud_bp.route('/zip', methods=['POST'])
@login_required
def zip_item():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    subpath = data.get('path', '')
    zip_name = data.get('zip_name')
    
    if not name:
        return jsonify(error="Falta especificar el elemento a comprimir"), 400
        
    result = services.zip_item(view, name, subpath, request.user_token, zip_name)
    if result is None:
        return jsonify(error="No autorizado o ruta no válida"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@cloud_bp.route('/unzip', methods=['POST'])
@login_required
def unzip_item():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    subpath = data.get('path', '')
    
    if not name:
        return jsonify(error="Falta especificar el archivo a descomprimir"), 400
        
    result = services.unzip_item(view, name, subpath, request.user_token)
    if result is None:
        return jsonify(error="No autorizado o ruta no válida"), 401
    if isinstance(result, str):
        return jsonify(error=result), 400
    return jsonify(ok=True)


@cloud_bp.route('/toggle_star', methods=['POST'])
@login_required
def toggle_star():
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    subpath = data.get('path', '')
    owner_id = data.get('owner_id')
    view = data.get('view', 'drive')
    
    ok, is_starred = services.toggle_star(name, subpath, view, owner_id, request.user_token)
    if not ok:
        return jsonify(error="Error"), 400
    return jsonify(ok=True, is_starred=is_starred)


@cloud_bp.route('/toggle_protect', methods=['POST'])
@login_required
def toggle_protect():
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    subpath = data.get('path', '')
    view = data.get('view', 'drive')
    
    ok, is_prot = services.toggle_protect(name, subpath, view, request.user_token)
    if not ok:
        return jsonify(error=is_prot if isinstance(is_prot, str) else "Error al cambiar el estado de protección"), 400
    return jsonify(ok=True, is_protected=is_prot)


@cloud_bp.route('/list_starred', methods=['GET'])
@login_required
def list_starred():
    files = services.list_starred(request.user_token)
    return jsonify(files=files or [])


@cloud_bp.route('/quota', methods=['GET', 'POST', 'DELETE'])
@login_required
def quota_manager():
    if request.method == 'DELETE':
        repository.cancel_quota_request(request.user_id)
        from core.socket_ext import socketio
        socketio.emit('admin_quota_refresh', {})
        return jsonify(ok=True)
        
    if request.method == 'POST':
        if repository.has_pending_quota_request(request.user_id):
            return jsonify(error="Ya tienes una petición pendiente"), 400
        repository.create_quota_request(request.user_id, 10)
        from core.socket_ext import socketio
        socketio.emit('admin_quota_refresh', {})
        return jsonify(ok=True)
        
    info = services.get_quota_info(request.user_token)
    info['has_pending_request'] = repository.has_pending_quota_request(request.user_id)
    return jsonify(info)


@cloud_bp.route('/admin/quota_requests', methods=['GET', 'POST'])
@login_required
def admin_quota_requests():
    # Autorización por rol/permiso explícito (columna `role` de users),
    # no por coincidencia del nombre de usuario.
    if not repository.is_admin(request.user_id):
        logger.warning(f"[SECURITY][ALERT] Acceso admin denegado para user_id={request.user_id}")
        return jsonify(error="No autorizado"), 403
        
    if request.method == 'GET':
        reqs = repository.get_pending_quota_requests()
        # Convert list of dict/rows to list of dicts safely
        formatted_reqs = []
        for r in reqs:
            formatted_reqs.append({
                'id': r['id'],
                'requested_gb': r['requested_gb'],
                'created_at': r['created_at'],
                'username': r['username']
            })
        return jsonify(requests=formatted_reqs)
        
    data = request.get_json(silent=True) or {}
    req_id = data.get('id')
    action = data.get('action') # 'approved' or 'rejected'
    
    if action in ['approved', 'rejected']:
        target_uid = repository.resolve_quota_request(req_id, action)
        if target_uid:
            from core.socket_ext import socketio
            socketio.emit('quota_updated', {}, room=f"user_{target_uid}")
    return jsonify(ok=True)


@cloud_bp.route('/info', methods=['POST'])
@login_required
def get_file_info():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    subpath = data.get('path', '')
    trash_id = data.get('id')
    owner_id = data.get('owner_id')
    
    info = services.get_file_info(view, name, subpath, trash_id, owner_id, request.user_token)
    if not info:
        return jsonify(error="No existe"), 404
    return jsonify(info)


@cloud_bp.route('/preview', methods=['GET'])
@login_required
def preview_file():
    view = request.args.get('view', 'drive')
    name = request.args.get('name', '')
    subpath = request.args.get('path', '')
    trash_id = request.args.get('id')
    owner_id = request.args.get('owner_id')
    
    resp, err = services.preview_file(view, name, subpath, trash_id, owner_id, request.user_token)
    if resp is None:
        if err:
            return err, 400 if err != "No encontrado" else 404
        return "No encontrado", 404
    return resp


@cloud_bp.route('/item_activity', methods=['POST'])
@login_required
def get_item_activity():
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    subpath = data.get('path', '')
    owner_id = data.get('owner_id')
    
    activity = services.get_item_activity(name, subpath, owner_id, request.user_token)
    return jsonify(activity=activity or [])


@cloud_bp.route('/search', methods=['GET'])
@login_required
def search_files():
    query = request.args.get('q', '')
    files = services.search_files(query, request.user_token)
    return jsonify(files=files or [])


@cloud_bp.route('/folders', methods=['GET'])
@login_required
def get_folders_tree():
    view = request.args.get('view', 'drive')
    path = (request.args.get('path', '') or '').strip('/')
    tree = services.get_folders_tree(view, request.user_token, path=path or None)
    resp = jsonify(tree=tree)
    # El árbol se construye por niveles (carga perezosa); nunca cachear la
    # respuesta o el navegador podría servir un árbol antiguo incompleto.
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@cloud_bp.route('/get_token', methods=['POST'])
@login_required
def get_download_token():
    data = request.get_json(silent=True) or {}
    view = data.get('view', 'drive')
    name = data.get('name')
    subpath = data.get('path', '')
    trash_id = data.get('id')
    owner_id = data.get('owner_id')
    
    dl_token, err = services.get_download_token(view, name, subpath, owner_id, trash_id, request.user_token)
    if not dl_token:
        return jsonify(error=err or "Archivo no encontrado"), 404
    return jsonify(t=dl_token)


@cloud_bp.route('/get_multi_token', methods=['POST'])
@login_required
def get_multi_download_token():
    data = request.get_json(silent=True) or {}
    items = data.get('items', [])
    view = data.get('view', 'drive')
    
    dl_token, err = services.get_multi_download_token(items, view, request.user_token)
    if not dl_token:
        return jsonify(error=err or "No se encontraron archivos válidos"), 400
    return jsonify(t=dl_token)


@cloud_bp.route('/download', methods=['GET'])
def download_file():
    dl_token = request.args.get('t')
    resp, err = services.download_file(dl_token)
    if resp is None:
        return err or "Token inválido", 403
    return resp


@cloud_bp.route('/stream_video', methods=['GET'])
def stream_video():
    dl_token = request.args.get('t')
    quality = request.args.get('quality', 'original').lower()
    status_only = request.args.get('status') == '1'
    available_only = request.args.get('available') == '1'
    resp, err = services.stream_video(dl_token, quality, status_only, available_only)
    if resp is None:
        return err or "Token inválido", 403
    if isinstance(resp, dict):
        # available=1: lista de calidades generadas; si no, transcodificación
        # en curso (el frontend hará polling hasta que el cache esté listo).
        return jsonify(resp), 200 if available_only else 202
    return resp


@cloud_bp.route('/users/search', methods=['GET'])
@login_required
def search_users():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify(users=[])
    
    from modules.api.friends import repository as friends_repo
    friends = friends_repo.get_friends(request.user_id)
    
    filtered = []
    for f in friends:
        if query.lower() in f['friend_name'].lower():
            filtered.append({
                'user_id': f['friend_id'],
                'username': f['friend_name'],
                'email': ''
            })
    return jsonify(users=filtered)


@cloud_bp.route('/contacts', methods=['GET'])
@login_required
def list_contacts():
    from modules.api.friends import repository as friends_repo
    friends = friends_repo.get_friends(request.user_id)
    
    mapped_contacts = []
    for f in friends:
        mapped_contacts.append({
            'user_id': f['friend_id'],
            'username': f['friend_name'],
            'email': ''
        })
    return jsonify(contacts=mapped_contacts)


@cloud_bp.route('/contacts/add', methods=['POST'])
@login_required
def add_contact():
    data = request.get_json(silent=True) or {}
    contact_id = data.get('contact_id')
    if not contact_id:
        return jsonify(error="Datos insuficientes"), 400
    repository.add_user_contact(request.user_id, contact_id)
    return jsonify(ok=True)


@cloud_bp.route('/contacts/remove', methods=['POST'])
@login_required
def remove_contact():
    data = request.get_json(silent=True) or {}
    contact_id = data.get('contact_id')
    repository.remove_user_contact(request.user_id, contact_id)
    return jsonify(ok=True)


@cloud_bp.route('/share', methods=['POST'])
@login_required
def share_item():
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    path = data.get('path', '')
    view = data.get('view', 'drive')
    shared_with = data.get('shared_with', [])
    
    result = services.share_file(name, path, view, shared_with, request.user_token)
    if isinstance(result, str):
        return jsonify(error=result), 400
        
    for uid in shared_with:
        socketio.emit('file_shared', {'name': name, 'by': request.user_id}, room=f"user_{uid}")
        
    return jsonify(ok=True)


@cloud_bp.route('/share/status', methods=['POST'])
@login_required
def share_status():
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    path = data.get('path', '')
    shares = services.list_file_shares(name, path, request.user_token)
    return jsonify(shares=shares)


@cloud_bp.route('/shared_with_me', methods=['GET'])
@login_required
def list_shared_with_me():
    files = services.list_shared_with_me(request.user_token)
    return jsonify(files=files or [])


@cloud_bp.route('/shared_by_me', methods=['GET'])
@login_required
def list_shared_by_me():
    shared = services.list_shared_by_me(request.user_token)
    return jsonify(files=shared or [])


@cloud_bp.route('/sync-agent/ping', methods=['POST'])
def sync_agent_ping():
    token = sync_agent.get_agent_token()
    uid, username = get_user_from_token(token)
    if not username:
        return jsonify(error="Unauthorized"), 401
    return sync_agent.handle_ping(token, username, request.get_json(silent=True) or {})


@cloud_bp.route('/sync-agent/disconnect', methods=['POST'])
def sync_agent_disconnect():
    token = sync_agent.get_agent_token()
    uid, username = get_user_from_token(token)
    if not username:
        return jsonify(error="Unauthorized"), 401
    return sync_agent.handle_disconnect(token, username, request.get_json(silent=True) or {})


@cloud_bp.route('/sync-agent/changes', methods=['POST'])
def sync_agent_changes():
    token = sync_agent.get_agent_token()
    uid, username = get_user_from_token(token)
    if not username:
        return jsonify(error="Unauthorized"), 401
    return sync_agent.handle_changes(token, username, request.get_json(silent=True) or {})


@cloud_bp.route('/sync-agent/download', methods=['GET'])
def sync_agent_download():
    token = sync_agent.get_agent_token()
    uid, username = get_user_from_token(token)
    if not username:
        return jsonify(error="Unauthorized"), 401
    return sync_agent.handle_download(token, username)


@cloud_bp.route('/sync-agent/download-client', methods=['GET'])
def download_client_agent():
    try:
        service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../'))
        possible_paths = [
            os.path.join(service_dir, 'client_agent'),
            os.path.abspath(os.path.join(service_dir, '..', 'client_agent')),
            '/app/client_agent',
            '/client_agent'
        ]
        client_agent_dir = next((p for p in possible_paths if os.path.exists(p)), possible_paths[0])

        dist_dir = os.path.join(client_agent_dir, 'dist')
        user_agent = request.headers.get('User-Agent', '').lower()
        is_windows = any(w in user_agent for w in ['windows', 'win32', 'win64'])
        is_mac = any(m in user_agent for m in ['macintosh', 'mac os', 'darwin'])

        def _first_existing(paths):
            for p in paths:
                if p and os.path.exists(p):
                    return p
            return None

        # Ejecutable nativo de escritorio (PySide6/Qt): nv-agent en Linux,
        # nv-agent.exe en Windows y nv-agent-mac en macOS. Se compila bajo
        # demanda con client_agent/compile.sh (no forma parte de Docker).
        if is_windows:
            exe = _first_existing([
                os.path.join(dist_dir, 'Null-Void-Agent.exe'),
                os.path.join(dist_dir, 'nv-agent.exe')
            ])
            if exe:
                return send_file(exe, as_attachment=True, download_name='Null-Void-Agent.exe')
        else:
            linux = _first_existing([
                os.path.join(dist_dir, 'Null-Void-Agent-Linux'),
                os.path.join(dist_dir, 'nv-agent')
            ])
            if linux:
                return send_file(linux, as_attachment=True, download_name='Null-Void-Agent-Linux')

        # Último recurso: el script del agente (ejecución desde Python).
        py_script = os.path.join(client_agent_dir, 'agent.py')
        if os.path.exists(py_script):
            return send_file(py_script, as_attachment=True, download_name='nullvoid_sync_agent.py')
        return jsonify(error="Agent file not found"), 404
    except Exception as e:
        logger.error(f"Error sirviendo el cliente de sync: {e}", exc_info=True)
        return jsonify(error="Error interno al preparar el cliente"), 500


@cloud_bp.route('/sync-agent/generate-token', methods=['POST'])
def sync_agent_generate_token():
    token = sync_agent.get_agent_token()
    uid, username = get_user_from_token(token)
    if not username:
        return jsonify(error="Unauthorized"), 401
    data = request.get_json(silent=True) or {}
    target_device = data.get("target_device", "")
    return sync_agent.handle_generate_token(token, username, target_device=target_device)


@cloud_bp.route('/sync-agent/check-token-status', methods=['POST'])
def sync_agent_check_token_status():
    try:
        data = request.get_json(silent=True) or {}
        return sync_agent.handle_check_token_status(data)
    except Exception as e:
        import traceback
        logger.error(f"check-token-status error: {traceback.format_exc()}")
        return jsonify(used=False, active=False)


@cloud_bp.route('/sync-agent/list-devices', methods=['POST'])
def sync_agent_list_devices():
    try:
        data = request.get_json(silent=True) or {}
        return sync_agent.handle_list_devices(data)
    except Exception as e:
        import traceback
        logger.error(f"list-devices error: {traceback.format_exc()}")
        return jsonify(error=f"Error interno: {e}"), 500


@cloud_bp.route('/sync-agent/my-devices', methods=['POST'])
def sync_agent_my_devices():
    """Lista los PCs del usuario autenticado por el token de dispositivo (Bearer)."""
    try:
        return sync_agent.handle_my_devices(sync_agent.get_agent_token())
    except Exception as e:
        import traceback
        logger.error(f"my-devices error: {traceback.format_exc()}")
        return jsonify(error=f"Error interno: {e}"), 500


@cloud_bp.route('/sync-agent/register', methods=['POST'])
def sync_agent_register():
    data = request.get_json(silent=True) or {}
    return sync_agent.handle_register(data)


@cloud_bp.route('/unshare', methods=['POST'])
@login_required
def unshare_item():
    data = request.get_json(silent=True) or {}
    owner_id = data.get('owner_id')
    name = data.get('name')
    shared_with = data.get('shared_with')
    
    current_uid = request.user_id
    if not name:
        return jsonify(error="Falta nombre de archivo"), 400

    if owner_id and owner_id != current_uid:
        repository.stop_sharing_with_me(owner_id, current_uid, name)
        socketio.emit('share_removed', {'name': name, 'by': current_uid}, room=f"user_{owner_id}")
    else:
        if not shared_with:
            return jsonify(error="Falta usuario a revocar"), 400
        repository.stop_sharing_with_me(current_uid, shared_with, name)
        socketio.emit('share_removed', {'name': name, 'by': current_uid}, room=f"user_{shared_with}")
        
    return jsonify(success=True)