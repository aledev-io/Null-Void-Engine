import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_ENV_PATH = os.path.join(PROJECT_ROOT, ".env")

def _load_env_into_environ(path: str) -> None:
    """Carga el .env directamente en el entorno del sistema operativo (os.environ)."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

_load_env_into_environ(_ENV_PATH)

class CONFIG:
    """Clase de configuración centralizada — Edición Búnker."""
    SERVER_NAME = os.environ.get("SERVER_NAME", "NullVoid")
    HOST        = os.environ.get("HOST", "0.0.0.0")
    FLASK_PORT  = int(os.environ.get("FLASK_PORT", "5000"))
    DEBUG       = os.environ.get("DEBUG", "false").lower() == "true"
    
    SECRET_KEY = os.environ.get("SECRET_KEY")
    if not SECRET_KEY:
        raise ValueError("No se ha definido SECRET_KEY")
    
    USE_HTTPS = os.environ.get("USE_HTTPS", "false").lower() == "true"
    CERTS_DIR = os.path.join(PROJECT_ROOT, "certs")
    CERT_FILE = os.environ.get("CERT_FILE", os.path.join(CERTS_DIR, "cert.pem"))
    KEY_FILE  = os.environ.get("KEY_FILE", os.path.join(CERTS_DIR, "key.pem"))

    _raw_creds = os.environ.get("CREDENTIALS")
    if not _raw_creds:
        raise ValueError("No se han definido CREDENTIALS")

    CREDENTIALS = {}
    for _pair in _raw_creds.split(','):
        if ':' in _pair:
            _u, _p = _pair.split(':', 1)
            CREDENTIALS[_u.strip()] = _p.strip()

    _raw_data_dir = os.environ.get("DATA_DIR", os.path.join(PROJECT_ROOT, "data", "app"))
    DATA_DIR = _raw_data_dir if os.path.isabs(_raw_data_dir) else os.path.join(PROJECT_ROOT, _raw_data_dir)
    DB_PATH  = os.environ.get("DB_PATH", os.path.join(DATA_DIR, "manager.db"))
    
    FCM_SECRET_KEY = os.environ.get("FCM_SECRET_KEY")
    FCM_CREDENTIALS_PATH = os.environ.get("FCM_CREDENTIALS_PATH", os.path.join(PROJECT_ROOT, "src", "firebase_key.json"))