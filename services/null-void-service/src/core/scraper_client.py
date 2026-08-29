"""Cliente HTTP del microservicio scraper con autenticación interna.

Todas las llamadas al puerto 5001 llevan la cabecera X-Internal-Token,
validada por el scraper contra la misma SCRAPER_API_KEY del .env.
"""
import os

import requests

SCRAPER_BASE_URL = os.environ.get("SCRAPER_BASE_URL", "http://127.0.0.1:5001")


def scraper_headers():
    key = os.environ.get("SCRAPER_API_KEY", "").strip()
    return {"X-Internal-Token": key} if key else {}


def scraper_request(method, path, **kw):
    """Realiza una petición al microservicio scraper con su token interno."""
    headers = dict(kw.pop("headers", None) or {})
    headers.update(scraper_headers())
    return requests.request(method, f"{SCRAPER_BASE_URL}{path}", headers=headers, **kw)