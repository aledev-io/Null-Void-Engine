import uuid
import re
from werkzeug.security import generate_password_hash, check_password_hash
from core.security import SecurityManager


def authenticate(username: str, password: str):
    row = SecurityManager.get_user_by_username_or_email(username)
    if not row:
        return None, "Usuario o contraseña incorrectos"

    user_id = row['user_id']
    db_username = row['username']
    stored_password = row['password']

    if not stored_password:
        return None, "Usuario o contraseña incorrectos"

    if not check_password_hash(stored_password, password):
        return None, "Usuario o contraseña incorrectos"

    return {"user_id": user_id, "username": db_username}, None


def create_user(username: str, password: str):
    if not re.match(r"^[a-zA-Z0-9_\-]{3,20}$", username):
        return None, {"code": "err_user_format", "msg": "El usuario debe tener entre 3 y 20 caracteres y solo contener letras, números, guiones o guiones bajos"}

    new_user_id = f"NV-{str(uuid.uuid4()).upper()}"
    email = f"{username.lower()}_{str(uuid.uuid4())[:4]}@nullvoid.local"

    existing = SecurityManager.check_username_exists(username)
    if existing:
        import random
        suggestions = [
            f"{username}{random.randint(10,99)}",
            f"{username}{random.randint(100,999)}",
            f"{username}_{random.randint(1,9)}",
        ]
        return None, {
            "code": "err_in_use", 
            "msg": f"El nombre de usuario ya está en uso. Prueba con: {', '.join(suggestions)}",
            "suggestions": suggestions
        }

    hashed = generate_password_hash(password)
    SecurityManager.insert_user(username, hashed, email, new_user_id)

    from modules.api.cloud import init_user_cloud
    init_user_cloud(new_user_id)
    return {"user_id": new_user_id, "email": email}, None