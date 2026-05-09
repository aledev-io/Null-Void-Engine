from flask import Blueprint, jsonify, request, abort
from core.database import get_db
from ui.session import session as sess
from datetime import datetime
import json

spreadsheet_bp = Blueprint('spreadsheet', __name__, url_prefix='/api/spreadsheet')

@spreadsheet_bp.route('', methods=['GET'])
def get_spreadsheet():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    with get_db() as conn:
        row = conn.execute("SELECT content FROM spreadsheets WHERE user_id = ? LIMIT 1", (uid,)).fetchone()
        if row:
            return jsonify(json.loads(row['content']))
        return jsonify({})

@spreadsheet_bp.route('', methods=['POST'])
def save_spreadsheet():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid: return jsonify(error='No autorizado'), 401

    data = request.get_json()
    content = json.dumps(data.get('content', {}))
    name = data.get('name', 'Principal')

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM spreadsheets WHERE user_id = ? LIMIT 1", (uid,)).fetchone()
        if existing:
            conn.execute("UPDATE spreadsheets SET content = ?, updated_at = ? WHERE user_id = ?", 
                         (content, datetime.now().isoformat(), uid))
        else:
            import uuid
            conn.execute("INSERT INTO spreadsheets (id, user_id, name, content, updated_at) VALUES (?, ?, ?, ?, ?)",
                         (str(uuid.uuid4()), uid, name, content, datetime.now().isoformat()))
        conn.commit()
    return jsonify(ok=True)

@spreadsheet_bp.route('/run-python', methods=['POST'])
def run_python():
    token = request.cookies.get('token') or request.args.get('token')
    user = sess.get_user(token)
    if not user: return jsonify(error='No autorizado'), 401

    data = request.get_json()
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
            'clear_all': lambda: spreadsheet_data.clear()
        }
        
        exec(code, {"__builtins__": __builtins__}, ctx)
        return jsonify(ok=True, data=spreadsheet_data)
    except Exception as e:
        return jsonify(ok=False, error=str(e))
