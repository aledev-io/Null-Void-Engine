from flask import jsonify, request, abort
from modules.session import session as sess
from . import transactions_bp
from .services import get_user_transactions, create_user_transaction, delete_user_transaction

@transactions_bp.route('', methods=['GET'])
def get_transactions():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    uid = sess.get_user_id(token)
    if not uid: 
        return jsonify(error='No autorizado'), 401

    try:
        transactions = get_user_transactions(uid)
        return jsonify(transactions)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@transactions_bp.route('', methods=['POST'])
def create_transaction():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    uid = sess.get_user_id(token)
    if not uid: 
        return jsonify(error='No autorizado'), 401

    try:
        data = request.get_json() or {}
        tx_id = create_user_transaction(uid, data)
        return jsonify(ok=True, id=tx_id)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@transactions_bp.route('/<tx_id>', methods=['DELETE'])
def delete_transaction(tx_id):
    token = request.cookies.get('token') or request.headers.get('X-Token')
    uid = sess.get_user_id(token)
    if not uid: 
        return jsonify(error='No autorizado'), 401

    try:
        delete_user_transaction(uid, tx_id)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500
