import tempfile
import zipfile
from flask import Blueprint, request, jsonify, send_file
import os
import shutil
import subprocess
import io
from ui.session import session

import uuid
import time
import json

cloud_bp = Blueprint('cloud', __name__, url_prefix='/api/cloud')

# Almacén de tokens temporales (token -> {path, expires})
download_tokens = {}

# Directorio base para los archivos en la raíz del proyecto
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
BASE_CLOUD_ROOT = os.path.join(PROJECT_ROOT, 'data', 'Cloud')
CONFIG_PATH = os.path.join(PROJECT_ROOT, 'data', 'cloud_config.json')

os.makedirs(BASE_CLOUD_ROOT, exist_ok=True)

def get_token():
    token = request.cookies.get('token')
    if not token:
        token = request.headers.get('X-Token')
    return token

def get_user_root(token=None):
    if token is None:
        token = get_token()
    
    uid = session.get_user_id(token)
    if not uid:
        return None
    
    # Limpiar nombre por seguridad
    safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_uid:
        safe_uid = "unknown"
        
    user_path = os.path.normpath(os.path.join(BASE_CLOUD_ROOT, safe_uid))
    os.makedirs(user_path, exist_ok=True)
        
    return user_path

def get_view_root(view='drive', token=None):
    base_root = get_user_root(token)
    if not base_root: return None
    
    if view == 'computers':
        comp_path = os.path.join(base_root, '.computers')
        if not os.path.exists(comp_path):
            os.makedirs(comp_path, exist_ok=True)
        return comp_path
    
    if view == 'trash':
        trash_path = os.path.join(base_root, '.trash')
        if not os.path.exists(trash_path):
            os.makedirs(trash_path, exist_ok=True)
        return trash_path
    
    return base_root

def get_user_quota(token=None):
    """Obtiene el límite de GB para el usuario actual desde la DB."""
    if token is None:
        token = get_token()
    username = session.get_user(token)
    if not username:
        return 10 # Default
    
    from core.database import get_db
    with get_db() as conn:
        row = conn.execute("SELECT quota_gb FROM users WHERE username = ?", (username,)).fetchone()
        if row and row['quota_gb']:
            return row['quota_gb']
    return 10 # Default

def set_quota_config(limit_gb):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, 'w') as f:
        json.dump({"limit_gb": limit_gb}, f)

def get_dir_size(path):
    if not os.path.exists(path): return 0
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                total_size += os.path.getsize(fp)
    return total_size

def get_disk_info(path):
    total, used, free = shutil.disk_usage(path)
    return {"total": total, "free": free, "used": used}

def add_activity(user, user_id, action, name, path=""):
    if not user_id:
        return
    
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
    os.makedirs(user_root, exist_ok=True)
    
    activity_path = os.path.join(user_root, '.activity.json')
    activity = []
    if os.path.exists(activity_path):
        try:
            with open(activity_path, 'r', encoding='utf-8') as f:
                activity = json.load(f)
        except: pass
    
    activity.insert(0, {
        "user": user,
        "user_id": user_id,
        "action": action,
        "name": name,
        "path": path,
        "time": time.time()
    })
    
    with open(activity_path, 'w') as f:
        json.dump(activity[:50], f)

