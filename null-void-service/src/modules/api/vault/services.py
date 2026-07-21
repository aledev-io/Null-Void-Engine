import os

# --- VAULT DUMB STORAGE SERVICES (ZERO-KNOWLEDGE) ---

def init_vault_file(filepath: str, blob: bytes):
    """
    Creates a new vault file with the given binary blob.
    Raises ValueError if file already exists.
    """
    if os.path.exists(filepath):
        raise ValueError("El archivo ya existe.")
    with open(filepath, 'wb') as f:
        f.write(blob)

def load_vault_file(filepath: str) -> bytes:
    """
    Reads the binary blob from the vault file.
    Returns the bytes. Raises FileNotFoundError if missing.
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError("Vault no encontrado")
    with open(filepath, 'rb') as f:
        return f.read()

def save_vault_file(filepath: str, blob: bytes):
    """
    Saves a binary blob to the vault file securely.
    Writes to a temporary file first, creates a backup if the original exists,
    and keeps only the latest 5 backups.
    """
    import glob
    from datetime import datetime
    
    # Write to temp file first to prevent data loss on crash
    temp_path = f"{filepath}.tmp"
    with open(temp_path, 'wb') as f:
        f.write(blob)
    
    # Backup existing file if it exists
    if os.path.exists(filepath):
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = f"{filepath}_{timestamp}.bak"
        os.rename(filepath, backup_path)
    
    # Rename temp to original safely
    os.rename(temp_path, filepath)
        
    # Prune old backups (keep only latest 5)
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
