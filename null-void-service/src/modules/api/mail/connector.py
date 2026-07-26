import imaplib
import os
import re
import smtplib
from email.header import decode_header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from core.database import get_db

IMAP_SERVER = "imap.gmail.com"

ALIAS_SMTP_HOST = os.environ.get("ALIAS_SMTP_HOST", "smtp.gmail.com")
try:
    ALIAS_SMTP_PORT = int(os.environ.get("ALIAS_SMTP_PORT", "587"))
except (ValueError, TypeError):
    ALIAS_SMTP_PORT = 587

FOLDER_NAMES = {
    "inbox":      "Recibidos",
    "starred":    "Destacados",
    "sent":       "Enviados",
    "drafts":     "Borradores",
    "important":  "Importantes",
    "scheduled":  "Programados",
    "all":        "Todos",
    "spam":       "Spam",
    "trash":      "Papelera",
}

_FLAG_TO_ID = {
    "\\Flagged":   "starred",
    "\\Sent":      "sent",
    "\\Drafts":    "drafts",
    "\\Important": "important",
    "\\All":       "all",
    "\\Junk":      "spam",
    "\\Trash":     "trash",
}

_NAME_FALLBACKS = {
    "spam": "spam", "junk": "spam",
    "trash": "trash", "papelera": "trash", "bin": "trash",
    "sent": "sent", "sent mail": "sent", "enviados": "sent",
    "drafts": "drafts", "borradores": "drafts",
    "scheduled": "scheduled", "programados": "scheduled",
    "starred": "starred", "destacados": "starred",
    "important": "important", "importantes": "important",
    "all mail": "all", "todos": "all", "todo el correo": "all",
}


def decode_mime_words(s):
    if not s:
        return ""
    decoded_words = decode_header(s)
    result = []
    for word, charset in decoded_words:
        if isinstance(word, bytes):
            try:
                result.append(word.decode(charset or 'utf-8'))
            except Exception:
                result.append(word.decode('utf-8', errors='replace'))
        else:
            result.append(word)
    return "".join(result)


def get_google_credentials(user_id, email=None):
    with get_db() as db:
        if email:
            row = db.execute(
                "SELECT email, app_password FROM user_google_accounts WHERE user_id = ? AND email = ?",
                (user_id, email)
            ).fetchone()
        else:
            row = db.execute(
                "SELECT email, app_password FROM user_google_accounts WHERE user_id = ? LIMIT 1",
                (user_id,)
            ).fetchone()
            
        if row and row['email'] and row['app_password']:
            return row['email'], row['app_password']
            
        # Fallback to users table just in case migration hasn't run
        row = db.execute(
            "SELECT gmail_address, gmail_app_password FROM users WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        if row and row['gmail_address'] and row['gmail_app_password']:
            if not email or row['gmail_address'] == email:
                return row['gmail_address'], row['gmail_app_password']
                
    return None, None


def connect_imap(user_id, email=None):
    gmail_user, gmail_pass = get_google_credentials(user_id, email)
    if not gmail_user or not gmail_pass:
        raise Exception("Credenciales de Google no configuradas para este usuario o cuenta.")
    mail = imaplib.IMAP4_SSL(IMAP_SERVER)
    mail.login(gmail_user, gmail_pass)
    return mail


def discover_folders(mail):
    folder_map = {"inbox": "INBOX"}
    status, folder_list = mail.list()
    if status != 'OK':
        return folder_map

    for item in folder_list:
        if not item:
            continue
        line = item.decode('utf-8', errors='replace') if isinstance(item, bytes) else str(item)
        match = re.match(r'\(([^)]*)\)\s+"([^"]*)"\s+"?([^"]*)"?', line)
        if not match:
            match = re.match(r'\(([^)]*)\)\s+"([^"]*)"\s+(.*)', line)
        if not match:
            continue

        flags_str = match.group(1)
        folder_name = match.group(3).strip().strip('"')

        matched = False
        for flag, folder_id in _FLAG_TO_ID.items():
            if flag in flags_str:
                folder_map[folder_id] = folder_name
                matched = True
                break

        if not matched:
            basename = folder_name.rsplit("/", 1)[-1].strip()
            basename_lower = basename.lower()
            if basename_lower in _NAME_FALLBACKS:
                fid = _NAME_FALLBACKS[basename_lower]
                if fid not in folder_map:
                    folder_map[fid] = folder_name
            else:
                fid = f"custom_{basename_lower.replace(' ', '_')}"
                if fid not in folder_map:
                    folder_map[fid] = folder_name

    return folder_map


def select_folder(mail, folder_key, folder_map=None, readonly=True):
    if folder_map is None:
        folder_map = discover_folders(mail)
    imap_folder = folder_map.get(folder_key)
    if not imap_folder:
        return 'NO', folder_map
    status, data = mail.select(f'"{imap_folder}"', readonly=readonly)
    return status, folder_map


def send_via_smtp(gmail_user, gmail_pass, to_email, subject, body, files):
    msg = MIMEMultipart()
    msg['From'] = gmail_user
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'html'))

    for f in files:
        if f.filename:
            file_data = f.read()
            part = MIMEApplication(file_data, Name=f.filename)
            part['Content-Disposition'] = f'attachment; filename="{f.filename}"'
            msg.attach(part)
            f.seek(0)

    use_alias = bool(ALIAS_SMTP_HOST and ALIAS_SMTP_PORT)
    smtp_host = ALIAS_SMTP_HOST if use_alias else 'smtp.gmail.com'
    smtp_port = ALIAS_SMTP_PORT if use_alias else 587
    smtp_user = gmail_user
    smtp_pass = gmail_pass

    server = None
    try:
        if use_alias and ALIAS_SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10.0)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10.0)
            server.starttls()

        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
    finally:
        if server:
            try:
                server.quit()
            except Exception:
                pass