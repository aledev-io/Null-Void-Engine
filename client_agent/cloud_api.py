# -*- coding: utf-8 -*-
"""
Capa de red del agente Null-Void Cloud, separada de la interfaz Qt.
Centraliza las llamadas HTTP, la clasificación de excepciones y la
limpieza de mensajes de error para que la UI no repita esa lógica.
"""
import requests


def peer_cert_fingerprint(res):
    """SHA-256 (hex, minúsculas) del certificado TLS presentado por el servidor
    con el que se completó la petición `res`. Devuelve None si no se pudo
    obtener (por ejemplo si la conexión ya se liberó)."""
    try:
        conn = getattr(res.raw, "_connection", None)
        sock = getattr(conn, "sock", None) if conn else None
        der = sock.getpeercert(binary_form=True) if sock else None
        if not der:
            return None
        import hashlib
        return hashlib.sha256(der).hexdigest()
    except Exception:
        return None


def clean_error_msg(err_raw):
    """Limpia y personaliza cualquier mensaje de error de red para ser claro con el usuario."""
    if not err_raw:
        return "No se pudo conectar con el servidor. Verifica que la URL sea correcta."
    s_err = str(err_raw)
    if "<html" in s_err.lower() or "<!doctype" in s_err.lower():
        if "404" in s_err:
            return "La URL especificada existe pero no es un servidor Null-Void Cloud. Asegúrate de incluir el puerto (ej: https://tu-servidor:5000)."
        elif "500" in s_err:
            return "El servidor Null-Void respondió con un error interno (HTTP 500). Inténtalo más tarde."
        elif "502" in s_err or "503" in s_err:
            return "El servidor remoto se encuentra temporalmente fuera de servicio o reiniciándose (HTTP 502/503)."
        return "La URL ingresada no corresponde a un servidor Null-Void Cloud válido."
    if len(s_err) > 130:
        return s_err[:130] + "..."
    return s_err


class CloudAPIError(Exception):
    """Error de red o de protocolo ya traducido a un mensaje legible."""


class CloudAPICertificateError(CloudAPIError):
    """El servidor respondió con un certificado SSL no verificado."""


