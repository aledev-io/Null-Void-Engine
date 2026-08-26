"""Cifrado simétrico reversible (AES-128-CBC vía Fernet) para las API keys de
proveedores externos almacenadas en SQLite (ai_api_keys.api_key).

La clave se deriva de la variable de entorno ``AI_SECRET_KEY``. Si no está
configurada, se usa como fallback de desarrollo la ``SECRET_KEY`` del servidor
(CONFIG.SECRET_KEY), de modo que el servicio nunca deja de funcionar en un
arranque sin la variable. El cifrado solo hace ilegible la clave en reposo
frente a una copia de la base de datos; en ningún momento se devuelve la clave
completa descifrada a la UI.

Formato de los valores: ``nv2$<token_fernet>``
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet

_PREFIX = "nv2$"


def _derive_fernet_key() -> bytes:
    """Deriva una clave Fernet (32 bytes url-safe base64) de AI_SECRET_KEY.
    """
    material = os.environ.get("AI_SECRET_KEY") or ""
    if not material:
        try:
            from config.config import CONFIG
            material = CONFIG.SECRET_KEY or ""
        except Exception:
            material = ""
    if not material:
        material = "null-void-dev-fallback-key"
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_fernet_key())


def encrypt_api_key(plain_text: str) -> str:
    """Cifra una API key en texto plano y devuelve la cadena cifrada."""
    if plain_text is None:
        return plain_text
    token = _fernet.encrypt(str(plain_text).encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{token}"


def decrypt_api_key(encrypted_text: str) -> str:
    """Descifra una API key previamente cifrada.

    Compatibilidad hacia atrás: si el valor no está cifrado (clave guardada en
    texto plano antes de la migración) o no puede descifrarse, se devuelve el
    texto original sin romper la ejecución.
    """
    if not encrypted_text or not str(encrypted_text).startswith(_PREFIX):
        return encrypted_text
    try:
        token = str(encrypted_text)[len(_PREFIX):]
        return _fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        return encrypted_text
