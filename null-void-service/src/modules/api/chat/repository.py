import uuid
import time
from core.database import get_db

_CHAT_PAIR_SQL = "((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))"
_NOT_DELETED_SQL = "id NOT IN (SELECT message_id FROM deleted_messages WHERE user_id = ?)"
_MSG_COLS = "id, sender_id, receiver_id, message, created_at, read, file_path, file_name, file_size, edited_at"


def get_contact_ids(viewer_id: str) -> list[str]:
    """Retorna los IDs de los contactos con los que el usuario tiene mensajes activos."""
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT DISTINCT
                CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as contact_id
            FROM chat_messages
            WHERE (sender_id = ? OR receiver_id = ?) AND {_NOT_DELETED_SQL}
        """, (viewer_id, viewer_id, viewer_id, viewer_id)).fetchall()
        return [r['contact_id'] for r in rows]


def get_contact_info(contact_id: str):
    with get_db() as conn:
        return conn.execute(
            "SELECT username, user_id FROM users WHERE user_id = ?",
            (contact_id,)
        ).fetchone()


def get_last_message(viewer_id: str, contact_id: str):
    """Obtiene el último mensaje de la conversación que no haya sido borrado por el espectador."""
    with get_db() as conn:
        return conn.execute(f"""
            SELECT message, created_at, sender_id, file_name
            FROM chat_messages
            WHERE {_CHAT_PAIR_SQL} AND {_NOT_DELETED_SQL}
            ORDER BY created_at DESC LIMIT 1
        """, (viewer_id, contact_id, contact_id, viewer_id, viewer_id)).fetchone()


def get_unread_count(contact_id: str, viewer_id: str) -> int:
    with get_db() as conn:
        res = conn.execute(f"""
            SELECT COUNT(*) as count FROM chat_messages
            WHERE sender_id = ? AND receiver_id = ? AND read = 0 AND {_NOT_DELETED_SQL}
        """, (contact_id, viewer_id, viewer_id)).fetchone()
        return res['count'] if res else 0


def get_total_unread(viewer_id: str) -> int:
    with get_db() as conn:
        res = conn.execute(f"""
            SELECT COUNT(*) as count FROM chat_messages
            WHERE receiver_id = ? AND read = 0 AND {_NOT_DELETED_SQL}
        """, (viewer_id, viewer_id)).fetchone()
        return res['count'] if res else 0


def get_messages_before(viewer_id: str, contact_id: str, before: float, limit: int):
    with get_db() as conn:
        return conn.execute(f"""
            SELECT {_MSG_COLS}
            FROM chat_messages
            WHERE {_CHAT_PAIR_SQL} AND created_at < ? AND {_NOT_DELETED_SQL}
            ORDER BY created_at DESC LIMIT ?
        """, (viewer_id, contact_id, contact_id, viewer_id, before, viewer_id, limit)).fetchall()


def get_messages_recent(viewer_id: str, contact_id: str, limit: int):
    with get_db() as conn:
        return conn.execute(f"""
            SELECT {_MSG_COLS}
            FROM chat_messages
            WHERE {_CHAT_PAIR_SQL} AND {_NOT_DELETED_SQL}
            ORDER BY created_at DESC LIMIT ?
        """, (viewer_id, contact_id, contact_id, viewer_id, viewer_id, limit)).fetchall()


def get_poll_messages(viewer_id: str, contact_id: str, since: float):
    with get_db() as conn:
        if contact_id:
            return conn.execute(f"""
                SELECT {_MSG_COLS}
                FROM chat_messages
                WHERE {_CHAT_PAIR_SQL} AND created_at > ? AND {_NOT_DELETED_SQL} 
                ORDER BY created_at ASC
            """, (viewer_id, contact_id, contact_id, viewer_id, since, viewer_id)).fetchall()
        
        return conn.execute(f"""
            SELECT {_MSG_COLS}
            FROM chat_messages
            WHERE receiver_id = ? AND created_at > ? AND {_NOT_DELETED_SQL} 
            ORDER BY created_at ASC
        """, (viewer_id, since, viewer_id)).fetchall()


def insert_message(sender_id: str, receiver_id: str, message: str, file_path=None, file_name=None, file_size=None):
    msg_id = str(uuid.uuid4())
    now = time.time()
    with get_db() as conn:
        conn.execute("""
            INSERT INTO chat_messages (id, sender_id, receiver_id, message, created_at, read, file_path, file_name, file_size)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        """, (msg_id, sender_id, receiver_id, message, now, file_path, file_name, file_size))
        conn.commit()
    return msg_id, now


def edit_message(msg_id: str, sender_id: str, new_text: str):
    now = time.time()
    with get_db() as conn:
        conn.execute("""
            UPDATE chat_messages SET message = ?, edited_at = ? WHERE id = ? AND sender_id = ?
        """, (new_text, now, msg_id, sender_id))
        conn.commit()
        return conn.total_changes > 0, now


def delete_message_for_user(msg_id: str, viewer_id: str) -> bool:
    with get_db() as conn:
        try:
            conn.execute("""
                INSERT OR IGNORE INTO deleted_messages (message_id, user_id) VALUES (?, ?)
            """, (msg_id, viewer_id))
            conn.commit()
            return conn.total_changes > 0
        except Exception:
            return False


def delete_message_for_everyone(msg_id: str, sender_id: str) -> bool:
    with get_db() as conn:
        try:
            conn.execute("""
                DELETE FROM chat_messages WHERE id = ? AND sender_id = ?
            """, (msg_id, sender_id))
            conn.commit()
            return conn.total_changes > 0
        except Exception:
            return False


def delete_conversation(viewer_id: str, contact_id: str) -> bool:
    """Oculta la conversación completa para el usuario actual."""
    with get_db() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO deleted_messages (message_id, user_id)
            SELECT id, ? FROM chat_messages WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        """, (viewer_id, viewer_id, contact_id, contact_id, viewer_id))
        conn.commit()
        return conn.total_changes > 0


