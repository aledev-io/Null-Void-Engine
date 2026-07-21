from core.database import get_db

def load_users() -> dict[str, str]:
    """Carga usuarios desde la base de datos: {username: password}"""
    users = {}
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT username, password FROM users").fetchall()
            for row in rows:
                users[row["username"]] = row["password"]
    except Exception as e:
        print(f"Error cargando usuarios desde DB: {e}")
    return users