import json
from core.database import get_db


def load_installed_modules(username):
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT modules FROM users WHERE username = ?", (username,)
            ).fetchone()
            if row and row['modules']:
                return json.loads(row['modules'])
    except Exception:
        pass
    return [m["id"] for m in ALL_MODULES if m.get("core")]


def save_installed_modules(username, modules_list):
    try:
        with get_db() as conn:
            conn.execute(
                "UPDATE users SET modules = ? WHERE username = ?",
                (json.dumps(modules_list), username)
            )
            conn.commit()
    except Exception as e:
        print(f"[System] Error guardando módulos para {username}: {e}")


def get_user_by_id(user_id):
    with get_db() as conn:
        return conn.execute(
            "SELECT username, email, user_id FROM users WHERE user_id = ?",
            (user_id,)
        ).fetchone()


def get_user_password(user_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT password FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        return row['password'] if row else None


def update_username(user_id, new_username, new_email):
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET username = ?, email = ? WHERE user_id = ?",
            (new_username, new_email, user_id)
        )
        conn.commit()


def update_password(user_id, new_hashed):
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password = ? WHERE user_id = ?",
            (new_hashed, user_id)
        )
        conn.commit()


def check_username_exists(username):
    with get_db() as conn:
        return conn.execute(
            "SELECT username FROM users WHERE username = ?", (username,)
        ).fetchone() is not None


ALL_MODULES = [
    {"id": "monitor", "name": "Telemetria", "icon": "📊", "desc": "Monitorizacion en tiempo real.", "core": True},
    {"id": "calendar", "name": "Calendario", "icon": "📅", "desc": "Eventos y tareas.", "url": "/calendar", "core": True},
    {"id": "admin", "name": "Recordatorios", "icon": "🛡️", "desc": "Recordatorios del sistema.", "core": True},
    {"id": "marketplace",  "name": "Tienda Apps",       "icon": "🏪", "desc": "Instala nuevos módulos.","url": "/marketplace", "core": True},
    {"id": "invoices", "name": "ERP Facturación", "icon": "📑", "desc": "Facturas y OCR.", "url": "/invoices"},
    {"id": "transactions", "name": "Contabilidad", "icon": "💰", "desc": "Control de gastos."},
    {"id": "cloud", "name": "Null-Void Cloud", "icon": "📂", "desc": "Almacenamiento personal.", "url": "/cloud", "core": True},
    {"id": "backups", "name": "Backups", "icon": "💾", "desc": "Respaldos del sistema.","url": "/backups", "core": True},
    {"id": "ai", "name": "AI", "icon": "🤖", "desc": "Asistente Inteligente.", "url": "/ai", "core": True},
    {"id": "docs", "name": "Documentación", "icon": "📖", "desc": "Guías y tutoriales.", "url": "/docs", "core": True},
]
ALL_MODULES.insert(3, {"id": "budgets", "name": "Excel", "icon": "🧮", "desc": "Excel con Python.", "url": "/excel"})
ALL_MODULES.append({"id": "chat", "name": "Mensajes", "icon": "💬", "desc": "Chat entre usuarios.", "url": "/chat", "badge": "chat-badge"})
ALL_MODULES.append({"id": "friends", "name": "Amigos", "icon": "👥", "desc": "Gestiona tus amigos y solicitudes.", "url": "/friends"})
ALL_MODULES.append({"id": "mail", "name": "Correo", "icon": "📧", "desc": "Bandeja de entrada SMTP/IMAP.", "url": "/mail", "core": True})
ALL_MODULES.append({"id": "scraper_pcc", "name": "Scraper BD", "icon": "🛒", "desc": "Base de datos de PcComponentes", "url": "/scraper", "core": True})
ALL_MODULES.append({"id": "vault", "name": "Vault", "icon": "🔐", "desc": "Gestor de Contraseñas", "url": "/vault", "core": True})
