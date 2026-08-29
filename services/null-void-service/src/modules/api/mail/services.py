import email
import os
import re
import uuid
from email.header import decode_header
from datetime import datetime, timezone

from core.database import get_db
from . import connector, repository
from .connector import FOLDER_NAMES


def get_user_email(username):
    return f"{username}@nullvoid"


def get_recipient_id(to_email):
    # Support 'username@nullvoid' internal email format
    clean_username = to_email.split('@nullvoid')[0] if '@nullvoid' in to_email else to_email
    
    with get_db() as db:
        row = db.execute(
            "SELECT user_id FROM users WHERE username = ? OR email = ?",
            (clean_username, to_email)
        ).fetchone()
        return row['user_id'] if row else None


import time

_imap_cache = {}
CACHE_TTL = 60

def _get_from_cache(key):
    if key in _imap_cache:
        timestamp, data = _imap_cache[key]
        if time.time() - timestamp < CACHE_TTL:
            return data
        else:
            del _imap_cache[key]
    return None

def _set_in_cache(key, data):
    _imap_cache[key] = (time.time(), data)

def get_folders(user_id, mode, force_refresh=False, google_email=None):
    if mode == 'internal':
        unread_map = repository.get_internal_folders_with_unread(user_id)
        all_custom = repository.get_internal_all_folders(user_id)
        
        result = [
            {"id": fid, "name": fname, "unread": unread_map.get(fid, 0), "total": 0}
            for fid, fname in FOLDER_NAMES.items()
        ]
        
        for c_folder in all_custom:
            if c_folder not in FOLDER_NAMES:
                result.append({
                    "id": c_folder, 
                    "name": c_folder, 
                    "unread": unread_map.get(c_folder, 0), 
                    "total": 0
                })
        return result

    cache_key = f"folders_{user_id}_{google_email}"
    if not force_refresh:
        cached_data = _get_from_cache(cache_key)
        if cached_data is not None:
            return cached_data

    mail = connector.connect_imap(user_id, google_email)
    folder_map = connector.discover_folders(mail)
    folders_data = []

    for key, imap_folder in folder_map.items():
        name = FOLDER_NAMES.get(key) or imap_folder.rsplit("/", 1)[-1].strip()
        unread = 0
        total = 0
        try:
            status_code, status_data = mail.status(f'"{imap_folder}"', "(MESSAGES UNSEEN)")
            if status_code == 'OK' and status_data[0]:
                status_str = status_data[0].decode('utf-8', errors='ignore')
                m_match = re.search(r'MESSAGES\s+(\d+)', status_str, re.IGNORECASE)
                u_match = re.search(r'UNSEEN\s+(\d+)', status_str, re.IGNORECASE)
                if m_match:
                    total = int(m_match.group(1))
                if u_match:
                    unread = int(u_match.group(1))
        except Exception:
            pass
        folders_data.append({"id": key, "name": name, "unread": unread, "total": total})

    if not any(f['id'] == 'scheduled' for f in folders_data):
        folders_data.append({
            "id": "scheduled", "name": FOLDER_NAMES["scheduled"], "unread": 0, "total": 0,
        })

    mail.logout()
    _set_in_cache(cache_key, folders_data)
    return folders_data


