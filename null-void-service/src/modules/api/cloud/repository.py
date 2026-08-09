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


def update_user_quota(username, limit_gb):
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET quota_gb = ? WHERE username = ?", (int(limit_gb), username)
        )
        conn.commit()


def search_users_db(query, exclude_uid):
    with get_db() as conn:
        return conn.execute(
            "SELECT user_id, username, email FROM users "
            "WHERE (username LIKE ? OR email LIKE ?) AND user_id != ? LIMIT 10",
            (f"%{query}%", f"%{query}%", exclude_uid)
        ).fetchall()


def get_user_contacts(uid):
    with get_db() as conn:
        return conn.execute(
            "SELECT u.user_id, u.username, u.email FROM users u "
            "JOIN user_connections c ON u.user_id = c.contact_id WHERE c.user_id = ?",
            (uid,)
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
    with get_db() as conn:
        for uid in shared_with_uids:
            # Check if already shared
            exists = conn.execute(
                "SELECT 1 FROM cloud_shared WHERE owner_id = ? AND shared_with = ? AND file_name = ? AND file_path = ? AND view = ?",
                (owner_id, uid, name, path, view)
            ).fetchone()
            if exists:
                continue
            share_id = str(uuid.uuid4())
            conn.execute("""
                INSERT INTO cloud_shared (id, owner_id, shared_with, file_name, file_path, view, created_at)
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


def get_file_shares(owner_id, file_name, file_path):
    with get_db() as conn:
        return conn.execute("""
            SELECT shared_with FROM cloud_shared
            WHERE owner_id = ? AND file_name = ? AND file_path = ?
        """, (owner_id, file_name, file_path)).fetchall()


def get_shares_in_path(owner_id, file_path):
    inherited = []
    if file_path:
        parts = file_path.strip('/').split('/')
        with get_db() as conn:
            for i in range(len(parts)):
                f_path = '/'.join(parts[:i])
                f_name = parts[i]
                rows = conn.execute("""
                    SELECT shared_with FROM cloud_shared
                    WHERE owner_id = ? AND file_path = ? AND file_name = ?
                """, (owner_id, f_path, f_name)).fetchall()
                for r in rows:
                    user_obj = {'shared_with': r['shared_with']}
                    if user_obj not in inherited:
                        inherited.append(user_obj)

    with get_db() as conn:
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
    """Remove all share records when the owner deletes a file."""
    with get_db() as conn:
        conn.execute("""
            DELETE FROM cloud_shared
            WHERE owner_id = ? AND file_name = ? AND file_path = ? AND view = ?
        """, (owner_id, file_name, file_path, view))
        conn.commit()
        return []


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
