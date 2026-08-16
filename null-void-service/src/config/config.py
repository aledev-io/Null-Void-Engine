import os
import sys
import secrets

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_ENV_PATH = os.path.join(PROJECT_ROOT, ".env")

# Valor de fábrica que nunca debe usarse en producción (clave pública conocida).
_FACTORY_SECRET_KEY = "una-clave-secreta-por-defecto"

def _load_env_into_environ(path: str) -> None:
    """Carga el .env directamente en el entorno del sistema operativo (os.environ)."""
    if not os.path.exists(path):
        print(f"[!] AVISO CONFIGURACIÓN: No se encontró el archivo de entorno '{path}'.")
        print("[!] Se utilizarán las variables del entorno del sistema si están definidas.")
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())


def _secret_persist_path() -> str:
    """Ruta donde se persiste una SECRET_KEY generada.

    En Docker /app es efímero (solo /app/data está montado y sobrevive), por
    eso se guarda en DATA_DIR; en ejecución local se usa el propio .env.
    """
    try:
        raw = os.environ.get("DATA_DIR") or os.path.join(PROJECT_ROOT, "data", "app")
        if os.path.exists("/app/data") and raw.startswith("/home/"):
            raw = "/app/data/app"
        data_dir = raw if os.path.isabs(raw) else os.path.join(PROJECT_ROOT, raw)
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, "secret_key")
    except Exception:
        return _ENV_PATH


def _ensure_secure_secret_key() -> str:
    """Devuelve una SECRET_KEY segura, generando y persistiendo una nueva si
    falta o todavía usa el valor de fábrica conocido.

    La clave generada se reutiliza entre reinicios (en data/app/secret_key),
    así que las sesiones y los fingerprints de los agentes se mantienen.
    """
    secret = os.environ.get("SECRET_KEY")
    if secret and secret.strip('"\' ') != _FACTORY_SECRET_KEY:
        return secret.strip('"\' ')

    persist_path = _secret_persist_path()
    if persist_path != _ENV_PATH and os.path.exists(persist_path):
        try:
            with open(persist_path, encoding="utf-8") as f:
                stored = f.read().strip()
            if stored:
                print(f"[NullVoid] SECRET_KEY generada en un arranque anterior; reutilizada desde {persist_path}.")
                os.environ["SECRET_KEY"] = stored
                return stored
        except OSError:
            pass

    new_secret = secrets.token_hex(32)
    print("[NullVoid] SECRET_KEY ausente o con valor de fábrica: se generó una clave aleatoria nueva.")
    try:
        with open(persist_path, "w", encoding="utf-8") as f:
            f.write(new_secret + "\n")
        try:
            os.chmod(persist_path, 0o600)
        except OSError:
            pass
    except OSError:
        pass
    os.environ["SECRET_KEY"] = new_secret
    return new_secret


_load_env_into_environ(_ENV_PATH)

class CONFIG:
    """Clase de configuración centralizada — Edición Búnker."""
    SERVER_NAME = os.environ.get("SERVER_NAME", "NullVoid")
    HOST        = os.environ.get("HOST", "0.0.0.0")
    FLASK_PORT  = int(os.environ.get("FLASK_PORT", "5000"))
    DEBUG       = os.environ.get("DEBUG", "false").lower() == "true"
    
    SECRET_KEY = _ensure_secure_secret_key()
    
    CERTS_DIR = os.path.join(PROJECT_ROOT, "certs")
    CERT_FILE = os.environ.get("CERT_FILE", os.path.join(CERTS_DIR, "cert.pem"))
    KEY_FILE  = os.environ.get("KEY_FILE", os.path.join(CERTS_DIR, "key.pem"))
    
    _use_https_env = os.environ.get("USE_HTTPS", "false").lower() == "true"
    USE_HTTPS = _use_https_env and os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)

    _raw_creds = os.environ.get("CREDENTIALS")
    if not _raw_creds:
        raise ValueError(
            "[ERROR CRÍTICO CONFIGURACIÓN] No se han definido CREDENTIALS en el .env ni en el entorno. "
            "Crea el archivo .env basándote en el ejemplo o define CREDENTIALS=usuario:contraseña."
        )

    CREDENTIALS = {}
    for _pair in _raw_creds.split(','):
        if ':' in _pair:
            _u, _p = _pair.split(':', 1)
            CREDENTIALS[_u.strip()] = _p.strip()

    if CREDENTIALS.get("admin") == "admin":
        print("[!] ADVERTENCIA DE SEGURIDAD: El administrador usa la contraseña por defecto 'admin'.")
        print("[!] Cambia CREDENTIALS en el .env (usuario:clave) antes de exponer el servidor a Internet.")

    _raw_data_dir = os.environ.get("DATA_DIR", os.path.join(PROJECT_ROOT, "data", "app"))
    if os.path.exists("/app/data") and _raw_data_dir.startswith("/home/"):
        _raw_data_dir = "/app/data/app"
    DATA_DIR = _raw_data_dir if os.path.isabs(_raw_data_dir) else os.path.join(PROJECT_ROOT, _raw_data_dir)
    DB_PATH  = os.environ.get("DB_PATH", os.path.join(DATA_DIR, "manager.db"))
    
    if os.path.exists(DB_PATH):
        print(f"[NullVoid] Base de datos detectada y cargada desde {DB_PATH}.")
    else:
        print(f"[!] AVISO IMPORTANTE DE DATOS: No se encontró base de datos previa en '{DB_PATH}'.")
        print(f"[!] Se está inicializando un directorio de datos NUEVO en '{DATA_DIR}'. Verifique si la ruta del .env o volumen es correcta.")
    
    FCM_SECRET_KEY = os.environ.get("FCM_SECRET_KEY")
    _raw_fcm_path = os.environ.get("FCM_CREDENTIALS_PATH", os.path.join(PROJECT_ROOT, ".secrets", "firebase_key.json"))
    if os.path.exists("/app/.secrets") and _raw_fcm_path.startswith("/home/"):
        _raw_fcm_path = "/app/.secrets/firebase_key.json"
    FCM_CREDENTIALS_PATH = _raw_fcm_path if os.path.isabs(_raw_fcm_path) else os.path.join(PROJECT_ROOT, _raw_fcm_path)