import os
import uuid
from datetime import datetime, timezone
from core.database import get_db
from config.config import CONFIG

ATTACHMENTS_DIR = os.path.join(CONFIG.DATA_DIR, 'mail_attachments')
os.makedirs(ATTACHMENTS_DIR, exist_ok=True)


def _now():
    return datetime.now(timezone.utc).isoformat() + "Z"


def get_internal_folders_with_unread(user_id):
    with get_db() as db:
        counts = db.execute(
            "SELECT folder, COUNT(*) as c FROM internal_mail WHERE user_id = ? AND is_read = 0 GROUP BY folder",
            (user_id,)
        ).fetchall()
    return {row['folder']: row['c'] for row in counts}


def get_internal_all_folders(user_id):
    with get_db() as db:
        rows = db.execute("SELECT DISTINCT folder FROM internal_mail WHERE user_id = ?", (user_id,)).fetchall()
    return [r['folder'] for r in rows]


def get_internal_emails(user_id, folder):
    with get_db() as db:
        if folder == 'all':
            rows = db.execute(
                "SELECT * FROM internal_mail WHERE user_id = ? ORDER BY created_at DESC",
                (user_id,)
            ).fetchall()
        elif folder == 'starred':
            rows = db.execute(
                "SELECT * FROM internal_mail WHERE user_id = ? AND is_starred = 1 ORDER BY created_at DESC",
                (user_id,)
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM internal_mail WHERE user_id = ? AND folder = ? ORDER BY created_at DESC",
                (user_id, folder)
            ).fetchall()
    return [dict(r) for r in rows]


def get_internal_email_by_id(user_id, msg_id):
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM internal_mail WHERE user_id = ? AND id = ?",
            (user_id, msg_id)
        ).fetchone()
    return dict(row) if row else None


def mark_as_read(user_id, msg_id):
    with get_db() as db:
        db.execute(
            "UPDATE internal_mail SET is_read = 1 WHERE user_id = ? AND id = ?",
            (user_id, msg_id)
        )
        db.commit()


def get_attachments_for_mail(mail_id):
    with get_db() as db:
        rows = db.execute(
            "SELECT id, filename, content_type, file_path FROM internal_mail_attachments WHERE mail_id = ?",
            (mail_id,)
        ).fetchall()
    result = []
    for a in rows:
        size = os.path.getsize(a['file_path']) if os.path.exists(a['file_path']) else 0
        result.append({
            "id": a['id'],
            "filename": a['filename'],
            "content_type": a['content_type'],
            "size": size,
        })
    return result


def save_scheduled_mail(user_id, subject, from_email, to_email, body, scheduled_at, files):
    mail_id = str(uuid.uuid4())
    with get_db() as db:
        db.execute("""
            INSERT INTO internal_mail (id, user_id, folder, subject, from_email, to_email, body_plain, body_html, is_read, created_at)
            VALUES (?, ?, 'scheduled', ?, ?, ?, ?, NULL, 1, ?)
        """, (mail_id, user_id, subject, from_email, to_email, body, scheduled_at or _now()))

        for f in files:
            if f.filename:
                _save_attachment(db, mail_id, f)
                f.seek(0)

        db.commit()
    return mail_id


def save_sent_and_inbox(user_id, subject, from_email, to_email, body, recipient_id, files):
    sent_id = str(uuid.uuid4())
    inbox_id = str(uuid.uuid4())
    now = _now()

    with get_db() as db:
        db.execute("""
            INSERT INTO internal_mail (id, user_id, folder, subject, from_email, to_email, body_plain, body_html, is_read, created_at)
            VALUES (?, ?, 'sent', ?, ?, ?, ?, NULL, 1, ?)
        """, (sent_id, user_id, subject, from_email, to_email, body, now))

        db.execute("""
            INSERT INTO internal_mail (id, user_id, folder, subject, from_email, to_email, body_plain, body_html, is_read, created_at)
            VALUES (?, ?, 'inbox', ?, ?, ?, ?, NULL, 0, ?)
        """, (inbox_id, recipient_id, subject, from_email, to_email, body, now))

        for f in files:
            if f.filename:
                _save_attachment(db, sent_id, f)
            f.seek(0)
            if f.filename:
                _save_attachment(db, inbox_id, f)
            f.seek(0)

        db.commit()
    return sent_id


def _save_attachment(db, mail_id, file_storage):
    att_id = str(uuid.uuid4())
    file_path = os.path.join(ATTACHMENTS_DIR, att_id)
    with open(file_path, 'wb') as f:
        f.write(file_storage.read())
    db.execute("""
        INSERT INTO internal_mail_attachments (id, mail_id, filename, content_type, file_path)
        VALUES (?, ?, ?, ?, ?)
    """, (att_id, mail_id, file_storage.filename, file_storage.content_type, file_path))


def save_scheduled_gmail_entry(user_id, subject, gmail_user, to_email, body, scheduled_at):
    mail_id = str(uuid.uuid4())
    with get_db() as db:
        db.execute("""
            INSERT INTO internal_mail
            (id, user_id, folder, subject, from_email, to_email, body_plain, body_html, is_read, created_at)
            VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, 1, ?)
        """, (mail_id, user_id, subject, gmail_user, to_email, body, body, scheduled_at or _now()))
        db.commit()
    return mail_id


def toggle_star_internal(msg_id, user_id, star):
    with get_db() as db:
        db.execute(
            "UPDATE internal_mail SET is_starred = ? WHERE id = ? AND user_id = ?",
            (1 if star else 0, msg_id, user_id)
        )
        db.commit()


def bulk_action_internal(action, msg_ids, user_id):
    with get_db() as db:
        for msg_id in msg_ids:
            if action == 'archive':
                db.execute("UPDATE internal_mail SET folder = 'all' WHERE id = ? AND user_id = ?", (msg_id, user_id))
            elif action == 'unarchive':
                db.execute("UPDATE internal_mail SET folder = 'inbox' WHERE id = ? AND user_id = ?", (msg_id, user_id))
            elif action == 'trash':
                db.execute("UPDATE internal_mail SET folder = 'trash' WHERE id = ? AND user_id = ?", (msg_id, user_id))
            elif action == 'spam':
                db.execute("UPDATE internal_mail SET folder = 'spam' WHERE id = ? AND user_id = ?", (msg_id, user_id))
            elif action == 'delete':
                db.execute("DELETE FROM internal_mail WHERE id = ? AND user_id = ?", (msg_id, user_id))
            elif action == 'unread':
                db.execute("UPDATE internal_mail SET is_read = 0 WHERE id = ? AND user_id = ?", (msg_id, user_id))
            elif action == 'read':
                db.execute("UPDATE internal_mail SET is_read = 1 WHERE id = ? AND user_id = ?", (msg_id, user_id))
        db.commit()

def empty_trash_internal(user_id):
    with get_db() as db:
        db.execute("DELETE FROM internal_mail WHERE folder = 'trash' AND user_id = ?", (user_id,))
        db.commit()


def get_attachment_owner(att_id):
    with get_db() as db:
        att = db.execute(
            "SELECT mail_id FROM internal_mail_attachments WHERE id = ?", (att_id,)
        ).fetchone()
        if not att:
            return None
        mail = db.execute(
            "SELECT user_id, to_email, from_email FROM internal_mail WHERE id = ?",
            (att['mail_id'],)
        ).fetchone()
        return dict(mail) if mail else None
