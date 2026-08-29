"""Persistencia de datos para el submódulo de Workspaces/Proyectos."""
import uuid
import time
from datetime import datetime
from core.database import get_db
from ..repository import ensure_schema


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


def add_workspace_file(workspace_id: str, filename: str, file_id: str = None) -> str:
    ensure_schema()
    fid = str(uuid.uuid4())
    now = datetime.now().timestamp()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_workspace_files (id, workspace_id, filename, file_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (fid, workspace_id, filename, file_id, now)
        )
        conn.commit()
    return fid


def get_workspace_files(workspace_id: str) -> list[dict]:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT wf.id, wf.filename, wf.file_id, wf.created_at, w.user_id "
            "FROM ai_workspace_files wf JOIN ai_workspaces w ON w.id = wf.workspace_id "
            "WHERE wf.workspace_id = ? ORDER BY wf.created_at ASC",
            (workspace_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_workspace_file_content(file_id: str) -> str:
    """Devuelve el contenido del archivo de workspace desde <DATA_DIR>/ai/<uid>/
    (metadata gestionada por el módulo cloud)."""
    ensure_schema()
    with get_db() as conn:
        row = conn.execute(
            "SELECT wf.file_id, w.user_id FROM ai_workspace_files wf "
            "JOIN ai_workspaces w ON w.id = wf.workspace_id WHERE wf.id = ?",
            (file_id,),
        ).fetchone()
    if not row or not row['file_id']:
        return ""
    from modules.storage import store
    data = store.ai_read_file_by_uid(row['user_id'], row['file_id'])
    if data is None:
        return ""
    return data.decode("utf-8", errors="replace")


def delete_workspace_file(file_id: str) -> tuple:
    """Elimina la fila del workspace; devuelve (user_id, attachment_file_id)
    para que la ruta limpie también el archivo físico."""
    ensure_schema()
    with get_db() as conn:
        row = conn.execute(
            "SELECT wf.file_id, w.user_id FROM ai_workspace_files wf "
            "JOIN ai_workspaces w ON w.id = wf.workspace_id WHERE wf.id = ?",
            (file_id,),
        ).fetchone()
        conn.execute("DELETE FROM ai_workspace_files WHERE id = ?", (file_id,))
        conn.commit()
    if row and row['file_id']:
        return row['user_id'], row['file_id']
    return None, None


def toggle_workspace_star(uid: str, workspace_id: str, is_starred: int):
    with get_db() as conn:
        conn.execute("UPDATE ai_workspaces SET is_starred = ? WHERE id = ? AND user_id = ?", (is_starred, workspace_id, uid))
        conn.commit()


def toggle_workspace_archive(uid: str, workspace_id: str, is_archived: int):
    with get_db() as conn:
        conn.execute("UPDATE ai_workspaces SET is_archived = ? WHERE id = ? AND user_id = ?", (is_archived, workspace_id, uid))
        conn.commit()
