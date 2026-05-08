"""
database.py — Inicialización y acceso a SQLite para el Calendario Flask
"""

import sqlite3
import os
import json

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'manager.db')


def get_db() -> sqlite3.Connection:
    """Crea una conexión a la base de datos con acceso por nombre de columna."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # Habilita modo concurrente para evitar bloqueos
    return conn


def init_db() -> None:
    """Crea las tablas necesarias si no existen"""
    with get_db() as conn:
        # 1. Tabla de Usuarios (Maestra)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                email    TEXT,
                user_id  TEXT UNIQUE,
                quota_gb INTEGER DEFAULT 10,
                modules  TEXT DEFAULT '["monitor", "calendar", "admin", "marketplace", "cloud"]'
            )
        """)

        # 2. Tabla de Eventos (Calendario)
        conn.execute("""
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
                is_important INTEGER NOT NULL DEFAULT 0
            )
        """)
        
        # 3. Tabla de Finanzas (Transacciones)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                title       TEXT NOT NULL,
                amount      REAL NOT NULL,
                type        TEXT NOT NULL,
                category    TEXT,
                date        TEXT NOT NULL,
                created_at  TEXT NOT NULL
            )
        """)

        # 4. Tabla de Documentos (Excel)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS spreadsheets (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                name        TEXT NOT NULL,
                content     TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)

        # 5. Tabla de Facturas (ERP)
        conn.execute("""
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
                created_at     TEXT
            )
        """)

        # --- MIGRACIONES Y OPTIMIZACIONES ---
        
        # Verificar columnas de users
        cursor = conn.execute("PRAGMA table_info(users)")
        cols_users = [c[1] for c in cursor.fetchall()]
        if 'user_id' not in cols_users:
            conn.execute("ALTER TABLE users ADD COLUMN user_id TEXT")
            import uuid
            for u in conn.execute("SELECT username FROM users").fetchall():
                uid = f"NV-{str(uuid.uuid4())[:8].upper()}"
                conn.execute("UPDATE users SET user_id = ? WHERE username = ?", (uid, u['username']))

        # Función de migración genérica
        def migrate_table(table_name):
            cursor = conn.execute(f"PRAGMA table_info({table_name})")
            cols = [c[1] for c in cursor.fetchall()]
            
            # Si tiene la columna vieja 'user' pero no la nueva 'user_id'
            if 'user' in cols and 'user_id' not in cols:
                print(f"[Migration] Migrando {table_name} a user_id...")
                conn.execute(f"ALTER TABLE {table_name} ADD COLUMN user_id TEXT")
                conn.execute(f"""
                    UPDATE {table_name} 
                    SET user_id = (SELECT user_id FROM users WHERE users.username = {table_name}.user)
                """)
                # Limpiar huérfanos
                conn.execute(f"UPDATE {table_name} SET user_id = 'NV-ADMIN' WHERE user_id IS NULL")
            
            # Añadir otras columnas faltantes según el esquema
            if table_name == 'events':
                if 'reminders' not in cols: conn.execute("ALTER TABLE events ADD COLUMN reminders TEXT DEFAULT '[]'")
                if 'is_important' not in cols: conn.execute("ALTER TABLE events ADD COLUMN is_important INTEGER DEFAULT 0")

        for t in ["events", "transactions", "spreadsheets", "invoices"]:
            migrate_table(t)

        # Crear Índices
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_userid ON events(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tx_userid ON transactions(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_inv_userid ON invoices(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sheet_userid ON spreadsheets(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)")

        conn.commit()

def migrate_users_to_db(credentials_dict: dict):
    """Migra usuarios de config y CSV a la base de datos."""
    with get_db() as conn:
        for u, p in credentials_dict.items():
            conn.execute("INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)", (u, p))
        conn.commit()


def row_to_dict(row: sqlite3.Row) -> dict:
    """Convierte una sqlite3.Row al dict que espera el frontend."""
    d = dict(row)
    # Normaliza nombres: snake_case → camelCase para el JS
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
        'isImportant': bool(d.get('is_important', 0))
    }

def transaction_to_dict(d):
    return {
        'id': d['id'],
        'title': d['title'],
        'amount': d['amount'],
        'type': d['type'],
        'category': d['category'],
        'date': d['date'],
        'createdAt': d['created_at']
    }
