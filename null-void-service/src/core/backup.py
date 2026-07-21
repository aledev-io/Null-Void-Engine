import os
import shutil
import tempfile
from datetime import datetime
from modules.session import session as sess
from config.config import CONFIG

TEMP_BACKUP_DIR = "/tmp/nullvoid_backups"
os.makedirs(TEMP_BACKUP_DIR, exist_ok=True)

def create_backup(files, dest_mode, cloud_path, token):
    """
    Procesa la lista de archivos enviados desde el frontend, genera un ZIP
    y lo almacena en la nube del usuario o lo prepara para descarga.
    """
    user_id = sess.get_user_id(token)
    if not user_id:
        return None, "No autorizado"

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"backup_{timestamp}.zip"

    with tempfile.TemporaryDirectory() as tmp_dir:
        for f in files:
            safe_name = os.path.basename(f.filename)
            if safe_name:
                f.save(os.path.join(tmp_dir, safe_name))
        if dest_mode == "cloud":
            base_cloud = os.path.join(CONFIG.DATA_DIR, "Cloud", user_id, ".backups")
            if cloud_path:
                destino_final = os.path.join(base_cloud, cloud_path.strip("/"))
            else:
                destino_final = base_cloud
            
            os.makedirs(destino_final, exist_ok=True)
            ruta_zip_final = os.path.join(destino_final, zip_name)
            
            try:
                ruta_base_zip = os.path.splitext(ruta_zip_final)[0]
                shutil.make_archive(ruta_base_zip, "zip", tmp_dir)
                return {"cloud": True, "zip_name": zip_name}, None
            except Exception as e:
                return None, f"Error al guardar en Cloud: {str(e)}"

        else:
            ruta_zip_temp = os.path.join(TEMP_BACKUP_DIR, zip_name)
            try:
                ruta_base_zip = os.path.splitext(ruta_zip_temp)[0]
                shutil.make_archive(ruta_base_zip, "zip", tmp_dir)
                return {
                    "cloud": False, 
                    "zip_name": zip_name, 
                    "zip_url": f"/api/backup/download/{zip_name}"
                }, None
            except Exception as e:
                return None, f"Error al generar archivo de descarga: {str(e)}"

def get_zip_path(filename):
    path = os.path.join(TEMP_BACKUP_DIR, filename)
    if os.path.exists(path):
        return path
    return None

def cleanup_old_temp():
    try:
        for f in os.listdir(TEMP_BACKUP_DIR):
            path = os.path.join(TEMP_BACKUP_DIR, f)
            if os.path.isfile(path) and (time.time() - os.path.getmtime(path) > 3600):
                os.remove(path)
    except Exception:
        pass