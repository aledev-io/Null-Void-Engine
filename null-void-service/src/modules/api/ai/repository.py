import uuid
import time
from datetime import datetime
from core.database import get_db


def ensure_schema():
    """Garantiza el esquema canónico (core.schema) y las migraciones
    versionadas. Ya no contiene ALTER TABLE ad-hoc: el DDL canónico vive en
    core/schema.py y las migraciones del módulo IA están registradas en
    core.schema.MIGRATIONS (101-104)."""
    from core import schema
    schema.apply_schema()


def _parse_attachments_json(att_str):
    """Convierte el JSON de attachments almacenado en una lista de dicts."""
    if not att_str:
        return []
    try:
        atts = json.loads(att_str)
    except Exception:
        return []
    return [a for a in atts if isinstance(a, dict)] if isinstance(atts, list) else []


def _parse_attachment_ids(att_str):
    """Extrae la lista de ids (FK) de un JSON de attachments almacenado."""
    return [a["id"] for a in _parse_attachments_json(att_str) if a.get("id")]


_AI_ATTACHMENT_TABLE_DDL = """
    CREATE TABLE IF NOT EXISTS ai_attachment_files (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        filename   TEXT NOT NULL,
        size       INTEGER NOT NULL DEFAULT 0,
        mime       TEXT,
        is_image   INTEGER NOT NULL DEFAULT 0,
        is_text    INTEGER NOT NULL DEFAULT 0,
        is_audio   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        trashed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""


def _ensure_column(conn, table, column, ddl):
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _migrate_v4_ai_trashed_at():
    """v4: columna trashed_at en ai_attachment_files para reactivar la
    metadata al restaurar archivos de IA desde la papelera del Cloud."""
    with get_db() as conn:
        _ensure_column(conn, "ai_attachment_files", "trashed_at", "TEXT")


def _migrate_v1_attachments():
    """v1: los adjuntos con payload embebido (base64/texto) se extraen a
    <DATA_DIR>/ai/<uid>/ con metadata en ai_attachment_files y
    ai_messages.attachments queda solo con la FK [{id}]. Las escrituras se
    hacen con conexiones cerradas para no bloquear al módulo cloud."""
    from modules.api.cloud import services as cloud_services
    from modules.api.cloud import repository as cloud_repo
    import base64
    import os as _os
    with get_db() as conn:
        conn.execute(_AI_ATTACHMENT_TABLE_DDL)
        # Autodefensa: bases legacy pueden no tener la columna attachments
        # (código antiguo la añadía con ALTER en cada arranque).
        _ensure_column(conn, "ai_messages", "attachments", "TEXT")
        pending = [
            (r['id'], r['user_id'], _parse_attachments_json(r['attachments']))
            for r in conn.execute(
                "SELECT id, user_id, attachments FROM ai_messages WHERE attachments IS NOT NULL AND attachments != ''"
            ).fetchall()
        ]

    updates = []
    for msg_id, uid, legacy in pending:
        if not legacy:
            continue
        try:
            new_atts = []
            for att in legacy:
                file_id = att.get("id")
                data = att.get("data")
                name = att.get("name") or "archivo"
                if data:
                    try:
                        if data.startswith("data:"):
                            raw = data.split(",", 1)[1] if "," in data else data
                            payload = base64.b64decode(raw)
                        else:
                            payload = data.encode("utf-8")
                    except Exception:
                        continue
                    ref = cloud_services.ai_save_file_uid(uid, name, payload, check_quota=False)
                    if isinstance(ref, dict) and ref.get("id"):
                        new_atts.append({"id": ref["id"]})
                    continue
                if not file_id:
                    continue
                # Refs legacy (id = nombre en disco) o ya uuid: asegurar metadata
                if not cloud_repo.get_ai_attachment(uid, file_id):
                    root = cloud_services.ai_root_for_uid(uid)
                    safe_name = _os.path.basename(str(file_id))
                    exists = False
                    if root:
                        try:
                            exists = _os.path.isfile(cloud_services.safe_join(root, safe_name))
                        except ValueError:
                            exists = False
                    if not exists:
                        continue
                    flags = cloud_services._ai_ext_flags(safe_name)
                    try:
                        with open(cloud_services.safe_join(root, safe_name), 'rb') as fh:
                            size = len(fh.read())
                    except Exception:
                        size = 0
                    cloud_repo.add_ai_attachment(uid, str(file_id), safe_name,
                                                 size, flags["mime"], flags["is_image"], flags["is_text"], flags["is_audio"])
                new_atts.append({"id": file_id})
            updates.append((json.dumps(new_atts) if new_atts else None, msg_id))
        except Exception:
            # Fila problemática (usuario inexistente, datos corruptos...):
            # se deja intacta para no perder nada; la migración continúa.
            continue

    with get_db() as conn:
        for att_str, msg_id in updates:
            conn.execute("UPDATE ai_messages SET attachments = ? WHERE id = ?", (att_str, msg_id))


def _migrate_v2_workspace_files():
    """v2: el contenido de los archivos de workspace (ai_workspace_files)
    pasa a <DATA_DIR>/ai/<uid>/ con metadata en ai_attachment_files; la fila
    conserva solo la FK (file_id)."""
    from modules.api.cloud import services as cloud_services
    with get_db() as conn:
        conn.execute(_AI_ATTACHMENT_TABLE_DDL)
        _ensure_column(conn, "ai_workspace_files", "file_id", "TEXT")
        pending = [
            (r['id'], r['workspace_id'], r['filename'], r['content'])
            for r in conn.execute(
                "SELECT wf.id, wf.workspace_id, wf.filename, wf.content "
                "FROM ai_workspace_files wf "
                "JOIN ai_workspaces w ON w.id = wf.workspace_id "
                "WHERE wf.content IS NOT NULL AND wf.content != ''"
            ).fetchall()
        ]

    updates = []
    for fid, ws_id, filename, content in pending:
        try:
            if not content:
                continue
            if not isinstance(content, str):
                content = str(content)
            with get_db() as conn:
                owner = conn.execute(
                    "SELECT user_id FROM ai_workspaces WHERE id = ?", (ws_id,)
                ).fetchone()
            if not owner:
                continue
            ref = cloud_services.ai_save_file_uid(owner['user_id'], filename or "archivo",
                                                  content.encode("utf-8"), check_quota=False)
            if isinstance(ref, dict) and ref.get("id"):
                updates.append((ref["id"], fid))
        except Exception:
            continue

    with get_db() as conn:
        for file_id, fid in updates:
            conn.execute("UPDATE ai_workspace_files SET file_id = ?, content = NULL WHERE id = ?", (file_id, fid))


def _migrate_v3_notes():
    """v3: el contenido de las notas de IA (ai_notes) pasa a
    <DATA_DIR>/ai/<uid>/ con metadata en ai_attachment_files; la nota
    conserva solo la FK (file_id)."""
    from modules.api.cloud import services as cloud_services
    with get_db() as conn:
        conn.execute(_AI_ATTACHMENT_TABLE_DDL)
        _ensure_column(conn, "ai_notes", "file_id", "TEXT")
        pending = [
            (r['id'], r['user_id'], r['title'], r['content'])
            for r in conn.execute(
                "SELECT id, user_id, title, content FROM ai_notes WHERE content IS NOT NULL AND content != ''"
            ).fetchall()
        ]

    def _note_filename(title):
        safe = "".join(c for c in str(title or "") if c.isalnum() or c in ' ._-()').strip()
        safe = safe[:80] or "nota"
        return f"{safe}.txt"

    updates = []
    for nid, uid, title, content in pending:
        try:
            if not content:
                continue
            if not isinstance(content, str):
                content = str(content)
            ref = cloud_services.ai_save_file_uid(uid, _note_filename(title),
                                                  content.encode("utf-8"), check_quota=False)
            if isinstance(ref, dict) and ref.get("id"):
                updates.append((ref["id"], nid))
        except Exception:
            continue

    with get_db() as conn:
        for file_id, nid in updates:
            conn.execute("UPDATE ai_notes SET file_id = ?, content = NULL WHERE id = ?", (file_id, nid))

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


import json

def save_message(
    uid: str, session_id: str, role: str, content: str, model: str = None, attachments = None,
    cancelled: bool = False,
) -> int:
    ensure_schema()
    now = datetime.now().isoformat()
    att_str = json.dumps(attachments) if attachments is not None else None
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_messages (session_id, user_id, role, content, model, attachments, cancelled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, uid, role, content, model, att_str, 1 if cancelled else 0, now),
        )
        conn.execute(
            "UPDATE ai_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _resolve_attachment_refs(uid, atts):
    """Convierte las FKs almacenadas en ai_messages.attachments ([{id}]) en
    refs completos usando la metadata de la tabla de Cloud
    (ai_attachment_files). Los huérfanos se descartan."""
    if not atts:
        return atts or []
    ids = []
    for a in atts:
        if isinstance(a, dict) and a.get("id"):
            ids.append(a["id"])
        elif isinstance(a, str) and a:
            ids.append(a)
    if not ids:
        return []
    from modules.api.cloud import services as cloud_services
    return cloud_services.ai_get_refs_by_uid(uid, ids)


def get_session_messages(uid: str, session_id: str) -> list[dict]:
    ensure_schema()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM ai_messages WHERE user_id = ? AND session_id = ? ORDER BY id ASC",
            (uid, session_id),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("attachments"):
                try:
                    d["attachments"] = json.loads(d["attachments"])
                except Exception:
                    d["attachments"] = None
                if d["attachments"]:
                    d["attachments"] = _resolve_attachment_refs(uid, d["attachments"])
            result.append(d)
        return result

def clear_session_messages(uid: str, session_id: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute(
            "DELETE FROM ai_messages WHERE user_id = ? AND session_id = ?",
            (uid, session_id),
        )
        conn.commit()


def replace_session_messages(uid: str, session_id: str, messages: list):
    """Reemplaza el historial de una sesión en una única transacción y conexión.

    messages: lista de dicts {role, content, model, attachments} ya resueltos
    (attachments como refs de almacenamiento). Si cualquier INSERT falla se hace
    rollback y el historial previo permanece intacto (nunca queda vacío ni parcial).
    """
    ensure_schema()
    now = datetime.now().isoformat()
    with get_db() as conn:
        try:
            conn.execute(
                "DELETE FROM ai_messages WHERE user_id = ? AND session_id = ?",
                (uid, session_id),
            )
            for m in messages:
                att_str = json.dumps(m.get("attachments")) if m.get("attachments") is not None else None
                conn.execute(
                    "INSERT INTO ai_messages (session_id, user_id, role, content, model, attachments, cancelled, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (session_id, uid, m["role"], m["content"], m.get("model"), att_str, 0, now),
                )
            conn.execute(
                "UPDATE ai_sessions SET updated_at = ? WHERE id = ?",
                (now, session_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


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
    orphan_attachments = []
    with get_db() as conn:
        # Encontrar todas las sesiones compartidas derivadas de esta
        shared = conn.execute("SELECT shared_session_id FROM ai_shared_sessions WHERE original_session_id = ?", (session_id,)).fetchall()
        for row in shared:
            s_id = row['shared_session_id']
            # Obtener a quién pertenece esta sesión compartida antes de borrarla
            s_user = conn.execute("SELECT user_id FROM ai_sessions WHERE id = ?", (s_id,)).fetchone()
            if s_user:
                affected_users.append({'user_id': s_user['user_id'], 'session_id': s_id})
                
            for m in conn.execute("SELECT user_id, attachments FROM ai_messages WHERE session_id = ?", (s_id,)).fetchall():
                ids = _parse_attachment_ids(m['attachments'])
                if ids:
                    orphan_attachments.append((m['user_id'], ids))
            # Borrar la sesión compartida (cascada manual)
            conn.execute("DELETE FROM ai_messages WHERE session_id = ?", (s_id,))
            conn.execute("DELETE FROM ai_sessions WHERE id = ?", (s_id,))
            
        # Limpiar referencias de la tabla de compartidos
        conn.execute("DELETE FROM ai_shared_sessions WHERE original_session_id = ?", (session_id,))
        conn.execute("DELETE FROM ai_shared_sessions WHERE shared_session_id = ?", (session_id,))

        for m in conn.execute(
            "SELECT attachments FROM ai_messages WHERE user_id = ? AND session_id = ?",
            (uid, session_id),
        ).fetchall():
            ids = _parse_attachment_ids(m['attachments'])
            if ids:
                orphan_attachments.append((uid, ids))
        conn.execute(
            "DELETE FROM ai_messages WHERE user_id = ? AND session_id = ?",
            (uid, session_id),
        )
        conn.execute(
            "DELETE FROM ai_sessions WHERE user_id = ? AND id = ?",
            (uid, session_id),
        )
        conn.commit()
    _cleanup_orphan_attachments(orphan_attachments)
    return affected_users

def _cleanup_orphan_attachments(orphan_attachments):
    """Borra metadata + archivo físico de adjuntos huérfanos (sesiones eliminadas)."""
    if not orphan_attachments:
        return
    from modules.api.cloud import services as cloud_services
    seen = set()
    for owner, ids in orphan_attachments:
        key = (owner, tuple(sorted(ids)))
        if key in seen:
            continue
        seen.add(key)
        try:
            cloud_services.ai_cleanup_attachments(owner, ids)
        except Exception:
            pass


def delete_all_user_sessions(uid: str) -> list[dict]:
    ensure_schema()
    affected_users = []
    orphan_attachments = []
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
                    
                for m in conn.execute("SELECT user_id, attachments FROM ai_messages WHERE session_id = ?", (sh_id,)).fetchall():
                    ids = _parse_attachment_ids(m['attachments'])
                    if ids:
                        orphan_attachments.append((m['user_id'], ids))
                conn.execute("DELETE FROM ai_messages WHERE session_id = ?", (sh_id,))
                conn.execute("DELETE FROM ai_sessions WHERE id = ?", (sh_id,))
            
            for m in conn.execute("SELECT attachments FROM ai_messages WHERE session_id = ?", (s_id,)).fetchall():
                ids = _parse_attachment_ids(m['attachments'])
                if ids:
                    orphan_attachments.append((uid, ids))
            conn.execute("DELETE FROM ai_shared_sessions WHERE original_session_id = ?", (s_id,))
            conn.execute("DELETE FROM ai_shared_sessions WHERE shared_session_id = ?", (s_id,))

        conn.execute("DELETE FROM ai_messages WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM ai_sessions WHERE user_id = ?", (uid,))
        conn.commit()
    _cleanup_orphan_attachments(orphan_attachments)
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

def save_api_key(user_id: str, provider: str, api_key: str, api_url: str = None, model: str = None, is_shared: int = 0, shared_with_users: str = "*"):
    ensure_schema()
    from .crypto import encrypt_api_key
    encrypted_key = encrypt_api_key(api_key)
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO ai_api_keys (user_id, provider, api_key, api_url, model, is_shared, shared_with_users) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, provider, encrypted_key, api_url, model, int(is_shared), shared_with_users)
        )
        conn.commit()

def toggle_api_key_sharing(user_id: str, provider: str, is_shared: int, shared_with_users: str = "*"):
    ensure_schema()
    with get_db() as conn:
        conn.execute(
            "UPDATE ai_api_keys SET is_shared = ?, shared_with_users = ? WHERE user_id = ? AND LOWER(provider) = LOWER(?)",
            (int(is_shared), shared_with_users, user_id, provider)
        )
        conn.commit()

def _are_friends(uid1, uid2):
    """¿Son amigos aceptados en el módulo Friends?"""
    if not uid1 or not uid2 or str(uid1) == str(uid2):
        return False
    with get_db() as conn:
        try:
            r = conn.execute(
                "SELECT 1 FROM friendships "
                "WHERE ((requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?)) "
                "AND status = 'accepted' LIMIT 1",
                (uid1, uid2, uid2, uid1),
            ).fetchone()
        except Exception:
            return False
        return r is not None


def _key_allows(allowed, user_id, owner_id=None):
    """¿El user_id (o su username) tiene acceso a una API key compartida?
    - Si allowed es '*' o 'all', se comparte con TODOS LOS AMIGOS ACEPTADOS del dueño (_are_friends).
    - Si allowed contiene IDs o usernames específicos, solo esos amigos seleccionados tienen acceso.
    """
    if not user_id:
        return False
    if owner_id and str(user_id) == str(owner_id):
        return True

    allowed_str = str(allowed or "*").strip()

    # Modo '*' -> Estrictamente todos mis amigos aceptados del sistema
    if allowed_str == '*' or allowed_str.lower() == 'all':
        if not owner_id:
            return False
        return _are_friends(owner_id, user_id)

    # Modo lista específica de amigos/usuarios seleccionados
    allowed_ids = [u.strip().lower() for u in allowed_str.split(',') if u.strip()]
    if not allowed_ids:
        return False

    if str(user_id).lower() in allowed_ids:
        return True

    with get_db() as conn:
        row = conn.execute("SELECT username FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if row and row['username'] and row['username'].lower() in allowed_ids:
            return True

    return False


def get_api_key(user_id: str, provider: str) -> dict:
    ensure_schema()
    from .crypto import decrypt_api_key
    with get_db() as conn:
        row = conn.execute(
            "SELECT api_key, api_url, model, is_shared, user_id, shared_with_users FROM ai_api_keys WHERE user_id = ? AND LOWER(provider) = LOWER(?)",
            (user_id, provider)
        ).fetchone()
        if row:
            return {"api_key": decrypt_api_key(row[0]), "api_url": row[1], "model": row[2], "is_shared": row[3], "owner_id": row[4], "shared_with_users": row[5] or "*"}
        # Fallback to shared API key from another team member / friend
        shared_rows = conn.execute(
            "SELECT api_key, api_url, model, is_shared, user_id, shared_with_users FROM ai_api_keys WHERE LOWER(provider) = LOWER(?) AND is_shared = 1",
            (provider,)
        ).fetchall()
        for srow in shared_rows:
            allowed = srow[5] or "*"
            if _key_allows(allowed, user_id, owner_id=srow[4]):
                return {"api_key": decrypt_api_key(srow[0]), "api_url": srow[1], "model": srow[2], "is_shared": 1, "owner_id": srow[4], "shared_with_users": allowed}
        return None

def get_user_api_keys(user_id: str) -> list:
    ensure_schema()
    with get_db() as conn:
        own_rows = conn.execute(
            "SELECT provider, api_url, api_key, model, is_shared, user_id, shared_with_users FROM ai_api_keys WHERE user_id = ?",
            (user_id,)
        ).fetchall()
        keys_list = [{
            "provider": r[0],
            "api_url": r[1],
            "api_key": "••••••••",  # la clave nunca viaja al cliente (ni al dueño)
            "model": r[3],
            "is_shared": bool(r[4]),
            "is_own": True,
            "owner_id": r[5],
            "owner_name": "Tú",
            "shared_with_users": r[6] or "*"
        } for r in own_rows]
        own_providers = {r[0].lower() for r in own_rows}

        shared_rows = conn.execute(
            "SELECT k.provider, k.api_url, k.model, k.is_shared, k.user_id, k.shared_with_users, u.username FROM ai_api_keys k LEFT JOIN users u ON k.user_id = u.user_id WHERE k.user_id != ? AND k.is_shared = 1",
            (user_id,)
        ).fetchall()
        for r in shared_rows:
            p_name = r[0]
            allowed = r[5] or "*"
            owner_name = r[6] or r[4] or "Equipo"
            if p_name.lower() not in own_providers:
                if _key_allows(allowed, user_id, owner_id=r[4]):
                    keys_list.append({
                        "provider": p_name,
                        "api_url": r[1],
                        "api_key": "••••••••", # Censored for security
                        "model": r[2],
                        "is_shared": True,
                        "is_own": False,
                        "owner_id": r[4],
                        "owner_name": owner_name,
                        "shared_with_users": allowed
                    })
        return keys_list

def delete_api_key(user_id: str, provider: str):
    ensure_schema()
    with get_db() as conn:
        conn.execute(
            "DELETE FROM ai_api_keys WHERE user_id = ? AND LOWER(provider) = LOWER(?)",
            (user_id, provider)
        )
        conn.commit()

def note_filename_for_title(title):
    """Nombre de archivo seguro para una nota (usado al crear/exportar)."""
    safe = "".join(c for c in str(title or "") if c.isalnum() or c in ' ._-()').strip()
    safe = safe[:80] or "nota"
    return f"{safe}.txt"


def get_user_notes(user_id: str) -> list:
    ensure_schema()
    with get_db() as conn:
        # GROUP_CONCAT trae los colaboradores en la misma consulta (sin N+1).
        rows = conn.execute("""
            SELECT n.id, n.user_id, n.title, n.content, n.file_id, n.created_at, n.updated_at,
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
            content = r['content'] or ""
            if r['file_id']:
                # El contenido vive en disco (gestionado por el módulo cloud)
                from modules.api.cloud import services as cloud_services
                data = cloud_services.ai_read_file_by_uid(r['user_id'], r['file_id'])
                if data is not None:
                    content = data.decode("utf-8", errors="replace")
                else:
                    content = "" if r['content'] is None else content

            c_at = r['created_at']
            u_at = r['updated_at']
            if not c_at or c_at == 0:
                try:
                    nid_int = int(r['id'])
                    if nid_int > 1000000000000:
                        c_at = nid_int
                    elif nid_int > 1000000000:
                        c_at = nid_int * 1000
                except (ValueError, TypeError):
                    c_at = 0
            if not u_at or u_at == 0:
                u_at = c_at or 0

            notes.append({
                "id": r['id'],
                "user_id": r['user_id'],
                "title": r['title'],
                "content": content,
                "created": int(c_at) if c_at else 0,
                "updated": int(u_at) if u_at else 0,
                "createdAt": int(c_at) if c_at else 0,
                "updatedAt": int(u_at) if u_at else 0,
                "pinned": bool(r['pinned']),
                "is_shared": bool(r['is_shared']),
                "author": r['author'],
                "shared_by": r['shared_by'],
                "collaborators": collaborators,
                "collaborators_names": collaborators_names
            })
        return notes