@cloud_bp.route('/recent', methods=['GET'])
def list_recent():
    user_root = get_user_root()
    token = get_token()
    current_user = session.get_user(token)
    
    if not user_root: return jsonify(error="No autorizado"), 401
        
    starred_path = os.path.join(user_root, '.starred.json')
    starred_list = []
    if os.path.exists(starred_path):
        try:
            with open(starred_path, 'r') as f:
                starred_list = json.load(f)
        except: pass
    
    recent_files = []
    activity_path = os.path.join(user_root, '.activity.json')
    activity_data = []
    if os.path.exists(activity_path):
        try:
            with open(activity_path, 'r') as f:
                activity_data = json.load(f)
        except: pass

    current_uid = session.get_user_id(token)
    
    for act in activity_data:
        if act['name'] == '.activity.json' or act['name'].startswith('.'): continue
        if act.get('user_id') == current_uid:
            fp = os.path.join(user_root, act['path'], act['name'])
            if not os.path.exists(fp):
                fp = os.path.join(user_root, '.computers', act['path'], act['name'])
            
            if os.path.exists(fp):
                info = os.stat(fp)
                is_starred = {"name": act['name'], "path": act['path']} in starred_list
                recent_files.append({
                    "name": act['name'],
                    "path": act['path'],
                    "is_dir": os.path.isdir(fp),
                    "size": info.st_size,
                    "mtime": info.st_mtime,
                    "ext": os.path.splitext(act['name'])[1].lower(),
                    "owner": act['user'],
                    "owner_id": act.get('user_id'),
                    "action_type": act['action'],
                    "action_time": act['time'],
                    "starred": is_starred
                })

    unique_files = []
    seen = set()
    for f in recent_files:
        key = (f['name'], f['path'])
        if key not in seen:
            unique_files.append(f)
            seen.add(key)

    unique_files.sort(key=lambda x: x.get('action_time', x['mtime']), reverse=True)
    return jsonify(files=unique_files[:20])

@cloud_bp.route('/files', methods=['GET'])
def list_files():
    view = request.args.get('view', 'drive')
    user_root = get_view_root(view)
    if not user_root: return jsonify(error="No autorizado"), 401
    
    subpath = request.args.get('path', '').strip('/')
    
    if view == 'trash':
        return list_trash()

    target_path = os.path.abspath(os.path.join(user_root, subpath))
    if not os.path.normcase(target_path).startswith(os.path.normcase(user_root)):
        return jsonify(error="Acceso denegado"), 403
    
    if not os.path.exists(target_path):
        return jsonify(files=[], current_path=subpath)

    prot_path = os.path.join(get_user_root(), '.protected.json')
    protected_data = []
    if os.path.exists(prot_path):
        try:
            with open(prot_path, 'r') as f:
                protected_data = json.load(f)
        except: pass

    # Cargar destacados
    starred_path = os.path.join(get_user_root(), '.starred.json')
    starred_data = []
    if os.path.exists(starred_path):
        try:
            with open(starred_path, 'r') as f:
                starred_data = json.load(f)
        except: pass

    files = []
    try:
        for name in os.listdir(target_path):
            if name.startswith('.'): continue 
            try:
                fp = os.path.join(target_path, name)
                is_dir = os.path.isdir(fp)
                info = os.stat(fp)
                
                is_protected = {"name": name, "path": subpath, "view": view} in protected_data
                if view == 'computers' and subpath == '':
                    is_protected = True

                # Check starred
                is_starred = {"name": name, "path": subpath} in starred_data

                files.append({
                    "name": name,
                    "is_dir": is_dir,
                    "size": info.st_size,
                    "mtime": info.st_mtime,
                    "owner": session.get_user(get_token()),
                    "ext": os.path.splitext(name)[1].lower(),
                    "protected": is_protected,
                    "starred": is_starred
                })
            except Exception as e:
                print(f"[Cloud ERROR] Error con {name}: {e}")
    except Exception as e:
        print(f"[Cloud ERROR] Error listando {target_path}: {e}")
    
    files.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    return jsonify({"files": files, "current_path": subpath})

