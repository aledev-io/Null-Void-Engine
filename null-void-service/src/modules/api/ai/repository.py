import uuid
import time
from datetime import datetime
from core.database import get_db


def ensure_schema():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_sessions (
                id         TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                title      TEXT DEFAULT 'New Chat',
                model      TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                user_id    TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT NOT NULL,
                model      TEXT,
                created_at TEXT NOT NULL
            )
        """)
        
        # Check if updated_at is missing from ai_sessions for backward compatibility
        cursor = conn.execute("PRAGMA table_info(ai_sessions)")
        cols = {row[1] for row in cursor.fetchall()}
        if "updated_at" not in cols:
            conn.execute("ALTER TABLE ai_sessions ADD COLUMN updated_at TEXT")
            conn.execute("UPDATE ai_sessions SET updated_at = created_at WHERE updated_at IS NULL")
            
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_shared_sessions (
                original_session_id TEXT NOT NULL,
                shared_session_id TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_api_keys (
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                api_key TEXT NOT NULL,
                api_url TEXT,
                PRIMARY KEY (user_id, provider)
            )
        """)
        # Migración: modelo por defecto del proveedor (ej: OpenRouter necesita
        # un id de modelo concreto, no basta con 'openrouter').
        cursor = conn.execute("PRAGMA table_info(ai_api_keys)")
        key_cols = {row[1] for row in cursor.fetchall()}
        if "model" not in key_cols:
            conn.execute("ALTER TABLE ai_api_keys ADD COLUMN model TEXT")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_notes (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT,
                content TEXT,
                created_at REAL,
                updated_at REAL,
                pinned INTEGER DEFAULT 0,
                is_shared INTEGER DEFAULT 0,
                author TEXT,
                shared_by TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_note_collaborators (
                note_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT,
                PRIMARY KEY (note_id, user_id)
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_workspaces (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                created_at REAL,
                updated_at REAL,
                is_starred INTEGER DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_workspace_files (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                content TEXT,
                created_at REAL
            )
        """)
        
        cursor = conn.execute("PRAGMA table_info(ai_sessions)")
        cols = {row[1] for row in cursor.fetchall()}
        if "workspace_id" not in cols:
            conn.execute("ALTER TABLE ai_sessions ADD COLUMN workspace_id TEXT")
            
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_user_preferences (
                user_id TEXT PRIMARY KEY,
                default_model TEXT
            )
        """)

def get_user_default_model(uid: str) -> str:
    with get_db() as conn:
        row = conn.execute("SELECT default_model FROM ai_user_preferences WHERE user_id = ?", (uid,)).fetchone()
        return row[0] if row and row[0] else None

def set_user_default_model(uid: str, model_name: str):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO ai_user_preferences (user_id, default_model)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET default_model = excluded.default_model
        """, (uid, model_name))
            
        cursor = conn.execute("PRAGMA table_info(ai_workspaces)")
        cols = {row[1] for row in cursor.fetchall()}
        if "is_starred" not in cols:
            conn.execute("ALTER TABLE ai_workspaces ADD COLUMN is_starred INTEGER DEFAULT 0")
            conn.execute("UPDATE ai_workspaces SET is_starred = 0 WHERE is_starred IS NULL")
            
        if "is_archived" not in cols:
            conn.execute("ALTER TABLE ai_workspaces ADD COLUMN is_archived INTEGER DEFAULT 0")
            conn.execute("UPDATE ai_workspaces SET is_archived = 0 WHERE is_archived IS NULL")
            
        conn.commit()


def create_session(uid: str, model: str = None, title: str = "New Chat", session_id: str = None, workspace_id: str = None) -> str:
    ensure_schema()
    if not session_id:
        session_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_sessions (id, user_id, title, model, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at, "
            "title = CASE WHEN (excluded.title IS NOT NULL AND excluded.title != '' AND excluded.title != 'New Chat') THEN excluded.title ELSE ai_sessions.title END",
            (session_id, uid, title, model, workspace_id, now, now),
        )
        conn.commit()
    return session_id


def save_message(
    uid: str, session_id: str, role: str, content: str, model: str = None
) -> int:
    ensure_schema()
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_messages (session_id, user_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, uid, role, content, model, now),
        )
        conn.execute(
            "UPDATE ai_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def get_session_messages(uid: str, session_id: str) -> list[dict]:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM ai_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC",
            (uid, session_id),
        ).fetchall()
        return [dict(r) for r in rows]

def clear_session_messages(uid: str, session_id: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute(
            "DELETE FROM ai_messages WHERE user_id = ? AND session_id = ?",
            (uid, session_id),
        )
        conn.commit()


def get_user_sessions(uid: str) -> list[dict]:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM ai_sessions WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC",
            (uid,),
        ).fetchall()
        sessions = [dict(r) for r in rows]
        for s in sessions:
            if not s.get("title") or s.get("title") == "New Chat":
                first_msg = conn.execute(
                    "SELECT content FROM ai_messages WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1",
                    (s["id"],)
                ).fetchone()
                if first_msg and first_msg[0]:
                    clean_title = first_msg[0].strip().replace("\n", " ")[:30] + "..."
                    s["title"] = clean_title
                    conn.execute("UPDATE ai_sessions SET title = ? WHERE id = ?", (clean_title, s["id"]))
        conn.commit()
        return sessions


def delete_session(uid: str, session_id: str) -> list[dict]:
    ensure_schema()
    affected_users = []
    with get_db() as conn:
        # Encontrar todas las sesiones compartidas derivadas de esta
        shared = conn.execute("SELECT shared_session_id FROM ai_shared_sessions WHERE original_session_id = ?", (session_id,)).fetchall()
        for row in shared:
            s_id = row['shared_session_id']
            # Obtener a quién pertenece esta sesión compartida antes de borrarla
            s_user = conn.execute("SELECT user_id FROM ai_sessions WHERE id = ?", (s_id,)).fetchone()
            if s_user:
                affected_users.append({'user_id': s_user['user_id'], 'session_id': s_id})
                
            # Borrar la sesión compartida (cascada manual)
            conn.execute("DELETE FROM ai_messages WHERE session_id = ?", (s_id,))
            conn.execute("DELETE FROM ai_sessions WHERE id = ?", (s_id,))
            
        # Limpiar referencias de la tabla de compartidos
        conn.execute("DELETE FROM ai_shared_sessions WHERE original_session_id = ?", (session_id,))
        conn.execute("DELETE FROM ai_shared_sessions WHERE shared_session_id = ?", (session_id,))

        conn.execute(
            "DELETE FROM ai_messages WHERE user_id = ? AND session_id = ?",
            (uid, session_id),
        )
        conn.execute(
            "DELETE FROM ai_sessions WHERE user_id = ? AND id = ?",
            (uid, session_id),
        )
        conn.commit()
    return affected_users

def delete_all_user_sessions(uid: str) -> list[dict]:
    ensure_schema()
    affected_users = []
    with get_db() as conn:
        sessions = conn.execute("SELECT id FROM ai_sessions WHERE user_id = ?", (uid,)).fetchall()
        for session in sessions:
            s_id = session['id']
            shared = conn.execute("SELECT shared_session_id FROM ai_shared_sessions WHERE original_session_id = ?", (s_id,)).fetchall()
            for row in shared:
                sh_id = row['shared_session_id']
                # Obtener a quién pertenece esta sesión compartida antes de borrarla
                s_user = conn.execute("SELECT user_id FROM ai_sessions WHERE id = ?", (sh_id,)).fetchone()
                if s_user:
                    affected_users.append({'user_id': s_user['user_id'], 'session_id': sh_id})
                    
                conn.execute("DELETE FROM ai_messages WHERE session_id = ?", (sh_id,))
                conn.execute("DELETE FROM ai_sessions WHERE id = ?", (sh_id,))
            
            conn.execute("DELETE FROM ai_shared_sessions WHERE original_session_id = ?", (s_id,))
            conn.execute("DELETE FROM ai_shared_sessions WHERE shared_session_id = ?", (s_id,))

        conn.execute("DELETE FROM ai_messages WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM ai_sessions WHERE user_id = ?", (uid,))
        conn.commit()
    return affected_users

def clone_session_for_user(owner_uid: str, session_id: str, new_user_id: str, sender_name: str) -> str:
    ensure_schema()
    with get_db() as conn:
        session = conn.execute(
            "SELECT * FROM ai_sessions WHERE id = ? AND user_id = ?",
            (session_id, owner_uid)
        ).fetchone()
        
        if not session:
            return None
            
        existing = conn.execute('''
            SELECT s.id 
            FROM ai_sessions s
            JOIN ai_shared_sessions ss ON s.id = ss.shared_session_id
            WHERE ss.original_session_id = ? AND s.user_id = ?
        ''', (session_id, new_user_id)).fetchone()
        
        if existing:
            return existing['id']
            
        new_session_id = str(uuid.uuid4())
        new_title = f"{session['title']} (de {sender_name})"
        now = datetime.now().isoformat()
        
        conn.execute(
            "INSERT INTO ai_sessions (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (new_session_id, new_user_id, new_title, session['model'], now, now),
        )
        
        # Clone messages (un solo INSERT...SELECT, sin bucle por mensaje)
        conn.execute("""
            INSERT INTO ai_messages (session_id, user_id, role, content, model, created_at)
            SELECT ?, ?, role, content, model, ?
            FROM ai_messages
            WHERE session_id = ? AND user_id = ?
        """, (new_session_id, new_user_id, now, session_id, owner_uid))
            
        # Vincular como sesión compartida
        conn.execute(
            "INSERT INTO ai_shared_sessions (original_session_id, shared_session_id) VALUES (?, ?)",
            (session_id, new_session_id)
        )
            
        conn.commit()
        return new_session_id

def create_shared_session(recipient_user_id: str, sender_name: str, title: str, messages: list) -> str:
    ensure_schema()
    with get_db() as conn:
        new_session_id = str(uuid.uuid4())
        new_title = f"{title} (de {sender_name})"
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO ai_sessions (id, user_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (new_session_id, recipient_user_id, new_title, "shared", now, now),
        )
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            conn.execute(
                "INSERT INTO ai_messages (session_id, user_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (new_session_id, recipient_user_id, role, content, "shared", now),
            )
        conn.commit()
        return new_session_id

def save_api_key(user_id: str, provider: str, api_key: str, api_url: str = None, model: str = None):
    ensure_schema()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO ai_api_keys (user_id, provider, api_key, api_url, model) VALUES (?, ?, ?, ?, ?)",
            (user_id, provider, api_key, api_url, model)
        )
        conn.commit()

def get_api_key(user_id: str, provider: str) -> dict:
    ensure_schema()
    with get_db() as conn:
        row = conn.execute(
            "SELECT api_key, api_url, model FROM ai_api_keys WHERE user_id = ? AND provider = ?",
            (user_id, provider)
        ).fetchone()
        if row:
            return {"api_key": row[0], "api_url": row[1], "model": row[2]}
        return None

def get_user_api_keys(user_id: str) -> list:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT provider, api_url, api_key, model FROM ai_api_keys WHERE user_id = ?",
            (user_id,)
        ).fetchall()
        return [{"provider": r[0], "api_url": r[1], "api_key": r[2], "model": r[3]} for r in rows]


def delete_api_key(user_id: str, provider: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute(
            "DELETE FROM ai_api_keys WHERE user_id = ? AND provider = ?",
            (user_id, provider)
        )
        conn.commit()

def get_user_notes(user_id: str) -> list:
    ensure_schema()
    with get_db() as conn:
        # GROUP_CONCAT trae los colaboradores en la misma consulta (sin N+1).
        rows = conn.execute("""
            SELECT n.id, n.user_id, n.title, n.content, n.created_at, n.updated_at,
                   n.pinned, n.is_shared, n.author, n.shared_by,
                   COALESCE(GROUP_CONCAT(c.user_id), '') AS collab_ids,
                   COALESCE(GROUP_CONCAT(c.user_name), '') AS collab_names
            FROM ai_notes n
            LEFT JOIN ai_note_collaborators c ON n.id = c.note_id
            WHERE n.user_id = ? OR c.user_id = ?
            GROUP BY n.id
            ORDER BY n.updated_at DESC
        """, (user_id, user_id)).fetchall()

        notes = []
        for r in rows:
            collaborators = [u for u in r['collab_ids'].split(',') if u]
            collaborators_names = [u for u in r['collab_names'].split(',') if u]

            notes.append({
                "id": r['id'],
                "user_id": r['user_id'],
                "title": r['title'],
                "content": r['content'],
                "created": int(r['created_at']) if r['created_at'] else 0,
                "updated": int(r['updated_at']) if r['updated_at'] else 0,
                "pinned": bool(r['pinned']),
                "is_shared": bool(r['is_shared']),
                "author": r['author'],
                "shared_by": r['shared_by'],
                "collaborators": collaborators,
                "collaborators_names": collaborators_names
            })
        return notes

def save_note(note_data: dict):
    ensure_schema()
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO ai_notes 
            (id, user_id, title, content, created_at, updated_at, pinned, is_shared, author, shared_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            note_data["id"],
            note_data.get("user_id", note_data.get("author")), # Provide fallback
            note_data.get("title", ""),
            note_data.get("content", ""),
            note_data.get("createdAt", note_data.get("created", 0)),
            note_data.get("updatedAt", note_data.get("updated", 0)),
            1 if note_data.get("pinned") else 0,
            1 if note_data.get("is_shared") else 0,
            note_data.get("author", ""),
            note_data.get("shared_by", "")
        ))
        
        conn.commit()

def delete_note(note_id: str, user_id: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute("DELETE FROM ai_notes WHERE id = ? AND user_id = ?", (note_id, user_id))
        conn.execute("DELETE FROM ai_note_collaborators WHERE note_id = ?", (note_id,))
        conn.execute("DELETE FROM ai_note_collaborators WHERE note_id = ? AND user_id = ?", (note_id, user_id))
        conn.commit()

def share_note(note_id: str, friend_id: str, friend_name: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute("UPDATE ai_notes SET is_shared = 1 WHERE id = ?", (note_id,))
        conn.execute("INSERT OR IGNORE INTO ai_note_collaborators (note_id, user_id, user_name) VALUES (?, ?, ?)", (note_id, friend_id, friend_name))
        conn.commit()

def unshare_note(note_id: str, friend_id: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute("DELETE FROM ai_note_collaborators WHERE note_id = ? AND user_id = ?", (note_id, friend_id))
        conn.commit()

def create_workspace(uid: str, name: str, description: str = "") -> str:
    ensure_schema()
    wid = str(uuid.uuid4())
    now = datetime.now().timestamp()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_workspaces (id, user_id, name, description, created_at, updated_at, is_starred) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (wid, uid, name, description, now, now, 0)
        )
        conn.commit()
    return wid

def get_workspaces(uid: str) -> list[dict]:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM ai_workspaces WHERE user_id = ? ORDER BY created_at DESC", (uid,)).fetchall()
        return [dict(r) for r in rows]

def delete_workspace(uid: str, workspace_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM ai_workspaces WHERE id = ? AND user_id = ?", (workspace_id, uid))
        conn.execute("DELETE FROM ai_workspace_files WHERE workspace_id = ?", (workspace_id,))
        conn.execute("UPDATE ai_sessions SET workspace_id = NULL WHERE workspace_id = ? AND user_id = ?", (workspace_id, uid))

def update_workspace(uid: str, workspace_id: str, name: str, description: str):
    with get_db() as conn:
        now = int(time.time())
        conn.execute("UPDATE ai_workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?", (name, description, now, workspace_id, uid))
        conn.commit()

def add_workspace_file(workspace_id: str, filename: str, content: str) -> str:
    ensure_schema()
    fid = str(uuid.uuid4())
    now = datetime.now().timestamp()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_workspace_files (id, workspace_id, filename, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (fid, workspace_id, filename, content, now)
        )
        conn.commit()
    return fid

def get_workspace_files(workspace_id: str) -> list[dict]:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute("SELECT id, filename, created_at FROM ai_workspace_files WHERE workspace_id = ? ORDER BY created_at ASC", (workspace_id,)).fetchall()
        return [dict(r) for r in rows]

def get_workspace_file_content(file_id: str) -> str:
    ensure_schema()
    with get_db() as conn:
        row = conn.execute("SELECT content FROM ai_workspace_files WHERE id = ?", (file_id,)).fetchone()
        return row["content"] if row else ""

def delete_workspace_file(file_id: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute("DELETE FROM ai_workspace_files WHERE id = ?", (file_id,))
        conn.commit()

def toggle_workspace_star(uid: str, workspace_id: str, is_starred: int):
    with get_db() as conn:
        conn.execute("UPDATE ai_workspaces SET is_starred = ? WHERE id = ? AND user_id = ?", (is_starred, workspace_id, uid))
        conn.commit()

def toggle_workspace_archive(uid: str, workspace_id: str, is_archived: int):
    with get_db() as conn:
        conn.execute("UPDATE ai_workspaces SET is_archived = ? WHERE id = ? AND user_id = ?", (is_archived, workspace_id, uid))
        conn.commit()
