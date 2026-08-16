import uuid
import time
from core.database import get_db

_CHAT_PAIR_SQL = "((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))"
_NOT_DELETED_SQL = "id NOT IN (SELECT message_id FROM deleted_messages WHERE user_id = ?)"
_MSG_COLS = "id, sender_id, receiver_id, message, created_at, read, file_path, file_name, file_size, edited_at"


def get_contact_ids(viewer_id: str) -> list[str]:
    """Retorna los IDs de los contactos con los que el usuario tiene mensajes activos o conexiones no ocultas."""
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT contact_id
            FROM user_connections
            WHERE user_id = ? AND contact_id NOT IN (
                SELECT contact_id FROM hidden_conversations WHERE user_id = ?
            )
            UNION
            SELECT
                CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as contact_id
            FROM chat_messages
            WHERE (sender_id = ? OR receiver_id = ?) AND {_NOT_DELETED_SQL}
            UNION
            SELECT group_id as contact_id
            FROM chat_group_members
            WHERE user_id = ?
        """, (viewer_id, viewer_id, viewer_id, viewer_id, viewer_id, viewer_id, viewer_id)).fetchall()
        return [r['contact_id'] for r in rows if r['contact_id'] and r['contact_id'] != viewer_id]


def get_contact_info(contact_id: str):
    with get_db() as conn:
        if contact_id.startswith('group_'):
            return conn.execute(
                "SELECT name as username, id as user_id, 1 as is_group FROM chat_groups WHERE id = ?",
                (contact_id,)
            ).fetchone()
        
        return conn.execute(
            "SELECT username, user_id, 0 as is_group FROM users WHERE user_id = ?",
            (contact_id,)
        ).fetchone()


def get_last_message(viewer_id: str, contact_id: str):
    """Obtiene el último mensaje de la conversación que no haya sido borrado por el espectador."""
    with get_db() as conn:
        if contact_id.startswith('group_'):
            return conn.execute(f"""
                SELECT message, created_at, sender_id, file_name
                FROM chat_messages
                WHERE receiver_id = ? AND {_NOT_DELETED_SQL}
                ORDER BY created_at DESC LIMIT 1
            """, (contact_id, viewer_id)).fetchone()
            
        return conn.execute(f"""
            SELECT message, created_at, sender_id, file_name
            FROM chat_messages
            WHERE {_CHAT_PAIR_SQL} AND {_NOT_DELETED_SQL}
            ORDER BY created_at DESC LIMIT 1
        """, (viewer_id, contact_id, contact_id, viewer_id, viewer_id)).fetchone()


def get_unread_count(contact_id: str, viewer_id: str) -> int:
    with get_db() as conn:
        if contact_id.startswith('group_'):
            return 0 # Simplified: No unread counts for groups yet
            
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
        if contact_id.startswith('group_'):
            return conn.execute(f"""
                SELECT {_MSG_COLS}
                FROM chat_messages
                WHERE receiver_id = ? AND created_at < ? AND {_NOT_DELETED_SQL}
                ORDER BY created_at DESC LIMIT ?
            """, (contact_id, before, viewer_id, limit)).fetchall()
            
        return conn.execute(f"""
            SELECT {_MSG_COLS}
            FROM chat_messages
            WHERE {_CHAT_PAIR_SQL} AND created_at < ? AND {_NOT_DELETED_SQL}
            ORDER BY created_at DESC LIMIT ?
        """, (viewer_id, contact_id, contact_id, viewer_id, before, viewer_id, limit)).fetchall()


def get_messages_recent(viewer_id: str, contact_id: str, limit: int):
    with get_db() as conn:
        if contact_id.startswith('group_'):
            return conn.execute(f"""
                SELECT {_MSG_COLS}
                FROM chat_messages
                WHERE receiver_id = ? AND {_NOT_DELETED_SQL}
                ORDER BY created_at DESC LIMIT ?
            """, (contact_id, viewer_id, limit)).fetchall()
            
        return conn.execute(f"""
            SELECT {_MSG_COLS}
            FROM chat_messages
            WHERE {_CHAT_PAIR_SQL} AND {_NOT_DELETED_SQL}
            ORDER BY created_at DESC LIMIT ?
        """, (viewer_id, contact_id, contact_id, viewer_id, viewer_id, limit)).fetchall()


def get_poll_messages(viewer_id: str, contact_id: str, since: float):
    with get_db() as conn:
        if contact_id:
            if contact_id.startswith('group_'):
                return conn.execute(f"""
                    SELECT {_MSG_COLS}
                    FROM chat_messages
                    WHERE receiver_id = ? AND created_at > ? AND {_NOT_DELETED_SQL} 
                    ORDER BY created_at ASC
                """, (contact_id, since, viewer_id)).fetchall()
                
            return conn.execute(f"""
                SELECT {_MSG_COLS}
                FROM chat_messages
                WHERE {_CHAT_PAIR_SQL} AND created_at > ? AND {_NOT_DELETED_SQL} 
                ORDER BY created_at ASC
            """, (viewer_id, contact_id, contact_id, viewer_id, since, viewer_id)).fetchall()
        
        # When contact_id is not provided, we need to poll for ALL messages directed to the user,
        # OR to any group the user belongs to.
        return conn.execute(f"""
            SELECT {_MSG_COLS}
            FROM chat_messages
            WHERE (receiver_id = ? OR receiver_id IN (SELECT group_id FROM chat_group_members WHERE user_id = ?)) 
              AND created_at > ? AND {_NOT_DELETED_SQL} 
            ORDER BY created_at ASC
        """, (viewer_id, viewer_id, since, viewer_id)).fetchall()


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
                UPDATE chat_messages 
                SET message = '[DELETED]', file_path = NULL, file_name = NULL, read = 1
                WHERE id = ? AND sender_id = ?
            """, (msg_id, sender_id))
            conn.commit()
            return conn.total_changes > 0
        except Exception:
            return False


