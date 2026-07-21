"""
database.py — Inicialización y acceso a SQLite para el Calendario Flask
"""

import sqlite3
import os
import uuid
import json
from werkzeug.security import generate_password_hash

from config.config import CONFIG

DB_PATH = os.path.join(CONFIG.DATA_DIR, "manager.db")


def get_db() -> sqlite3.Connection:
    """Crea una conexión a la base de datos con acceso por nombre de columna."""
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Crea las tablas necesarias si no existen y ejecuta migraciones."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id           TEXT PRIMARY KEY,
                username          TEXT NOT NULL UNIQUE,
                password          TEXT NOT NULL,
                email             TEXT UNIQUE,
                quota_gb          INTEGER DEFAULT 10,
                modules           TEXT DEFAULT '["monitor", "calendar", "admin", "marketplace", "cloud"]',
                gmail_address     TEXT,
                gmail_app_password TEXT
            );

            CREATE TABLE IF NOT EXISTS events (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL,
                title        TEXT NOT NULL,
                date         TEXT NOT NULL,
                start_time   TEXT,
                end_time     TEXT,
                all_day      INTEGER NOT NULL DEFAULT 0,
                category     TEXT NOT NULL DEFAULT 'personal',
                description  TEXT,
                completed    INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT,
                reminders    TEXT NOT NULL DEFAULT '[]',
                is_important INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                title       TEXT NOT NULL,
                amount      REAL NOT NULL,
                type        TEXT NOT NULL,
                category    TEXT,
                date        TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS spreadsheets (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                name        TEXT NOT NULL,
                content     TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS invoices (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id        TEXT NOT NULL,
                invoice_number TEXT,
                date           TEXT,
                client         TEXT,
                reference      TEXT,
                total          REAL,
                status         TEXT DEFAULT 'no_pagada',
                raw_text       TEXT,
                created_at     TEXT,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cloud_shared (
                id           TEXT PRIMARY KEY,
                owner_id     TEXT NOT NULL,
                shared_with  TEXT NOT NULL,
                file_name    TEXT NOT NULL,
                file_path    TEXT NOT NULL,
                view         TEXT DEFAULT 'drive',
                permissions  TEXT DEFAULT 'read',
                created_at   REAL NOT NULL,
                FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (shared_with) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_connections (
                user_id      TEXT NOT NULL,
                contact_id   TEXT NOT NULL,
                PRIMARY KEY (user_id, contact_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id          TEXT PRIMARY KEY,
                sender_id   TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                message     TEXT NOT NULL,
                created_at  REAL NOT NULL,
                read        INTEGER DEFAULT 0,
                file_path   TEXT,
                file_name   TEXT,
                file_size   INTEGER,
                edited_at   REAL,
                FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (receiver_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS deleted_messages (
                message_id TEXT NOT NULL,
                user_id    TEXT NOT NULL,
                PRIMARY KEY (message_id, user_id),
                FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS hidden_conversations (
                user_id     TEXT NOT NULL,
                contact_id  TEXT NOT NULL,
                PRIMARY KEY (user_id, contact_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS internal_mail (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                folder      TEXT NOT NULL DEFAULT 'inbox',
                subject     TEXT,
                from_email  TEXT,
                to_email    TEXT,
                body_plain  TEXT,
                body_html   TEXT,
                is_read     INTEGER DEFAULT 0,
                is_starred  INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS internal_mail_attachments (
                id           TEXT PRIMARY KEY,
                mail_id      TEXT NOT NULL,
                filename     TEXT NOT NULL,
                content_type TEXT NOT NULL,
                file_path    TEXT NOT NULL,
                FOREIGN KEY (mail_id) REFERENCES internal_mail(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS cloud_devices (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL,
                name         TEXT NOT NULL,
                os           TEXT,
                last_seen    REAL,
                ip_address   TEXT,
                version      TEXT,
                created_at   REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS cloud_device_tokens (
                token        TEXT PRIMARY KEY,
                device_id    TEXT NOT NULL,
                created_at   REAL NOT NULL,
                FOREIGN KEY (device_id) REFERENCES cloud_devices(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS quota_requests (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      TEXT NOT NULL,
                requested_gb INTEGER NOT NULL,
                status       TEXT DEFAULT 'pending',
                created_at   REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS webpush_subs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      TEXT NOT NULL,
                endpoint     TEXT NOT NULL UNIQUE,
                p256dh       TEXT NOT NULL,
                auth         TEXT NOT NULL,
                created_at   REAL NOT NULL
            );
        """)

        # ─── Migraciones post-creación ───

        # Migrar columna 'user' a 'user_id' en tablas legacy
        for table in ["events", "transactions", "spreadsheets", "invoices"]:
            info = conn.execute(f"PRAGMA table_info({table})").fetchall()
            cols = {c[1] for c in info}
            if 'user' in cols and 'user_id' not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN user_id TEXT")
                conn.execute(f"""
                    UPDATE {table}
                    SET user_id = (SELECT user_id FROM users WHERE users.username = {table}.user)
                    WHERE user_id IS NULL
                """)
                conn.execute(f"UPDATE {table} SET user_id = 'NV-ADMIN' WHERE user_id IS NULL")

        # Columnas opcionales en events
        events_cols = {c[1] for c in conn.execute("PRAGMA table_info(events)").fetchall()}
        for col, default in [("reminders", "DEFAULT '[]'"), ("is_important", "DEFAULT 0"), ("type", "DEFAULT 'event'")]:
            if col not in events_cols:
                conn.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT {default}")

        # Migrar emails nulos
        conn.execute("""
            UPDATE users
            SET email = CASE
                WHEN email IS NULL OR email = '' THEN
                    LOWER(REPLACE(username, ' ', '')) || '@nullvoid'
                ELSE email
            END
        """)
        # Resolver conflictos de email duplicados añadiendo sufijo del user_id
        conn.execute("""
            UPDATE users
            SET email = LOWER(REPLACE(REPLACE(username, ' ', ''), '.', '')) || '_' || SUBSTR(user_id, -4) || '@nullvoid'
            WHERE rowid NOT IN (
                SELECT MIN(rowid) FROM users GROUP BY email
            )
        """)

        # Migrar de deleted_for a deleted_messages
        chat_info = {c[1] for c in conn.execute("PRAGMA table_info(chat_messages)").fetchall()}
        if 'deleted_for' in chat_info:
            # Migrate each deleted_for value: split by comma, insert into deleted_messages
            rows = conn.execute("SELECT id, deleted_for FROM chat_messages WHERE deleted_for IS NOT NULL AND deleted_for != ''").fetchall()
            for r in rows:
                for uid in r['deleted_for'].split(','):
                    uid = uid.strip()
                    if uid:
                        conn.execute(
                            "INSERT OR IGNORE INTO deleted_messages (message_id, user_id) VALUES (?, ?)",
                            (r['id'], uid)
                        )
            conn.execute("ALTER TABLE chat_messages DROP COLUMN deleted_for")
        if 'edited_at' not in chat_info:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN edited_at REAL")
        if 'file_path' not in chat_info:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN file_path TEXT")
            conn.execute("ALTER TABLE chat_messages ADD COLUMN file_name TEXT")
            conn.execute("ALTER TABLE chat_messages ADD COLUMN file_size INTEGER")

        # ─── Índices ───
        indexes = [
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)",
            "CREATE INDEX IF NOT EXISTS idx_events_userid ON events(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_tx_userid ON transactions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_inv_userid ON invoices(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_sheet_userid ON spreadsheets(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)",
            "CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)",
            "CREATE INDEX IF NOT EXISTS idx_chat_sender ON chat_messages(sender_id)",
            "CREATE INDEX IF NOT EXISTS idx_chat_receiver ON chat_messages(receiver_id)",
            "CREATE INDEX IF NOT EXISTS idx_chat_time ON chat_messages(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_del_msg_message ON deleted_messages(message_id)",
            "CREATE INDEX IF NOT EXISTS idx_del_msg_user ON deleted_messages(user_id)",
        ]
        for idx in indexes:
            conn.execute(idx)

        conn.commit()


def migrate_users_to_db(credentials_dict: dict):
    """Migra usuarios de config y CSV a la base de datos con contraseñas hasheadas."""
    with get_db() as conn:
        existing = {r['username'] for r in conn.execute("SELECT username FROM users").fetchall()}
        for username, password in credentials_dict.items():
            if username in existing:
                continue
            uid = str(uuid.uuid4())
            email = username.lower().replace(' ', '') + '@nullvoid'
            hashed = generate_password_hash(password)
            try:
                conn.execute(
                    "INSERT INTO users (user_id, username, password, email) VALUES (?, ?, ?, ?)",
                    (uid, username, hashed, email)
                )
            except sqlite3.IntegrityError:
                suffix = uid[-4:]
                email = username.lower().replace(' ', '') + '_' + suffix + '@nullvoid'
                conn.execute(
                    "INSERT INTO users (user_id, username, password, email) VALUES (?, ?, ?, ?)",
                    (uid, username, hashed, email)
                )
        conn.commit()


def row_to_dict(row: sqlite3.Row) -> dict:
    """Convierte una fila de eventos al formato del frontend."""
    d = dict(row)
    return {
        'id':          d['id'],
        'title':       d['title'],
        'date':        d['date'],
        'startTime':   d['start_time'],
        'endTime':     d['end_time'],
        'allDay':      bool(d['all_day']),
        'category':    d['category'],
        'description': d['description'] or '',
        'completed':   bool(d['completed']),
        'createdAt':   d['created_at'],
        'updatedAt':   d.get('updated_at'),
        'reminders':   json.loads(d.get('reminders', '[]')) if d.get('reminders') else [],
        'isImportant': bool(d.get('is_important', 0)),
        'type':        d.get('type', 'event')
    }


def transaction_to_dict(d):
    """Convierte una fila de transacciones al formato del frontend."""
    return {
        'id': d['id'],
        'title': d['title'],
        'amount': d['amount'],
        'type': d['type'],
        'category': d['category'],
        'date': d['date'],
        'createdAt': d['created_at']
    }
