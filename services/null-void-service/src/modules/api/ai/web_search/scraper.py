"""Módulo de extracción de URLs y scraping web seguro con protección SSRF."""
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse
from typing import Callable, List, Optional

import requests
from bs4 import BeautifulSoup

URL_PATTERN = re.compile(r'https?://[^\s<>"\']+')


def extract_urls(text: str) -> List[str]:
    """Extrae y normaliza URLs encontradas en un texto."""
    if not text:
        return []
    urls = URL_PATTERN.findall(text)
    cleaned = []
    for url in urls:
        while url and url[-1] in '.,;:!?':
            url = url[:-1]
        open_count = url.count('(')
        close_count = url.count(')')
        while close_count > open_count and url.endswith(')'):
            url = url[:-1]
            close_count -= 1
        if url:
            cleaned.append(url)
    return cleaned


def _url_is_safe(url: str) -> bool:
    """SSRF guard: solo http/https hacia hosts públicos (bloquea IPs privadas/loopback)."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        return False
    try:
        infos = socket.getaddrinfo(
            host, parsed.port or (443 if parsed.scheme == "https" else 80),
            proto=socket.IPPROTO_TCP,
        )
    except (socket.gaierror, OSError):
        return False
    if not infos:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False
    return True


def _fetch_safe(getter: Callable, url: str, headers: dict, timeout: int = 8) -> Optional[requests.Response]:
    """GET con validación SSRF en cada salto de redirección."""
    current = url
    for _ in range(5):
        if not _url_is_safe(current):
            return None
        try:
            resp = getter(current, timeout=timeout, headers=headers, allow_redirects=False)
        except Exception:
            return None
        if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
            current = urljoin(current, resp.headers["Location"])
            continue
        return resp
    return None


def scrape_url_content(url: str, max_chars: int = 6000) -> Optional[str]:
    """Descarga y extrae el texto legible principal de una URL."""
    try:
        resp = None
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            )
        }
        try:
            import cloudscraper
            scraper = cloudscraper.create_scraper()
            resp = _fetch_safe(scraper.get, url, headers)
        except Exception:
            resp = _fetch_safe(requests.get, url, headers)

        if not resp or resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, 'html.parser')

        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'iframe',
                         'noscript', 'aside', 'form', 'button', 'svg', 'meta', 'link']):
            tag.decompose()

        main = soup.find('main') or soup.find('article') or soup.find(attrs={"role": "main"})
        container = main if main else soup.find('body') or soup

        title = ""
        title_el = soup.find('title')
        if title_el:
            title = title_el.get_text(strip=True)[:200]

        lines = []
        for el in container.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'td', 'th', 'span', 'div', 'dd', 'dt']):
            text = el.get_text(separator=' ', strip=True)
            if text and len(text) > 10:
                lines.append(text)

        price_elements = container.select('[class*="price"], [class*="Price"], [itemprop="price"], [data-price]')
        for el in price_elements[:10]:
            text = el.get_text(strip=True)
            if text and any(c.isdigit() for c in text):
                lines.append(f"[PRECIO]: {text}")

        if not lines:
            text = container.get_text(separator='\n', strip=True)
            lines = [l.strip() for l in text.split('\n') if l.strip() and len(l.strip()) > 10]

        seen = set()
        unique_lines = []
        for line in lines:
            normalized = line[:80]
            if normalized not in seen:
                seen.add(normalized)
                unique_lines.append(line)

        content = '\n'.join(unique_lines)
        if len(content) > max_chars:
            content = content[:max_chars] + "\n[...contenido truncado...]"

        return f"Título: {title}\nURL: {url}\n\n{content}" if content else None
    except Exception as e:
        return f"Error al acceder a {url}: {str(e)}"


def _scrape_page_prices(url: str) -> Optional[str]:
    """Extrae precios y nombres de productos específicos de una tienda online."""
    try:
        import cloudscraper
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        }
        scraper = cloudscraper.create_scraper()
        resp = _fetch_safe(scraper.get, url, headers, timeout=5)
        if not resp or resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, 'html.parser')

        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'iframe']):
            tag.decompose()

        price_texts = []
        price_selectors = [
            '[class*="price"]', '[class*="Price"]', '[class*="precio"]',
            '[id*="price"]', '[id*="Price"]',
            '[data-price]', '[itemprop="price"]',
            '.a-price', '.product-price', '.offer-price',
        ]

        for selector in price_selectors:
            elements = soup.select(selector)
            for el in elements[:5]:
                text = el.get_text(strip=True)
                if text and len(text) < 100 and any(c.isdigit() for c in text):
                    price_texts.append(text)

        title = ""
        title_el = soup.find('h1') or soup.find('title')
        if title_el:
            title = title_el.get_text(strip=True)[:150]

        if price_texts:
            unique_prices = list(dict.fromkeys(price_texts))[:4]
            return f"Producto: {title}\nPrecios encontrados: {' | '.join(unique_prices)}"

        return None
    except Exception:
        return None
