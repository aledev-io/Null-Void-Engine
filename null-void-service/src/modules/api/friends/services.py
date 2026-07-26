from . import repository
from modules.session import session as sess


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


def send_friend_request(requester_id, addressee_id):
    if requester_id == addressee_id:
        return None, "No puedes enviarte solicitud a ti mismo"
    if repository.are_friends(requester_id, addressee_id):
        return None, "Ya sois amigos"
        
    # Check if the other user already sent a request to this user
    pending_id = repository.get_pending_request_id(addressee_id, requester_id)
    if pending_id:
        # Auto-accept the reciprocal request
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
