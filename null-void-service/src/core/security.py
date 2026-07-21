import logging
import sqlite3
from core.database import get_db

logging.basicConfig(level=logging.ERROR)

class SecurityManager:
    @staticmethod
    def get_user_by_username_or_email(identifier: str):
        """Busca un usuario por nombre de usuario o correo, usando consultas seguras."""
        try:
            with get_db() as conn:
                return conn.execute(
                    "SELECT user_id, username, password FROM users WHERE username = ? OR email = ?",
                    (identifier, identifier)
                ).fetchone()
        except sqlite3.Error as e:
            logging.error(f"Error de base de datos en get_user_by_username_or_email: {e}")
            return None

    @staticmethod
    def check_username_exists(username: str):
        """Verifica si un nombre de usuario ya está registrado."""
        try:
            with get_db() as conn:
                return conn.execute(
                    "SELECT username FROM users WHERE username = ?", (username,)
                ).fetchone()
        except sqlite3.Error as e:
            logging.error(f"Error de base de datos en check_username_exists: {e}")
            return None

    @staticmethod
    def insert_user(username: str, hashed_password: str, email: str, user_id: str):
        """Inserta de manera segura un nuevo usuario en la base de datos."""
        try:
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO users (username, password, email, user_id) VALUES (?, ?, ?, ?)",
                    (username, hashed_password, email, user_id)
                )
                conn.commit()
        except sqlite3.Error as e:
            logging.error(f"Error de base de datos en insert_user: {e}")
            return None
