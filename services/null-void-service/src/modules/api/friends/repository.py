from core.database import get_db


def ensure_table():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS friendships (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                requester   TEXT NOT NULL,
                addressee   TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'pending',
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL,
                UNIQUE(requester, addressee)
            )
        """)
        conn.commit()


def send_request(requester, addressee):
    ensure_table()
    with get_db() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO friendships (requester, addressee, status, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, ?)
        """, (requester, addressee, __import__('time').time(), __import__('time').time()))
        conn.commit()
        return conn.total_changes > 0


def get_requests(user_id):
    ensure_table()
    with get_db() as conn:
        rows = conn.execute("""
            SELECT f.id, f.requester, f.addressee, f.status, f.created_at,
                   u.username AS requester_name
            FROM friendships f
            JOIN users u ON u.user_id = f.requester
            WHERE f.addressee = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC
        """, (user_id,)).fetchall()
        return [dict(r) for r in rows]


def get_sent_requests(user_id):
    ensure_table()
    with get_db() as conn:
        rows = conn.execute("""
            SELECT f.id, f.requester, f.addressee, f.status, f.created_at,
                   u.username AS addressee_name
            FROM friendships f
            JOIN users u ON u.user_id = f.addressee
            WHERE f.requester = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC
        """, (user_id,)).fetchall()
        return [dict(r) for r in rows]


def get_friends(user_id):
    ensure_table()
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                CASE WHEN f.requester = ? THEN f.addressee ELSE f.requester END AS friend_id,
                u.username AS friend_name
            FROM friendships f
            JOIN users u ON u.user_id = CASE WHEN f.requester = ? THEN f.addressee ELSE f.requester END
            WHERE (f.requester = ? OR f.addressee = ?) AND f.status = 'accepted'
            ORDER BY u.username ASC
        """, (user_id, user_id, user_id, user_id)).fetchall()
        return [dict(r) for r in rows]


def respond_request(request_id, user_id, new_status):
    ensure_table()
    with get_db() as conn:
        req = conn.execute("SELECT requester, addressee FROM friendships WHERE id = ?", (request_id,)).fetchone()
        
        conn.execute("""
            UPDATE friendships SET status = ?, updated_at = ?
            WHERE id = ? AND addressee = ? AND status = 'pending'
        """, (new_status, __import__('time').time(), request_id, user_id))
        
        changed = conn.total_changes > 0
        
        if changed and new_status == 'accepted' and req:
            conn.execute("""
                DELETE FROM friendships
                WHERE ((requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?))
                  AND status = 'pending'
            """, (req['requester'], req['addressee'], req['addressee'], req['requester']))
            
        conn.commit()
        return changed


def delete_request(request_id, user_id):
    ensure_table()
    with get_db() as conn:
        conn.execute("""
            DELETE FROM friendships
            WHERE id = ? AND (requester = ? OR addressee = ?)
        """, (request_id, user_id, user_id))
        conn.commit()
        return conn.total_changes > 0


def get_request_users(request_id):
    ensure_table()
    with get_db() as conn:
        return conn.execute(
            "SELECT requester, addressee FROM friendships WHERE id = ?",
            (request_id,)
        ).fetchone()


def remove_friendship(user_id, friend_id):
    ensure_table()
    with get_db() as conn:
        conn.execute("""
            DELETE FROM friendships
            WHERE ((requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?))
              AND status = 'accepted'
        """, (user_id, friend_id, friend_id, user_id))
        conn.commit()
        return conn.total_changes > 0


def search_users(query, exclude_id):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT user_id, username FROM users
            WHERE username LIKE ? AND user_id != ?
            LIMIT 20
        """, (f'%{query}%', exclude_id)).fetchall()
        return [dict(r) for r in rows]


def are_friends(uid1, uid2):
    with get_db() as conn:
        r = conn.execute("""
            SELECT 1 FROM friendships
            WHERE ((requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?))
              AND status = 'accepted'
            LIMIT 1
        """, (uid1, uid2, uid2, uid1)).fetchone()
        return r is not None


def has_pending_request(from_uid, to_uid):
    with get_db() as conn:
        r = conn.execute("""
            SELECT 1 FROM friendships
            WHERE requester = ? AND addressee = ? AND status = 'pending'
            LIMIT 1
        """, (from_uid, to_uid)).fetchone()
        return r is not None

def get_pending_request_id(from_uid, to_uid):
    with get_db() as conn:
        r = conn.execute("""
            SELECT id FROM friendships
            WHERE requester = ? AND addressee = ? AND status = 'pending'
            LIMIT 1
        """, (from_uid, to_uid)).fetchone()
        return r['id'] if r else None


def remove_friendship(uid1, uid2):
    with get_db() as conn:
        conn.execute("""
            DELETE FROM friendships
            WHERE ((requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?))
              AND status = 'accepted'
        """, (uid1, uid2, uid2, uid1))
        conn.commit()
        return conn.total_changes > 0
