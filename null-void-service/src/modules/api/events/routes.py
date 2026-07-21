from flask import jsonify, request, abort
from modules.session import session as sess
from . import events_bp
from .services import get_user_events, create_user_event, update_user_event, delete_user_event

@events_bp.route('', methods=['GET'])
def get_events():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    try:
        events = get_user_events(uid)
        return jsonify(events)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('', methods=['POST'])
def create_event():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    try:
        event_id = create_user_event(uid, data)
        return jsonify(ok=True, id=event_id)
    except ValueError as e:
        abort(400, description=str(e))
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('/<event_id>', methods=['PUT'])
def update_event(event_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    try:
        update_user_event(uid, event_id, data)
        return jsonify(ok=True)
    except KeyError as e:
        abort(404, description=str(e))
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('/<event_id>', methods=['DELETE'])
def delete_event(event_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    try:
        delete_user_event(uid, event_id)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500