def get_message_by_id(msg_id: str):
    with get_db() as conn:
        return conn.execute(f"SELECT {_MSG_COLS} FROM chat_messages WHERE id = ?", (msg_id,)).fetchone()


def get_contacts_for_forward(viewer_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT DISTINCT 
                u.user_id AS contact_id, 
                u.username
            FROM chat_messages cm
            JOIN users u ON u.user_id = CASE WHEN cm.sender_id = ? THEN cm.receiver_id ELSE cm.sender_id END
            WHERE (cm.sender_id = ? OR cm.receiver_id = ?) AND cm.{_NOT_DELETED_SQL}
        """, (viewer_id, viewer_id, viewer_id, viewer_id)).fetchall()
        return [{'contact_id': r['contact_id'], 'username': r['username']} for r in rows]


def mark_messages_read(contact_id: str, viewer_id: str) -> bool:
    with get_db() as conn:
        conn.execute("""
            UPDATE chat_messages SET read = 1
            WHERE sender_id = ? AND receiver_id = ? AND read = 0
        """, (contact_id, viewer_id))
        conn.commit()
        return conn.total_changes > 0


def get_user_receiver(receiver_id: str):
    with get_db() as conn:
        return conn.execute("SELECT username FROM users WHERE user_id = ?", (receiver_id,)).fetchone()


def search_users_db(query: str, exclude_id: str):
    pattern = '%' + query + '%'
    with get_db() as conn:
        return conn.execute(
            "SELECT username, user_id FROM users WHERE username LIKE ? AND user_id != ? LIMIT 10",
            (pattern, exclude_id)
        ).fetchall()


def get_contact_by_id(contact_id: str):
    with get_db() as conn:
        return conn.execute("SELECT username, user_id FROM users WHERE user_id = ?", (contact_id,)).fetchone()


def create_connections(user_id: str, contact_id: str):
    with get_db() as conn:
        conn.execute("INSERT OR IGNORE INTO user_connections (user_id, contact_id) VALUES (?, ?)", (user_id, contact_id))
        conn.execute("INSERT OR IGNORE INTO user_connections (user_id, contact_id) VALUES (?, ?)", (contact_id, user_id))
        conn.commit()


def is_muted(user_id: str, contact_id: str) -> bool:
    with get_db() as conn:
        res = conn.execute("SELECT 1 FROM muted_conversations WHERE user_id = ? AND contact_id = ?", (user_id, contact_id)).fetchone()
        return res is not None

def mute_conversation(user_id: str, contact_id: str) -> bool:
    with get_db() as conn:
        conn.execute("INSERT OR IGNORE INTO muted_conversations (user_id, contact_id) VALUES (?, ?)", (user_id, contact_id))
        conn.commit()
        return True

def unmute_conversation(user_id: str, contact_id: str) -> bool:
    with get_db() as conn:
        conn.execute("DELETE FROM muted_conversations WHERE user_id = ? AND contact_id = ?", (user_id, contact_id))
        conn.commit()
        return True