"""Configuración del microservicio scraper vía variables de entorno."""
import os

# URL del engine. Sin certificados, el engine arranca en HTTP: el scraper
# debe usar el mismo esquema. Con TLS: ENGINE_BASE_URL=https://127.0.0.1:5000
ENGINE_BASE_URL = os.environ.get("ENGINE_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