def get_emails(user_id, folder, mode, force_refresh=False, google_email=None, page=1, limit=50):
    if mode == 'internal':
        rows, has_more = repository.get_internal_emails(user_id, folder, page, limit)
        threads = {}
        for r in rows:
            s = str(r['subject'] or '').lower()
            s = re.sub(r'^(re|fwd|fw|rv):\s*', '', s).strip()
            thread_id = s or '(sin asunto)'
            
            if thread_id not in threads:
                threads[thread_id] = {
                    "id": [], "subject": r['subject'], "from": r['from_email'],
                    "to": r['to_email'], "date": r['created_at'],
                    "read": bool(r['is_read']), "starred": bool(r['is_starred']),
                    "thread_count": 0
                }
            threads[thread_id]["id"].append(str(r['id']))
            threads[thread_id]["thread_count"] += 1
            if not bool(r['is_read']):
                threads[thread_id]["read"] = False
            if bool(r['is_starred']):
                threads[thread_id]["starred"] = True
                
        for t in threads.values():
            t["id"] = ",".join(t["id"])
        thread_list = list(threads.values())
        # Si hay menos threads que el límite pedido, ya no hay más páginas
        if len(thread_list) < limit:
            has_more = False
        return {"emails": thread_list, "has_more": has_more}

    if folder == 'scheduled':
        rows, has_more = repository.get_internal_emails(user_id, 'scheduled', page, limit)
        return {"emails": [{
            "id": str(r["id"]), "subject": r["subject"], "from": r["from_email"],
            "to": r["to_email"], "date": r["created_at"], "read": True, "starred": False, "thread_count": 1
        } for r in rows], "has_more": has_more}

    cache_key = f"emails_{user_id}_{google_email}_{folder}"
    if not force_refresh:
        cached_data = _get_from_cache(cache_key)
        if cached_data is not None:
            return cached_data

    mail = connector.connect_imap(user_id, google_email)
    status, folder_map = connector.select_folder(mail, folder)
    if status != 'OK':
        mail.logout()
        return []

    try:
        status, messages = mail.sort('REVERSE DATE', 'UTF-8', 'ALL')
        is_sorted = status == 'OK'
        if not is_sorted:
            status, messages = mail.search(None, "ALL")
    except:
        status, messages = mail.search(None, "ALL")
        is_sorted = False

    email_ids = messages[0].split() if messages[0] else []
    total = len(email_ids)
    
    if is_sorted:
        start = (page - 1) * limit
        end = page * limit
        latest_ids = email_ids[start:end]
        has_more = end < total
    else:
        start = max(0, total - page * limit)
        end = total - (page - 1) * limit
        if end <= 0:
            latest_ids = []
        else:
            latest_ids = email_ids[start:end]
            latest_ids.reverse()
        has_more = start > 0

    parsed_msgs = {}
    if latest_ids:
        ids_str = b",".join(latest_ids)
        try:
            res, msg_data = mail.fetch(ids_str, "(X-GM-THRID RFC822.SIZE FLAGS BODY[HEADER.FIELDS (SUBJECT FROM TO DATE)])")
            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    flags_raw = response_part[0].decode(errors='replace')
                    msg = email.message_from_bytes(response_part[1])
                    
                    e_id_match = re.match(r'^(\d+)', flags_raw)
                    if e_id_match:
                        parsed_msgs[e_id_match.group(1)] = (flags_raw, msg)
        except Exception:
            pass

    threads = {}
    for e_id in latest_ids:
        e_id_str = e_id.decode()
        if e_id_str not in parsed_msgs:
            continue
            
        flags_raw, msg = parsed_msgs[e_id_str]
        m = re.search(r'X-GM-THRID (\d+)', flags_raw)
        thread_id = m.group(1) if m else e_id_str
        
        is_read = "\\Seen" in flags_raw
        is_starred = "\\Flagged" in flags_raw

        if thread_id not in threads:
            threads[thread_id] = {
                "id": [],
                "subject": connector.decode_mime_words(msg.get("Subject", "")),
                "from": connector.decode_mime_words(msg.get("From", "")),
                "to": connector.decode_mime_words(msg.get("To", "")),
                "date": connector.decode_mime_words(msg.get("Date", "")),
                "read": is_read,
                "starred": is_starred,
                "thread_count": 0
            }
        threads[thread_id]["id"].append(e_id_str)
        threads[thread_id]["thread_count"] += 1
        
        if not is_read:
            threads[thread_id]["read"] = False
        if is_starred:
            threads[thread_id]["starred"] = True

    for t in threads.values():
        t["id"] = ",".join(t["id"])
        
    emails_data = list(threads.values())
    mail.close()
    mail.logout()
    
    result = {"emails": emails_data, "has_more": has_more, "total_raw": total}
    if page == 1:
        _set_in_cache(cache_key, result)
        
    return result