def get_note_storage(note_id: str, user_id: str = None) -> dict:
    """Devuelve (user_id, file_id, title) de una nota, o None si no existe.
    Con user_id, la nota debe pertenecer al usuario o estar compartida con él
    (evita que ids de nota reutilizados secuestren la nota de otro usuario)."""
    ensure_schema()
    with get_db() as conn:
        if user_id:
            row = conn.execute(
                "SELECT n.user_id, n.file_id, n.title FROM ai_notes n "
                "WHERE n.id = ? AND (n.user_id = ? OR EXISTS ("
                "  SELECT 1 FROM ai_note_collaborators c WHERE c.note_id = n.id AND c.user_id = ?"
                "))",
                (note_id, user_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT user_id, file_id, title FROM ai_notes WHERE id = ?", (note_id,)
            ).fetchone()
    return dict(row) if row else None


def save_note(note_data: dict, file_id: str = None) -> bool:
    """Guarda la nota. Devuelve True si se insertó/actualizó; False si el id ya
    pertenece a otro usuario (no se sobreescribe)."""
    import time
    ensure_schema()
    now_ms = int(time.time() * 1000)
    c_at = note_data.get("createdAt") or note_data.get("created")
    u_at = note_data.get("updatedAt") or note_data.get("updated")
    if not c_at or c_at == 0:
        try:
            nid_int = int(note_data["id"])
            if nid_int > 1000000000000:
                c_at = nid_int
            elif nid_int > 1000000000:
                c_at = nid_int * 1000
        except (ValueError, TypeError):
            pass
    if not c_at or c_at == 0:
        c_at = now_ms
    if not u_at or u_at == 0:
        u_at = now_ms

    with get_db() as conn:
        # UPSERT con guarda de dueño: si el id ya existe pero pertenece a OTRO
        # usuario, no se sobreescribe (los ids de nota los genera el cliente).
        cur = conn.execute("""
            INSERT INTO ai_notes 
            (id, user_id, title, content, file_id, created_at, updated_at, pinned, is_shared, author, shared_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                file_id = excluded.file_id,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                pinned = excluded.pinned,
                is_shared = excluded.is_shared,
                author = excluded.author,
                shared_by = excluded.shared_by
            WHERE ai_notes.user_id = excluded.user_id
        """, (
            note_data["id"],
            note_data.get("user_id", note_data.get("author")), # Provide fallback
            note_data.get("title", ""),
            None,  # contenido en disco
            file_id,
            c_at,
            u_at,
            1 if note_data.get("pinned") else 0,
            1 if note_data.get("is_shared") else 0,
            note_data.get("author", ""),
            note_data.get("shared_by", "")
        ))
        
        conn.commit()
        return cur.rowcount > 0

def delete_note(note_id: str, user_id: str) -> tuple:
    """Elimina la nota; devuelve (owner_uid, attachment_file_id) para que la
    ruta limpie también el archivo físico, o (None, None). Solo el dueño
    puede eliminar: un colaborador no provoca la limpieza del archivo."""
    ensure_schema()
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id, file_id FROM ai_notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        ).fetchone()
        conn.execute("DELETE FROM ai_notes WHERE id = ? AND user_id = ?", (note_id, user_id))
        conn.execute("DELETE FROM ai_note_collaborators WHERE note_id = ?", (note_id,))
        conn.commit()
    if row:
        return row['user_id'], row['file_id']
    return None, None

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


# ── Re-exports de compatibilidad: Workspaces ────────────────────
from .workspaces.repository import (
    create_workspace,
    get_workspaces,
    delete_workspace,
    update_workspace,
    add_workspace_file,
    get_workspace_files,
    get_workspace_file_content,
    delete_workspace_file,
    toggle_workspace_star,
    toggle_workspace_archive,
)


# ── Registro de migraciones en el runner central (core.schema) ──
# Las migraciones 101-104 corresponden a las antiguas v1-v4 del módulo IA.
# Son idempotentes por contenido; el runner central las ejecuta una sola vez.
from core import schema as _core_schema

for _num, _fn in ((101, _migrate_v1_attachments),
                  (102, _migrate_v2_workspace_files),
                  (103, _migrate_v3_notes),
                  (104, _migrate_v4_ai_trashed_at)):
    _core_schema.MIGRATIONS.setdefault(_num, _fn)
