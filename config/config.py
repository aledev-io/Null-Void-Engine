import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
_ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

def _load_env(path: str) -> dict:
    """Parser minimalista de .env — ignora comentarios y líneas vacías."""
    result = {}
    if not os.path.exists(path):
        return result
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                result[key.strip()] = val.strip()
    return result

_env = _load_env(_ENV_PATH)

class CONFIG:
    """Clase de configuración centralizada."""
    HOST        = _env.get("HOST",        "0.0.0.0")
    FLASK_PORT  = int(_env.get("FLASK_PORT",  "5000"))
    DEBUG       = _env.get("DEBUG", "true").lower() == "true"
    SECRET_KEY  = _env.get("SECRET_KEY", "nv-engine-secret-key-1337")
    
    # Seguridad (HTTPS)
    USE_HTTPS = _env.get("USE_HTTPS", "false").lower() == "true"
    CERTS_DIR = os.path.join(PROJECT_ROOT, "certs")
    CERT_FILE = os.path.join(CERTS_DIR, "cert.pem")
    KEY_FILE  = os.path.join(CERTS_DIR, "key.pem")

    # Credenciales procesadas
    CREDENTIALS = {}
    _raw_creds = _env.get("CREDENTIALS", "admin:admin123")
    for _pair in _raw_creds.split(','):
        if ':' in _pair:
            _u, _p = _pair.split(':', 1)
            CREDENTIALS[_u.strip()] = _p.strip()

    # Rutas de datos
    DATA_DIR = os.path.join(PROJECT_ROOT, "data")
    DB_PATH  = os.path.join(DATA_DIR, "manager.db")
    CSV_PATH = os.path.join(DATA_DIR, "users.csv")