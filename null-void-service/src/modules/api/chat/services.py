from . import repository
from modules.session import session as sess


def get_conversations(user_id):
    contact_ids = repository.get_contact_ids(user_id)
    conversations = []
    for cid in contact_ids:
        contact = repository.get_contact_info(cid)
        if not contact:
            continue
        last_msg = repository.get_last_message(user_id, cid)
        unread = repository.get_unread_count(cid, user_id) if cid else 0
        last_activity = sess.get_last_activity(contact['username'])
        conversations.append({
            'contact_id': cid,
            'contact_name': contact['username'],
            'last_message': last_msg['message'] if last_msg else '',
            'last_time': last_msg['created_at'] if last_msg else 0,
            'last_sender': last_msg['sender_id'] if last_msg else '',
            'last_file_name': last_msg['file_name'] if last_msg else '',
            'unread': unread,
            'last_activity': last_activity,
        })
    conversations.sort(key=lambda c: c['last_time'], reverse=True)
    return conversations


def get_messages(user_id, contact_id, before, limit):
    if before:
        rows = repository.get_messages_before(user_id, contact_id, before, limit)
    else:
        rows = repository.get_messages_recent(user_id, contact_id, limit)
    result = [{
        'id': m['id'], 'sender_id': m['sender_id'],
        'message': m['message'], 'time': m['created_at'],
        'read': bool(m['read']), 'mine': m['sender_id'] == user_id,
        'file_path': m['file_path'], 'file_name': m['file_name'],
        'file_size': m['file_size'], 'edited_at': m['edited_at']
    } for m in rows]
    result.reverse()
    return result


def send_message(user_id, receiver_id, message, file_path=None, file_name=None, file_size=None):
    if not receiver_id:
        return None, "receiver_id requerido"
    if not message and not file_path:
        return None, "Mensaje vacío"
    if message and len(message) > 5000:
        return None, "Mensaje demasiado largo (máx 5000 caracteres)"

    receiver = repository.get_user_receiver(receiver_id)
    if not receiver:
        return None, "Usuario no encontrado"

    msg_id, now = repository.insert_message(user_id, receiver_id, message or "", file_path, file_name, file_size)
    return {
        'id': msg_id, 'sender_id': user_id, 'receiver_id': receiver_id,
        'message': message or "", 'time': now, 'read': False, 'mine': True,
        'file_path': file_path, 'file_name': file_name, 'file_size': file_size,
        'edited_at': None
    }, None


def edit_message(user_id, msg_id, new_text):
    if not new_text or len(new_text) > 5000:
        return None, "Mensaje inválido"
    ok, edited_at = repository.edit_message(msg_id, user_id, new_text)
    if ok:
        return {'edited_at': edited_at}, None
    return None, "No se pudo editar"


def delete_message(user_id, msg_id):
    ok = repository.delete_message_for_user(msg_id, user_id)
    return ok, "Mensaje eliminado" if ok else "No se pudo eliminar"


def delete_conversation(user_id, contact_id):
    ok = repository.delete_conversation(user_id, contact_id)
    return ok, "Conversación eliminada" if ok else "No se pudo eliminar"


def forward_message(user_id, msg_id, target_contact_id):
    msg = repository.get_message_by_id(msg_id)
    if not msg:
        return None, "Mensaje no encontrado"
    new_id, now = repository.insert_message(
        user_id, target_contact_id,
        msg['message'] or "",
        msg['file_path'], msg['file_name'], msg['file_size']
    )
    return {
        'id': new_id, 'sender_id': user_id, 'receiver_id': target_contact_id,
        'message': msg['message'] or "", 'time': now, 'read': False, 'mine': True,
        'file_path': msg['file_path'], 'file_name': msg['file_name'],
        'file_size': msg['file_size'], 'edited_at': None
    }, None


def get_forward_contacts(user_id):
    return repository.get_contacts_for_forward(user_id)


def mark_read(user_id, contact_id):
    changed = repository.mark_messages_read(contact_id, user_id)
    return changed, contact_id


def get_unread_count(user_id):
    return repository.get_total_unread(user_id)


def start_conversation(user_id, contact_id):
    contact = repository.get_contact_by_id(contact_id)
    if not contact:
        return None
    repository.create_connections(user_id, contact_id)
    return {
        'contact_id': contact['user_id'],
        'contact_name': contact['username'],
        'last_activity': sess.get_last_activity(contact['username']),
    }


def search_users(query, user_id):
    if len(query) < 2:
        return []
    users = repository.search_users_db(query, user_id)
    return [{
        'username': u['username'],
        'user_id': u['user_id'],
        'last_activity': sess.get_last_activity(u['username']),
    } for u in users]


def poll_messages(user_id, since, contact_id):
    rows = repository.get_poll_messages(user_id, contact_id, since)
    return [{
        'id': m['id'], 'sender_id': m['sender_id'],
        'receiver_id': m['receiver_id'], 'message': m['message'],
        'time': m['created_at'], 'read': bool(m['read']),
        'mine': m['sender_id'] == user_id,
        'file_path': m['file_path'], 'file_name': m['file_name'],
        'file_size': m['file_size'], 'edited_at': m['edited_at']
    } for m in rows]