def delete_conversation(user_id: str, contact_id: str):
    """Oculta la conversación de la vista del usuario, pero los mensajes persisten para el otro usuario."""
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO hidden_conversations (user_id, contact_id) VALUES (?, ?)",
            (user_id, contact_id)
        )
        conn.commit()


def clear_conversation(user_id: str, contact_id: str):
    """Marca todos los mensajes actuales de la conversación como borrados para este usuario."""
    with get_db() as conn:
        if contact_id.startswith('group_'):
            conn.execute("""
                INSERT OR IGNORE INTO deleted_messages (message_id, user_id)
                SELECT id, ? FROM chat_messages WHERE receiver_id = ?
            """, (user_id, contact_id))
        else:
            conn.execute(f"""
                INSERT OR IGNORE INTO deleted_messages (message_id, user_id)
                SELECT id, ? FROM chat_messages WHERE {_CHAT_PAIR_SQL}
            """, (user_id, user_id, contact_id, contact_id, user_id))
        conn.commit()


def create_group(group_name: str, creator_id: str) -> str:
    group_id = f"group_{str(uuid.uuid4())}"
    now = time.time()
    with get_db() as conn:
        conn.execute("""
            INSERT INTO chat_groups (id, name, created_by, created_at)
            VALUES (?, ?, ?, ?)
        """, (group_id, group_name, creator_id, now))
        
        conn.execute("""
            INSERT INTO chat_group_members (group_id, user_id, role, joined_at)
            VALUES (?, ?, 'admin', ?)
        """, (group_id, creator_id, now))
        conn.commit()
    return group_id

def add_group_member(group_id: str, user_id: str, role: str = 'member'):
    now = time.time()
    with get_db() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO chat_group_members (group_id, user_id, role, joined_at)
            VALUES (?, ?, ?, ?)
        """, (group_id, user_id, role, now))
        conn.commit()

def remove_group_member(group_id: str, user_id: str):
    with get_db() as conn:
        conn.execute("""
            DELETE FROM chat_group_members
            WHERE group_id = ? AND user_id = ?
        """, (group_id, user_id))
        conn.commit()

def get_group_members(group_id: str) -> list[str]:
    with get_db() as conn:
        rows = conn.execute("""
            SELECT user_id FROM chat_group_members WHERE group_id = ?
        """, (group_id,)).fetchall()
        return [r['user_id'] for r in rows]

def is_group_member(group_id: str, user_id: str) -> bool:
    with get_db() as conn:
        row = conn.execute("""
            SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?
        """, (group_id, user_id)).fetchone()
        return bool(row)

def get_group_creator(group_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT created_by FROM chat_groups WHERE id = ?", (group_id,)).fetchone()
        return row['created_by'] if row else None



def delete_group(group_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM chat_groups WHERE id = ?", (group_id,))
        conn.execute("DELETE FROM chat_group_members WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM chat_messages WHERE receiver_id = ?", (group_id,))
        conn.commit()

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