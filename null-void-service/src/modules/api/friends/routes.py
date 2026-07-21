from flask import Blueprint, jsonify, request
from modules.session import session as sess
from core.socket_ext import socketio
from . import services

friends_bp = Blueprint('friends', __name__, url_prefix='/api/friends')


def _get_user():
    token = request.cookies.get('token') or request.headers.get('X-Token') or request.args.get('token')
    user = sess.get_user(token)
    user_id = sess.get_user_id(token)
    return user, user_id


@friends_bp.route('/list', methods=['GET'])
def get_friends():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    return jsonify(friends=services.get_friends_list(uid))


@friends_bp.route('/requests', methods=['GET'])
def get_requests():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    return jsonify(
        incoming=services.get_pending_requests(uid),
        sent=services.get_sent_requests(uid)
    )


@friends_bp.route('/send', methods=['POST'])
def send_request():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(silent=True) or {}
    addressee = data.get('user_id')
    if not addressee:
        return jsonify(error="user_id requerido"), 400
    result, error = services.send_friend_request(uid, addressee)
    if error:
        return jsonify(error=error), 400
    socketio.emit('friends_updated', {}, room=f"user_{addressee}")
    return jsonify(ok=True)


@friends_bp.route('/accept', methods=['POST'])
def accept_request():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(silent=True) or {}
    rid = data.get('request_id')
    if not rid:
        return jsonify(error="request_id requerido"), 400
    ru = services.get_request_users(rid)
    ok, msg = services.accept_request(rid, uid)
    if ok and ru:
        socketio.emit('friends_updated', {}, room=f"user_{ru['requester']}")
    return jsonify(ok=ok, msg=msg)


@friends_bp.route('/reject', methods=['POST'])
def reject_request():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(silent=True) or {}
    rid = data.get('request_id')
    if not rid:
        return jsonify(error="request_id requerido"), 400
    ru = services.get_request_users(rid)
    ok, msg = services.reject_request(rid, uid)
    if ok and ru:
        socketio.emit('friends_updated', {}, room=f"user_{ru['requester']}")
    return jsonify(ok=ok, msg=msg)


@friends_bp.route('/cancel', methods=['POST'])
def cancel_request():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(silent=True) or {}
    rid = data.get('request_id')
    if not rid:
        return jsonify(error="request_id requerido"), 400
    # get addressee before deleting
    ru = services.get_request_users(rid)
    addressee = ru['addressee'] if ru else None
    ok, msg = services.cancel_request(rid, uid)
    if ok and addressee:
        socketio.emit('friends_updated', {}, room=f"user_{addressee}")
    return jsonify(ok=ok, msg=msg)


@friends_bp.route('/remove', methods=['POST'])
def remove_friend():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(silent=True) or {}
    friend_id = data.get('friend_id')
    if not friend_id:
        return jsonify(error="friend_id requerido"), 400
    ok, msg = services.remove_friend(uid, friend_id)
    if ok:
        socketio.emit('friend_removed', {'by': uid, 'friend_id': friend_id}, room=f"user_{friend_id}")
        socketio.emit('friend_removed', {'by': uid, 'friend_id': friend_id}, room=f"user_{uid}")
    return jsonify(ok=ok, msg=msg)


@friends_bp.route('/search', methods=['GET'])
def search():
    _, uid = _get_user()
    if not uid:
        return jsonify(error="No autorizado"), 401
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify(users=[])
    return jsonify(users=services.search_users_for_friend(q, uid))