class CloudAgentAPI:
    """Cliente HTTP de los endpoints de sync-agent del servidor Null-Void.

    Verificación TLS: el servidor usa un certificado autofirmado, así que la
    validación de cadena suele estar desactivada (verify=False). Para evitar
    ataques MITM se puede fijar la confianza con `cert_hash`: la huella
    SHA-256 del certificado del servidor (la imprime el servidor al arrancar
    y se pone en el .env del agente como AGENT_CERT_HASH). Si el certificado
    no coincide, todas las peticiones fallan con CloudAPICertificateError.
    """

    def __init__(self, timeout=6, verify=False, cert_hash=None):
        self.timeout = timeout
        self.verify = verify
        self.cert_hash = (cert_hash or "").strip().lower() or None
        self.last_cert_fingerprint = None

    def _check_cert_pin(self, res):
        """Compara la huella del certificado real con el hash esperado."""
        fingerprint = peer_cert_fingerprint(res)
        self.last_cert_fingerprint = fingerprint or self.last_cert_fingerprint
        if self.cert_hash:
            if not fingerprint or fingerprint != self.cert_hash:
                raise CloudAPICertificateError(
                    "El certificado SSL del servidor no coincide con la huella "
                    "esperada (AGENT_CERT_HASH). Posible suplantación (MITM).")

    def _post(self, url, path, body=None, headers=None, timeout=None):
        try:
            res = requests.post(
                f"{url.rstrip('/')}{path}",
                json=body,
                headers=headers or {},
                timeout=timeout or self.timeout,
                verify=self.verify,
            )
            self._check_cert_pin(res)
            return res
        except CloudAPICertificateError:
            raise
        except requests.exceptions.SSLError:
            raise CloudAPICertificateError("El servidor usa un certificado SSL no verificado.")
        except requests.exceptions.ConnectionError:
            raise CloudAPIError("No se pudo encontrar el servidor en esa dirección. Revisa tu conexión a internet o la IP/dominio ingresado.")
        except requests.exceptions.Timeout:
            raise CloudAPIError("Tiempo de espera agotado al conectar con el servidor. Asegúrate de que el puerto (ej: 5000) esté abierto.")
        except Exception as e:
            raise CloudAPIError(clean_error_msg(e))

    def test_connection(self, url, timeout=5):
        """Comprueba si la URL apunta a un servidor Null-Void Cloud.

        Devuelve (True, None) si el servidor existe y responde, o
        (False, mensaje) con el motivo del fallo.
        """
        try:
            res = self._post(
                url,
                "/api/cloud/sync-agent/list-devices",
                {"temp_token": "ping_test"},
                timeout=timeout,
            )
            if res.status_code in (200, 401, 400):
                return True, None
            if res.status_code == 404:
                return False, "La dirección especificada no es un servidor Null-Void Cloud. Recuerda incluir el puerto (ejemplo: https://mi-servidor:5000)."
            return False, f"El servidor respondió con código HTTP {res.status_code}. Verifica que el servicio Null-Void esté activo."
        except CloudAPICertificateError as e:
            if self.cert_hash:
                return False, str(e)
            # Sin hash configurado, un certificado sin verificar solo indica
            # que el servidor existe (el usuario podrá fijar la huella después).
            return True, None
        except CloudAPIError as e:
            return False, str(e)

    def verify_token(self, url, token):
        """Valida un token de enlace contra el servidor.

        Devuelve (ok, target_device, error_msg): ok=True si el token es
        válido y target_device es el nombre del PC asociado (si lo hay).
        """
        try:
            res = self._post(
                url,
                "/api/cloud/sync-agent/list-devices",
                {"temp_token": token},
                timeout=6,
            )
            data = res.json()
            if res.status_code == 200:
                return True, data.get("target_device", ""), None
            return False, "", data.get("error", "Token de enlace inválido o expirado.")
        except CloudAPIError as e:
            return False, "", str(e)
        except Exception as e:
            return False, "", clean_error_msg(e)

    def list_devices(self, url, token, bearer_token=None):
        """Lista los dispositivos del usuario (devices, username, target_device)."""
        headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}
        try:
            res = self._post(
                url,
                "/api/cloud/sync-agent/list-devices",
                {"temp_token": token or "session_active"},
                headers=headers,
                timeout=6,
            )
            data = res.json()
            if res.status_code == 200:
                return data
            raise CloudAPIError(data.get("error", "Error desconocido."))
        except CloudAPIError:
            raise
        except Exception as e:
            raise CloudAPIError(clean_error_msg(e))

    def my_devices(self, url, bearer_token):
        """Lista los dispositivos del usuario usando SU token de dispositivo (Bearer).

        No requiere un temp_token de enlace: el agente ya guarda este token en su
        configuración, permitiendo refrescar la lista de PCs sin pedir uno nuevo.
        """
        headers = {}
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        try:
            res = self._post(
                url,
                "/api/cloud/sync-agent/my-devices",
                headers=headers,
                timeout=6,
            )
            data = res.json()
            if res.status_code == 200:
                return data
            raise CloudAPIError(data.get("error", "Error desconocido."))
        except CloudAPIError:
            raise
        except Exception as e:
            raise CloudAPIError(clean_error_msg(e))

    def register_device(self, url, token, device_name, os_name):
        """Vincula este dispositivo al servidor con un token de enlace."""
        payload = {"temp_token": token, "os": os_name}
        if device_name:
            payload["device_name"] = device_name
        try:
            res = self._post(
                url,
                "/api/cloud/sync-agent/register",
                payload,
                timeout=6,
            )
            data = res.json()
            if res.status_code == 200:
                return data
            raise CloudAPIError(data.get("error", "Error desconocido."))
        except CloudAPIError:
            raise
        except Exception as e:
            raise CloudAPIError(clean_error_msg(e))