def list_trash():
    user_root = get_user_root()
    trash_json = os.path.join(user_root, '.trash.json')
    trash_data = []
    if os.path.exists(trash_json):
        try:
            with open(trash_json, 'r') as f:
                trash_data = json.load(f)
        except: pass
        
    files = []
    trash_path = os.path.join(user_root, '.trash')
    for item in trash_data:
        fp = os.path.join(trash_path, item['id'])
        if os.path.exists(fp):
            info = os.stat(fp)
            files.append({
                "id": item['id'],
                "name": item['name'],
                "original_path": item['original_path'],
                "is_dir": os.path.isdir(fp),
                "size": info.st_size,
                "mtime": item['deleted_at'], # Usamos fecha de borrado
                "ext": os.path.splitext(item['name'])[1].lower(),
                "owner": "Papelera",
                "view": item.get('view', 'drive'),
                "trash": True
            })
    
    files.sort(key=lambda x: x['mtime'], reverse=True)
    return jsonify(files=files, current_path='')




@cloud_bp.route('/upload', methods=['POST'])
def upload_file():
    view = request.form.get('view', 'drive')
    user_root = get_view_root(view)
    if not user_root: return jsonify(error="No autorizado"), 401
    
    if 'file' not in request.files:
        return jsonify(error="No hay archivo"), 400
    
    file = request.files['file']
    subpath = request.form.get('path', '').strip('/')
    target_dir = os.path.normpath(os.path.join(user_root, subpath))
    
    if not target_dir.startswith(os.path.normpath(user_root)):
        return jsonify(error="Acceso denegado"), 403

    os.makedirs(target_dir, exist_ok=True)
    
    token = get_token()
    limit_gb = get_user_quota(token)
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    current_usage = get_dir_size(get_user_root(token))
    
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    
    if current_usage + file_size > limit_bytes:
        return jsonify(error="Espacio insuficiente en Null-Void Cloud"), 400
        
    file.save(os.path.join(target_dir, file.filename))
    
    token = get_token()
    current_user = session.get_user(token)
    current_uid = session.get_user_id(token)
    add_activity(current_user, current_uid, "Subiste", file.filename, subpath)
    
    return jsonify(ok=True)

@cloud_bp.route('/mkdir', methods=['POST'])
def make_dir():
    data = request.get_json()
    view = data.get('view', 'drive')
    user_root = get_view_root(view)
    if not user_root: return jsonify(error="No autorizado"), 401
        
    name = data.get('name')
    subpath = data.get('path', '').strip('/')
    
    if not name: return jsonify(error="Nombre requerido"), 400
    
    target_path = os.path.normpath(os.path.join(user_root, subpath, name))
    if not target_path.startswith(os.path.normpath(user_root)):
        return jsonify(error="Acceso denegado"), 403
        
    os.makedirs(target_path, exist_ok=True)
    
    token = get_token()
    current_user = session.get_user(token)
    current_uid = session.get_user_id(token)
    add_activity(current_user, current_uid, "Creaste la carpeta", name, subpath)
    
    return jsonify(ok=True)

@cloud_bp.route('/delete', methods=['POST'])
def delete_item():
    data = request.get_json()
    view = data.get('view', 'drive')
    user_root = get_view_root(view)
    if not user_root: return jsonify(error="No autorizado"), 401
        
    name = data.get('name')
    subpath = data.get('path', '').strip('/')
    
    if view == 'trash':
        return delete_permanent(data.get('id'))

    if view == 'computers' and subpath == '':
        return jsonify(error="No se pueden eliminar dispositivos del sistema"), 403

    prot_path = os.path.join(get_user_root(), '.protected.json')
    if os.path.exists(prot_path):
        try:
            with open(prot_path, 'r') as f:
                protected_data = json.load(f)
                if {"name": name, "path": subpath, "view": view} in protected_data:
                    return jsonify(error="Este elemento está protegido contra eliminación"), 403
        except: pass

    target_path = os.path.normpath(os.path.join(user_root, subpath, name))
    if not target_path.startswith(os.path.normpath(user_root)):
        return jsonify(error="Acceso denegado"), 403
        
    if not os.path.exists(target_path):
        return jsonify(error="No encontrado"), 404

    # MOVER A PAPELERA
    trash_id = str(uuid.uuid4())
    trash_base = os.path.join(get_user_root(), '.trash')
    os.makedirs(trash_base, exist_ok=True)
    
    shutil.move(target_path, os.path.join(trash_base, trash_id))
    
    trash_json = os.path.join(get_user_root(), '.trash.json')
    trash_data = []
    if os.path.exists(trash_json):
        try:
            with open(trash_json, 'r') as f:
                trash_data = json.load(f)
        except: pass
    
    trash_data.append({
        "id": trash_id,
        "name": name,
        "original_path": subpath,
        "view": view,
        "deleted_at": time.time()
    })
    
    with open(trash_json, 'w') as f:
        json.dump(trash_data, f)
        
    return jsonify(ok=True, trashed=True)

