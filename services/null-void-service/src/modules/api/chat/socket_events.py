import sys
from flask import request
from flask_socketio import join_room
from core.socket_ext import socketio
from modules.session import session as sess


def _get_socket_user_id(auth=None) -> str | None:
    token = None
    if isinstance(auth, dict):
        token = auth.get('token')
    if not token:
        token = request.cookies.get('token') or request.headers.get('X-Token')
    
    if token:
        return sess.get_user_id(token)
    return None


@socketio.on('connect')
def handle_connect(auth=None):
    try:
        user_id = _get_socket_user_id(auth)
        if user_id:
            join_room(f"user_{user_id}")
            sys.stderr.write(f"[SocketIO][INFO] Usuario {user_id} conectado con éxito\n")
            return True
        
        sys.stderr.write("[SocketIO][WARN] Conexión rechazada: Credenciales inválidas\n")
        return False
    except Exception as e:
        sys.stderr.write(f"[SocketIO][ERROR] Excepción en connect: {e}\n")
        return False


@socketio.on('join_chat')
def on_join(data):
    try:
        user_id = _get_socket_user_id(data)
        if user_id:
            join_room(f"user_{user_id}")
    except Exception as e:
        sys.stderr.write(f"[SocketIO][ERROR] Excepción en join_chat: {e}\n")


@socketio.on('disconnect')
def handle_disconnect():
    pass


@socketio.on('typing')
def handle_typing(data):
    try:
        if not isinstance(data, dict):
            return

        receiver_id = data.get('receiver_id')
        if not receiver_id:
            return

        user_id = _get_socket_user_id(data)
        if user_id:
            from modules.api.chat import repository
            with repository.get_db() as conn:
                exists = conn.execute(
                    "SELECT 1 FROM user_connections WHERE user_id = ? AND contact_id = ?",
                    (user_id, receiver_id)
                ).fetchone()

            if exists:
                socketio.emit('typing', {
                    'sender_id': user_id
                }, room=f"user_{receiver_id}")
    except Exception as e:
        sys.stderr.write(f"[SocketIO][ERROR] Excepción en typing: {e}\n")