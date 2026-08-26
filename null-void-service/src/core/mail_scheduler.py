import threading


class MailScheduler:
    """
    Disparador de correos programados en segundo plano.

    El ownership del despacho (lectura de internal_mail, evaluación de
    due-time, resolución de destinatario, transiciones de estado y transporte
    SMTP) vive en el dominio Mail: modules.api.mail.services.
    dispatch_scheduled_emails(). Este módulo solo gestiona el ciclo de vida
    del hilo y delega el despacho.
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
        """Delega el despacho en el dominio Mail. Core ya no toca internal_mail
        ni SMTP; solo dispara el servicio de Mail."""
        try:
            from modules.api.mail import services as mail_services
            mail_services.dispatch_scheduled_emails()
        except Exception as e:
            print(f"[MailScheduler] Error crítico en _check_scheduled_emails: {e}")


mail_scheduler = MailScheduler()