def delete_permanent(trash_id):
    if not trash_id: return jsonify(error="ID requerido"), 400
    user_root = get_user_root()
    trash_path = os.path.join(user_root, '.trash', trash_id)
    if os.path.exists(trash_path):
        if os.path.isdir(trash_path): shutil.rmtree(trash_path)
        else: os.remove(trash_path)
        
    trash_json = os.path.join(user_root, '.trash.json')
    if os.path.exists(trash_json):
        try:
            with open(trash_json, 'r') as f:
                trash_data = json.load(f)
            trash_data = [item for item in trash_data if item['id'] != trash_id]
            with open(trash_json, 'w') as f:
                json.dump(trash_data, f)
        except: pass
    return jsonify(ok=True)

@cloud_bp.route('/restore', methods=['POST'])
def restore_item():
    data = request.get_json()
    trash_id = data.get('id')
    if not trash_id: return jsonify(error="ID requerido"), 400
    
    user_root = get_user_root()
    trash_json = os.path.join(user_root, '.trash.json')
    if not os.path.exists(trash_json): return jsonify(error="Papelera vacía"), 404
    
    try:
        with open(trash_json, 'r') as f:
            trash_data = json.load(f)
        
        item = next((i for i in trash_data if i['id'] == trash_id), None)
        if not item: return jsonify(error="Elemento no encontrado en papelera"), 404
        
        view_root = get_view_root(item.get('view', 'drive'))
        target_dir = os.path.join(view_root, item['original_path'])
        os.makedirs(target_dir, exist_ok=True)
        
        target_path = os.path.join(target_dir, item['name'])
        # Si ya existe, renombrar
        if os.path.exists(target_path):
            target_path = os.path.join(target_dir, f"Restaurado_{int(time.time())}_{item['name']}")
            
        shutil.move(os.path.join(user_root, '.trash', trash_id), target_path)
        
        # Quitar de .trash.json
        trash_data = [i for i in trash_data if i['id'] != trash_id]
        with open(trash_json, 'w') as f:
            json.dump(trash_data, f)
            
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@cloud_bp.route('/empty_trash', methods=['POST'])
def empty_trash():
    user_root = get_user_root()
    trash_path = os.path.join(user_root, '.trash')
    if os.path.exists(trash_path):
        shutil.rmtree(trash_path)
    os.makedirs(trash_path, exist_ok=True)
    
    trash_json = os.path.join(user_root, '.trash.json')
    with open(trash_json, 'w') as f:
        json.dump([], f)
    return jsonify(ok=True)

@cloud_bp.route('/rename', methods=['POST'])
def rename_item():
    data = request.get_json()
    view = data.get('view', 'drive')
    user_root = get_view_root(view)
    if not user_root: return jsonify(error="No autorizado"), 401
    old_name, new_name, subpath = data.get('old_name'), data.get('new_name'), data.get('path', '').strip('/')
    if not old_name or not new_name: return jsonify(error="Nombres requeridos"), 400
    old_path = os.path.normpath(os.path.join(user_root, subpath, old_name))
    new_path = os.path.normpath(os.path.join(user_root, subpath, new_name))
    if not old_path.startswith(os.path.normpath(user_root)) or not new_path.startswith(os.path.normpath(user_root)):
        return jsonify(error="Acceso denegado"), 403
    if os.path.exists(new_path): return jsonify(error="Ya existe un elemento con ese nombre"), 400
    os.rename(old_path, new_path)
    
    token = get_token()
    add_activity(session.get_user(token), session.get_user_id(token), "Renombraste", new_name, subpath)
    
    return jsonify(ok=True)

