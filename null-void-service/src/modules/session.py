import secrets
import json
import os
import unicodedata
from datetime import datetime, timedelta
from config.config import CONFIG

class SecurityManager:
    """Gestiona una tabla hash de intentos de ataque para bloquear IPs."""
    def __init__(self):
        # Tabla Hash: IP -> {"count": int, "blocked_until": iso_str, "last_attempt": iso_str}
        self._attack_table = {}
        self.MAX_ATTEMPTS = 5
        self.BLOCK_DURATION = 15 # minutos
        self._persistence_file = os.path.join(CONFIG.DATA_DIR, 'security.json')
        self._load()

    def _load(self):
        if os.path.exists(self._persistence_file):
            try:
                with open(self._persistence_file, 'r') as f:
                    self._attack_table = json.load(f)
            except: pass

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self._persistence_file), exist_ok=True)
            with open(self._persistence_file, 'w') as f:
                json.dump(self._attack_table, f, indent=4)
        except: pass

    def is_blocked(self, ip: str) -> bool:
        if ip not in self._attack_table:
            return False
        
        entry = self._attack_table[ip]
        try:
            blocked_until = datetime.fromisoformat(entry["blocked_until"])
            if blocked_until > datetime.now():
                return True
        except: pass
        
        # Si el bloqueo expiró, lo removemos de la tabla para liberar espacio
        if entry["count"] >= self.MAX_ATTEMPTS:
            del self._attack_table[ip]
            self._save()
            return False
        return False

    def record_failure(self, ip: str):
        now = datetime.now()
        if ip not in self._attack_table:
            self._attack_table[ip] = {
                "count": 1, 
                "blocked_until": now.isoformat(),
                "last_attempt": now.isoformat()
            }
        else:
            entry = self._attack_table[ip]
            entry["count"] += 1
            entry["last_attempt"] = now.isoformat()
            if entry["count"] >= self.MAX_ATTEMPTS:
                entry["blocked_until"] = (now + timedelta(minutes=self.BLOCK_DURATION)).isoformat()
        
        self._save()
        
        # Mantenimiento preventivo
        if len(self._attack_table) > 1000:
            self._cleanup()

    def reset(self, ip: str):
        """Limpia el historial de una IP tras un login exitoso."""
        if ip in self._attack_table:
            del self._attack_table[ip]
            self._save()

    def _cleanup(self):
        """Limpia IPs inactivas de la tabla hash para ahorrar memoria."""
        now = datetime.now()
        threshold = now - timedelta(hours=1)
        to_delete = []
        for ip, data in self._attack_table.items():
            try:
                last = datetime.fromisoformat(data["last_attempt"])
                blocked = datetime.fromisoformat(data["blocked_until"])
                if last < threshold and blocked < now:
                    to_delete.append(ip)
            except: to_delete.append(ip)
            
        for ip in to_delete:
            del self._attack_table[ip]
        self._save()

class AuditManager:
    """Gestiona el registro de auditoría de seguridad."""
    def __init__(self):
        self._log_file = os.path.join(CONFIG.DATA_DIR, 'audit.json')
        self._max_logs = 500
        self._logs = []
        self._load()

    def _load(self):
        if os.path.exists(self._log_file):
            try:
                with open(self._log_file, 'r') as f:
                    self._logs = json.load(f)
            except: pass

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self._log_file), exist_ok=True)
            with open(self._log_file, 'w') as f:
                json.dump(self._logs, f, indent=4)
        except: pass

    def _normalize(self, text):
        """Elimina tildes y caracteres raros."""
        if not text: return ""
        # Normalizar a NFD (descompone caracteres con tildes) y filtrar solo ASCII
        text = unicodedata.normalize('NFD', text)
        text = "".join([c for c in text if unicodedata.category(c) != 'Mn'])
        return text.encode('ascii', 'ignore').decode('ascii')

    def log(self, event_type: str, user: str, ip: str, details: str = ""):
        """Registra un nuevo evento de seguridad con hora exacta"""
        entry = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "type": self._normalize(event_type).upper(),
            "user": self._normalize(user),
            "ip": ip,
            "details": self._normalize(details)
        }
        self._logs.insert(0, entry) # El más reciente primero
        
        # Mantener tamaño razonable
        if len(self._logs) > self._max_logs:
            self._logs = self._logs[:self._max_logs]
        
        self._save()

    def get_logs(self):
        return self._logs

