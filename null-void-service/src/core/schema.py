"""
schema.py — Esquema canónico y migraciones versionadas de manager.db.

Fases de auditoría DBA:
- Fase 1: centralización del DDL y migraciones versionadas (user_version).
- Fase 2: integridad referencial (FK + ON DELETE CASCADE + NOT NULL + PKs).

Modelo:
- TABLE_DDL: dict {nombre: DDL canónico individual} — fuente única de verdad.
- legacy_sanitize(): migración única para bases pre-Fase1 (ALTERs históricos).
- MIGRATIONS: {numero: callable} — migraciones versionadas; cada una debe ser
  idempotente por contenido y gestionar sus propias conexiones (sin args).
- _rebuild_table(): recrea una tabla con su DDL canónico preservando datos
  (SQLite no permite ADD CONSTRAINT). Recrea también los índices asociados.

Nota: la BD del scraper (SCRAPER_DB_SQLITE) es un archivo independiente con
su propio esquema; queda fuera de este módulo.

CONVENCIONES (fase 4 — normalización de tipos):
- Columnas de tiempo en tablas NUEVAS: REAL epoch (float de time.time()).
  Las tablas legacy de texto (events, ai_sessions, ai_messages, internal_mail,
  users.created_at) usan TEXT ISO-8601 UTC con sufijo 'Z'; se documenta como
  legado y no se migra (destructivo sin beneficio). Usar los helpers
  now_epoch()/now_iso() de core.database en código nuevo.
- Claves primarias: INTEGER PRIMARY KEY (alias de rowid, más compacto y
  eficiente) para ids internos sin exposición externa; TEXT (uuid) para ids
  distribuibles o referenciados desde URLs/frontend. NO usar AUTOINCREMENT
  salvo que la reutilización de ids tras DELETE sea un problema.
- Toda columna nueva obligatoria lleva NOT NULL con DEFAULT.
"""


def get_db():
    """Conexión SQLite con WAL, FKs y timeout (definida en core.database;
    re-exportada aquí para evitar dependencias circulares)."""
    from core.database import get_db as _get_db
    return _get_db()


# ── DDL canónico individual por tabla ─────────────────────────────────────────

TABLE_DDL: dict[str, str] = {}

TABLE_DDL["users"] = """
    CREATE TABLE IF NOT EXISTS users (
        user_id           TEXT PRIMARY KEY,
        username          TEXT NOT NULL UNIQUE,
        password          TEXT NOT NULL,
        email             TEXT UNIQUE,
        quota_gb          INTEGER DEFAULT 10,
        modules           TEXT DEFAULT '["monitor", "calendar", "admin", "marketplace", "cloud"]',
        gmail_address     TEXT,
        gmail_app_password TEXT,
        role              TEXT DEFAULT 'member',
        created_at        TEXT NOT NULL DEFAULT ''
    )
"""

TABLE_DDL["events"] = """
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
        type         TEXT DEFAULT 'event',
        location     TEXT DEFAULT '',
        guests       TEXT DEFAULT '[]',
        series_id    TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["transactions"] = """
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
    )
"""

TABLE_DDL["spreadsheets"] = """
    CREATE TABLE IF NOT EXISTS spreadsheets (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        content     TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["invoices"] = """
    CREATE TABLE IF NOT EXISTS invoices (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        TEXT NOT NULL,
        invoice_number TEXT,
        date           TEXT,
        client         TEXT,
        reference      TEXT,
        total          REAL,
        status         TEXT DEFAULT 'no_pagada'
                       CHECK (status IN ('no_pagada', 'pagada', 'a_cuenta')),
        raw_text       TEXT,
        created_at     TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["cloud_shared"] = """
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
    )
