import uuid
from datetime import datetime
from core.database import get_db, transaction_to_dict

def get_user_transactions(uid):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC", (uid,)).fetchall()
        return [transaction_to_dict(r) for r in rows]

def create_user_transaction(uid, data):
    tx_id = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute("""
            INSERT INTO transactions (id, user_id, title, amount, type, category, date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            tx_id,
            uid,
            data.get('title'),
            data.get('amount'),
            data.get('type'),
            data.get('category'),
            data.get('date'),
            datetime.now().isoformat()
        ))
        conn.commit()
    return tx_id

def delete_user_transaction(uid, tx_id):
    with get_db() as conn:
        conn.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, uid))
        conn.commit()
