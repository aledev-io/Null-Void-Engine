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


def now_epoch() -> float:
    """Timestamp REAL (epoch) — convención para tablas nuevas (ver core.schema)."""
    import time
    return time.time()


def now_iso() -> str:
    """Timestamp TEXT ISO-8601 UTC con sufijo 'Z' — convención legada de texto."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat() + "Z"


def _rebuild_table_with_check(conn, table: str, check_clause: str) -> None:
    """Añade un CHECK constraint a una tabla existente sin perder datos.

    SQLite no permite ALTER TABLE ... ADD CHECK; se reconstruye la tabla
    reutilizando su DDL original e inyectando el CHECK antes del cierre.
    Idempotente: si el DDL ya contiene CHECK, no hace nada."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    if not row or not row['sql']:
        return
    if 'CHECK' in row['sql'].upper():
        return

    sql = row['sql'].rstrip().rstrip(';').rstrip()
    if not sql.endswith(')'):
        return
    new_sql = sql[:-1] + f", {check_clause})"
    new_table = table + '__new'

    old_isolation = conn.isolation_level
    conn.isolation_level = None  # autocommit: necesario para PRAGMA foreign_keys
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN")
        try:
            conn.execute(new_sql.replace(table, new_table, 1))
            cols = ", ".join(
                r['name'] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()
            )
            conn.execute(f"INSERT INTO {new_table} ({cols}) SELECT {cols} FROM {table}")
            conn.execute(f"DROP TABLE {table}")
            conn.execute(f"ALTER TABLE {new_table} RENAME TO {table}")
            # Reasentar la secuencia de AUTOINCREMENT si la hubiera
            conn.execute(f"DELETE FROM sqlite_sequence WHERE name = '{table}'")
            conn.execute(f"INSERT INTO sqlite_sequence (name, seq) SELECT '{table}', MAX(id) FROM '{table}'")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.isolation_level = old_isolation


def get_db() -> sqlite3.Connection:
    """Crea una conexión a la base de datos con acceso por nombre de columna."""
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.OperationalError:
        # Almacenamiento sin permisos de escritura (reinstall con volumen ro):
        # se continúa con journal mode clásico en lugar de bloquear la app.
        print(f"[database] AVISO: no se pudo activar WAL en '{DB_PATH}' "
              "(¿permisos o montaje read-only?). Se usa journal mode por defecto.")
    return conn


def init_db() -> None:
    """Crea/actualiza el esquema canónico y aplica migraciones versionadas.

    El DDL y las migraciones viven en core.schema (fase de auditoría DBA):
    este módulo solo delega. Idempotente y seguro de llamar en cada arranque."""
    from core import schema
    schema.apply_schema()


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
        conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin' AND (role IS NULL OR role != 'admin')")
        conn.commit()


def row_to_dict(row: sqlite3.Row) -> dict:
    """Convierte una fila de eventos al formato del frontend."""
    d = dict(row)
    guests_raw = d.get('guests')
    try:
        guests = json.loads(guests_raw) if guests_raw else []
    except (json.JSONDecodeError, TypeError):
        guests = []
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
        'type':        d.get('type', 'event'),
        'location':    d.get('location') or '',
        'guests':      guests,
        'seriesId':    d.get('series_id') or None,
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
