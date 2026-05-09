import time
import threading
import subprocess
import os
import json
import hashlib
import platform
from datetime import datetime
from core.database import get_db, DB_PATH

# Ruta al historial de notificaciones
HISTORY_PATH = os.path.join(os.path.dirname(DB_PATH), 'notifications_history.json')

class SystemNotifier:
    """
    Monitor de eventos en segundo plano que envía notificaciones nativas de Linux
    usando el comando 'notify-send'. Funciona independientemente del navegador.
    """
    def __init__(self):
        self.notified_ids = set()
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            # Si ya está corriendo, no hacer nada
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
            with get_db() as conn:
                # Buscamos TODOS los eventos no completados con hora de inicio
                rows = conn.execute(
                    "SELECT id, title, date, start_time, description, category, reminders, user_id "
                    "FROM events "
                    "WHERE completed = 0 AND start_time IS NOT NULL"
                ).fetchall()

                for row in rows:
                    ev_id = row['id']
                    try:
                        # Calculamos la diferencia total en minutos hasta el inicio del evento
                        ev_dt = datetime.strptime(f"{row['date']} {row['start_time']}", "%Y-%m-%d %H:%M")
                        diff_minutes = int((ev_dt - now).total_seconds() / 60)

                        # Si el evento ya pasó hace más de 1 minuto, lo ignoramos
                        if diff_minutes < -1:
                            continue

                        # Procesar cada recordatorio definido
                        reminders_json = row['reminders']
                        reminders = json.loads(reminders_json) if reminders_json else [0]
                        if not reminders: reminders = [0]

                        for reminder_minutes in reminders:
                            # ¿Estamos en la ventana de este recordatorio?
                            if 0 <= diff_minutes <= reminder_minutes:
                                # Lógica de repetición:
                                # Si faltan <= 10 min o es el momento del evento (reminder 0), 
                                # repetimos cada 2 minutos para que sea "persistente".
                                if diff_minutes <= 10 or reminder_minutes == 0:
                                    import math
                                    # Cambiamos la clave cada 2 minutos
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
                                
                                # Extraer ID de usuario
                                user_id = row['user_id'] or 'admin'
                                self._add_to_history(row['title'], row['date'], row['start_time'], row['category'], user_id)
                                
                    except (ValueError, json.JSONDecodeError) as e:
                        print(f"[Notifier] Error procesando evento {ev_id}: {e}")
                        continue
        except Exception as e:
            print(f"[Notifier] Error crítico en _check_events: {e}")

    def _add_to_history(self, title, date, time_val, category, user_id):
        """Guarda la notificación en un archivo JSON local por usuario"""
        try:
            # Ruta personalizada por ID de usuario
            user_history_path = os.path.join(os.path.dirname(DB_PATH), f'notifications_{user_id}.json')
            
            history = []
            if os.path.exists(user_history_path) and os.path.getsize(user_history_path) > 0:
                try:
                    with open(user_history_path, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                except (json.JSONDecodeError, IOError):
                    history = []
            
            new_entry = {
                "title": title,
                "date": date,
                "time": time_val,
                "category": category,
                "user_id": user_id,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            
            history.insert(0, new_entry)
            # Mantener solo las últimas 100 notificaciones
            history = history[:100]
            
            with open(user_history_path, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=4, ensure_ascii=False)
                
        except Exception as e:
            print(f"[Notifier] Error guardando historial para {user_id}: {e}")

    def _send_system_notification(self, title, start_time, diff, description, category):
        """Lanza una notificación de sistema según el SO (Linux/Windows)"""
        header = f"Calendario: {title}"
        body = f"Comienza a las {start_time}"
        if diff > 0:
            body += f" (en {diff} min)"
        else:
            body += " (¡Ahora!)"
        
        if description:
            body += f"\n{description}"

        icon_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'assets', 'app_icon.png'))
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

notifier = SystemNotifier()