def send_email(user_id, username, to_email, subject, body, files, mode, is_scheduled, scheduled_at, google_email=None):
    if is_scheduled and scheduled_at:
        try:
            dt = datetime.fromisoformat(scheduled_at.replace('Z', '+00:00'))
            if dt < datetime.now(timezone.utc):
                raise ValueError("La fecha de programación no puede estar en el pasado.")
        except ValueError as e:
            if "La fecha" in str(e):
                raise
            raise ValueError("Formato de fecha inválido.")

    if mode == 'internal':
        from_email = get_user_email(username)
        recipient_id = get_recipient_id(to_email)
        if not recipient_id:
            raise Exception(
                "El destinatario no existe en la red interna. "
                "Cambia al Modo Google para enviar correos externos."
            )

        if is_scheduled and scheduled_at:
            repository.save_scheduled_mail(user_id, subject, from_email, to_email, body, scheduled_at, files)
        else:
            repository.save_sent_and_inbox(user_id, subject, from_email, to_email, body, recipient_id, files)
        return

    gmail_user, gmail_pass = connector.get_google_credentials(user_id, google_email)
    if not gmail_user or not gmail_pass:
        raise Exception("Credenciales no configuradas para Modo Google.")

    if is_scheduled and scheduled_at:
        repository.save_scheduled_gmail_entry(user_id, subject, gmail_user, to_email, body, scheduled_at)
        return

    connector.send_via_smtp(gmail_user, gmail_pass, to_email, subject, body, files)


# Ownership del bucle de envío programado (antes en core/mail_scheduler.py).
# El scheduler de core solo dispara este servicio; el dominio Mail posee la
# lectura de internal_mail, la evaluación de due-time, la resolución de
# destinatario interno, las transiciones de estado y el transporte SMTP.

def _parse_scheduled_dt(created_at):
    """Interpreta created_at (hora programada) como datetime timezone-aware."""
    dt_str = (created_at or '').replace('Z', '+00:00')
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _dispatch_scheduled_row(conn, row):
    """Despacha una fila programada concreta (un commit por fila exitosa).

    - Interna (@nullvoid / @null-void.com): scheduled -> sent (remitente) y
      scheduled -> inbox (destinatario).
    - Externa: scheduled -> eliminada solo tras un envío SMTP exitoso.
    - Fallo o credenciales ausentes: no commit -> la fila permanece 'scheduled'
      (se reintenta en el siguiente ciclo). No existe estado de fallo explícito.
    Devuelve True si el despacho fue exitoso y committeado."""
    from_email = row['from_email']
    to_email = row['to_email']
    try:
        if "@nullvoid" in from_email or "@null-void.com" in from_email:
            conn.execute("UPDATE internal_mail SET folder = 'sent' WHERE id = ?", (row['id'],))
            recipient = conn.execute(
                "SELECT username FROM users WHERE username = ? OR email = ?", (to_email, to_email)
            ).fetchone()
            if recipient:
                now_str = datetime.now(timezone.utc).isoformat() + "Z"
                conn.execute(
                    "INSERT INTO internal_mail (id, user_id, folder, subject, from_email, to_email, body_plain, body_html, is_read, created_at) "
                    "VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?, 0, ?)",
                    (str(uuid.uuid4()), recipient['username'], row['subject'], row['from_email'],
                     row['to_email'], row['body_plain'], row['body_html'], now_str)
                )
        else:
            user_id = row['user_id']
            gmail_user, gmail_pass = connector.get_google_credentials(user_id)

            if not gmail_user or not gmail_pass:
                print(f"[MailScheduler] Credenciales no configuradas para el usuario {user_id}")
                return False

            connector.send_via_smtp(
                gmail_user, gmail_pass, to_email,
                row['subject'] or "",
                row['body_html'] or row['body_plain'] or "",
                files=[],
            )
            conn.execute("DELETE FROM internal_mail WHERE id = ?", (row['id'],))

        conn.commit()
        print(f"[MailScheduler] Correo {row['id']} programado enviado correctamente a {to_email}")
        return True
    except Exception as e:
        print(f"[MailScheduler] Error enviando correo programado {row['id']}: {e}")
        return False