class SessionManager:
    """Gestiona los tokens de sesión activos asociados a usuarios.
    
    Política: un usuario solo puede tener UNA sesión activa a la vez.
    Al crear una nueva sesión, la anterior queda invalidada automáticamente.
    Las sesiones expiran tras 2 horas de inactividad.
    """
    SESSION_TIMEOUT = 86400  # 24 horas

    def __init__(self):
        # token -> {username, created_at}
        self._sessions: dict[str, dict] = {}
        # username -> token (índice inverso para búsqueda rápida)
        self._user_index: dict[str, str] = {}
        self._last_cleanup = 0.0
        
        self._persistence_file = os.path.join(CONFIG.DATA_DIR, 'sessions.json')
        self._load()

    def _load(self):
        if os.path.exists(self._persistence_file):
            try:
                with open(self._persistence_file, 'r') as f:
                    data = json.load(f)
                    self._sessions = data.get('sessions', {})
                    self._user_index = data.get('index', {})
                    self._cleanup() # Limpiar sesiones expiradas al cargar
            except: pass

    def _cleanup(self):
        """Elimina sesiones expiradas o pendientes de borrado por más de 120s."""
        now = datetime.now()
        to_delete = []
        for token, data in self._sessions.items():
            try:
                # Sesiones pendientes de borrado (tab cerrada) - gracia de 120s
                if data.get("pending_delete") and data.get("pending_since"):
                    since = datetime.fromisoformat(data["pending_since"])
                    if (now - since).total_seconds() > 120:
                        to_delete.append(token)
                        continue
                # Sesiones inactivas
                last_act = datetime.fromisoformat(data["last_activity"])
                if (now - last_act).total_seconds() > self.SESSION_TIMEOUT:
                    to_delete.append(token)
            except:
                to_delete.append(token)
        
        if to_delete:
            for token in to_delete:
                username = self._sessions[token].get("username")
                if username and self._user_index.get(username) == token:
                    del self._user_index[username]
                del self._sessions[token]
        self._save()

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self._persistence_file), exist_ok=True)
            with open(self._persistence_file, 'w') as f:
                json.dump({
                    'sessions': self._sessions,
                    'index': self._user_index
                }, f)
        except: pass

    def has_active_session(self, username: str) -> bool:
        """Verifica si el usuario ya tiene una sesión activa."""
        self._cleanup()
        return username in self._user_index and self._user_index[username] in self._sessions

    def create(self, username: str, user_id: str = None) -> str:
        """Genera un nuevo token para el usuario."""
        # Invalidar sesión anterior si existe
        old_token = self._user_index.get(username)
        if old_token and old_token in self._sessions:
            del self._sessions[old_token]

        # Crear nueva sesión
        token = secrets.token_hex(32)
        self._sessions[token] = {
            "username": username,
            "user_id": user_id,
            "created_at": datetime.now().isoformat(),
            "last_activity": datetime.now().isoformat(),
            "active_tab": None # Se asignará en la primera validación
        }
        self._user_index[username] = token
        self._save()
        return token

    def _touch(self, token: str):
        """Actualiza la marca de tiempo de actividad sin guardar en disco (para rendimiento)."""
        if token in self._sessions:
            self._sessions[token]["last_activity"] = datetime.now().isoformat()

    def validate(self, token: str, tab_id: str = None) -> int:
        """Verifica el token y el tab_id. 
        Retorna: 200 (OK), 401 (No token), 403 (Otra pestaña activa)
        Las sesiones con pending_delete siguen siendo válidas (se limpian via _cleanup).
        """
        import time as ttime
        if ttime.time() - self._last_cleanup > 60:
            self._cleanup()
            self._last_cleanup = ttime.time()

        if token not in self._sessions:
            self._load()
            if token not in self._sessions:
                return 401
        
        # Si la sesión está pendiente de borrado pero el usuario hace requests,
        # cancelar el pending_delete automáticamente
        sess_data = self._sessions[token]
        if sess_data.get("pending_delete"):
            sess_data["pending_delete"] = False
            sess_data["revoke_key"] = None
            sess_data["pending_since"] = None
            self._save()

        if not tab_id:
            return 200

        sess = self._sessions[token]
        now = datetime.now()
        last_act = datetime.fromisoformat(sess["last_activity"])
        
        if (now - last_act).total_seconds() > self.SESSION_TIMEOUT:
            self.destroy(token)
            return 401
        
        if sess["active_tab"] is None:
            sess["active_tab"] = tab_id
            self._save()
        elif sess["active_tab"] != tab_id:
            if (now - last_act).total_seconds() < 5:
                return 403
            else:
                sess["active_tab"] = tab_id
                self._save()

        self._touch(token)
        return 200

    def get_user(self, token: str) -> str | None:
        """Devuelve el nombre de usuario asociado a un token activo, validando la pestaña."""
        self._cleanup()
        
        try:
            from flask import request
            tab_id = request.args.get("tabId") or request.headers.get("X-Tab-Id")
        except: tab_id = None
        
        if self.validate(token, tab_id) != 200:
            from core.database import get_db
            with get_db() as conn:
                row = conn.execute("SELECT u.username FROM cloud_device_tokens t JOIN cloud_devices d ON t.device_id = d.id JOIN users u ON d.user_id = u.user_id WHERE t.token = ?", (token,)).fetchone()
                if row: return row['username']
            return None

        if token in self._sessions:
            entry = self._sessions[token]
            if entry:
                self._touch(token)
                return entry.get("username")
        return None

    def get_user_id(self, token: str) -> str | None:
        """Devuelve el ID de usuario asociado a un token activo, validando la pestaña."""
        try:
            from flask import request
            tab_id = request.args.get("tabId") or request.headers.get("X-Tab-Id")
        except: tab_id = None

        if self.validate(token, tab_id) != 200:
            from core.database import get_db
            with get_db() as conn:
                row = conn.execute("SELECT u.user_id FROM cloud_device_tokens t JOIN cloud_devices d ON t.device_id = d.id JOIN users u ON d.user_id = u.user_id WHERE t.token = ?", (token,)).fetchone()
                if row: return row['user_id']
            return None

        entry = self._sessions.get(token)
        if entry:
            self._touch(token)
            if not entry.get("user_id"):
                from modules.api.system.repository import get_user_by_id
                from core.database import get_db
                with get_db() as conn:
                    row = conn.execute("SELECT user_id FROM users WHERE username = ?", (entry["username"],)).fetchone()
                    if row:
                        entry["user_id"] = row["user_id"]
                        self._save()
            return entry.get("user_id")
        return None

    def destroy(self, token: str):
        """Elimina una sesión específica por token."""
        entry = self._sessions.pop(token, None)
        if entry:
            username = entry["username"]
            if self._user_index.get(username) == token:
                del self._user_index[username]
            self._save()

    def soft_destroy(self, token: str, revoke_key: str) -> bool:
        """Marca la sesión como pending_delete si no fue revocada antes."""
        entry = self._sessions.get(token)
        if entry:
            if revoke_key in entry.get("cancelled_revokes", []):
                return False
            entry["pending_delete"] = True
            entry["revoke_key"] = revoke_key
            entry["pending_since"] = datetime.now().isoformat()
            self._save()
            return True
        return False

    def revoke_delete(self, token: str, revoke_key: str) -> bool:
        """Cancela un pending_delete. Si llegó antes que el soft_destroy,
        registra la key para que el soft_destroy posterior sea ignorado."""
        entry = self._sessions.get(token)
        if entry:
            if entry.get("pending_delete") and entry.get("revoke_key") == revoke_key:
                entry["pending_delete"] = False
                entry["revoke_key"] = None
                entry["pending_since"] = None
                if "revoked" in entry:
                    del entry["revoked"]
                self._save()
                return True
            if not entry.get("pending_delete"):
                cancelled = entry.get("cancelled_revokes", [])
                cancelled.append(revoke_key)
                entry["cancelled_revokes"] = cancelled[-10:]
                if "revoked" in entry:
                    del entry["revoked"]
                self._save()
                return True
        return False

    def get_last_activity(self, username: str) -> str | None:
        """Devuelve el timestamp (ISO) de la última actividad de un usuario."""
        token = self._user_index.get(username)
        if token and token in self._sessions:
            return self._sessions[token].get("last_activity")
        return None

    def online_users(self) -> list[dict]:
        """Devuelve la lista de usuarios realmente activos (actividad en los últimos 30s)."""
        now = datetime.now()
        active = []
        for data in self._sessions.values():
            try:
                last_act = datetime.fromisoformat(data["last_activity"])
                if (now - last_act).total_seconds() < 30:
                    active.append({
                        "username": data["username"],
                        "since": data["created_at"]
                    })
            except:
                continue
        return active

session = SessionManager()
security = SecurityManager()
audit = AuditManager()