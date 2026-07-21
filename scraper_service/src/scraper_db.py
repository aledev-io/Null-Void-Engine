import sqlite3
import os
import time

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_DIR = os.path.join(_PROJECT_ROOT, 'data', 'scraper')
_raw_scraper_dir = os.environ.get("SCRAPER_DIR", _DEFAULT_DIR)
SCRAPER_DIR = _raw_scraper_dir if os.path.isabs(_raw_scraper_dir) else os.path.join(_PROJECT_ROOT, _raw_scraper_dir)
os.makedirs(SCRAPER_DIR, exist_ok=True)
SCRAPER_DB_SQLITE = os.path.join(SCRAPER_DIR, 'scraper.db')

def get_db_connection():
    conn = sqlite3.connect(SCRAPER_DB_SQLITE)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;") # Modo WAL para que no se bloquee con Gevent
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Tabla principal de productos (Unificada)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            sku TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            brand TEXT,
            price REAL NOT NULL,
            url TEXT NOT NULL,
            image TEXT,
            availability TEXT,
            rating_value REAL,
            rating_count INTEGER,
            category TEXT,
            query_origin TEXT,
            scraper_type TEXT,
            last_updated REAL
        )
    ''')
    
    # Historial de precios con incremento automático nativo de SQLite
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp REAL NOT NULL,
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    
    # Índices optimizados para las búsquedas del frontend
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price ON products(price)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_category ON products(category)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_brand ON products(brand)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_scraper_type ON products(scraper_type)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_history_sku ON price_history(sku)')
    
    # Tareas de scraping (user_id unificado a TEXT para soportar tus IDs 'NV-UUID')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_scraping_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL, -- CORREGIDO: TEXT para emparejar con tus sesiones
            query TEXT NOT NULL,
            last_run_date TEXT,
            UNIQUE(user_id, query)
        )
    ''')
    
    # Productos favoritos/guardados por cada usuario
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_products (
            user_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            PRIMARY KEY (user_id, sku),
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    
    # Configuración de usuario
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_configs (
            user_id TEXT PRIMARY KEY,
            scraper_ref TEXT,
            filters TEXT
        )
    ''')
    
    # Distancias de usuario
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_distances (
            user_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            distance REAL,
            PRIMARY KEY (user_id, sku),
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    # Bot Rules for atHome
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS athome_bot_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            max_price REAL,
            min_surface REAL,
            max_distance REAL,
            keywords TEXT,
            is_active BOOLEAN DEFAULT 1
        )
    ''')
    
    for col_def in [
        "parking TEXT DEFAULT ''",
        "pets TEXT DEFAULT ''",
        "availability_date TEXT DEFAULT ''"
    ]:
        try:
            cursor.execute(f"ALTER TABLE athome_bot_rules ADD COLUMN {col_def}")
        except sqlite3.OperationalError:
            pass
    
    conn.commit()
    conn.close()


def save_products(products, query_origin="general", user_id=None, scraper_type="pccomponentes"):
    if not products: 
        return
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Agrupamos todo en un bloque de contexto 'with' para asegurar atomicidad y velocidad masiva
    with conn:
        current_time = time.time()
        
        for p in products:
            sku = p['sku']
            new_price = p['price']
            timestamp = p.get('timestamp', current_time)
            
            # Comprobar precio anterior
            cursor.execute("SELECT price FROM products WHERE sku = ?", (sku,))
            row = cursor.fetchone()
            
            # Insertar o actualizar producto usando el ON CONFLICT de SQLite
            cursor.execute('''
                INSERT INTO products (sku, title, brand, price, url, image, availability, rating_value, rating_count, category, query_origin, scraper_type, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sku) DO UPDATE SET
                    title=excluded.title,
                    price=excluded.price,
                    availability=excluded.availability,
                    rating_value=excluded.rating_value,
                    rating_count=excluded.rating_count,
                    category=excluded.category,
                    query_origin=excluded.query_origin,
                    scraper_type=excluded.scraper_type,
                    last_updated=excluded.last_updated
            ''', (
                sku, p['title'], p.get('brand', 'Unknown'), new_price, p['url'], p.get('image'),
                p.get('availability', 'Unknown'), p.get('rating_value', 0.0), p.get('rating_count', 0),
                p.get('category', 'general'), p.get('query', query_origin), p.get('scraper_type', scraper_type), timestamp
            ))
            
            # Guardamos en el histórico si el precio cambia o el artículo es nuevo
            if not row or row['price'] != new_price:
                cursor.execute('''
                    INSERT INTO price_history (sku, price, timestamp)
                    VALUES (?, ?, ?)
                ''', (sku, new_price, timestamp))
            
            if user_id:
                # INSERT OR IGNORE nativo y seguro de SQLite
                cursor.execute('INSERT OR IGNORE INTO user_products (user_id, sku) VALUES (?, ?)', (user_id, sku))
                
                if 'distance' in p and p['distance'] is not None:
                    cursor.execute('''
                        INSERT INTO user_distances (user_id, sku, distance)
                        VALUES (?, ?, ?)
                        ON CONFLICT(user_id, sku) DO UPDATE SET distance=excluded.distance
                    ''', (user_id, sku, p['distance']))
                
    conn.commit()
    conn.close()

