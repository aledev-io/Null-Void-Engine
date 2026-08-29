import time
import uuid
from core.database import get_db


def get_user_quota_from_db(username):
    with get_db() as conn:
        row = conn.execute(
            "SELECT quota_gb FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row and row['quota_gb'] is not None:
            return row['quota_gb']
    return 10


def search_users_db(query, exclude_uid):
    with get_db() as conn:
        return conn.execute(
            "SELECT user_id, username, email FROM users "
            "WHERE (username LIKE ? OR email LIKE ?) AND user_id != ? LIMIT 10",
            (f"%{query}%", f"%{query}%", exclude_uid)
        ).fetchall()


def add_user_contact(uid, contact_id):
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO user_connections (user_id, contact_id) VALUES (?, ?)",
            (uid, contact_id)
        )
        conn.commit()


def remove_user_contact(uid, contact_id):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM user_connections WHERE user_id = ? AND contact_id = ?",
            (uid, contact_id)
        )
        conn.commit()


def get_shared_item(owner_id, shared_with_uid, file_name):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM cloud_shared WHERE owner_id = ? AND shared_with = ? AND file_name = ?",
            (owner_id, shared_with_uid, file_name)
        ).fetchone()
        return dict(row) if row else None


def is_shared_with_user(owner_id, shared_with_uid, file_name):
    return get_shared_item(owner_id, shared_with_uid, file_name) is not None


