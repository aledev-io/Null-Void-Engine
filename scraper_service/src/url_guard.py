"""Guarda anti-SSRF para la navegación automatizada (Playwright).

Solo permite URLs públicas http/https: rechaza esquemas peligrosos
(file://, ftp://, ...) y cualquier host que resuelva a una IP interna o
reservada (loopback, privadas, link-local, unicast local IPv6, metadatos
de proveedores cloud, etc.), incluyendo trucos tipo 'localhost.'.dominio'.
"""
import ipaddress
import socket
from urllib.parse import urlparse

_ALLOWED_SCHEMES = ("http", "https")


def _is_global_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return ip.is_global


def _resolve_ips(host):
    try:
        infos = socket.getaddrinfo(host, None)
        return list({info[4][0] for info in infos})
    except (socket.gaierror, OSError):
        return []


def validate_public_url(url):
    """Valida que `url` sea una URL http/https pública navegable.

    Devuelve la URL limpia o lanza ValueError con el motivo.
    """
    if not isinstance(url, str) or not url.strip():
        raise ValueError("URL vacía")

    parsed = urlparse(url.strip())
    if (parsed.scheme or "").lower() not in _ALLOWED_SCHEMES:
        raise ValueError("Solo se permiten URLs http:// o https:// (no file://, ftp://, etc.)")
    if parsed.username or parsed.password:
        raise ValueError("URLs con credenciales embebidas no permitidas")

    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("URL sin host")
    if host == "localhost":
        raise ValueError("El host 'localhost' no está permitido")

    ips = _resolve_ips(host)
    if not ips:
        raise ValueError("No se pudo resolver el dominio")

    blocked = [ip for ip in ips if not _is_global_ip(ip)]
    if blocked:
        raise ValueError(
            "La URL resuelve a una IP interna o reservada (%s): no permitido" % blocked[0]
        )
    return url.strip()