def get_user_scraper_ref(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT scraper_ref FROM user_configs WHERE user_id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row['scraper_ref'] if row else None

def get_athome_routine_url():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT filters FROM user_configs WHERE filters IS NOT NULL')
    rows = cursor.fetchall()
    conn.close()
    import json
    for row in rows:
        try:
            filters = json.loads(row['filters'])
            if 'athome_routine_url' in filters and filters['athome_routine_url']:
                return filters['athome_routine_url']
        except:
            continue
    return None

def update_user_task_date(user_id, query, date_str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE user_scraping_tasks 
            SET last_run_date = ? 
            WHERE user_id = ? AND query = ?
        ''', (date_str, user_id, query))
        conn.commit()
    finally:
        conn.close()


def get_all_products(user_id=None, scraper_type=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if user_id:
        if scraper_type:
            cursor.execute('''
                SELECT p.*, 
                       ud.distance,
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                JOIN user_products up ON p.sku = up.sku
                LEFT JOIN user_distances ud ON p.sku = ud.sku AND ud.user_id = ?
                WHERE up.user_id = ? AND p.scraper_type = ?
                ORDER BY p.last_updated DESC
            ''', (user_id, user_id, scraper_type))
        else:
            cursor.execute('''
                SELECT p.*, 
                       ud.distance,
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                JOIN user_products up ON p.sku = up.sku
                LEFT JOIN user_distances ud ON p.sku = ud.sku AND ud.user_id = ?
                WHERE up.user_id = ?
                ORDER BY p.last_updated DESC
            ''', (user_id, user_id))
    else:
        if scraper_type:
            cursor.execute('''
                SELECT p.*, 
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                WHERE p.scraper_type = ?
                ORDER BY last_updated DESC
            ''', (scraper_type,))
        else:
            cursor.execute('''
                SELECT p.*, 
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                ORDER BY last_updated DESC
            ''')
    rows = cursor.fetchall()
    conn.close()
    
    result = []
    for r in rows:
        d = dict(r)
        d['price_formatted'] = f"{d['price']:.2f}€"
        d['prev_price_formatted'] = f"{d['prev_price']:.2f}€" if d['prev_price'] is not None else None
        result.append(d)
    return result

def add_user_product(user_id, sku):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('INSERT OR IGNORE INTO user_products (user_id, sku) VALUES (?, ?)', (user_id, sku))
    conn.commit()
    conn.close()

def is_user_product(user_id, sku):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM user_products WHERE user_id = ? AND sku = ?', (user_id, sku))
    row = cursor.fetchone()
    conn.close()
    return row is not None

def get_bot_rules(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM athome_bot_rules WHERE user_id = ? ORDER BY id DESC', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_active_bot_rules():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM athome_bot_rules WHERE is_active = 1')
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_bot_rule(user_id, name, max_price, min_surface, max_distance, keywords, parking='', pets='', availability_date=''):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO athome_bot_rules (user_id, name, max_price, min_surface, max_distance, keywords, parking, pets, availability_date, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ''', (user_id, name, max_price, min_surface, max_distance, keywords, parking, pets, availability_date))
    conn.commit()
    conn.close()

def delete_bot_rule(rule_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM athome_bot_rules WHERE id = ? AND user_id = ?', (rule_id, user_id))
    conn.commit()
    conn.close()

def toggle_bot_rule(rule_id, user_id, is_active):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE athome_bot_rules SET is_active = ? WHERE id = ? AND user_id = ?', (1 if is_active else 0, rule_id, user_id))
    conn.commit()
    conn.close()

# Inicialización automática controlada para entorno local
init_db()