from flask import Blueprint, jsonify, request
from modules.session import session as sess
from .repository import SpreadsheetRepository

spreadsheet_bp = Blueprint('spreadsheet', __name__, url_prefix='/api/spreadsheet')

def _get_uid():
    token = request.cookies.get('token') or request.args.get('token')
    return sess.get_user_id(token)

@spreadsheet_bp.route('', methods=['GET'])
def get_spreadsheet():
    uid = _get_uid()
    if not uid: 
        return jsonify(error='No autorizado'), 401
        
    data = SpreadsheetRepository.get_by_user(uid)
    return jsonify(data)

@spreadsheet_bp.route('', methods=['POST'])
def save_spreadsheet():
    uid = _get_uid()
    if not uid: 
        return jsonify(error='No autorizado'), 401

    data = request.get_json() or {}
    content = data.get('content', {})
    
    success = SpreadsheetRepository.save_or_update(uid, content)
    return jsonify(ok=success)


@spreadsheet_bp.route('/run-python', methods=['POST'])
def run_python():
    token = request.cookies.get('token') or request.args.get('token')
    user = sess.get_user(token)
    if not user:
        return jsonify(error='No autorizado'), 401

    data = request.get_json() or {}
    code = data.get('code', '')
    spreadsheet_data = data.get('data', {})

    try:
        import math
        import datetime

        ctx = {
            'data': spreadsheet_data,
            'math': math,
            'datetime': datetime,
            'range': range,
            'set_cell': lambda cell, val: spreadsheet_data.update({str(cell): str(val)}),
            'get_cell': lambda cell: spreadsheet_data.get(str(cell), ''),
            'clear_all': lambda: spreadsheet_data.clear(),
        }

        exec(code, {"__builtins__": __builtins__}, ctx)
        return jsonify(ok=True, data=spreadsheet_data)
    except Exception as e:
        return jsonify(ok=False, error=str(e))