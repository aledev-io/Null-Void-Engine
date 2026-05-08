import os
from flask import Blueprint, jsonify, request, abort
from core.database import get_db
from ui.session import session as sess
from datetime import datetime

invoices_bp = Blueprint('invoices', __name__, url_prefix='/api/invoices')

@invoices_bp.route('', methods=['GET'])
def get_invoices():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM invoices WHERE user_id = ? ORDER BY date DESC", (uid,)).fetchall()
        return jsonify([dict(r) for r in rows])

@invoices_bp.route('', methods=['POST'])
def create_invoice():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    data = request.get_json()
    with get_db() as conn:
        conn.execute("""
            INSERT INTO invoices (user_id, invoice_number, date, client, total, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            uid,
            data.get('invoice_number'),
            data.get('date'),
            data.get('client'),
            data.get('total'),
            data.get('status', 'no_pagada'),
            datetime.now().isoformat()
        ))
        conn.commit()
    return jsonify(ok=True)

@invoices_bp.route('/upload', methods=['POST'])
def upload_invoice():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    if 'file' not in request.files:
        return jsonify(error='No hay archivo'), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify(error='Nombre de archivo vacío'), 400

    filename = file.filename
    # Valores por defecto para entrada manual o procesamiento real futuro
    inv_num = "S/N"
    date_str = datetime.now().strftime("%Y-%m-%d")
    client = os.path.splitext(filename)[0].replace('_', ' ').title()
    total = 0.0
    
    raw_text = f"Factura subida: {filename}\n[Procesamiento OCR pendiente]"

    with get_db() as conn:
        conn.execute("""
            INSERT INTO invoices (user_id, invoice_number, date, client, total, status, raw_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            uid, inv_num, date_str, client, total, 'no_pagada', raw_text, datetime.now().isoformat()
        ))
        conn.commit()

    return jsonify(ok=True)

@invoices_bp.route('/delete', methods=['POST'])
def delete_invoices():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    data = request.get_json()
    ids = data.get('ids', [])
    if not ids: return jsonify(ok=True)

    with get_db() as conn:
        placeholders = ', '.join(['?'] * len(ids))
        conn.execute(f"DELETE FROM invoices WHERE user_id = ? AND id IN ({placeholders})", [uid] + ids)
        conn.commit()
    return jsonify(ok=True)

@invoices_bp.route('/update_status', methods=['POST'])
def update_invoice_status_alt():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    data = request.get_json()
    inv_id = data.get('id')
    new_status = data.get('status')
    
    with get_db() as conn:
        conn.execute("UPDATE invoices SET status = ? WHERE id = ? AND user_id = ?", (new_status, inv_id, uid))
        conn.commit()
    return jsonify(ok=True)


