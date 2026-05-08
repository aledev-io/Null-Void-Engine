import os
import shutil
from datetime import datetime

def realizar_backup(origen: str, destino: str) -> str:
    if not os.path.exists(origen):
        return f"❌ Error: El directorio origen '{origen}' no existe."
        
    if not os.path.exists(destino):
        try:
            os.makedirs(destino)
        except Exception as e:
            return f"❌ Error: No se pudo crear el directorio destino. ({str(e)})"
            
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    # Obtener el nombre de la última carpeta del origen para nombrar el archivo ZIP
    base_name = os.path.basename(os.path.normpath(origen))
    if not base_name: 
        base_name = "Backup"
        
    archivo_final = f"{base_name}_{timestamp}"
    ruta_zip = os.path.join(destino, archivo_final)
    
    try:
        shutil.make_archive(ruta_zip, "zip", origen)
        return f"✅ Backup completado: {archivo_final}.zip"
    except Exception as e:
        return f"❌ Error al crear ZIP: {str(e)}"
