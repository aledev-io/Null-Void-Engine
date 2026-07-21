import time
import threading
from datetime import datetime, timezone
from core.database import get_db

class MailScheduler:
    """
    Monitor de correos programados en segundo plano.
    Envía los correos programados cuya fecha ya se ha cumplido.
    """
    def __init__(self):
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            if hasattr(self, 'thread') and self.thread.is_alive() and not self._stop_event.is_set():
                return
            
            self._stop_event.clear()
            self.thread = threading.Thread(target=self._loop, daemon=True, name="MailScheduler")
            self.thread.start()
            print("[MailScheduler] Sistema de envío programado iniciado.")

    def stop(self):
        self._stop_event.set()
        print("[MailScheduler] Sistema de envío programado detenido.")

    def _loop(self):
        if self._stop_event.wait(5):
            return

        while not self._stop_event.is_set():
            try:
                self._check_scheduled_emails()
            except Exception as e:
                print(f"[MailScheduler] Error en el bucle: {e}")
            
            if self._stop_event.wait(60):
                break

    def _check_scheduled_emails(self):
        now = datetime.now(timezone.utc)
        
        try:
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT * FROM internal_mail WHERE folder = 'scheduled'"
                ).fetchall()

                for row in rows:
                    try:
                        dt_str = row['created_at'].replace('Z', '+00:00')
                        dt = datetime.fromisoformat(dt_str)
                        
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                            
                        if dt <= now:
                            self._send_email(row, conn)
                    except ValueError:
                        print(f"[MailScheduler] Formato de fecha inválido para correo {row['id']}: {row['created_at']}")
                        continue
        except Exception as e:
            print(f"[MailScheduler] Error crítico en _check_scheduled_emails: {e}")

    def _send_email(self, row, conn):
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        from modules.api.mail import ALIAS_SMTP_HOST, ALIAS_SMTP_PORT
        
        from_email = row['from_email']
        to_email = row['to_email']
        
        try:
            if "@nullvoid" in from_email or "@null-void.com" in from_email:
                conn.execute("UPDATE internal_mail SET folder = 'sent' WHERE id = ?", (row['id'],))
                recipient = conn.execute("SELECT username FROM users WHERE username = ? OR email = ?", (to_email, to_email)).fetchone()
                if recipient:
                    import uuid
                    now_str = datetime.now(timezone.utc).isoformat() + "Z"
                    conn.execute("""
                        INSERT INTO internal_mail (id, user_id, folder, subject, from_email, to_email, body_plain, body_html, is_read, created_at)
                        VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?, 0, ?)
                    """, (str(uuid.uuid4()), recipient['username'], row['subject'], row['from_email'], row['to_email'], row['body_plain'], row['body_html'], now_str))
            else:
                from modules.api.mail import get_google_credentials
                user_id = row['user_id']
                gmail_user, gmail_pass = get_google_credentials(user_id)
                
                if not gmail_user or not gmail_pass:
                    print(f"[MailScheduler] Credenciales no configuradas para el usuario {user_id}")
                    return
                
                msg = MIMEMultipart()
                msg['From'] = gmail_user
                msg['To'] = to_email
                msg['Subject'] = row['subject'] or ""
                msg.attach(MIMEText(row['body_html'] or row['body_plain'] or "", 'html'))
                
                use_alias = bool(ALIAS_SMTP_HOST and ALIAS_SMTP_PORT)
                smtp_host = ALIAS_SMTP_HOST if use_alias else 'smtp.gmail.com'
                smtp_port = ALIAS_SMTP_PORT if use_alias else 587
                
                if use_alias and ALIAS_SMTP_PORT == 465:
                    server = smtplib.SMTP_SSL(smtp_host, smtp_port)
                else:
                    server = smtplib.SMTP(smtp_host, smtp_port)
                    server.starttls()

                server.login(gmail_user, gmail_pass)
                server.send_message(msg)
                server.quit()
                
                conn.execute("DELETE FROM internal_mail WHERE id = ?", (row['id'],))
                
            conn.commit()
            print(f"[MailScheduler] Correo {row['id']} programado enviado correctamente a {to_email}")
        except Exception as e:
            print(f"[MailScheduler] Error enviando correo programado {row['id']}: {e}")

mail_scheduler = MailScheduler()
