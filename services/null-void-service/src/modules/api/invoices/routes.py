from flask import Blueprint, jsonify, request
from modules.session import session as sess
from . import services

invoices_bp = Blueprint('invoices', __name__, url_prefix='/api/invoices')


def _get_uid():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    return sess.get_user_id(token)


@invoices_bp.route('', methods=['GET'])
@invoices_bp.route('/list', methods=['GET'])
def get_invoices():
    uid = _get_uid()
    if not uid:
        return jsonify(error='No autorizado'), 401
    token = request.cookies.get('token') or request.headers.get('X-Token')
    return jsonify(services.get_invoices(uid, token))


@invoices_bp.route('', methods=['POST'])
def create_invoice():
    uid = _get_uid()
    if not uid:
        return jsonify(error='No autorizado'), 401
    services.create_invoice(uid, request.get_json())
    return jsonify(ok=True)


@invoices_bp.route('/upload', methods=['POST'])
def upload_invoice():
    uid = _get_uid()
    if not uid:
        return jsonify(error='No autorizado'), 401

    if 'file' not in request.files:
        return jsonify(error='No hay archivo'), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify(error='Nombre de archivo vacío'), 400

    if not file.filename.lower().endswith('.pdf'):
        return jsonify(error='Solo se permiten archivos PDF'), 400

    token = request.cookies.get('token') or request.headers.get('X-Token')
    try:
        services.process_upload(uid, file, token)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True)


@invoices_bp.route('/delete', methods=['POST'])
def delete_invoices():
    uid = _get_uid()
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json()
    token = request.cookies.get('token') or request.headers.get('X-Token')
    services.delete_invoices(uid, data.get('ids', []), token)
    return jsonify(ok=True)


@invoices_bp.route('/update_status', methods=['POST'])
def update_invoice_status_alt():
    uid = _get_uid()
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json()
    services.update_status(uid, data.get('id'), data.get('status'))
    return jsonify(ok=True)