def dispatch_scheduled_emails(now=None):
    """Despacha los correos programados cuya hora (created_at) ya se cumplió.

    Encapsula el bucle de despacho del correo programado. `now` por defecto es
    la hora actual UTC; se evalúa una sola vez para todo el ciclo.
    Retorna el número de correos despachados y committeados con éxito."""
    if now is None:
        now = datetime.now(timezone.utc)
    dispatched = 0
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM internal_mail WHERE folder = 'scheduled'"
            ).fetchall()

            for row in rows:
                try:
                    dt = _parse_scheduled_dt(row['created_at'])
                except ValueError:
                    print(f"[MailScheduler] Formato de fecha inválido para correo {row['id']}: {row['created_at']}")
                    continue

                if dt <= now:
                    if _dispatch_scheduled_row(conn, row):
                        dispatched += 1
    except Exception as e:
        print(f"[MailScheduler] Error crítico en dispatch_scheduled_emails: {e}")
    return dispatched


def read_email(user_id, folder, msg_id, mode, google_email=None):
    if mode == 'internal' or folder == 'scheduled':
        row = repository.get_internal_email_by_id(user_id, msg_id)
        if not row:
            return None

        if folder == 'inbox' and not row['is_read']:
            repository.mark_as_read(user_id, msg_id)

        attachments = repository.get_attachments_for_mail(row['id'])

        return {
            "id": row['id'],
            "subject": row['subject'],
            "from": row.get('sender_address') or row.get('from_email', ''),
            "to": row.get('recipient_address') or row.get('to_email', ''),
            "date": row['created_at'],
            "body_html": row['body_html'] or row['body_plain'],
            "body_plain": row['body_plain'] or "",
            "attachments": attachments,
            "sent_by": "nullvoid",
            "signed_by": "nullvoid",
            "security": "Encriptación local (AES)",
        }

    mail = connector.connect_imap(user_id, google_email)
    status, folder_map = connector.select_folder(mail, folder, readonly=False)
    if status != 'OK':
        mail.logout()
        return None

    res, msg_data = mail.fetch(msg_id.encode(), "(RFC822)")
    if res != 'OK':
        mail.logout()
        return None

    result = None
    for response_part in msg_data:
        if not isinstance(response_part, tuple):
            continue
        msg = email.message_from_bytes(response_part[1])

        subject = connector.decode_mime_words(msg.get("Subject", ""))
        from_ = connector.decode_mime_words(msg.get("From", ""))
        to_ = connector.decode_mime_words(msg.get("To", ""))
        date_ = connector.decode_mime_words(msg.get("Date", ""))

        body_html = ""
        body_plain = ""
        attachments = []

        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_maintype() == 'multipart':
                    continue
                ct = part.get_content_type()
                cd = str(part.get("Content-Disposition"))
                filename = part.get_filename()

                try:
                    if filename or "attachment" in cd:
                        payload = part.get_payload(decode=True)
                        if payload:
                            att_id = str(uuid.uuid4())
                            file_path = os.path.join(repository.ATTACHMENTS_DIR, att_id)
                            with open(file_path, 'wb') as f:
                                f.write(payload)
                            attachments.append({
                                "id": att_id,
                                "filename": connector.decode_mime_words(filename),
                                "content_type": ct,
                                "size": len(payload),
                            })
                    else:
                        charset = part.get_content_charset() or 'utf-8'
                        payload = part.get_payload(decode=True)
                        if payload:
                            decoded = payload.decode(charset, errors='replace')
                            if ct == "text/plain":
                                body_plain += decoded
                            elif ct == "text/html":
                                body_html += decoded
                except Exception:
                    pass
        else:
            ct = msg.get_content_type()
            try:
                charset = msg.get_content_charset() or 'utf-8'
                payload = msg.get_payload(decode=True)
                if payload:
                    decoded = payload.decode(charset, errors='replace')
                    if ct == "text/plain":
                        body_plain = decoded
                    elif ct == "text/html":
                        body_html = decoded
            except Exception:
                pass

        sent_by, signed_by, security = _analyze_security(msg)

        result = {
            "id": msg_id,
            "subject": subject,
            "from": from_,
            "to": to_,
            "date": date_,
            "body_html": body_html,
            "body_plain": body_plain,
            "attachments": attachments,
            "sent_by": sent_by,
            "signed_by": signed_by,
            "security": security,
        }

    mail.close()
    mail.logout()
    return result


