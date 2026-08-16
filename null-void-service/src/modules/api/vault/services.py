import os

def init_vault_file(filepath: str, blob: bytes):
    if os.path.exists(filepath):
        raise ValueError("El archivo ya existe.")
    with open(filepath, 'wb') as f:
        f.write(blob)

def load_vault_file(filepath: str) -> bytes:
    if not os.path.exists(filepath):
        raise FileNotFoundError("Vault no encontrado")
    with open(filepath, 'rb') as f:
        return f.read()

def save_vault_file(filepath: str, blob: bytes):
    import glob
    from datetime import datetime
    
    temp_path = f"{filepath}.tmp"
    with open(temp_path, 'wb') as f:
        f.write(blob)
    
    if os.path.exists(filepath):
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = f"{filepath}_{timestamp}.bak"
        os.rename(filepath, backup_path)
    
    os.rename(temp_path, filepath)
    
    directory = os.path.dirname(filepath)
    filename = os.path.basename(filepath)
    
    # Use glob.escape to prevent issues if filename contains [, ], *, etc.
    safe_filename = glob.escape(filename)
    backups = glob.glob(os.path.join(directory, f"{safe_filename}_*.bak"))
    backups.sort(key=os.path.getmtime, reverse=True)
    
    for old_backup in backups[5:]:
        try:
            os.remove(old_backup)
        except OSError:
            pass