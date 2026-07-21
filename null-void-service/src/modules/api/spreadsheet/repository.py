import json
import uuid
from core.database import get_db

class SpreadsheetRepository:
    """Gestiona de forma aislada la persistencia de las hojas de cálculo en SQLite."""

    @staticmethod
    def get_by_user(uid: int) -> dict:
        with get_db() as conn:
            row = conn.execute(
                "SELECT content FROM spreadsheets WHERE user_id = ? LIMIT 1", 
                (uid,)
            ).fetchone()
            if row:
                return json.loads(row['content'])
            return {}

    @staticmethod
    def save_or_update(uid: int, content_dict: dict) -> bool:
        content_json = json.dumps(content_dict)
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM spreadsheets WHERE user_id = ? LIMIT 1", 
                (uid,)
            ).fetchone()
            
            if existing:
                conn.execute(
                    "UPDATE spreadsheets SET content = ?, updated_at = datetime('now') WHERE user_id = ?",
                    (content_json, uid)
                )
            else:
                new_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO spreadsheets (id, user_id, name, content, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
                    (new_id, uid, "Libro 1", content_json)
                )
            conn.commit()
        return True