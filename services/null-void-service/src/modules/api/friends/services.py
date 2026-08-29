from . import repository
from modules.session import session as sess
from core.notifications import notifier
from datetime import datetime


def notify_friend_event(user_id, sender_id, sender_name, action):
    """Envía una notificación (historial + push/web/FCM) a user_id por una acción de sender_name."""
    if not sender_name:
        return
    if action == 'sent':
        title, body = "Nueva solicitud de amistad", f"{sender_name} te ha enviado una solicitud de amistad"
    elif action == 'accepted':
        title, body = "Solicitud de amistad aceptada", f"{sender_name} ha aceptado tu solicitud de amistad"
    elif action == 'rejected':
        title, body = "Solicitud de amistad rechazada", f"{sender_name} ha rechazado tu solicitud de amistad"
    elif action == 'auto_accepted':
        title, body = "Nueva amistad", f"{sender_name} y tú ya sois amigos"
    else:
        return
    now = datetime.now()
    notifier._add_to_history(title, now.strftime("%Y-%m-%d"), now.strftime("%H:%M"), body, "friends", user_id, sender_id=sender_id)
    notifier._send_system_notification(title, now.strftime("%H:%M"), 0, body, "friends", user_id=user_id, sender_id=sender_id)


def get_friends_list(user_id):
    friends = repository.get_friends(user_id)
    for f in friends:
        f['last_activity'] = sess.get_last_activity(f['friend_name'])
    return friends


def get_pending_requests(user_id):
    reqs = repository.get_requests(user_id)
    for r in reqs:
        r['last_activity'] = sess.get_last_activity(r['requester_name'])
    return reqs


def get_sent_requests(user_id):
    reqs = repository.get_sent_requests(user_id)
    for r in reqs:
        r['last_activity'] = sess.get_last_activity(r['addressee_name'])
    return reqs


MAX_FRIENDS = 1000


def send_friend_request(requester_id, addressee_id):
    if requester_id == addressee_id:
        return None, "No puedes enviarte solicitud a ti mismo"
    if repository.are_friends(requester_id, addressee_id):
        return None, "Ya sois amigos"
        
    requester_friends = repository.get_friends(requester_id)
    if len(requester_friends) >= MAX_FRIENDS:
        return None, f"Has alcanzado el límite máximo de {MAX_FRIENDS} amigos"

    addressee_friends = repository.get_friends(addressee_id)
    if len(addressee_friends) >= MAX_FRIENDS:
        return None, f"El usuario ha alcanzado el límite máximo de {MAX_FRIENDS} amigos"
        
    pending_id = repository.get_pending_request_id(addressee_id, requester_id)
    if pending_id:
        ok = repository.respond_request(pending_id, requester_id, 'accepted')
        if ok:
            return {"ok": True, "auto_accepted": True}, None
        else:
            return None, "Error al aceptar automáticamente la solicitud"

    if repository.has_pending_request(requester_id, addressee_id):
        return None, "Ya enviaste una solicitud a este usuario"
        
    ok = repository.send_request(requester_id, addressee_id)
    if ok:
        return {"ok": True}, None
    return None, "No se pudo enviar la solicitud"


def accept_request(request_id, user_id):
    user_friends = repository.get_friends(user_id)
    if len(user_friends) >= MAX_FRIENDS:
        return False, f"Has alcanzado el límite máximo de {MAX_FRIENDS} amigos"
        
    ok = repository.respond_request(request_id, user_id, 'accepted')
    return ok, "Solicitud aceptada" if ok else "No se pudo aceptar"


def reject_request(request_id, user_id):
    ok = repository.respond_request(request_id, user_id, 'rejected')
    return ok, "Solicitud rechazada" if ok else "No se pudo rechazar"


def cancel_request(request_id, user_id):
    ok = repository.delete_request(request_id, user_id)
    return ok, "Solicitud cancelada" if ok else "No se pudo cancelar"


def get_request_users(request_id):
    return repository.get_request_users(request_id)


def remove_friend(user_id, friend_id):
    ok = repository.remove_friendship(user_id, friend_id)
    return ok, "Amigo eliminado" if ok else "No se pudo eliminar"


def search_users_for_friend(query, user_id):
    users = repository.search_users(query, user_id)
    result = []
    for u in users:
        result.append({
            'user_id': u['user_id'],
            'username': u['username'],
            'is_friend': repository.are_friends(user_id, u['user_id']),
            'has_pending': repository.has_pending_request(user_id, u['user_id']),
            'last_activity': sess.get_last_activity(u['username']),
        })
    return result


def remove_friend(user_id, friend_id):
    return repository.remove_friendship(user_id, friend_id)