@cloud_bp.route('/get_token', methods=['POST'])
def get_download_token():
    data = request.get_json()
    view = data.get('view', 'drive')
    user_root = get_view_root(view)
    if not user_root: return jsonify(error="No autorizado"), 401
    name, subpath = data.get('name'), data.get('path', '').strip('/')
    target_path = os.path.normpath(os.path.join(user_root, subpath, name))
    
    # Si no existe en el root de la vista, probar en .computers
    if not os.path.exists(target_path):
        base_user_root = get_user_root()
        alt_path = os.path.normpath(os.path.join(base_user_root, '.computers', subpath, name))
        if os.path.exists(alt_path):
            target_path = alt_path
            user_root = base_user_root # Ajustar root para el chequeo de seguridad
        
    if not target_path.startswith(os.path.normpath(user_root)) and not target_path.startswith(os.path.normpath(os.path.join(get_user_root(), '.computers'))):
        return jsonify(error="Acceso denegado"), 403
    
    if not os.path.exists(target_path): return jsonify(error="Archivo no encontrado"), 404
    
    dl_token = str(uuid.uuid4())
    # Guardamos si es directorio para comprimir después
    is_dir = os.path.isdir(target_path)
    download_tokens[dl_token] = {"path": target_path, "name": name, "is_dir": is_dir, "expires": time.time() + 300}
    
    token = get_token()
    add_activity(session.get_user(token), session.get_user_id(token), "Descargó", name, subpath)
    return jsonify(t=dl_token)

