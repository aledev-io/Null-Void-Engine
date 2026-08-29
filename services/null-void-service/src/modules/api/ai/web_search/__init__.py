"""Módulo de búsqueda web y scraping de URLs en tiempo real."""

from .scraper import (
    extract_urls,
    scrape_url_content,
)
from .searcher import (
    perform_web_search,
)

__all__ = [
    "extract_urls",
    "scrape_url_content",
    "perform_web_search",
]
