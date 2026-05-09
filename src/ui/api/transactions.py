from flask import Blueprint, jsonify, request, abort
from core.database import get_db, transaction_to_dict
from ui.session import session as sess
from datetime import datetime
import uuid

transactions_bp = Blueprint('transactions', __name__, url_prefix='/api/transactions')

@transactions_bp.route('', methods=['GET'])
def get_transactions():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, created_at DESC", (uid,)).fetchall()
        return jsonify([transaction_to_dict(r) for r in rows])

@transactions_bp.route('', methods=['POST'])
def create_transaction():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    data = request.get_json()
    with get_db() as conn:
        tx_id = str(uuid.uuid4())
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
    return jsonify(ok=True, id=tx_id)

@transactions_bp.route('/<tx_id>', methods=['DELETE'])
def delete_transaction(tx_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    with get_db() as conn:
        conn.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, uid))
        conn.commit()
    return jsonify(ok=True)
