from flask import Blueprint, jsonify, request, abort
from core.database import get_db, row_to_dict
from ui.session import session as sess
from datetime import datetime

events_bp = Blueprint('events', __name__, url_prefix='/api/events')

def now_iso():
    return datetime.now().isoformat()

def _validate_event(data):
    if not data.get('title') or not data.get('date'):
        return None, "Faltan campos obligatorios (title, date)"
    return data, None

@events_bp.route('', methods=['GET'])
def get_events():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE user_id = ? ORDER BY date ASC, start_time ASC", 
            (uid,)
        ).fetchall()
        return jsonify([row_to_dict(r) for r in rows])

@events_bp.route('', methods=['POST'])
def create_event():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    data, err = _validate_event(data)
    if err:
        abort(400, description=err)

    event_id   = data.get('id') or f"ev_{int(datetime.now().timestamp()*1000)}"
    created_at = data.get('createdAt') or now_iso()

    with get_db() as conn:
        conn.execute("""
            INSERT INTO events 
            (id, user_id, title, date, start_time, end_time, all_day, category, description, completed, created_at, updated_at, is_important)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event_id,
            uid,
            data['title'].strip(),
            data['date'],
            data.get('startTime') or data.get('start_time'),
            data.get('endTime') or data.get('end_time'),
            1 if (data.get('allDay') or data.get('all_day')) else 0,
            data.get('category', 'personal'),
            data.get('description'),
            1 if data.get('completed') else 0,
            created_at,
            None,
            1 if data.get('isImportant') else 0
        ))
        conn.commit()
    return jsonify(ok=True, id=event_id)

@events_bp.route('/<event_id>', methods=['PUT'])
def update_event(event_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    
    with get_db() as conn:
        # Verificar pertenencia
        existing = conn.execute("SELECT id FROM events WHERE id = ? AND user_id = ?", (event_id, uid)).fetchone()
        if not existing:
            abort(404, description='Evento no encontrado')

        conn.execute("""
            UPDATE events SET
                title = ?, date = ?, start_time = ?, end_time = ?, all_day = ?, 
                category = ?, description = ?, completed = ?, updated_at = ?, is_important = ?
            WHERE id = ? AND user_id = ?
        """, (
            data['title'].strip(),
            data['date'],
            data.get('startTime') or data.get('start_time'),
            data.get('endTime') or data.get('end_time'),
            1 if (data.get('allDay') or data.get('all_day')) else 0,
            data.get('category', 'personal'),
            data.get('description'),
            1 if data.get('completed') else 0,
            now_iso(),
            1 if data.get('isImportant') else 0,
            event_id,
            uid
        ))
        conn.commit()
    return jsonify(ok=True)

@events_bp.route('/<event_id>', methods=['DELETE'])
def delete_event(event_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    with get_db() as conn:
        conn.execute("DELETE FROM events WHERE id = ? AND user_id = ?", (event_id, uid))
        conn.commit()
    return jsonify(ok=True)
