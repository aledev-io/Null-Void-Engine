import sqlite3
import os
import json
import time
from config.config import CONFIG

DATA_DIR = CONFIG.DATA_DIR
SCRAPER_DIR = os.path.join(os.path.dirname(DATA_DIR), 'scraper')
os.makedirs(SCRAPER_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
SCRAPER_DB_SQLITE = os.path.join(SCRAPER_DIR, 'scraper.db')

def get_db_connection():
    conn = sqlite3.connect(SCRAPER_DB_SQLITE)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;") 
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
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
            last_updated REAL NOT NULL
        )
    ''')
    cursor.execute("PRAGMA table_info(products)")
    cols = {row[1] for row in cursor.fetchall()}
    if "scraper_type" not in cols:
        cursor.execute("ALTER TABLE products ADD COLUMN scraper_type TEXT")
        
    cursor.execute("PRAGMA table_info(user_configs)")
    cols = {row[1] for row in cursor.fetchall()}
    if "filters" not in cols:
        cursor.execute("ALTER TABLE user_configs ADD COLUMN filters TEXT")
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp REAL NOT NULL,
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price ON products(price)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_category ON products(category)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_brand ON products(brand)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_scraper_type ON products(scraper_type)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_history_sku ON price_history(sku)')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_scraping_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            query TEXT NOT NULL,
            last_run_date TEXT,
            UNIQUE(user_id, query)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_products (
            user_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            PRIMARY KEY (user_id, sku),
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_configs (
            user_id TEXT PRIMARY KEY,
            scraper_ref TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_distances (
            user_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            distance REAL,
            PRIMARY KEY (user_id, sku),
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_details (
            sku TEXT PRIMARY KEY,
            description TEXT,
            images TEXT,
            contact TEXT,
            FOREIGN KEY(sku) REFERENCES products(sku) ON DELETE CASCADE
        )
    ''')
    
    conn.commit()
    conn.close()

def get_all_products(user_id=None, scraper_type=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if user_id:
        if scraper_type:
            cursor.execute('''
                SELECT p.*, pd.description as description_text,
                       ud.distance,
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                LEFT JOIN product_details pd ON p.sku = pd.sku
                LEFT JOIN user_distances ud ON p.sku = ud.sku AND ud.user_id = ?
                WHERE p.scraper_type = ?
                ORDER BY p.last_updated DESC
            ''', (user_id, scraper_type))
        else:
            cursor.execute('''
                SELECT p.*, pd.description as description_text,
                       ud.distance,
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                LEFT JOIN product_details pd ON p.sku = pd.sku
                LEFT JOIN user_distances ud ON p.sku = ud.sku AND ud.user_id = ?
                ORDER BY p.last_updated DESC
            ''', (user_id,))
    else:
        if scraper_type:
            cursor.execute('''
                SELECT p.*, pd.description as description_text,
                       NULL as distance,
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                LEFT JOIN product_details pd ON p.sku = pd.sku
                WHERE p.scraper_type = ?
                ORDER BY last_updated DESC
            ''', (scraper_type,))
        else:
            cursor.execute('''
                SELECT p.*, pd.description as description_text,
                       NULL as distance,
                       (SELECT price FROM price_history 
                        WHERE sku = p.sku 
                        ORDER BY timestamp DESC 
                        LIMIT 1 OFFSET 1) as prev_price 
                FROM products p 
                LEFT JOIN product_details pd ON p.sku = pd.sku
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

def get_product_history(sku):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM products WHERE sku = ?', (sku,))
    product = cursor.fetchone()
    
    if not product:
        conn.close()
        return None
        
    cursor.execute('SELECT price, timestamp FROM price_history WHERE sku = ? ORDER BY timestamp ASC', (sku,))
    history = cursor.fetchall()
    
    conn.close()
    
    return {
        "product": dict(product),
        "history": [dict(h) for h in history]
    }

def get_user_tasks(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM user_scraping_tasks WHERE user_id = ?', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_user_task(user_id, query):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO user_scraping_tasks (user_id, query, last_run_date)
            VALUES (?, ?, "")
        ''', (user_id, query))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def update_user_task_date(user_id, query, date_str):
    """Actualiza la fecha de la última ejecución de una tarea específica."""
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

def delete_user_task(user_id, task_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('DELETE FROM user_scraping_tasks WHERE user_id = ? AND id = ?', (user_id, task_id))
        conn.commit()
    finally:
        conn.close()

def get_user_config(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM user_configs WHERE user_id = ?', (str(user_id),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {}

def set_user_config(user_id, scraper_ref=None, filters=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM user_configs WHERE user_id = ?', (str(user_id),))
    row = cursor.fetchone()
    
    current_ref = row['scraper_ref'] if row and 'scraper_ref' in row.keys() else ''
    current_filters = row['filters'] if row and 'filters' in row.keys() else ''
    
    if scraper_ref is not None: current_ref = scraper_ref
    if filters is not None: current_filters = filters
    
    cursor.execute('''
        INSERT INTO user_configs (user_id, scraper_ref, filters)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET scraper_ref=excluded.scraper_ref, filters=excluded.filters
    ''', (str(user_id), current_ref, current_filters))
    conn.commit()
    conn.close()

def update_product_distance(user_id, sku, distance):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO user_distances (user_id, sku, distance)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, sku) DO UPDATE SET distance=excluded.distance
    ''', (user_id, sku, distance))
    conn.commit()
    conn.close()

def get_user_scraper_ref(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT scraper_ref FROM user_configs WHERE user_id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row['scraper_ref'] if row else None

def get_product_detail(sku):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM product_details WHERE sku = ?', (sku,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def save_product_detail(sku, description, images, contact):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO product_details (sku, description, images, contact, updated_at) 
        VALUES (?, ?, ?, ?, ?) 
        ON CONFLICT(sku) DO UPDATE SET 
            description=excluded.description,
            images=excluded.images,
            contact=excluded.contact,
            updated_at=excluded.updated_at
    ''', (sku, description, images, contact, time.time()))
    conn.commit()
    conn.close()

def mark_product_sold_out(sku):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE products SET availability = 'Agotado' WHERE sku = ?", (sku,))
    conn.commit()
    conn.close()

def mark_product_in_stock(sku):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE products SET availability = 'http://schema.org/InStock' WHERE sku = ?", (sku,))
    conn.commit()
    conn.close()
