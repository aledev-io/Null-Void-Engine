from flask import request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

def get_limiter_key():
    user_agent = request.headers.get("User-Agent", "")
    # Si la peticion viene del agente de escritorio (NullVoidAgent), se le asigna su propia clave aislada
    if "NullVoidAgent" in user_agent or "nv-agent" in user_agent:
        token = request.headers.get("X-Agent-Token") or request.headers.get("Authorization", "")
        return f"agent:{token or get_remote_address()}"
    # Para la web/usuario normal, se limita por su IP
    return f"user:{get_remote_address()}"

limiter = Limiter(
    key_func=get_limiter_key,
    default_limits=["1000 per day", "300 per hour"],
    storage_uri="memory://"
)
# trigger reload