def share_file_with_users(owner_id, name, path, view, shared_with_uids):
    # La unicidad se garantiza en el esquema (uq_cloud_shared): un usuario solo
    # puede compartir el mismo archivo una vez; los reintentos se ignoran.
    with get_db() as conn:
        for uid in shared_with_uids:
            share_id = str(uuid.uuid4())
            conn.execute("""
                INSERT OR IGNORE INTO cloud_shared (id, owner_id, shared_with, file_name, file_path, view, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (share_id, owner_id, uid, name, path, view, time.time()))
        conn.commit()


def get_shared_with_me(uid):
    with get_db() as conn:
        return conn.execute("""
            SELECT s.*, u.username as owner_name
            FROM cloud_shared s JOIN users u ON s.owner_id = u.user_id
            WHERE s.shared_with = ? ORDER BY s.created_at DESC
        """, (uid,)).fetchall()


def get_shared_by_me(uid):
    with get_db() as conn:
        return conn.execute("""
            SELECT s.*, u.username as shared_with_name
            FROM cloud_shared s JOIN users u ON s.shared_with = u.user_id
            WHERE s.owner_id = ? ORDER BY s.created_at DESC
        """, (uid,)).fetchall()


def get_username_by_id(user_id):
    with get_db() as conn:
        row = conn.execute("SELECT username FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return row['username'] if row else "Usuario"


def get_shares_in_path(owner_id, file_path):
    """Comparticiones del propietario en la ruta dada.

    Devuelve (result, inherited):
      - inherited: usuarios con los que se compartió cualquier carpeta
        antecesora de file_path (incluida la propia carpeta).
      - result:    dict file_name -> [usuarios compartidos] para las
        comparticiones directas DENTRO de file_path (más las heredadas).
    Una sola consulta para los antecesores (sin N+1 por nivel de ruta): un
    share de la carpeta 'a/b' con file_name 'c' representa la ruta 'a/b/c',
    que es antecesora de T si es igual a T o si T empieza por 'a/b/c/'."""
    inherited = []
    target = (file_path or '').strip('/')
    with get_db() as conn:
        if target:
            rows = conn.execute("""
                WITH share_paths AS (
                    SELECT shared_with,
                           file_path || CASE WHEN file_path = '' THEN '' ELSE '/' END || file_name AS fullpath
                    FROM cloud_shared
                    WHERE owner_id = ?
                )
                SELECT DISTINCT shared_with FROM share_paths
                WHERE fullpath = ?
                   OR (length(?) > length(fullpath)
                       AND substr(?, 1, length(fullpath) + 1) = fullpath || '/')
                ORDER BY length(fullpath) ASC
            """, (owner_id, target, target, target)).fetchall()
            inherited = [{'shared_with': r['shared_with']} for r in rows]

        rows = conn.execute("""
            SELECT file_name, shared_with FROM cloud_shared
            WHERE owner_id = ? AND file_path = ?
        """, (owner_id, file_path)).fetchall()
        
        result = {}
        for r in rows:
            fname = r['file_name']
            if fname not in result:
                result[fname] = list(inherited)
            user_obj = {'shared_with': r['shared_with']}
            if user_obj not in result[fname]:
                result[fname].append(user_obj)
                
        return result, inherited


def remove_shares_by_file(owner_id, file_name, file_path, view):
    """Remove all share records when the owner deletes a file.
    Devuelve los uids de los usuarios con los que estaba compartido
    (para notificarles en tiempo real)."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT shared_with FROM cloud_shared
            WHERE owner_id = ? AND file_name = ? AND file_path = ? AND view = ?
        """, (owner_id, file_name, file_path, view)).fetchall()
        conn.execute("""
            DELETE FROM cloud_shared
            WHERE owner_id = ? AND file_name = ? AND file_path = ? AND view = ?
        """, (owner_id, file_name, file_path, view))
        conn.commit()
        return [r['shared_with'] for r in rows]


def stop_sharing_with_me(owner_id, shared_with_uid, file_name):
    with get_db() as conn:
        conn.execute("""
            DELETE FROM cloud_shared
            WHERE owner_id = ? AND shared_with = ? AND file_name = ?
        """, (owner_id, shared_with_uid, file_name))
        conn.commit()

def create_quota_request(user_id, increment_gb):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO quota_requests (user_id, requested_gb, created_at) VALUES (?, ?, ?)",
            (user_id, increment_gb, time.time())
        )
        conn.commit()

def get_pending_quota_requests():
    with get_db() as conn:
        return conn.execute("""
            SELECT q.id, q.requested_gb, q.created_at, u.username
            FROM quota_requests q
            JOIN users u ON q.user_id = u.user_id
            WHERE q.status = 'pending'
            ORDER BY q.created_at DESC
        """).fetchall()

def resolve_quota_request(req_id, status):
    # status can be 'approved' or 'rejected'.
    # Solo se resuelven peticiones 'pending': cada solicitud solo puede
    # aprobarse o rechazarse una única vez (protección anti-replay).
    with get_db() as conn:
        req = conn.execute(
            "SELECT user_id, requested_gb FROM quota_requests WHERE id = ? AND status = 'pending'",
            (req_id,)
        ).fetchone()
        if not req: return None
        conn.execute("UPDATE quota_requests SET status = ? WHERE id = ?", (status, req_id))
        
        if status == 'approved':
            conn.execute("UPDATE users SET quota_gb = quota_gb + ? WHERE user_id = ?", (req['requested_gb'], req['user_id']))
        conn.commit()
        return req['user_id']


def is_admin(user_id):
    """Verifica autorización administrativa por rol explícito en la base de datos."""
    with get_db() as conn:
        row = conn.execute("SELECT role FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return bool(row and row['role'] == 'admin')



def has_pending_quota_request(user_id):
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM quota_requests WHERE user_id = ? AND status = 'pending'", (user_id,)).fetchone()
        return bool(row)


def cancel_quota_request(user_id):
    with get_db() as conn:
        conn.execute("DELETE FROM quota_requests WHERE user_id = ? AND status = 'pending'", (user_id,))
        conn.commit()


# ── Metadatos de adjuntos de IA (ai_attachment_files) ─────────────
# Tabla gestionada por el módulo de Cloud: los adjuntos de la IA
# guardan aquí su metadata y en ai_messages solo queda la FK (id).

def add_ai_attachment(user_id, file_id, filename, size, mime, is_image, is_text, is_audio):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO ai_attachment_files (id, user_id, filename, size, mime, is_image, is_text, is_audio, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (file_id, user_id, filename, size, mime, int(is_image), int(is_text), int(is_audio),
             time.strftime('%Y-%m-%dT%H:%M:%S')),
        )
        conn.commit()


def get_ai_attachment(user_id, file_id):
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM ai_attachment_files WHERE user_id = ? AND id = ?",
            (user_id, file_id),
        ).fetchone()


def get_ai_attachment_by_filename(user_id, filename):
    with get_db() as conn:
        return conn.execute(
            "SELECT * FROM ai_attachment_files WHERE user_id = ? AND filename = ?",
            (user_id, filename),
        ).fetchone()


def get_ai_attachments_by_ids(user_id, ids):
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM ai_attachment_files WHERE user_id = ? AND id IN ({placeholders})",
            (user_id, *ids),
        ).fetchall()
        by_id = {r['id']: dict(r) for r in rows}
        # Preservar el orden en que se pidieron los ids
        return [by_id[i] for i in ids if i in by_id]


def list_ai_attachments(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM ai_attachment_files WHERE user_id = ? AND trashed_at IS NULL "
            "ORDER BY created_at DESC, filename ASC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def update_ai_attachment_size(user_id, file_id, size):
    with get_db() as conn:
        conn.execute(
            "UPDATE ai_attachment_files SET size = ? WHERE user_id = ? AND id = ?",
            (size, user_id, file_id),
        )
        conn.commit()


def update_ai_attachment_filename(user_id, old_filename, new_filename):
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE ai_attachment_files SET filename = ? "
            "WHERE user_id = ? AND filename = ? AND trashed_at IS NULL",
            (new_filename, user_id, old_filename),
        )
        conn.commit()
        return cur.rowcount > 0


def trash_ai_attachment_by_filename(user_id, filename):
    """Soft-delete: marca el adjunto como en la papelera del Cloud (la fila
    sobrevive para poder reactivarse al restaurar)."""
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE ai_attachment_files SET trashed_at = ? "
            "WHERE user_id = ? AND filename = ? AND trashed_at IS NULL",
            (time.strftime('%Y-%m-%dT%H:%M:%S'), user_id, filename),
        )
        conn.commit()
        return cur.rowcount > 0


def restore_ai_attachment_by_filename(user_id, filename, final_name=None):
    """Reactiva un adjunto en papelera; si el archivo se restauró con otro
    nombre (colisión), la metadata sigue al archivo. Devuelve True si había
    fila que reactivar."""
    final_name = final_name or filename
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE ai_attachment_files SET trashed_at = NULL, filename = ? "
            "WHERE user_id = ? AND filename = ? AND trashed_at IS NOT NULL",
            (final_name, user_id, filename),
        )
        conn.commit()
        return cur.rowcount > 0


def delete_ai_attachment_by_filename(user_id, filename):
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM ai_attachment_files WHERE user_id = ? AND filename = ?",
            (user_id, filename),
        )
        conn.commit()
        return cur.rowcount > 0


def delete_ai_attachment(user_id, file_id):
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM ai_attachment_files WHERE user_id = ? AND id = ?",
            (user_id, file_id),
        )
        conn.commit()
        return cur.rowcount > 0


def delete_ai_attachments_by_ids(user_id, ids):
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    with get_db() as conn:
        cur = conn.execute(
            f"DELETE FROM ai_attachment_files WHERE user_id = ? AND id IN ({placeholders})",
            (user_id, *ids),
        )
        conn.commit()
        return cur.rowcount


def get_user_quota_by_uid(user_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT quota_gb FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row and row['quota_gb'] is not None:
            return row['quota_gb']
    return 10


def get_ai_storage_usage(user_id):
    """Uso en bytes de los archivos de IA del usuario (mantenido por triggers
    en ai_storage_usage)."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT total_bytes FROM ai_storage_usage WHERE user_id = ?", (user_id,)
        ).fetchone()
        return row['total_bytes'] if row else 0