@cloud_bp.route('/download', methods=['GET'])
def download_file():
    dl_token = request.args.get('t')
    if not dl_token or dl_token not in download_tokens: return "Token inválido o expirado", 403
    info = download_tokens[dl_token]
    if time.time() > info['expires']:
        download_tokens.pop(dl_token, None)
        return "Token expirado", 403
    
    target = info['path']
    if not os.path.exists(target): return "No encontrado", 404
    
    force_dl = request.args.get('dl') == '1'
    if info.get('is_dir'):
        temp_fd, temp_path = tempfile.mkstemp(suffix='.zip')
        os.close(temp_fd)
        import zipfile
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(target):
                for d in dirs:
                    full_d = os.path.join(root, d)
                    rel_d = os.path.relpath(full_d, target)
                    zf.write(full_d, rel_d)
                for f in files:
                    full_f = os.path.join(root, f)
                    rel_f = os.path.relpath(full_f, target)
                    zf.write(full_f, rel_f)
        return send_file(temp_path, as_attachment=True, download_name=f"{info['name']}.zip")
    else:
        ext = os.path.splitext(info['name'])[1].lower()
        # Si force_dl es True, siempre enviamos como attachment
        is_attachment = force_dl or (ext not in ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt'])
        return send_file(target, as_attachment=is_attachment, download_name=info['name'])

@cloud_bp.route('/quota', methods=['GET', 'POST'])
def quota_manager():
    token = get_token()
    user_root = get_user_root(token)
    if not user_root: return jsonify(error="No autorizado"), 401
    
    if request.method == 'POST':
        data = request.get_json()
        new_limit = data.get('limit_gb')
        if new_limit:
            username = session.get_user(token)
            from core.database import get_db
            with get_db() as conn:
                conn.execute("UPDATE users SET quota_gb = ? WHERE username = ?", (int(new_limit), username))
                conn.commit()
        return jsonify(ok=True)

    limit_gb = get_user_quota(token)
    used = get_dir_size(user_root)
    disk = get_disk_info(user_root)
    return jsonify({"used_bytes": used, "limit_gb": limit_gb, "disk_total": disk['total'], "disk_free": disk['free']})

@cloud_bp.route('/preview', methods=['GET'])
def preview_file():
    view = request.args.get('view', 'drive')
    user_root = get_user_root()
    if not user_root: return "No autorizado", 401
    
    name, path = request.args.get('name', ''), request.args.get('path', '').strip('/')
    trash_id = request.args.get('id')

    if view == 'trash' and trash_id:
        target_path = os.path.join(user_root, '.trash', trash_id)
    else:
        v_root = get_view_root(view)
        target_path = os.path.normpath(os.path.join(v_root, path, name))
        if not target_path.startswith(os.path.normcase(v_root)): return "Acceso denegado", 403

    if not os.path.exists(target_path): return "No encontrado", 404
    
    ext = os.path.splitext(name)[1].lower()
    if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']: 
        return send_file(target_path)
    
    if ext == '.pdf':
        try:
            # Generar preview con pdftoppm (parte de poppler-utils)
            # -f 1 -l 1 solo primera página, -png formato png, -singlefile sin sufijos numéricos
            cmd = ['pdftoppm', '-f', '1', '-l', '1', '-png', '-singlefile', target_path]
            result = subprocess.run(cmd, capture_output=True, check=True)
            return send_file(io.BytesIO(result.stdout), mimetype='image/png')
        except Exception as e:
            print(f"[PDF Preview Error] {e}")
            return "Error al generar vista previa", 500
            
    return "Tipo de archivo no previsualizable", 400

@cloud_bp.route('/toggle_star', methods=['POST'])
def toggle_star():
    user_root = get_user_root()
    if not user_root: return jsonify(error="No autorizado"), 401
    data = request.get_json()
    name, path = data.get('name'), data.get('path', '').strip('/')
    
    # user_root ya está apuntando a la carpeta por ID gracias a get_user_root
    starred_path = os.path.join(user_root, '.starred.json')
    starred_data = []
    if os.path.exists(starred_path):
        try:
            with open(starred_path, 'r', encoding='utf-8') as f: starred_data = json.load(f)
        except: pass
    item_key = {"name": name, "path": path}
    if item_key in starred_data:
        starred_data.remove(item_key)
        is_starred = False
    else:
        starred_data.append(item_key)
        is_starred = True
    with open(starred_path, 'w') as f: json.dump(starred_data, f)
    return jsonify(ok=True, is_starred=is_starred)

@cloud_bp.route('/toggle_protect', methods=['POST'])
def toggle_protect():
    user_root = get_user_root()
    if not user_root: return jsonify(error="No autorizado"), 401
    data = request.get_json()
    name, path, view = data.get('name'), data.get('path', '').strip('/'), data.get('view', 'drive')
    
    # user_root ya está apuntando a la carpeta por ID
    prot_path = os.path.join(user_root, '.protected.json')
    prot_data = []
    if os.path.exists(prot_path):
        try:
            with open(prot_path, 'r', encoding='utf-8') as f: prot_data = json.load(f)
        except: pass
    item_key = {"name": name, "path": path, "view": view}
    if item_key in prot_data:
        prot_data.remove(item_key)
        is_prot = False
    else:
        prot_data.append(item_key)
        is_prot = True
    with open(prot_path, 'w') as f: json.dump(prot_data, f)
    return jsonify(ok=True, is_protected=is_prot)

@cloud_bp.route('/list_starred', methods=['GET'])
def list_starred():
    user_root = get_user_root()
    if not user_root: return jsonify(error="No autorizado"), 401
    starred_path = os.path.join(user_root, '.starred.json')
    starred_data = []
    if os.path.exists(starred_path):
        try:
            with open(starred_path, 'r') as f: starred_data = json.load(f)
        except: pass
    files = []
    for item in starred_data:
        fp = os.path.join(user_root, item['path'], item['name'])
        if not os.path.exists(fp): fp = os.path.join(user_root, '.computers', item['path'], item['name'])
        if os.path.exists(fp):
            info = os.stat(fp)
            files.append({"name": item['name'], "path": item['path'], "is_dir": os.path.isdir(fp), "size": info.st_size, "mtime": info.st_mtime, "ext": os.path.splitext(item['name'])[1].lower(), "owner": "Yo", "starred": True})
    return jsonify(files=files)

@cloud_bp.route('/info', methods=['POST'])
def get_file_info():
    data = request.get_json()
    view = data.get('view', 'drive')
    user_root = get_user_root()
    if not user_root: return jsonify(error="No autorizado"), 401
    
    name, subpath = data.get('name'), data.get('path', '').strip('/')
    trash_id = data.get('id')

    if view == 'trash' and trash_id:
        fp = os.path.join(user_root, '.trash', trash_id)
        if not os.path.exists(fp): return jsonify(error="No existe en papelera"), 404
        
        # Obtener info original si es posible
        trash_json = os.path.join(user_root, '.trash.json')
        original_name = name
        if os.path.exists(trash_json):
            try:
                with open(trash_json, 'r') as f:
                    trash_data = json.load(f)
                    item = next((i for i in trash_data if i['id'] == trash_id), None)
                    if item: original_name = item['name']
            except: pass
    else:
        v_root = get_view_root(view)
        fp = os.path.join(v_root, subpath, name)
        original_name = name

    if not os.path.exists(fp): return jsonify(error="No existe"), 404
    
    username = session.get_user(get_token()) or "Usuario"
    stat = os.stat(fp)
    return jsonify({
        "name": original_name,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "ctime": stat.st_ctime,
        "is_dir": os.path.isdir(fp),
        "path": subpath,
        "owner": username
    })

@cloud_bp.route('/move', methods=['POST'])
def move_item():
    data = request.get_json()
    view = data.get('view', 'drive')
    user_root = get_view_root(view)
    name = data.get('name')
    old_subpath = data.get('old_path', '').strip('/')
    new_subpath = data.get('new_path', '').strip('/')
    
    src = os.path.join(user_root, old_subpath, name)
    dst = os.path.join(user_root, new_subpath, name)
    
    if os.path.exists(dst): return jsonify(error="Ya existe"), 400
    shutil.move(src, dst)
    return jsonify(ok=True)

@cloud_bp.route('/item_activity', methods=['POST'])
def get_item_activity():
    data = request.get_json()
    name, path = data.get('name'), data.get('path', '').strip('/')
    user_root = get_user_root()
    if not user_root: return jsonify(error="No autorizado"), 401
    
    activity_path = os.path.join(user_root, '.activity.json')
    item_activity = []
    if os.path.exists(activity_path):
        try:
            with open(activity_path, 'r', encoding='utf-8') as f:
                all_activity = json.load(f)
                item_activity = [act for act in all_activity if act['name'] == name and act['path'] == path]
        except: pass
        
    return jsonify(activity=item_activity)

def init_user_cloud(user_id):
    """Inicializa la estructura de carpetas Cloud para un nuevo usuario."""
    if not user_id: return
    user_root = os.path.join(BASE_CLOUD_ROOT, user_id)
    os.makedirs(user_root, exist_ok=True)
    
    # Crear carpetas ocultas del sistema
    os.makedirs(os.path.join(user_root, '.computers'), exist_ok=True)
    os.makedirs(os.path.join(user_root, '.trash'), exist_ok=True)
    
    # Inicializar archivos JSON si no existen
    for f in ['.activity.json', '.starred.json', '.protected.json', '.trash.json']:
        p = os.path.join(user_root, f)
        if not os.path.exists(p):
            with open(p, 'w', encoding='utf-8') as f_out:
                json.dump([], f_out)
    
    print(f"[Cloud] Estructura inicializada para {user_id}")

