import time
import threading
import subprocess
import os
import json
import hashlib
import platform
from datetime import datetime
from typing import List, Optional, Protocol
from core.database import get_db, DB_PATH

try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None

from core.webpush_utils import get_or_create_vapid_keys, get_vapid_claims

HISTORY_PATH = os.path.join(os.path.dirname(DB_PATH), 'notifications_history.json')

class ReminderSource(Protocol):
    """Port: origen de recordatorios de eventos.

    Core posee el mecanismo de notificación y solo necesita saber que existe
    una fuente capaz de devolver los recordatorios próximos a notificar.
    La implementación real vive en la aplicación y se inyecta desde la capa
    de bootstrap; core no importa el dominio de eventos.
    """
    def upcoming_reminder_events(self) -> List[dict]:
        """Devuelve las filas de eventos con recordatorios pendientes."""
        ...

class SystemNotifier:
    """
    Monitor de eventos en segundo plano que envía notificaciones nativas de Linux
    usando el comando 'notify-send'. Funciona independientemente del navegador.
    """
    def __init__(self, reminder_source: Optional[ReminderSource] = None):
        self.notified_ids = set()
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        # Fuente de recordatorios inyectada desde la capa de composición.
        self.reminder_source = reminder_source

    def start(self):
        with self._lock:
            if hasattr(self, 'thread') and self.thread.is_alive() and not self._stop_event.is_set():
                return
            
            self._stop_event.clear()
            self.thread = threading.Thread(target=self._loop, daemon=True, name="EventNotifier")
            self.thread.start()
            print("[Notifier] Sistema de notificaciones nativas iniciado.")

    def stop(self):
        """Detiene el bucle de notificaciones de forma segura."""
        self._stop_event.set()
        print("[Notifier] Sistema de notificaciones detenido.")

    def _loop(self):
        # Pequeña pausa inicial para dejar que el sistema arranque
        # Si se activa el stop_event durante la espera, salimos
        if self._stop_event.wait(5):
            return

        while not self._stop_event.is_set():
            try:
                self._check_events()
            except Exception as e:
                print(f"[Notifier] Error en el bucle: {e}")
            
            # Esperar 60 segundos o hasta que se pida detener (interrumpible)
            if self._stop_event.wait(60):
                break

    def _check_events(self):
        now = datetime.now()

        # Limpiar IDs periódicamente para evitar crecimiento infinito
        if now.hour == 0 and now.minute == 0:
            self.notified_ids.clear()

        try:
            # Los recordatorios llegan a través del port ReminderSource,
            # inyectado por la capa de bootstrap; core no importa Events.
            if self.reminder_source is None:
                return
            rows = self.reminder_source.upcoming_reminder_events()

            for row in rows:
                ev_id = row['id']
                try:
                    ev_dt = datetime.strptime(f"{row['date']} {row['start_time']}", "%Y-%m-%d %H:%M")
                    diff_minutes = int((ev_dt - now).total_seconds() / 60)

                    if diff_minutes < -1:
                        continue

                    reminders_json = row['reminders']
                    reminders = json.loads(reminders_json) if reminders_json else [0]
                    if not reminders: reminders = [0]

                    for reminder_minutes in reminders:
                        if 0 <= diff_minutes <= reminder_minutes:
                            # Lógica de repetición:
                            # Si faltan <= 10 min o es el momento del evento (reminder 0), 
                            # repetimos cada 2 minutos para que sea "persistente".
                            if diff_minutes <= 10 or reminder_minutes == 0:
                                import math
                                interval_bucket = math.floor(time.time() / 120) 
                                notify_key = f"{ev_id}:{reminder_minutes}:rep_{interval_bucket}"
                            else:
                                # Recordatorios lejanos (ej: 1 hora antes) solo suenan una vez
                                notify_key = f"{ev_id}:{reminder_minutes}"

                            if notify_key in self.notified_ids:
                                continue

                            # Si es un recordatorio puntual (no persistente), 
                            # solo lo lanzamos si estamos en el minuto exacto (o se acaba de pasar)
                            # para evitar que un recordatorio de "1 día" suene cada minuto del día.
                            if "rep_" not in notify_key and (reminder_minutes - diff_minutes) > 1:
                                continue

                            self._send_system_notification(
                                row['title'], 
                                f"{row['date']} {row['start_time']}", 
                                diff_minutes, 
                                row['description'],
                                row['category']
                            )
                            self.notified_ids.add(notify_key)
                            
                            user_id = row['user_id'] or 'admin'
                            self._add_to_history(row['title'], row['date'], row['start_time'], row['description'], row['category'], user_id)

                except (ValueError, json.JSONDecodeError) as e:
                    print(f"[Notifier] Error procesando evento {ev_id}: {e}")
                    continue
        except Exception as e:
            print(f"[Notifier] Error crítico en _check_events: {e}")

    def _entry_id(self, category, title, date, time_val, user_id, sender_id=None):
        """ID estable de la notificación, independiente de su timestamp.

        Para chat identifica el hilo remitente→usuario: al agrupar un mensaje
        nuevo la entrada conserva su ID y el estado "leído" del navegador
        sigue siendo válido (antes cambiaba el timestamp y la notificación
        reaparecía como no leída)."""
        if category == 'chat':
            key = f"chat|{title}|{user_id}"
        else:
            key = f"{category}|{title}|{date}|{time_val}|{user_id}"
        return hashlib.sha256(key.encode('utf-8')).hexdigest()[:24]

    def _add_to_history(self, title, date, time_val, body, category, user_id, **kwargs):
        """Guarda la notificación en un archivo JSON local por usuario"""
        try:
            user_history_path = os.path.join(os.path.dirname(DB_PATH), f'notifications_{user_id}.json')
            
            history = []
            if os.path.exists(user_history_path) and os.path.getsize(user_history_path) > 0:
                try:
                    with open(user_history_path, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                except (json.JSONDecodeError, IOError):
                    history = []
            
            entry_id = self._entry_id(category, title, date, time_val, user_id, kwargs.get('sender_id'))
            new_entry = {
                "id": entry_id,
                "title": title,
                "body": body,
                "date": date,
                "time": time_val,
                "category": category,
                "user_id": user_id,
                "sender_id": kwargs.get('sender_id'),
                "image": kwargs.get('image'),
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            
            # Si es notificación de chat, agrupar con cualquier notificación existente del mismo remitente
            if category == 'chat' and history:
                existing_entry = None
                for idx, item in enumerate(history):
                    if item.get('category') == 'chat' and item.get('title') == title:
                        existing_entry = history.pop(idx)
                        break
                
                if existing_entry:
                    if not existing_entry.get('id'):
                        existing_entry['id'] = entry_id  # entrada creada antes de los IDs estables
                    msg_list = existing_entry.get('messages', [])
                    if not msg_list and existing_entry.get('body'):
                        lines = [line.strip() for line in existing_entry['body'].split('\n') if line.strip() and not line.strip().startswith('+')]
                        msg_list = lines
                    
                    msg_list.append(body)
                    existing_entry['messages'] = msg_list
                    
                    if len(msg_list) <= 3:
                        existing_entry['body'] = "\n".join(msg_list)
                    else:
                        shown = msg_list[:3]
                        extra_count = len(msg_list) - 3
                        existing_entry['body'] = "\n".join(shown) + f"\n+ {extra_count} más"
                        
                    existing_entry['time'] = time_val
                    existing_entry['date'] = date
                    existing_entry['timestamp'] = new_entry['timestamp']
                    if kwargs.get('image'):
                        existing_entry['image'] = kwargs.get('image')
                    
                    history.insert(0, existing_entry)
                    with open(user_history_path, 'w', encoding='utf-8') as f:
                        json.dump(history, f, indent=4, ensure_ascii=False)
                    return

            # Si ya existe una entrada con el mismo ID, se actualiza en su
            # sitio en vez de duplicar (p. ej. recordatorios que se repiten).
            for idx, item in enumerate(history):
                if item.get('id') == entry_id:
                    existing = history.pop(idx)
                    existing['body'] = body
                    existing['time'] = time_val
                    existing['date'] = date
                    existing['timestamp'] = new_entry['timestamp']
                    if kwargs.get('image'):
                        existing['image'] = kwargs.get('image')
                    history.insert(0, existing)
                    with open(user_history_path, 'w', encoding='utf-8') as f:
                        json.dump(history, f, indent=4, ensure_ascii=False)
                    return

            history.insert(0, new_entry)
            history = history[:100]
            
            with open(user_history_path, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=4, ensure_ascii=False)
                
        except Exception as e:
            print(f"[Notifier] Error guardando historial para {user_id}: {e}")

    def _send_system_notification(self, title, start_time, diff, description, category, user_id=None, **kwargs):
        self._send_local_notification(title, start_time, diff, description, category)
        
        self._send_web_push(title, description, category, user_id, **kwargs)
        
        self._send_fcm_push(title, description, category, user_id)
        
    def _send_fcm_push(self, title, body, category, user_id=None):
        from core.fcm_utils import send_fcm_notification
        from config.config import CONFIG
        
        with get_db() as conn:
            if user_id:
                subs = conn.execute("SELECT token FROM fcm_subs WHERE user_id = ?", (user_id,)).fetchall()
            else:
                subs = conn.execute("SELECT token FROM fcm_subs").fetchall()
                
        tokens = [sub['token'] for sub in subs]
        if tokens:
            full_title = f"[{CONFIG.SERVER_NAME}] {title}"
            full_body = f"[{category.upper()}] {body}" if body else f"[{category.upper()}]"
            send_fcm_notification(tokens, full_title, full_body)
            
    def _send_web_push(self, title, body, category, user_id=None, **kwargs):
        if not webpush:
            print("[Notifier] pywebpush not installed. Skipping web push.")
            return
            
        try:
            vapid_keys = get_or_create_vapid_keys()
            claims = get_vapid_claims()
            
            with get_db() as conn:
                if user_id:
                    subs = conn.execute("SELECT * FROM webpush_subs WHERE user_id = ?", (user_id,)).fetchall()
                else:
                    subs = conn.execute("SELECT * FROM webpush_subs").fetchall()
                
            for sub in subs:
                try:
                    sub_info = {
                        "endpoint": sub['endpoint'],
                        "keys": {
                            "p256dh": sub['p256dh'],
                            "auth": sub['auth']
                        }
                    }
                    payload_dict = {
                        "title": title,
                        "body": body,
                        "category": category,
                        "tag": kwargs.get('tag') or (f"chat-{kwargs.get('sender_id', title)}" if category == 'chat' else category),
                        "url": kwargs.get('url', '/app')
                    }
                    img = kwargs.get('image') or kwargs.get('photo')
                    if img:
                        payload_dict["image"] = img
                    payload = json.dumps(payload_dict)
                    webpush(
                        subscription_info=sub_info,
                        data=payload,
                        vapid_private_key=vapid_keys['private_key'],
                        vapid_claims=claims,
                        ttl=259200 # 3 días en segundos
                    )
                except WebPushException as ex:
                    print(f"[Notifier] Error enviando web push a {sub['endpoint']}: {ex}")
                    if ex.response and ex.response.status_code in [404, 410]:
                        with get_db() as conn:
                            conn.execute("DELETE FROM webpush_subs WHERE id = ?", (sub['id'],))
                            conn.commit()
                except Exception as e:
                    print(f"[Notifier] Error desconocido en web push: {e}")
        except Exception as e:
            print(f"[Notifier] Error en la infraestructura web push: {e}")

    def _send_local_notification(self, title, start_time, diff, description, category):
        """Lanza una notificación de sistema según el SO (Linux/Windows)"""
        header = f"Calendario: {title}"
        body = f"Comienza a las {start_time}"
        if diff > 0:
            body += f" (en {diff} min)"
        else:
            body += " (¡Ahora!)"
        
        if description:
            body += f"\n{description}"

        icon_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'static', 'img', 'app_icon.png'))
        system = platform.system()

        if system == "Linux":
            try:
                subprocess.run([
                    "gdbus", "call", "--session",
                    "--dest", "org.freedesktop.Notifications",
                    "--object-path", "/org/freedesktop/Notifications",
                    "--method", "org.freedesktop.Notifications.Notify",
                    "Manager", "0", icon_path, header, body, "[]", "{}", "10000"
                ], check=False, capture_output=True)
            except Exception as e:
                print(f"[Notifier] Error enviando notificación Linux: {e}")
        
        elif system == "Windows":
            try:
                h = header.replace("'", "''")
                b = body.replace("'", "''")
                i = icon_path.replace("'", "''")
                
                ps_cmd = (
                    f"$ErrorActionPreference='SilentlyContinue';"
                    f"[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;"
                    f"$type=[Windows.UI.Notifications.ToastTemplateType]::ToastImageAndText02;"
                    f"$template=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($type);"
                    f"$xml=[Windows.Data.Xml.Dom.XmlDocument]::new();$xml.LoadXml($template.GetXml());"
                    f"$text=$xml.GetElementsByTagName('text');$text.Item(0).AppendChild($xml.CreateTextNode('{h}'))|Out-Null;"
                    f"$text.Item(1).AppendChild($xml.CreateTextNode('{b}'))|Out-Null;"
                    f"if(Test-Path '{i}'){{$img=$xml.GetElementsByTagName('image');$img.Item(0).Attributes.GetNamedItem('src').Value='{i}'}};"
                    f"$toast=[Windows.UI.Notifications.ToastNotification]::new($xml);"
                    f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Manager').Show($toast)"
                )
                
                subprocess.run(["powershell", "-Command", ps_cmd], check=False, capture_output=True)
            except Exception as e:
                print(f"[Notifier] Error enviando notificación Windows: {e}")

    def send_telegram_message(self, message):
        """Envía un mensaje a través del bot de Telegram si está configurado."""
        if os.environ.get('TELEGRAM_ENABLED', 'true').lower() == 'false':
            print("[Notifier] Telegram deshabilitado temporalmente (TELEGRAM_ENABLED=false)")
            return False
        bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        chat_id = os.environ.get('TELEGRAM_CHAT_ID')
        
        if not bot_token or not chat_id:
            return False
            
        import requests
        try:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": False
            }
            res = requests.post(url, json=payload, timeout=5)
            if res.status_code == 200:
                print("[Notifier] Telegram enviado con éxito.")
                return True
            else:
                print(f"[Notifier] Error de Telegram: {res.text}")
                return False
        except Exception as e:
            print(f"[Notifier] Error en send_telegram_message: {e}")
            return False

    def notify_chat_message(self, sender_name, receiver_id, message, file_name=None, sender_id=None, image_url=None):
        """Notifica un nuevo mensaje de chat al destinatario."""
        import re
        title = sender_name
        category = "chat"
        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d")
        time_str = now.strftime("%H:%M")
        
        body = message or ""
        # Limpiar tags de respuesta si existen
        body = re.sub(r'^\[REPLY\|.*?\|.*?\|.*?\]\s*', '', body)
        
        if file_name:
            if "Audio" in file_name or re.search(r'_\d+s\.', file_name):
                body = "🎤 Audio" + (f" - {body}" if body else "")
            elif file_name.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                body = "📷 Foto" + (f" - {body}" if body else "")
                if not image_url and file_name.startswith('/'):
                    image_url = file_name
            elif file_name.lower().endswith(('.mp4', '.webm', '.ogg')):
                body = "🎬 Video" + (f" - {body}" if body else "")
            else:
                body = f"📎 {file_name}" + (f" - {body}" if body else "")
                
        if len(body) > 60:
            body = body[:60] + "..."
            
        self._add_to_history(title, date_str, time_str, body, category, receiver_id, sender_id=sender_id, image=image_url)
        
        self._send_system_notification(title, time_str, 0, body, category, user_id=receiver_id, sender_id=sender_id, image=image_url)

notifier = SystemNotifier()