def _analyze_security(msg):
    sent_by = ""
    signed_by = ""
    security = "Estándar"

    dkim = msg.get("DKIM-Signature", "")
    if dkim:
        m = re.search(r'd=([^;\s]+)', dkim)
        if m:
            signed_by = m.group(1)

    if not signed_by:
        auth_res = msg.get("Authentication-Results", "")
        if "dkim=pass" in auth_res.lower():
            m = re.search(r'header\.d=([^;\s]+)', auth_res)
            if m:
                signed_by = m.group(1)

    sender = msg.get("Sender", "")
    return_path = msg.get("Return-Path", "")
    msg_id = msg.get("Message-ID", "")

    if sender:
        m = re.search(r'@([a-zA-Z0-9.-]+)', sender)
        if m:
            sent_by = m.group(1)
    if not sent_by and return_path:
        m = re.search(r'@([a-zA-Z0-9.-]+)', return_path)
        if m:
            sent_by = m.group(1)
    if not sent_by and msg_id:
        m = re.search(r'@([a-zA-Z0-9.-]+)', msg_id)
        if m:
            sent_by = m.group(1)

    received_headers = msg.get_all("Received") or []
    is_secure = False
    for r in received_headers:
        r_upper = r.upper()
        if "TLS" in r_upper or "SSL" in r_upper or "ESMTPS" in r_upper or "HTTPS" in r_upper:
            is_secure = True
            break

    if is_secure or (sent_by and "gmail.com" in sent_by.lower()):
        security = "Encriptación estándar (TLS)"
    else:
        security = "No encriptado"

    return sent_by, signed_by, security


def clear_user_cache(user_id):
    keys_to_delete = [k for k in _imap_cache.keys() if k.startswith(f"folders_{user_id}") or k.startswith(f"emails_{user_id}_")]
    for k in keys_to_delete:
        del _imap_cache[k]


def toggle_star(user_id, folder, msg_id, star, mode, google_email=None):
    if mode == 'internal' or folder == 'scheduled':
        repository.toggle_star_internal(msg_id, user_id, star)
        return

    mail = connector.connect_imap(user_id, google_email)
    status, folder_map = connector.select_folder(mail, folder, readonly=False)
    if status != 'OK':
        mail.logout()
        raise Exception("Carpeta no disponible.")

    flag_action = '+FLAGS' if star else '-FLAGS'
    res, _ = mail.store(msg_id.encode(), flag_action, '\\Flagged')
    mail.close()
    mail.logout()

    if res != 'OK':
        raise Exception("No se pudo modificar en el servidor")
    clear_user_cache(user_id)


