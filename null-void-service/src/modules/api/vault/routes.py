import os
from flask import Blueprint, request, jsonify, render_template, redirect, url_for
from modules.session import session as sess
from core.limiter import limiter
from config.config import CONFIG

from .services import init_vault_file, load_vault_file, save_vault_file

vault_bp = Blueprint('vault', __name__)

def get_vault_path(username: str, filename: str = None) -> str:
    vaults_dir = os.path.join(CONFIG.DATA_DIR, 'vaults')
    
    # Directorio específico del usuario
    user_vault_dir = os.path.join(vaults_dir, username)
    os.makedirs(user_vault_dir, exist_ok=True)
    
    if filename:
        # Asegurar que termina en .enc y prevenir path traversal
        clean_name = os.path.basename(filename)
        if not clean_name.endswith('.enc'):
            clean_name += '.enc'
        return os.path.join(user_vault_dir, clean_name)
    
    return user_vault_dir

def migrate_legacy_vault(username: str):
    vaults_dir = os.path.join(CONFIG.DATA_DIR, 'vaults')
    legacy_file = os.path.join(vaults_dir, f"{username}.enc")
    
    if os.path.exists(legacy_file) and os.path.isfile(legacy_file):
        new_file = get_vault_path(username, "Mi_Vault.enc")
        if not os.path.exists(new_file):
            import shutil
            shutil.move(legacy_file, new_file)

@vault_bp.route('/vault')
def vault_ui():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return redirect(url_for('auth.index'))
    
    migrate_legacy_vault(user)
    
    return render_template('modules/vault.html', user=user)

@vault_bp.route('/api/vault/list', methods=['GET'])
def api_vault_list():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return jsonify({"error": "No autorizado"}), 401
        
    migrate_legacy_vault(user)
    user_vault_dir = get_vault_path(user)
    
    vaults = []
    if os.path.exists(user_vault_dir):
        for f in os.listdir(user_vault_dir):
            if f.endswith('.enc'):
                vaults.append({"filename": f})
                
    return jsonify({"success": True, "vaults": vaults})

@vault_bp.route('/api/vault/init', methods=['POST'])
@limiter.limit("10 per minute")
def api_vault_init():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return jsonify({"error": "No autorizado"}), 401
        
    data = request.get_json() or {}
    filename = data.get('filename')
    file_content = data.get('file_content')
    
    if not filename or not file_content:
        return jsonify({"error": "El nombre de archivo y los datos son obligatorios"}), 400
        
    if len(file_content) > 2 * 1024 * 1024:
        return jsonify({"error": "El archivo es demasiado grande (Max 2MB)"}), 413
        
    vault_path = get_vault_path(user, filename)
    
    if os.path.exists(vault_path):
        return jsonify({"error": "El vault ya existe."}), 400
        
    try:
        init_vault_file(vault_path, file_content.encode('utf-8'))
        return jsonify({"success": True, "message": "Vault inicializado correctamente."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@vault_bp.route('/api/vault/unlock', methods=['POST'])
@limiter.limit("10 per minute")
def api_vault_unlock():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return jsonify({"error": "No autorizado"}), 401
        
    data = request.get_json() or {}
    filename = data.get('filename')
    
    if not filename:
        return jsonify({"error": "Falta el nombre de archivo"}), 400
        
    vault_path = get_vault_path(user, filename)
    
    try:
        blob = load_vault_file(vault_path)
        return jsonify({"success": True, "file_content": blob.decode('utf-8')})
    except FileNotFoundError:
        return jsonify({"error": "Vault no encontrado"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@vault_bp.route('/api/vault/sync', methods=['POST'])
@limiter.limit("5 per minute")
def api_vault_sync():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return jsonify({"error": "No autorizado"}), 401
        
    data = request.get_json() or {}
    filename = data.get('filename')
    file_content = data.get('file_content')
    
    if not filename or not file_content:
        return jsonify({"error": "Faltan datos para sincronizar"}), 400
        
    if len(file_content) > 2 * 1024 * 1024:
        return jsonify({"error": "El archivo es demasiado grande (Max 2MB)"}), 413
        
    vault_path = get_vault_path(user, filename)
    
    try:
        save_vault_file(vault_path, file_content.encode('utf-8'))
        return jsonify({"success": True, "message": "Vault guardado correctamente."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@vault_bp.route('/api/vault/upload', methods=['POST'])
@limiter.limit("5 per minute")
def api_vault_upload():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return jsonify({"error": "No autorizado"}), 401
        
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['file']
    filename = request.form.get('filename')
    
    if not filename:
        return jsonify({"error": "No filename provided"}), 400
        
    blob = file.read()
    if len(blob) > 2 * 1024 * 1024:
        return jsonify({"error": "El archivo es demasiado grande (Max 2MB)"}), 413
        
    vault_path = get_vault_path(user, filename)
    
    try:
        save_vault_file(vault_path, blob)
        return jsonify({"success": True, "message": "Vault guardado correctamente."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