"""

TABLE_DDL["user_connections"] = """
    CREATE TABLE IF NOT EXISTS user_connections (
        user_id      TEXT NOT NULL,
        contact_id   TEXT NOT NULL,
        created_at   REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, contact_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_attachment_files"] = """
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

TABLE_DDL["chat_messages"] = """
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
        FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
        -- receiver_id SIN FK a propósito: puede ser user_id O group_id.
    )
"""

TABLE_DDL["deleted_messages"] = """
    CREATE TABLE IF NOT EXISTS deleted_messages (
        message_id TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id),
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["chat_groups"] = """
    CREATE TABLE IF NOT EXISTS chat_groups (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        avatar      TEXT,
        created_by  TEXT NOT NULL,
        created_at  REAL NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["chat_group_members"] = """
    CREATE TABLE IF NOT EXISTS chat_group_members (
        group_id    TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        role        TEXT DEFAULT 'member',
        joined_at   REAL NOT NULL,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["hidden_conversations"] = """
    CREATE TABLE IF NOT EXISTS hidden_conversations (
        user_id     TEXT NOT NULL,
        contact_id  TEXT NOT NULL,
        created_at  REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, contact_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["muted_conversations"] = """
    CREATE TABLE IF NOT EXISTS muted_conversations (
        user_id     TEXT NOT NULL,
        contact_id  TEXT NOT NULL,
        created_at  REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, contact_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["internal_mail"] = """
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
    )
"""

TABLE_DDL["internal_mail_attachments"] = """
    CREATE TABLE IF NOT EXISTS internal_mail_attachments (
        id           TEXT PRIMARY KEY,
        mail_id      TEXT NOT NULL,
        filename     TEXT NOT NULL,
        content_type TEXT NOT NULL,
        file_path    TEXT NOT NULL,
        FOREIGN KEY (mail_id) REFERENCES internal_mail(id) ON DELETE CASCADE
    )
"""

TABLE_DDL["cloud_devices"] = """
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
    )
"""

TABLE_DDL["cloud_device_tokens"] = """
    CREATE TABLE IF NOT EXISTS cloud_device_tokens (
        token        TEXT PRIMARY KEY,
        device_id    TEXT NOT NULL,
        created_at   REAL NOT NULL,
        FOREIGN KEY (device_id) REFERENCES cloud_devices(id) ON DELETE CASCADE
    )
"""

TABLE_DDL["agent_link_tokens"] = """
    CREATE TABLE IF NOT EXISTS agent_link_tokens (
        token          TEXT PRIMARY KEY,
        original_token TEXT NOT NULL,
        username       TEXT NOT NULL,
        target_device  TEXT DEFAULT '',
        expires        REAL NOT NULL,
        created_at     REAL NOT NULL
        -- SIN FK por diseño: referencia a usuarios por username, no por id.
    )
"""

TABLE_DDL["quota_requests"] = """
    CREATE TABLE IF NOT EXISTS quota_requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT NOT NULL,
        requested_gb INTEGER NOT NULL,
        status       TEXT DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at   REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["webpush_subs"] = """
    CREATE TABLE IF NOT EXISTS webpush_subs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT NOT NULL,
        endpoint     TEXT NOT NULL UNIQUE,
        p256dh       TEXT NOT NULL,
        auth         TEXT NOT NULL,
        created_at   REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["fcm_subs"] = """
    CREATE TABLE IF NOT EXISTS fcm_subs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT NOT NULL,
        token        TEXT NOT NULL UNIQUE,
        created_at   REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["user_google_accounts"] = """
    CREATE TABLE IF NOT EXISTS user_google_accounts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT NOT NULL,
        email        TEXT NOT NULL,
        app_password TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        UNIQUE(user_id, email)
    )
"""

TABLE_DDL["friendships"] = """
    CREATE TABLE IF NOT EXISTS friendships (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        requester   TEXT NOT NULL,
        addressee   TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  REAL NOT NULL,
        updated_at  REAL NOT NULL,
        UNIQUE(requester, addressee),
        FOREIGN KEY (requester) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (addressee) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

# ── Tablas del módulo IA ──────────────────────────────────────────────────────

TABLE_DDL["ai_sessions"] = """
    CREATE TABLE IF NOT EXISTS ai_sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        title      TEXT DEFAULT 'New Chat',
        model      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        workspace_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_messages"] = """
    CREATE TABLE IF NOT EXISTS ai_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        model       TEXT,
        attachments TEXT,
        cancelled   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_shared_sessions"] = """
    CREATE TABLE IF NOT EXISTS ai_shared_sessions (
        original_session_id TEXT NOT NULL,
        shared_session_id   TEXT NOT NULL,
        created_at          REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (original_session_id, shared_session_id),
        FOREIGN KEY (original_session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (shared_session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_api_keys"] = """
    CREATE TABLE IF NOT EXISTS ai_api_keys (
        user_id           TEXT NOT NULL,
        provider          TEXT NOT NULL,
        api_key           TEXT NOT NULL,
        api_url           TEXT,
        model             TEXT,
        is_shared         INTEGER DEFAULT 0,
        shared_with_users TEXT DEFAULT '*',
        created_at        TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, provider),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_notes"] = """
    CREATE TABLE IF NOT EXISTS ai_notes (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        title      TEXT,
        content    TEXT,
        file_id    TEXT,
        created_at REAL NOT NULL DEFAULT 0,
        updated_at REAL NOT NULL DEFAULT 0,
        pinned     INTEGER DEFAULT 0,
        is_shared  INTEGER DEFAULT 0,
        author     TEXT,
        shared_by  TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_note_collaborators"] = """
    CREATE TABLE IF NOT EXISTS ai_note_collaborators (
        note_id    TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        user_name  TEXT,
        created_at REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (note_id, user_id),
        FOREIGN KEY (note_id) REFERENCES ai_notes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_workspaces"] = """
    CREATE TABLE IF NOT EXISTS ai_workspaces (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  REAL NOT NULL DEFAULT 0,
        updated_at  REAL NOT NULL DEFAULT 0,
        is_starred  INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_workspace_files"] = """
    CREATE TABLE IF NOT EXISTS ai_workspace_files (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        filename     TEXT NOT NULL,
        content      TEXT,
        file_id      TEXT,
        created_at   REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (workspace_id) REFERENCES ai_workspaces(id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_user_preferences"] = """
    CREATE TABLE IF NOT EXISTS ai_user_preferences (
        user_id TEXT PRIMARY KEY,
        default_model TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

# ── Contadores derivados (mantenidos por TRIGGERS, migración 106) ─────────────
# Patrón profesional: en lugar de COUNT(*) on-demand o cachés en memoria, las
# agregaciones frecuentes viven en tablas de contadores actualizadas por
# triggers (AFTER INSERT/UPDATE/DELETE) con backfill en la migración.

TABLE_DDL["chat_unread_counts"] = """
    CREATE TABLE IF NOT EXISTS chat_unread_counts (
        user_id    TEXT NOT NULL,   -- receptor
        contact_id TEXT NOT NULL,   -- emisor
        unread     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, contact_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["mail_stats"] = """
    CREATE TABLE IF NOT EXISTS mail_stats (
        user_id TEXT NOT NULL,
        folder  TEXT NOT NULL,
        unread  INTEGER NOT NULL DEFAULT 0,
        total   INTEGER NOT NULL DEFAULT 0,
        starred INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, folder),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

TABLE_DDL["ai_storage_usage"] = """
    CREATE TABLE IF NOT EXISTS ai_storage_usage (
        user_id     TEXT PRIMARY KEY,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
"""

MANAGER_TABLES_DDL = ";\n".join(
    TABLE_DDL[t] for t in (
        "users", "events", "transactions", "spreadsheets", "invoices",
        "cloud_shared", "user_connections", "ai_attachment_files",
        "chat_messages", "deleted_messages", "chat_groups", "chat_group_members",
        "hidden_conversations", "muted_conversations", "internal_mail",
        "internal_mail_attachments", "cloud_devices", "cloud_device_tokens",
        "agent_link_tokens", "quota_requests", "webpush_subs", "fcm_subs",
        "user_google_accounts", "friendships",
        "chat_unread_counts", "mail_stats", "ai_storage_usage",
    )
)

AI_TABLES_DDL = ";\n".join(
    TABLE_DDL[t] for t in (
        "ai_sessions", "ai_messages", "ai_shared_sessions", "ai_api_keys",
        "ai_notes", "ai_note_collaborators", "ai_workspaces",
        "ai_workspace_files", "ai_user_preferences",
    )
)

SCHEMA_INDEXES = [
    # Índices existentes (idempotentes: se recrean si faltan)
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
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_cloud_shared ON cloud_shared(owner_id, shared_with, file_name, file_path, view)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_ref ON invoices(user_id, reference)",
    "CREATE INDEX IF NOT EXISTS idx_chat_unread ON chat_messages(receiver_id, read)",
    "CREATE INDEX IF NOT EXISTS idx_chat_pair ON chat_messages(sender_id, receiver_id)",
    "CREATE INDEX IF NOT EXISTS idx_quota_status ON quota_requests(status, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_mail_folder ON internal_mail(user_id, folder, is_read)",
    "CREATE INDEX IF NOT EXISTS idx_shared_path ON cloud_shared(owner_id, file_path)",
]

# ── Migraciones versionadas ───────────────────────────────────────────────────

BASELINE_LEGACY = 100  # version que marca el saneamiento legacy aplicado
MIGRATIONS: dict[int, object] = {}


def _table_columns(conn, table):
    return {r[1] for r in conn.execute("PRAGMA table_info(" + table + ")").fetchall()}


def legacy_sanitize(conn) -> None:
    """Saneamiento de una sola ejecución para bases creadas antes de la
    centralización (los ALTERs condicionales históricos). En bases nuevas
    (DDL canónico ya aplicado) todos los chequeos son no-op."""
    cols = _table_columns(conn, "users")
    if "role" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'")
    conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin' AND (role IS NULL OR role != 'admin')")

    if "target_device" not in _table_columns(conn, "agent_link_tokens"):
        conn.execute("ALTER TABLE agent_link_tokens ADD COLUMN target_device TEXT DEFAULT ''")

    # Migrar credenciales legacy de Gmail a la nueva tabla (cifradas)
    from core.crypto_utils import encrypt_field
    legacy_rows = conn.execute("""
        SELECT user_id, gmail_address, gmail_app_password
        FROM users
        WHERE gmail_address IS NOT NULL AND gmail_address != ''
          AND gmail_app_password IS NOT NULL AND gmail_app_password != ''
    """).fetchall()
    for row in legacy_rows:
        try:
            conn.execute(
                "INSERT OR IGNORE INTO user_google_accounts (user_id, email, app_password) VALUES (?, ?, ?)",
                (row['user_id'], row['gmail_address'], encrypt_field(row['gmail_app_password']))
            )
        except Exception:
            pass

    # Migrar columna 'user' a 'user_id' en tablas legacy
    for table in ["events", "transactions", "spreadsheets", "invoices"]:
        info = conn.execute("PRAGMA table_info(" + table + ")").fetchall()
        cols = {c[1] for c in info}
        if "user" in cols and "user_id" not in cols:
            conn.execute("ALTER TABLE " + table + " ADD COLUMN user_id TEXT")
            conn.execute("""
                UPDATE {0}
                SET user_id = (SELECT user_id FROM users WHERE users.username = {0}.user)
                WHERE user_id IS NULL
            """.format(table))
            conn.execute("UPDATE " + table + " SET user_id = 'NV-ADMIN' WHERE user_id IS NULL")

    # Columnas opcionales en events
    events_cols = _table_columns(conn, "events")
    for col, default in [("reminders", "DEFAULT '[]'"), ("is_important", "DEFAULT 0"),
                         ("type", "DEFAULT 'event'"), ("location", "DEFAULT ''"),
                         ("guests", "DEFAULT '[]'"), ("series_id", "DEFAULT NULL")]:
        if col not in events_cols:
            conn.execute("ALTER TABLE events ADD COLUMN " + col + " TEXT " + default)

    # Emails nulos/duplicados
    conn.execute("""
        UPDATE users
        SET email = CASE
            WHEN email IS NULL OR email = '' THEN
                LOWER(REPLACE(username, ' ', '')) || '@nullvoid'
            ELSE email
        END
    """)
    conn.execute("""
        UPDATE users
        SET email = LOWER(REPLACE(REPLACE(username, ' ', ''), '.', '')) || '_' || SUBSTR(user_id, -4) || '@nullvoid'
        WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM users GROUP BY email
        )
    """)

    # Migrar de deleted_for a deleted_messages
    chat_info = _table_columns(conn, "chat_messages")
    if "deleted_for" in chat_info:
        rows = conn.execute(
            "SELECT id, deleted_for FROM chat_messages WHERE deleted_for IS NOT NULL AND deleted_for != ''"
        ).fetchall()
        for r in rows:
            for uid in r['deleted_for'].split(','):
                uid = uid.strip()
                if uid:
                    conn.execute(
                        "INSERT OR IGNORE INTO deleted_messages (message_id, user_id) VALUES (?, ?)",
                        (r['id'], uid)
                    )
        conn.execute("ALTER TABLE chat_messages DROP COLUMN deleted_for")
    if "edited_at" not in chat_info:
        conn.execute("ALTER TABLE chat_messages ADD COLUMN edited_at REAL")
    if "file_path" not in chat_info:
        conn.execute("ALTER TABLE chat_messages ADD COLUMN file_path TEXT")
        conn.execute("ALTER TABLE chat_messages ADD COLUMN file_name TEXT")
        conn.execute("ALTER TABLE chat_messages ADD COLUMN file_size INTEGER")

    # CHECK constraints en tablas existentes (rebuild seguro)
    from core.database import _rebuild_table_with_check
    _rebuild_table_with_check(
        conn, 'invoices',
        "CHECK (status IN ('no_pagada', 'pagada', 'a_cuenta'))"
    )
    _rebuild_table_with_check(
        conn, 'quota_requests',
        "CHECK (status IN ('pending', 'approved', 'rejected'))"
    )

    # Deduplicación de cloud_shared / invoices antes de imponer unicidad
    conn.execute("""
        DELETE FROM cloud_shared WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM cloud_shared
            GROUP BY owner_id, shared_with, file_name, file_path, view
        )
    """)
    conn.execute("""
        DELETE FROM invoices WHERE reference IS NOT NULL AND reference != '' AND rowid NOT IN (
            SELECT MIN(rowid) FROM invoices
            WHERE reference IS NOT NULL AND reference != ''
            GROUP BY user_id, reference
        )
    """)


def _rebuild_table(conn, table: str, fill: dict[str, object] | None = None) -> None:
    """Recrea la tabla con su DDL canónico (FKs, NOT NULL, CHECK) preservando
    los datos. `fill` rellena columnas NOT NULL nuevas que puedan tener NULLs
    históricos. Idempotente: no-op si el DDL actual ya coincide."""
    ddl = (TABLE_DDL.get(table) or "").strip().rstrip(';').rstrip()
    if not ddl:
        raise ValueError(f"Sin DDL canónico para la tabla {table}")
    current = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", (table,)
    ).fetchone()
    if not current:
        conn.execute(ddl)
        return
    old_sql = current[0]
    new_sql = ddl.replace(f"CREATE TABLE IF NOT EXISTS {table}", f"CREATE TABLE {table}__new", 1)
    if "CREATE TABLE IF NOT EXISTS" not in new_sql and "CREATE TABLE " not in new_sql:
        new_sql = ddl.replace(f"CREATE TABLE {table}", f"CREATE TABLE {table}__new", 1)

    if fill:
        for col, val in fill.items():
            conn.execute(f"UPDATE {table} SET {col} = ? WHERE {col} IS NULL", (val,))

    new_table = table + "__new"
    old_isolation = conn.isolation_level
    conn.isolation_level = None  # autocommit: necesario para PRAGMA foreign_keys
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN")
        try:
            conn.execute(new_sql)
            cols = ", ".join(
                r['name'] for r in conn.execute("PRAGMA table_info(" + table + ")").fetchall()
            )
            conn.execute(f"INSERT INTO {new_table} ({cols}) SELECT {cols} FROM {table}")
            conn.execute(f"DROP TABLE {table}")
            conn.execute(f"ALTER TABLE {new_table} RENAME TO {table}")
            # Reasentar la secuencia de AUTOINCREMENT solo si la tabla tiene id
            table_cols = [r['name'] for r in conn.execute("PRAGMA table_info(" + table + ")").fetchall()]
            if "id" in table_cols:
                conn.execute(f"DELETE FROM sqlite_sequence WHERE name = '{table}'")
                conn.execute(f"INSERT INTO sqlite_sequence (name, seq) SELECT '{table}', MAX(id) FROM '{table}'")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.isolation_level = old_isolation


def _migrate_v2_integrity():
    """Fase 2 (migración 105): integridad referencial.

    Añade FKs + ON DELETE CASCADE + NOT NULL + PKs compuestas a las tablas
    que carecían de ellas (friendships, ai_*). Primero se limpian los
    huérfanos acumulados (referencias a usuarios/sesiones/notas inexistentes)
    para que el rebuild con FKs pueda completarse sin violaciones."""
    with get_db() as conn:
        # ── Limpieza de huérfanos ──
        # Amistades
        conn.execute(
            "DELETE FROM friendships WHERE requester NOT IN (SELECT user_id FROM users) "
            "OR addressee NOT IN (SELECT user_id FROM users)"
        )
        # IA: sesiones sin usuario (y sus mensajes)
        conn.execute(
            "DELETE FROM ai_messages WHERE session_id NOT IN (SELECT id FROM ai_sessions) "
            "OR user_id NOT IN (SELECT user_id FROM users)"
        )
        conn.execute("DELETE FROM ai_sessions WHERE user_id NOT IN (SELECT user_id FROM users)")
        # IA: compartidas sin sesiones referenciadas o duplicadas
        conn.execute(
            "DELETE FROM ai_shared_sessions WHERE original_session_id NOT IN (SELECT id FROM ai_sessions) "
            "OR shared_session_id NOT IN (SELECT id FROM ai_sessions)"
        )
        conn.execute("""
            DELETE FROM ai_shared_sessions WHERE rowid NOT IN (
                SELECT MIN(rowid) FROM ai_shared_sessions
                GROUP BY original_session_id, shared_session_id
            )
        """)
        # IA: claves api huérfanas
        conn.execute("DELETE FROM ai_api_keys WHERE user_id NOT IN (SELECT user_id FROM users)")
        # IA: notas sin usuario, colaboradores sin nota/usuario
        conn.execute("DELETE FROM ai_notes WHERE user_id NOT IN (SELECT user_id FROM users)")
        conn.execute(
            "DELETE FROM ai_note_collaborators WHERE note_id NOT IN (SELECT id FROM ai_notes) "
            "OR user_id NOT IN (SELECT user_id FROM users)"
        )
        # IA: workspaces sin usuario y sus archivos
        conn.execute("DELETE FROM ai_workspaces WHERE user_id NOT IN (SELECT user_id FROM users)")
        conn.execute(
            "DELETE FROM ai_workspace_files WHERE workspace_id NOT IN (SELECT id FROM ai_workspaces)"
        )
        conn.execute("DELETE FROM ai_user_preferences WHERE user_id NOT IN (SELECT user_id FROM users)")
        # Web push huérfanos
        conn.execute("DELETE FROM webpush_subs WHERE user_id NOT IN (SELECT user_id FROM users)")

        # ── Rebuilds con el DDL canónico (FKs / NOT NULL / PKs) ──
        for table, fill in (
            ("friendships", None),
            ("ai_notes", {"created_at": 0, "updated_at": 0}),
            ("ai_workspaces", {"created_at": 0, "updated_at": 0}),
            ("ai_workspace_files", {"created_at": 0}),
            ("ai_messages", None),
            ("ai_sessions", None),
            ("ai_shared_sessions", None),
            ("ai_api_keys", None),
            ("ai_note_collaborators", None),
            ("ai_user_preferences", None),
            ("webpush_subs", None),
        ):
            _rebuild_table(conn, table, fill)
        conn.commit()


_TRIGGERS_DDL = """
DROP TRIGGER IF EXISTS trg_chat_unread_insert;
CREATE TRIGGER trg_chat_unread_insert
AFTER INSERT ON chat_messages
WHEN NEW.read = 0 AND NEW.receiver_id NOT LIKE 'group_%'
BEGIN
    INSERT INTO chat_unread_counts (user_id, contact_id, unread) VALUES (NEW.receiver_id, NEW.sender_id, 1)
    ON CONFLICT(user_id, contact_id) DO UPDATE SET unread = unread + 1;
END;

DROP TRIGGER IF EXISTS trg_chat_unread_update;
CREATE TRIGGER trg_chat_unread_update
AFTER UPDATE OF read ON chat_messages
WHEN OLD.read != NEW.read AND OLD.receiver_id NOT LIKE 'group_%'
BEGIN
    UPDATE chat_unread_counts SET unread = unread + (OLD.read - NEW.read)
    WHERE user_id = OLD.receiver_id AND contact_id = OLD.sender_id;
END;

DROP TRIGGER IF EXISTS trg_chat_unread_delete;
CREATE TRIGGER trg_chat_unread_delete
AFTER DELETE ON chat_messages
WHEN OLD.read = 0 AND OLD.receiver_id NOT LIKE 'group_%'
BEGIN
    UPDATE chat_unread_counts SET unread = unread - 1
    WHERE user_id = OLD.receiver_id AND contact_id = OLD.sender_id;
END;

DROP TRIGGER IF EXISTS trg_chat_unread_del_insert;
CREATE TRIGGER trg_chat_unread_del_insert
AFTER INSERT ON deleted_messages
WHEN (SELECT read FROM chat_messages WHERE id = NEW.message_id) = 0
BEGIN
    UPDATE chat_unread_counts SET unread = unread - 1
    WHERE user_id = NEW.user_id
      AND contact_id = (SELECT sender_id FROM chat_messages WHERE id = NEW.message_id);
END;

DROP TRIGGER IF EXISTS trg_chat_unread_del_delete;
CREATE TRIGGER trg_chat_unread_del_delete
AFTER DELETE ON deleted_messages
WHEN (SELECT read FROM chat_messages WHERE id = OLD.message_id) = 0
BEGIN
    UPDATE chat_unread_counts SET unread = unread + 1
    WHERE user_id = OLD.user_id
      AND contact_id = (SELECT sender_id FROM chat_messages WHERE id = OLD.message_id);
END;

DROP TRIGGER IF EXISTS trg_mail_stats_insert;
CREATE TRIGGER trg_mail_stats_insert
AFTER INSERT ON internal_mail
BEGIN
    INSERT INTO mail_stats (user_id, folder, unread, total, starred)
    VALUES (NEW.user_id, NEW.folder,
            CASE WHEN NEW.is_read = 0 THEN 1 ELSE 0 END, 1,
            CASE WHEN NEW.is_starred = 1 THEN 1 ELSE 0 END)
    ON CONFLICT(user_id, folder) DO UPDATE SET
        unread  = unread + excluded.unread,
        total   = total + 1,
        starred = starred + excluded.starred;
END;

DROP TRIGGER IF EXISTS trg_mail_stats_update;
CREATE TRIGGER trg_mail_stats_update
AFTER UPDATE OF folder, is_read, is_starred ON internal_mail
BEGIN
    UPDATE mail_stats SET
        unread  = unread - CASE WHEN OLD.is_read = 0 THEN 1 ELSE 0 END,
        total   = total - 1,
        starred = starred - CASE WHEN OLD.is_starred = 1 THEN 1 ELSE 0 END
    WHERE user_id = OLD.user_id AND folder = OLD.folder;
    INSERT INTO mail_stats (user_id, folder, unread, total, starred)
    VALUES (NEW.user_id, NEW.folder,
            CASE WHEN NEW.is_read = 0 THEN 1 ELSE 0 END, 1,
            CASE WHEN NEW.is_starred = 1 THEN 1 ELSE 0 END)
    ON CONFLICT(user_id, folder) DO UPDATE SET
        unread  = unread + excluded.unread,
        total   = total + 1,
        starred = starred + excluded.starred;
END;

DROP TRIGGER IF EXISTS trg_mail_stats_delete;
CREATE TRIGGER trg_mail_stats_delete
AFTER DELETE ON internal_mail
BEGIN
    UPDATE mail_stats SET
        unread  = unread - CASE WHEN OLD.is_read = 0 THEN 1 ELSE 0 END,
        total   = total - 1,
        starred = starred - CASE WHEN OLD.is_starred = 1 THEN 1 ELSE 0 END
    WHERE user_id = OLD.user_id AND folder = OLD.folder;
END;

DROP TRIGGER IF EXISTS trg_ai_usage_insert;
CREATE TRIGGER trg_ai_usage_insert
AFTER INSERT ON ai_attachment_files
BEGIN
    INSERT INTO ai_storage_usage (user_id, total_bytes) VALUES (NEW.user_id, NEW.size)
    ON CONFLICT(user_id) DO UPDATE SET total_bytes = total_bytes + NEW.size;
END;

DROP TRIGGER IF EXISTS trg_ai_usage_update;
CREATE TRIGGER trg_ai_usage_update
AFTER UPDATE OF size ON ai_attachment_files
BEGIN
    UPDATE ai_storage_usage SET total_bytes = total_bytes + (NEW.size - OLD.size)
    WHERE user_id = NEW.user_id;
END;

DROP TRIGGER IF EXISTS trg_ai_usage_delete;
CREATE TRIGGER trg_ai_usage_delete
AFTER DELETE ON ai_attachment_files
BEGIN
    UPDATE ai_storage_usage SET total_bytes = total_bytes - OLD.size
    WHERE user_id = OLD.user_id;
END;
"""

_BACKFILL_SQL = """
INSERT INTO chat_unread_counts (user_id, contact_id, unread)
SELECT receiver_id, sender_id, COUNT(*)
FROM chat_messages
WHERE read = 0 AND receiver_id NOT LIKE 'group_%'
  AND id NOT IN (SELECT message_id FROM deleted_messages WHERE user_id = chat_messages.receiver_id)
GROUP BY receiver_id, sender_id
ON CONFLICT(user_id, contact_id) DO UPDATE SET unread = excluded.unread;

INSERT INTO mail_stats (user_id, folder, unread, total, starred)
SELECT user_id, folder,
       SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END),
       COUNT(*),
       SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END)
FROM internal_mail
GROUP BY user_id, folder
ON CONFLICT(user_id, folder) DO UPDATE SET
    unread = excluded.unread, total = excluded.total, starred = excluded.starred;

INSERT INTO ai_storage_usage (user_id, total_bytes)
SELECT user_id, SUM(size) FROM ai_attachment_files GROUP BY user_id
ON CONFLICT(user_id) DO UPDATE SET total_bytes = excluded.total_bytes;
"""


def _migrate_v3_counters():
    """Fase 3 (migración 106): contadores derivados mantenidos por TRIGGERS.

    chat_unread_counts (badges por contacto), mail_stats (badges por carpeta)
    y ai_storage_usage (cuota de archivos de IA) sustituyen COUNT(*) on-demand
    y la caché en memoria de tamaño de directorio para la cuota de IA."""
    with get_db() as conn:
        conn.executescript(_TRIGGERS_DDL)
        conn.executescript(_BACKFILL_SQL)
        conn.commit()


_TIME_COLUMNS = [
    # (tabla, columna, tipo con NOT NULL DEFAULT, valor de backfill)
    ("users", "created_at", "TEXT NOT NULL DEFAULT ''", "iso"),
    ("user_google_accounts", "created_at", "TEXT NOT NULL DEFAULT ''", "iso"),
    ("ai_api_keys", "created_at", "TEXT NOT NULL DEFAULT ''", "iso"),
    ("ai_shared_sessions", "created_at", "REAL NOT NULL DEFAULT 0", "epoch"),
    ("ai_note_collaborators", "created_at", "REAL NOT NULL DEFAULT 0", "epoch"),
    ("hidden_conversations", "created_at", "REAL NOT NULL DEFAULT 0", "epoch"),
    ("muted_conversations", "created_at", "REAL NOT NULL DEFAULT 0", "epoch"),
    ("user_connections", "created_at", "REAL NOT NULL DEFAULT 0", "epoch"),
]


def _migrate_v4_timestamps():
    """Fase 4 (migración 107): normalización de columnas de tiempo.

    Añade created_at a las tablas que carecían de timestamps y rellena las
    filas existentes con el momento de la migración (las filas nuevas las
    escribe la aplicación con la convención documentada). En bases nuevas el
    DDL canónico ya trae las columnas y este paso es no-op."""
    import time
    from datetime import datetime, timezone

    now_epoch = time.time()
    now_iso = datetime.now(timezone.utc).isoformat() + "Z"

    with get_db() as conn:
        for table, col, ddl, kind in _TIME_COLUMNS:
            if col not in _table_columns(conn, table):
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
            # El heal puede haber creado la columna con el DEFAULT: se rellena
            # cualquier valor vacío restante (idempotente, una sola ejecución).
            conn.execute(
                f"UPDATE {table} SET {col} = ? WHERE {col} = '' OR {col} IS NULL OR {col} = 0",
                (now_iso if kind == "iso" else now_epoch,),
            )
        conn.commit()


MIGRATIONS[105] = _migrate_v2_integrity
MIGRATIONS[106] = _migrate_v3_counters
MIGRATIONS[107] = _migrate_v4_timestamps


# ── Runner ────────────────────────────────────────────────────────────────────

def _ensure_module_migrations() -> None:
    """Registra las migraciones declaradas por los módulos (ej. IA: 101-104)
    por si este runner se ejecuta sin haberlos importado antes. Se comprueba
    la presencia de esas migraciones concretas (el dict ya puede contener
    migraciones del propio core, como la 105)."""
    if 101 in MIGRATIONS and 104 in MIGRATIONS:
        return
    try:
        from modules.api.ai import repository as _ai_repo  # noqa: F401
    except Exception:
        pass


def _heal_legacy_schema() -> None:
    """Alinea columnas de tablas legacy con el DDL canónico.

    CREATE TABLE IF NOT EXISTS no añade columnas a tablas existentes, y las
    versiones antiguas del código añadían columnas (p. ej. ai_messages.
    attachments) con ALTER en cada arranque. Para bases creadas por código
    antiguo, este paso añade las columnas canónicas que falten (SOLO añade,
    nunca elimina ni altera datos). Idempotente y barato."""
    import re as _re

    def _canonical_columns(table):
        ddl = TABLE_DDL.get(table) or ""
        body = ddl.split("(", 1)[1].rsplit(")", 1)[0] if "(" in ddl else ""
        cols = []
        for line in body.splitlines():
            line = line.strip().rstrip(",")
            if not line:
                continue
            if line.startswith(("PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK", "CONSTRAINT")):
                continue
            parts = line.split(None, 1)
            if len(parts) == 2 and _re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", parts[0]):
                cols.append((parts[0], parts[1]))
        return cols

    with get_db() as conn:
        for table, ddl in TABLE_DDL.items():
            try:
                existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            except Exception:
                continue  # la tabla aún no existe: el CREATE canónico la creará
            for col, col_ddl in _canonical_columns(table):
                if col not in existing:
                    try:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_ddl}")
                    except Exception:
                        # Columna con sintaxis no soportada por ADD COLUMN:
                        # se omite (el resto del heal continúa).
                        continue
        conn.commit()


def apply_migrations() -> None:
    """Aplica el esquema canónico y las migraciones versionadas pendientes.

    - user_version < BASELINE_LEGACY: base legacy sin sanear → legacy_sanitize
      (una sola vez) y se marca BASELINE_LEGACY.
    - A partir de ahí se aplican las MIGRATIONS numeradas > BASELINE_LEGACY.
    """
    _ensure_module_migrations()
    _heal_legacy_schema()
    with get_db() as conn:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version < BASELINE_LEGACY:
            legacy_sanitize(conn)
            version = BASELINE_LEGACY
        conn.execute(f"PRAGMA user_version = {version}")
        conn.commit()
    # Las migraciones gestionan sus propias conexiones (contrato: sin args)
    for num in sorted(MIGRATIONS):
        if num > version:
            MIGRATIONS[num]()
            version = num
    with get_db() as conn:
        conn.execute(f"PRAGMA user_version = {version}")
        conn.commit()


def apply_schema() -> None:
    """Crea/actualiza tablas e índices (idempotente) y aplica migraciones.

    Los índices se crean DESPUÉS de las migraciones: los rebuilds de tablas
    (DROP + RENAME) eliminan los índices asociados a la tabla."""
    with get_db() as conn:
        conn.executescript(MANAGER_TABLES_DDL)
        conn.executescript(AI_TABLES_DDL)
        conn.commit()
    apply_migrations()
    with get_db() as conn:
        for idx in SCHEMA_INDEXES:
            conn.execute(idx)
        conn.commit()