def bulk_action(user_id, folder, action, msg_ids, mode, google_email=None):
    actual_ids = []
    for m in msg_ids:
        if isinstance(m, str) and ',' in m:
            actual_ids.extend(m.split(','))
        else:
            actual_ids.append(m)
    
    if mode == 'internal' or folder == 'scheduled':
        repository.bulk_action_internal(action, actual_ids, user_id)
        return

    mail = connector.connect_imap(user_id, google_email)
    status, folder_map = connector.select_folder(mail, folder, readonly=False)
    if status != 'OK':
        mail.logout()
        raise Exception("Carpeta no disponible.")

    target = None
    if action in folder_map:
        target = folder_map[action]
    if not target:
        if action == 'archive':
            target = folder_map.get('all')
        elif action == 'unarchive':
            target = folder_map.get('inbox')
        elif action == 'trash':
            target = folder_map.get('trash')
        elif action == 'spam':
            target = folder_map.get('spam')

    needs_expunge = False
    for msg_id in actual_ids:
        mid = str(msg_id).encode()
        if action in ('archive', 'trash', 'spam', 'unarchive') and target:
            mail.copy(mid, f'"{target}"')
            if not (folder == 'all' and action == 'unarchive'):
                mail.store(mid, '+FLAGS', '\\Deleted')
            needs_expunge = True
        elif action in ('delete', 'trash'):
            mail.store(mid, '+FLAGS', '\\Deleted')
            needs_expunge = True
        elif action == 'unread':
            mail.store(mid, '-FLAGS', '\\Seen')
        elif action == 'read':
            mail.store(mid, '+FLAGS', '\\Seen')

    if needs_expunge:
        mail.expunge()

    mail.close()
    mail.logout()
    clear_user_cache(user_id)

def empty_trash(user_id, mode, google_email=None):
    if mode == 'internal':
        repository.empty_trash_internal(user_id)
        return

    mail = connector.connect_imap(user_id, google_email)
    status, folder_map = connector.select_folder(mail, 'trash', readonly=False)
    if status != 'OK':
        mail.logout()
        return

    mail.store("1:*", '+FLAGS', '\\Deleted')
    mail.expunge()

    mail.close()
    mail.logout()
    clear_user_cache(user_id)



def verify_credentials(email_addr, app_password):
    import imaplib
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(email_addr, app_password)
    mail.logout()


def save_credentials(user_id, email_addr, app_password):
    from core.crypto_utils import encrypt_field
    encrypted = encrypt_field(app_password)
    with get_db() as db:
        row = db.execute("SELECT id FROM user_google_accounts WHERE user_id = ? AND email = ?", (user_id, email_addr)).fetchone()
        if row:
            db.execute("UPDATE user_google_accounts SET app_password = ? WHERE id = ?", (encrypted, row['id']))
        else:
            db.execute("INSERT INTO user_google_accounts (user_id, email, app_password) VALUES (?, ?, ?)", (user_id, email_addr, encrypted))
        db.commit()

def remove_credentials(user_id, email_addr):
    with get_db() as db:
        db.execute("DELETE FROM user_google_accounts WHERE user_id = ? AND email = ?", (user_id, email_addr))
        db.commit()

def get_config(user_id, username):
    accounts = []
    with get_db() as db:
        rows = db.execute("SELECT email FROM user_google_accounts WHERE user_id = ?", (user_id,)).fetchall()
        for row in rows:
            accounts.append({"email": row["email"]})
            
        if not accounts:
            # Fallback legacy
            row = db.execute("SELECT gmail_address FROM users WHERE user_id = ?", (user_id,)).fetchone()
            if row and row['gmail_address']:
                accounts.append({"email": row["gmail_address"]})

    internal_email = f"{username}@nullvoid"
    return {
        "ok": True,
        "configured": len(accounts) > 0,
        "accounts": accounts,
        "email": accounts[0]["email"] if accounts else None,  # For backward compatibility
        "internal_email": internal_email,
        "username": username,
    }


def get_attachment_path(att_id):
    file_path = os.path.join(repository.ATTACHMENTS_DIR, att_id)
    if not os.path.exists(file_path):
        return None
    return file_path
