import collections
import ipaddress
import json
import os
import re
import socket
import threading
import time
import uuid
import requests
from datetime import date, timedelta
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
from core.socket_ext import socketio
from . import ollama_client, repository, external_client, privacy
from . import tools

active_ai_users = {}
container_running = False
container_stopping = False
ACTIVE_DOWNLOADS = {}


def _docker_api(path: str, method: str = "POST") -> tuple[bool, str]:
    """Llama a la API de Docker vía socket UNIX. Devuelve (ok, respuesta)."""
    if not os.path.exists("/var/run/docker.sock"):
        return False, "docker.sock no disponible"
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect("/var/run/docker.sock")
        s.sendall(
            f"{method} /v1.41/{path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n".encode()
        )
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()
        first = data.decode(errors="replace").split("\r\n", 1)[0]
        return first.startswith("HTTP/1.1 20") or first.startswith("HTTP/1.1 30"), first
    except Exception as e:
        return False, str(e)


def _start_ollama_container() -> bool:
    ok, resp = _docker_api("containers/ollama/start")
    if not ok:
        _log_ollama(f"Error starting ollama: {resp}")
    return ok


def _wait_ollama_ready(timeout: float = 45.0) -> bool:
    """Espera a que el servidor HTTP de Ollama acepte conexiones.

    `docker start` devuelve en cuanto el contenedor arranca el proceso,
    pero Ollama tarda unos segundos en levantar su API. Sin esta espera,
    la primera petición tras un arranque en frío falla con
    'Connection refused' (error de conexión en el módulo de IA).
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{ollama_client.OLLAMA_URL}/api/tags", timeout=2)
            if r.status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(1)
    return False


def _stop_ollama_container() -> bool:
    ok, resp = _docker_api("containers/ollama/stop")
    if not ok:
        _log_ollama(f"Error stopping ollama: {resp}")
    return ok


_last_ollama_log = [0.0]


def _log_ollama(msg: str):
    now = time.time()
    if now - _last_ollama_log[0] > 60:
        _last_ollama_log[0] = now
        print(msg)


def _ollama_container_running() -> bool:
    """Estado real del contenedor vía Docker inspect (200 + State.Running)."""
    if not os.path.exists("/var/run/docker.sock"):
        return False
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect("/var/run/docker.sock")
        s.sendall(b"GET /v1.41/containers/ollama/json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()
        text = data.decode(errors="replace")
        if not text.startswith("HTTP/1.1 200"):
            return False
        head, _, rest = text.partition("\r\n\r\n")
        if "transfer-encoding: chunked" in head.lower():
            body = ""
            pos = 0
            while True:
                end = rest.find("\r\n", pos)
                if end < 0:
                    break
                size = int(rest[pos:end], 16)
                if size == 0:
                    break
                body += rest[end + 2:end + 2 + size]
                pos = end + 2 + size + 2
        else:
            body = rest
        return bool(json.loads(body).get("State", {}).get("Running"))
    except Exception as e:
        _log_ollama(f"Error inspect ollama: {e}")
        return False


def _inactivity_watcher():
    global container_running, container_stopping
    while True:
        time.sleep(5)
        now = time.time()
        
        # Eliminar usuarios inactivos
        for uid in list(active_ai_users.keys()):
            if now - active_ai_users[uid] > 60:
                del active_ai_users[uid]

        # Si no hay nadie, no hay generaciones activas ni cola, y el
        # contenedor corre: apagarlo. Nunca cortar una generación en curso
        # ni una descarga de modelo (puede durar minutos y quedaría
        # truncada con un error de conexión).
        with _GEN_LOCK:
            idle = (len(active_ai_users) == 0
                    and _gen_active == 0 and not _gen_waiters)
        if container_running and idle and not ACTIVE_DOWNLOADS and not container_stopping:
            container_stopping = True
            try:
                ollama_client.unload_all_models()
                time.sleep(1) # Pequeño margen para la descarga
                _stop_ollama_container()
            finally:
                container_running = False
                container_stopping = False


threading.Thread(target=_inactivity_watcher, daemon=True).start()


def handle_heartbeat(uid: str = "anonymous"):
    global container_running, container_stopping
    active_ai_users[uid] = time.time()

    # Si se está apagando, esperar a que termine la ventana de apagado antes de revaluar
    if container_stopping:
        for _ in range(15):
            time.sleep(0.1)
            if not container_stopping:
                break

    # Verificar el estado REAL del contenedor: si está parado (aunque la
    # app lo crea activo), arrancarlo y esperar a que Ollama responda.
    if _ollama_container_running() and not container_stopping:
        container_running = True
    elif _start_ollama_container():
        container_running = True
        if not _wait_ollama_ready():
            _log_ollama("Ollama no respondió tras arrancar el contenedor")
    return {"ok": True}


def get_available_models(uid: str | None = None) -> tuple[list[dict], str | None]:
    """Modelos de Ollama (cacheados globalmente) + modelos externos del usuario."""
    models = _get_ollama_models_cached()
    if models is None:
        try:
            models = ollama_client.fetch_models()
            if models:
                _MODELS_CACHE["ts"] = time.time()
                _MODELS_CACHE["models"] = models
        except Exception as e:
            if _MODELS_CACHE["models"] is not None:
                models = _MODELS_CACHE["models"]
            else:
                return [], str(e)
    models = list(models)
    if uid:
        try:
            keys = repository.get_user_api_keys(uid)
            for key in keys:
                provider = key.get("provider", "API")
                if provider.lower() == "openrouter":
                    # Catálogo completo de OpenRouter (cacheado 1h): cada
                    # modelo entra como "API: openrouter:{id}". La app puede
                    # usar cualquiera, y el frontend marca los gratuitos
                    # (pricing.prompt == "0").
                    catalog = _fetch_openrouter_catalog()
                    if catalog:
                        for m in catalog:
                            mid = (m or {}).get("id")
                            if not mid:
                                continue
                            models.append({
                                "name": f"API: openrouter:{mid}",
                                "size": "N/A",
                                "modified_at": "OpenRouter",
                                "is_external": True,
                                "provider": "openrouter",
                                "pricing": (m or {}).get("pricing") or {},
                                "supported_parameters": (m or {}).get("supported_parameters") or [],
                            })
                    # Entrada genérica: usa el modelo configurado en la key
                    # (por defecto openrouter/auto)
                    models.append({
                        "name": "API: openrouter",
                        "size": "N/A",
                        "modified_at": "External API",
                        "is_external": True,
                        "provider": "openrouter",
                        "pricing": {},
                    })
                else:
                    models.append({
                        "name": f"API: {provider}",
                        "size": "N/A",
                        "modified_at": "External API",
                        "is_external": True,
                        "provider": provider
                    })
        except Exception:
            pass
    return models, None


def pull_ai_model(model_name: str, uid: str = "anonymous"):
    handle_heartbeat(uid)
    if model_name in ACTIVE_DOWNLOADS:
        return {"status": "started", "model": model_name, "message": "Ya se está descargando."}
    
    ACTIVE_DOWNLOADS[model_name] = {"progress": "Iniciando descarga...", "status": "downloading"}
    
    def _pull_worker():
        try:
            for chunk in ollama_client.pull_model(model_name):
                try:
                    parsed = json.loads(chunk)
                    if "error" in parsed:
                        ACTIVE_DOWNLOADS[model_name] = {"status": "error", "message": parsed["error"]}
                        socketio.emit('model_pull_progress', {"model": model_name, "status": "error", "message": parsed["error"]})
                        break
                    
                    status_text = parsed.get("status", "")
                    if "completed" in parsed and "total" in parsed:
                        completed_mb = parsed["completed"] / 1024 / 1024
                        total_mb = parsed["total"] / 1024 / 1024
                        status_text = f"{status_text} ({completed_mb:.1f}MB / {total_mb:.1f}MB)"
                    
                    ACTIVE_DOWNLOADS[model_name]["progress"] = status_text
                    socketio.emit('model_pull_progress', {"model": model_name, "status": "downloading", "progress": status_text, "raw": parsed})
                except (json.JSONDecodeError, TypeError):
                    pass
            
            if model_name in ACTIVE_DOWNLOADS and ACTIVE_DOWNLOADS[model_name].get("status") != "error":
                ACTIVE_DOWNLOADS[model_name] = {"status": "success", "progress": "Descarga completada."}
                socketio.emit('model_pull_progress', {"model": model_name, "status": "success"})
                _invalidate_models_cache()
                time.sleep(5)
                if model_name in ACTIVE_DOWNLOADS:
                    del ACTIVE_DOWNLOADS[model_name]
                    
        except Exception as e:
            ACTIVE_DOWNLOADS[model_name] = {"status": "error", "message": str(e)}
            socketio.emit('model_pull_progress', {"model": model_name, "status": "error", "message": str(e)})

    threading.Thread(target=_pull_worker, daemon=True).start()
    return {"status": "started", "model": model_name}


def delete_ai_model(model_name: str, uid: str = "anonymous") -> dict:
    handle_heartbeat(uid)
    result = ollama_client.delete_model(model_name)
    _invalidate_models_cache()
    return result


URL_PATTERN = re.compile(r'https?://[^\s<>"\']+')


def extract_urls(text: str) -> list[str]:
    urls = URL_PATTERN.findall(text)
    # Clean trailing punctuation that isn't part of the URL
    cleaned = []
    for url in urls:
        # Remove trailing punctuation but preserve balanced parentheses
        while url and url[-1] in '.,;:!?':
            url = url[:-1]
        # Balance parentheses (for Wikipedia-style URLs)
        open_count = url.count('(')
        close_count = url.count(')')
        while close_count > open_count and url.endswith(')'):
            url = url[:-1]
            close_count -= 1
        cleaned.append(url)
    return cleaned


def _url_is_safe(url: str) -> bool:
    """SSRF guard: solo http/https hacia hosts públicos (no IPs privadas/loopback)."""
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


def _fetch_safe(getter, url: str, headers: dict, timeout: int = 8):
    """GET con validación SSRF en cada hop (redirecciones incluidas)."""
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


def scrape_url_content(url: str, max_chars: int = 6000) -> str | None:
    """Scrape readable text content from a URL."""
    try:
        # Try cloudscraper first, fall back to requests
        resp = None
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            if text and len(text) > 10:  # Skip very short fragments
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


def _is_price_query(query: str) -> bool:
    price_keywords = [
        "precio", "precios", "cuánto cuesta", "cuanto cuesta", "cuánto vale", "cuanto vale",
        "comprar", "barato", "oferta", "ofertas", "descuento", "comparar precios",
        "price", "cost", "cheap", "buy", "deal", "discount",
        "mejor precio", "dónde comprar", "donde comprar", "tienda",
        "amazon", "pccomponentes", "mediamarkt", "el corte inglés",
        "€", "euros", "dolares", "$"
    ]
    q_lower = query.lower()
    return any(kw in q_lower for kw in price_keywords)


def _scrape_page_prices(url: str) -> str | None:
    try:
        import cloudscraper
        from bs4 import BeautifulSoup

        # SSRF guard: misma barrera que scrape_url_content; valida el host
        # y sigue redirecciones hop a hop a través de _fetch_safe.
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
            for el in elements[:5]:  # Limit to first 5 matches
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


def perform_web_search(query: str) -> str:
    """Performs a web search using duckduckgo-search. Enhanced for price queries."""
    try:
        from ddgs import DDGS
        
        is_price = _is_price_query(query)
        
        results = []
        with DDGS() as ddgs:
            if is_price:
                stores = ["amazon.es", "pccomponentes.com", "mediamarkt.es", "el corte inglés", "fnac.es"]
                
                general_results = list(ddgs.text(f"{query} precio", max_results=4))
                for res in general_results:
                    title = res.get('title', '')
                    snippet = res.get('body', '')
                    url = res.get('href', '')
                    if title and snippet:
                        results.append(f"Fuente: {title}\nURL: {url}\nInformación: {snippet}")
                
                for store in stores[:3]:
                    try:
                        store_results = list(ddgs.text(f"{query} {store} precio", max_results=2))
                        for res in store_results:
                            title = res.get('title', '')
                            snippet = res.get('body', '')
                            url = res.get('href', '')
                            if title and snippet:
                                results.append(f"Fuente [{store}]: {title}\nURL: {url}\nInformación: {snippet}")
                    except Exception:
                        continue
                
                seen_urls = []
                for res in general_results[:3]:
                    url = res.get('href', '')
                    if url and url not in seen_urls:
                        seen_urls.append(url)
                        scraped = _scrape_page_prices(url)
                        if scraped:
                            results.append(f"[PRECIO EXTRAÍDO DE PÁGINA]\nURL: {url}\n{scraped}")
            else:
                search_results = list(ddgs.text(query, max_results=6))
                for res in search_results:
                    title = res.get('title', '')
                    snippet = res.get('body', '')
                    url = res.get('href', '')
                    if title and snippet:
                        results.append(f"Fuente: {title}\nURL: {url}\nInformación: {snippet}")
                    
        if not results:
            return "No se encontraron resultados relevantes en la web o el buscador bloqueó la consulta."
            
        return "\n\n".join(results)
    except Exception as e:
        return f"Error durante la búsqueda: {str(e)}"

CANCELED_GENS = set()  # gen_id de generaciones canceladas (token por petición)
ACTIVE_GENERATIONS = {}  # session_id -> {"model": str, "started_at": float, "gen_id": str}

# Cola de generación: hardware limitado, una sola generación a la vez
MAX_CONCURRENT_GENERATIONS = int(os.environ.get("AI_MAX_CONCURRENT", "1"))
QUEUE_MAX_WAIT = float(os.environ.get("AI_QUEUE_MAX_WAIT", "300"))
QUEUE_POLL_INTERVAL = 0.5
_GEN_LOCK = threading.Lock()
_gen_active = 0
_gen_waiters: list[str] = []


class _GenerationQueueTimeout(Exception):
    pass


def _friendly_error(msg: str) -> str:
    """Traduce errores comunes del motor de IA a mensajes accionables."""
    m = (msg or "").lower()
    if any(k in m for k in (
        "context window", "context length", "context is too",
        "maximum context", "too large", "exceeds the", "truncat",
        "contexto", "ventana de contexto", "demasiado largo",
    )):
        return (
            "El mensaje o el contexto de la conversación es demasiado largo "
            "para este modelo. Reduce el texto, usa una conversación nueva o "
            "aumenta el límite de contexto del modelo."
        )
    return msg


def _dequeue_generation(key: str):
    with _GEN_LOCK:
        if key in _gen_waiters:
            _gen_waiters.remove(key)


def _queue_position(key: str) -> int:
    """Posición en cola: 0 = generando ya; 1..n = esperando turno."""
    with _GEN_LOCK:
        if key in _gen_waiters:
            return _gen_waiters.index(key) + 1
        return 0


def _acquire_generation_slot(key: str, notify, is_cancelled=None) -> bool:
    """Espera (FIFO) hasta conseguir slot de generación. notify(pos) en cada
    cambio de posición. Devuelve False si se canceló o se agotó el tiempo."""
    global _gen_active
    deadline = time.time() + QUEUE_MAX_WAIT
    _dequeue_generation(key)
    with _GEN_LOCK:
        if _gen_active < MAX_CONCURRENT_GENERATIONS and not _gen_waiters:
            # Ruta rápida: comprobar cancelación ANTES de ocupar el slot
            # (la cancelación puede llegar en el instante entre el registro
            # de la petición y la adquisición del slot).
            if is_cancelled is not None and is_cancelled():
                return False
            _gen_active += 1
            notify(0)
            return True
        if key not in _gen_waiters:
            _gen_waiters.append(key)
    last_emitted = -1
    while True:
        if is_cancelled is not None and is_cancelled():
            _dequeue_generation(key)
            return False
        with _GEN_LOCK:
            if (_gen_active < MAX_CONCURRENT_GENERATIONS
                    and _gen_waiters and _gen_waiters[0] == key):
                _gen_waiters.pop(0)
                _gen_active += 1
                notify(0)
                return True
            position = _gen_waiters.index(key) + 1 if key in _gen_waiters else 1
        if position != last_emitted:
            last_emitted = position
            notify(position)
        if time.time() > deadline:
            _dequeue_generation(key)
            return False
        time.sleep(QUEUE_POLL_INTERVAL)


def _release_generation_slot():
    global _gen_active
    with _GEN_LOCK:
        _gen_active = max(0, _gen_active - 1)

MAX_MESSAGES = 50
MAX_MESSAGE_CHARS = 131072
RATE_MAX = 30
RATE_WINDOW = 60.0
_RATE_LIMITS: dict[str, collections.deque] = {}

_MODELS_CACHE: dict = {"ts": 0.0, "models": None}
MODELS_CACHE_TTL = 300.0

# Catálogo público de modelos de OpenRouter (https://openrouter.ai/api/v1/models)
_OPENROUTER_CACHE: dict = {"ts": 0.0, "models": None}
OPENROUTER_CACHE_TTL = 3600.0


def _fetch_openrouter_catalog() -> list | None:
    """Catálogo completo de modelos de OpenRouter (público, sin auth).
    Devuelve la lista cacheada o None si no se puede obtener."""
    if (_OPENROUTER_CACHE["models"] is not None
            and time.time() - _OPENROUTER_CACHE["ts"] < OPENROUTER_CACHE_TTL):
        return _OPENROUTER_CACHE["models"]
    try:
        r = requests.get("https://openrouter.ai/api/v1/models", timeout=15)
        if r.status_code == 200:
            data = r.json().get("data", [])
            _OPENROUTER_CACHE["models"] = data
            _OPENROUTER_CACHE["ts"] = time.time()
            return data
    except requests.RequestException:
        pass
    return _OPENROUTER_CACHE["models"]


def _models_cache_fresh() -> bool:
    return (_MODELS_CACHE["models"] is not None
            and time.time() - _MODELS_CACHE["ts"] < MODELS_CACHE_TTL)


def models_cache_needs_refresh() -> bool:
    """True si hay que contactar con Ollama (el contenedor puede estar parado)."""
    return not _models_cache_fresh()


def _get_ollama_models_cached() -> list | None:
    return list(_MODELS_CACHE["models"]) if _models_cache_fresh() else None


def _invalidate_models_cache():
    _MODELS_CACHE["models"] = None


def is_rate_limited(uid: str | None, ip: str | None) -> tuple[bool, int]:
    """Ventana deslizante por usuario/IP. Devuelve (limitado, retry_after_seg)."""
    key = f"{uid or 'anon'}:{ip or 'unknown'}"
    now = time.monotonic()
    dq = _RATE_LIMITS.setdefault(key, collections.deque())
    while dq and now - dq[0] > RATE_WINDOW:
        dq.popleft()
    if len(dq) >= RATE_MAX:
        return True, max(1, int(RATE_WINDOW - (now - dq[0])))
    dq.append(now)
    return False, 0


def validate_chat_payload(data: dict) -> str | None:
    """Valida el payload de /api/ai/chat. Devuelve un error o None."""
    messages = data.get("messages") if isinstance(data, dict) else None
    if not isinstance(messages, list) or not messages:
        return "Faltan mensajes en la petición"
    if len(messages) > MAX_MESSAGES:
        return f"Demasiados mensajes (máximo {MAX_MESSAGES})"
    for m in messages:
        content = m.get("content") if isinstance(m, dict) else None
        if not isinstance(content, str) or not content.strip():
            return "Mensaje vacío en el historial"
        if len(content) > MAX_MESSAGE_CHARS:
            return f"Mensaje demasiado largo (máximo {MAX_MESSAGE_CHARS} caracteres)"
    return None

def cancel_generation(session_id: str):
    if session_id:
        entry = ACTIVE_GENERATIONS.get(session_id)
        if entry and entry.get("gen_id"):
            CANCELED_GENS.add(entry["gen_id"])
        ACTIVE_GENERATIONS.pop(session_id, None)
        # Cancelar también cualquier petición de esta sesión atascada en la cola (_gen_waiters)
        prefix = f"{session_id}:"
        with _GEN_LOCK:
            to_remove = [k for k in _gen_waiters if k.startswith(prefix)]
            for k in to_remove:
                _gen_waiters.remove(k)
                gid = k.split(":", 1)[1] if ":" in k else None
                if gid:
                    CANCELED_GENS.add(gid)

def get_generation_status(session_id: str) -> dict:
    if session_id and session_id in ACTIVE_GENERATIONS:
        return {"generating": True, **ACTIVE_GENERATIONS[session_id]}
    return {"generating": False}

def get_all_active_generations() -> dict:
    return dict(ACTIVE_GENERATIONS)

# Puerta de fecha: prohibir creaciones cuya fecha NO aparezca en el mensaje
# (el modelo tiende a inventar la fecha en vez de preguntarla). Solo se permite
# crear sin día explícito en la jornada ('he trabajado...' = hoy) y en los
# planes de estudio (las fechas derivan del examen real inyectado).
# (DATE_MSG_RE y _DATE_GATE_EXEMPT_RE viven en tools.py: fuente única)


# ─── Extracción estructurada con privacidad (modelos externos / API) ───
# 1) Enmascarado local de entidades sensibles; 2) inferencia externa con
# JSON estricto (el proveedor nunca ve los datos reales); 3) desenmascarado,
# persistencia y respuesta con plantilla local.
EXTRACTION_SYSTEM_PROMPT = """Eres un motor de extracción estructurada para una agenda personal y registro de actividades.
Tu única tarea es analizar el texto del usuario y devolver un objeto JSON estricto según las instrucciones.

REGLAS:
1. No inventes información. Si un dato no está presente, usa null.
2. Conserva intactos todos los identificadores opacos con formato <PII:tipo:id>.
   Nunca alteres, acortes, traduzcas ni reformatees un tag PII. Cópialos exactamente.
3. Clasifica la intención en una de estas acciones:
   - "log_work": Registros de horas trabajadas o tareas realizadas.
   - "create_event": Nuevas citas o eventos programados a futuro.
   - "list_events": Consultas sobre eventos o agenda.
   - "delete_event": Cancelaciones o borrados.
   - "unknown": Si no coincide con ninguna acción de agenda/registro.
4. Devuelve ÚNICAMENTE el JSON, sin bloques de código markdown, explicaciones ni saludos.

SCHEMA JSON DE SALIDA:
{
  "action": "log_work" | "create_event" | "list_events" | "delete_event" | "unknown",
  "title": string | null,
  "entity": string | null,
  "location": string | null,
  "duration_hours": number | null,
  "target_date_raw": string | null,
  "target_time_raw": string | null,
  "notes": string | null
}"""


def _build_study_plan(exams, lang="es"):
    """Plan de estudio determinista a partir de los exámenes reales (títulos
    y fechas): semanas completas entre hoy y el primer examen, repartiendo el
    tiempo entre los exámenes cuando hay varios. Último recurso si el modelo
    se niega a elaborar el plan."""
    en = lang == "en"
    sorted_exams = sorted(exams, key=lambda e: (e.get("date") or "9999"))
    today = date.today()
    lines = []
    if en:
        lines.append(f"You have {len(sorted_exams)} upcoming exam(s):")
    else:
        lines.append(f"Tienes {len(sorted_exams)} exámenes próximos:")
    for e in sorted_exams:
        d = e.get("date") or "?"
        lines.append(f'  - "{e.get("title", "")}" el {d}')
    first = (sorted_exams[0] or {}).get("date")
    first_d = None
    try:
        first_d = date.fromisoformat(first) if first else None
    except (TypeError, ValueError):
        first_d = None
    if first_d and first_d >= today:
        weeks = max(1, ((first_d - today).days // 7) + 1)
        half = max(1, weeks // 2) if len(sorted_exams) > 1 else None
        if en:
            lines.append(f"Until the first exam ({first}) there are about {weeks} full week(s).")
            lines.append("Proposed plan (from today to the exam):")
        else:
            lines.append(f"Desde hoy hasta el primer examen ({first}) hay unas {weeks} semana(s) completas.")
            lines.append("Plan propuesto (de hoy al examen):")
        for i in range(weeks):
            start = today + timedelta(weeks=i)
            end = start + timedelta(days=6)
            if half is not None:
                if i < half:
                    target = 1
                    label = f'examen {1}: "{sorted_exams[0].get("title", "")}"'
                else:
                    target = 2
                    label = f'examen {2}: "{sorted_exams[1].get("title", "")}"' if len(sorted_exams) > 1 else "repaso general"
            else:
                target = 1
                label = f'examen {1}: "{sorted_exams[0].get("title", "")}"'
            if en:
                lines.append(f"- Week {i+1} ({start:%d-%m} to {end:%d-%m}): study for {label}")
            else:
                lines.append(f"- Semana {i+1} ({start:%d-%m} a {end:%d-%m}): estudiar para {label}")
        if en:
            lines.append("If you want, I can create these study sessions as tasks in your calendar.")
        else:
            lines.append("Si quieres, puedo apuntar estas sesiones de estudio como tareas en tu calendario.")
    return "\n".join(lines)


def _run_external_extraction(uid, text, api_key, api_url, model_name, priv_ctx=None):
    """Enmascara el texto y pide el JSON estricto a la API externa.

    Si se proporciona priv_ctx (MaskingContext), se enmascara con ese contexto
    compartido (los tags son consistentes con el resto de la generación y la
    deduplicación es correcta). Si no, crea un contexto temporal anónimo.

    Devuelve (data, mapping, masked) o (None, mapping, masked) si falla.
    """
    if priv_ctx is not None:
        # Usar el contexto compartido de la generación: misma dedup y mismos tags
        _msgs, mapping = privacy.mask_conversation_with_context(
            [{"role": "user", "content": text}], priv_ctx
        )
        masked = _msgs[0]["content"]
    else:
        masked, mapping = privacy.mask_sensitive(text)
    today = date.today().isoformat()
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Fecha actual: {today}. Mensaje: {masked}"},
        ],
        "temperature": 0.1,
        "max_tokens": 300,
    }
    try:
        content = external_client.complete(payload, api_key, api_url, timeout=45)
    except Exception:
        return None, mapping, masked
    data = tools._tolerant_json(content)
    if not isinstance(data, dict):
        return None, mapping, masked
    return data, mapping, masked


def _handle_extracted_action(uid, data, mapping, user_text, lang="es"):
    """Ejecuta la acción extraída y devuelve una respuesta con plantilla local
    (datos desenmascarados), o None si hay que seguir el flujo normal."""
    en = lang == "en"
    action = str(data.get("action") or "unknown").strip().lower()
    if action not in ("log_work", "create_event", "list_events"):
        return None

    def _v(key):
        raw = data.get(key)
        if raw is None:
            return None
        return privacy.unmask(str(raw).strip(), mapping) or None

    title = _v("title")
    entity = _v("entity")
    location = _v("location")
    date_raw = _v("target_date_raw")
    time_raw = _v("target_time_raw")
    notes = _v("notes")
    try:
        duration = float(data["duration_hours"]) if data.get("duration_hours") is not None else None
    except (TypeError, ValueError):
        duration = None

    if action == "list_events":
        period = tools.detect_read_period(user_text) or (date_raw or None)
        args = {"period": period} if period else {}
        result = tools.execute_tool("list_upcoming_events", args, uid)
        if isinstance(result, dict) and result.get("events") is not None:
            return tools.format_events_summary(result, lang)
        return None

    if action == "log_work":
        if not title and entity:
            title = f"Trabajo en {entity}"
        title = title or "Trabajo"
        args = {"title": title, "category": "trabajo"}
        if location:
            args["location"] = location
        if duration or notes:
            parts = [f"Trabajo de {duration:g}h" if duration else None, notes]
            args["description"] = " · ".join(p for p in parts if p)
        args["date"] = date_raw or date.today().isoformat()
    else:  # create_event
        args = {}
        if title:
            args["title"] = title
        if date_raw:
            args["date"] = date_raw
        if time_raw:
            args["startTime"] = time_raw
        if location:
            args["location"] = location
        if notes:
            args["description"] = notes

    result = tools.execute_tool("create_event", args, uid)
    if isinstance(result, dict) and result.get("error"):
        return None  # faltan datos: se sigue el flujo normal (pregunta determinista)
    if isinstance(result, dict) and result.get("ok"):
        # Fecha resuelta a ISO (las fechas relativas las normaliza el servidor)
        normalized = tools.normalize_tool_args("create_event", args) or args
        d = normalized.get("date") or args.get("date") or date.today().isoformat()
        if en:
            noun = "work" if action == "log_work" else "event"
            return f'I have recorded the {noun} "{args.get("title")}" for {d}.'
        noun = "el trabajo" if action == "log_work" else "el evento"
        return f'He registrado {noun} "{args.get("title")}" para el {d}.'
    return None


def _run_tool_once(executed_tool_calls, name, args, uid, last_user_text=None, study_plan_ctx=False):
    """Ejecuta una herramienta evitando duplicados (mismo nombre + mismos args).

    Para consultas de lectura con periodo ('dónde he trabajado esta semana'),
    el resultado de list_upcoming_events se ajusta al periodo y a los eventos
    de trabajo detectados en la consulta del usuario.
    """
    # Los modelos débiles omiten campos en update_event (p. ej. description):
    # se rellenan desde el mensaje del usuario si este los mencionó.
    if name == "update_event" and isinstance(args, dict) and last_user_text:
        enriched = tools.enrich_update_args(args, last_user_text)
        if enriched != args:
            args = enriched
    # Si el usuario delega la fecha ("en la fecha que quieras") y el modelo
    # no la aporta, se usa el día de hoy en lugar de bloquear.
    if (name in ("create_event", "create_task") and isinstance(args, dict)
            and last_user_text and not (args.get("date") or args.get("fecha"))
            and tools._DATE_DELEGATED_RE.search(last_user_text)):
        args["date"] = date.today().isoformat()
    call_key = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
    if call_key in executed_tool_calls:
        return executed_tool_calls[call_key], False
    # Puerta de fecha: si el usuario NO menciona ningún día, un create con
    # fecha (inventada por el modelo) se rechaza y se obliga a preguntar.
    # EXCEPCIÓN: con un plan de estudio activo las fechas derivan de los
    # exámenes reales inyectados por el servidor (no son inventadas), aunque
    # el usuario no repita el día en cada seguimiento ("apúntalo").
    if (name in ("create_event", "create_task")
            and last_user_text
            and not study_plan_ctx
            and not tools.DATE_MSG_RE.search(last_user_text)
            and not tools._DATE_GATE_EXEMPT_RE.search(last_user_text)):
        result = {
            "error": (
                "El usuario no ha indicado qué día. NO crees el evento/tarea y NO "
                "inventes una fecha: pregunta al usuario qué día quiere antes de "
                "volver a intentarlo."
            )
        }
        executed_tool_calls[call_key] = result
        return result, True
    result = tools.execute_tool(name, args, uid)
    if name == "list_upcoming_events" and last_user_text:
        period = tools.detect_read_period(last_user_text)
        if period:
            filtered = tools.execute_tool("list_upcoming_events", {"period": period}, uid)
            if re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE):
                evs = [
                    e for e in (filtered.get("events") or [])
                    if re.search(r"trabaj|work", e.get("title") or "", re.IGNORECASE)
                ]
                filtered = {"events": evs, "total": len(evs)}
            result = filtered
    executed_tool_calls[call_key] = result
    return result, True


def _fallback_summary(executed_tool_calls, lang="es"):
    """Resumen determinista cuando el modelo no genera texto legible."""
    en = lang == "en"
    last_list = None
    last_ok_name = None
    for (name, _), result in executed_tool_calls.items():
        if isinstance(result, dict):
            if "events" in result:
                last_list = result
            if result.get("ok"):
                last_ok_name = name
    if last_list is not None:
        return tools.format_events_summary(last_list, lang)
    if last_ok_name:
        if en:
            verb = {
                "create_event": "created the event",
                "create_task": "created the task",
                "update_event": "updated the item",
                "delete_event": "deleted the item",
            }.get(last_ok_name)
            if verb:
                return f"Done. I have {verb} in your calendar."
        else:
            verb = {
                "create_event": "creado el evento",
                "create_task": "creada la tarea",
                "update_event": "actualizado el elemento",
                "delete_event": "eliminado el elemento",
            }.get(last_ok_name)
            if verb:
                return f"Hecho. He {verb} en tu agenda."
    return "Done." if en else "Hecho."


def _write_confirmation(executed_tool_calls, lang="es"):
    """Confirmación determinista de las escrituras ejecutadas con éxito.
    Si se crearon varias tareas/eventos (p. ej. un plan de estudio completo),
    se confirman TODAS en un resumen, no solo la última."""
    created = []
    updated_or_deleted = None
    for (name, args_dump), result in executed_tool_calls.items():
        if not (isinstance(result, dict) and result.get("ok")):
            continue
        try:
            args = json.loads(args_dump)
        except (json.JSONDecodeError, TypeError):
            args = {}
        if name in ("create_event", "create_task"):
            created.append((name, args))
        elif name in ("update_event", "delete_event"):
            updated_or_deleted = (name, args)

    en = lang == "en"
    parts = []

    if created:
        if len(created) == 1:
            name, args = created[0]
            title = args.get("title") or ""
            if name == "create_task":
                msg = 'I have created the task "{0}"' if en else 'He creado la tarea "{0}"'
            else:
                msg = 'I have created the event "{0}"' if en else 'He creado el evento "{0}"'
            msg = msg.format(title)
            if args.get("date"):
                msg += (f" for {args['date']}" if en else f" para el {args['date']}")
            if args.get("startTime"):
                msg += (f" at {args['startTime']}" if en else f" a las {args['startTime']}")
            parts.append(msg + ".")
        else:
            if en:
                parts.append(f"I have created {len(created)} items in your calendar:")
            else:
                parts.append(f"He creado {len(created)} tareas/eventos en tu agenda:")
            for (name, args) in created[:8]:
                title = args.get("title") or ""
                d = args.get("date") or ""
                t = args.get("startTime") or ""
                line = f'  - "{title}"'
                if d:
                    line += f" ({d}" + (f" {t})" if t else ")")
                parts.append(line)
            if len(created) > 8:
                parts.append(f"  - ...y {len(created) - 8} más" if not en
                             else f"  - ...and {len(created) - 8} more")

    if updated_or_deleted is not None:
        name, args = updated_or_deleted
        if name == "update_event":
            parts.append("I have updated the item in your calendar." if en
                         else "He actualizado el elemento en tu agenda.")
        else:
            parts.append("I have deleted the item from your calendar." if en
                         else "He eliminado el elemento de tu agenda.")

    return "\n".join(parts) if parts else None


def stream_chat(uid: str | None, data: dict):
    import queue
    
    model = data.get("model", "llama3")
    messages = data.get("messages", [])
    session_id = data.get("session_id")
    title = data.get("title", "New Chat")
    reasoning_mode = bool(data.get("reasoning_mode", False))

    if uid and messages:
        last_msg = messages[-1]
        if last_msg.get("role") == "user":
            workspace_id = data.get("workspace_id")
            session_id = repository.create_session(uid, model, title, session_id, workspace_id)

            # Se re-sincroniza el historial con lo enviado por el cliente
            # (ediciones), pero PRESERVANDO el modelo original de cada mensaje
            # histórico: si se sobreescribiera con el modelo actual, se perdería
            # qué IA respondió realmente a cada mensaje.
            _prev = repository.get_session_messages(uid, session_id)
            _prev_pool = [(r.get("role"), r.get("content"), r.get("model")) for r in _prev]
            _used = set()

            def _prev_model_for(role, content):
                for i, (r, c, mdl) in enumerate(_prev_pool):
                    if i in _used:
                        continue
                    if r == role and c == content:
                        _used.add(i)
                        return mdl
                return None

            repository.clear_session_messages(uid, session_id)
            for m in messages:
                _m_model = _prev_model_for(m.get("role"), m.get("content")) or model
                repository.save_message(uid, session_id, m["role"], m["content"], _m_model)

    options = dict(data.get("options") or {})
    if reasoning_mode:
        options.setdefault("temperature", 0.6)
        options.setdefault("num_predict", 6000)
        sys_directive = ""
    else:
        options.setdefault("temperature", 0.1)
        options.setdefault("num_predict", 1000)
        sys_directive = "Responde de forma directa y concisa, sin explicaciones ni razonamientos internos innecesarios."

    payload = {**data, "keep_alive": "30s", "options": options}
    q = queue.Queue()
    gen_id = uuid.uuid4().hex
    # Compartido entre el worker y el generador (cliente): True cuando el
    # cliente recibió el final del stream. Si nunca lo recibe (se cerró la
    # conexión, cambió de página...), la respuesta se completó en segundo
    # plano y hay que notificarlo.
    _state = {"consumed": False}
    # Privacidad: contexto de enmascarado para toda la generación.
    # Es la única fuente de verdad para el mapping PII ↔ valor real.
    # INVARIANTE: agent_messages SIEMPRE contiene datos reales; solo
    # el model_payload que sale a APIs externas se construye enmascarado.
    _priv_ctx = privacy.MaskingContext()
    
    if session_id:
        q.put(("chunk", json.dumps({"session_id": session_id}) + "\n"))
    
    if session_id:
        ACTIVE_GENERATIONS[session_id] = {
            "model": model, "started_at": time.time(), "gen_id": gen_id,
        }

    def _is_cancelled() -> bool:
        return gen_id in CANCELED_GENS

    def background_worker():
        full_response = ""
        final_text = None
        slot_acquired = False
        last_qpos = [-1]
        # Clave ÚNICA por petición: la sesión se reutiliza entre mensajes y
        # cancelar/limpiar por session_id afectaría a otras generaciones
        # (la vieja cancelada seguiría ocupando el slot y la nueva se quedaría
        # esperando en cola sin que nadie la desbloquee).
        gen_key = f"{session_id or 'anon'}:{gen_id}"

        def _queue_notify(position):
            if position != last_qpos[0]:
                last_qpos[0] = position
                q.put(("chunk", json.dumps({"queue": {"position": position}}) + "\n"))

        def _final(msg):
            """Envía el mensaje FINAL al cliente y lo marca para persistirlo en
            BD aunque el cliente se desconecte antes de recibirlo (la respuesta
            se completa en segundo plano y se guarda en la sesión)."""
            nonlocal final_text
            if _priv_ctx.mapping:
                msg = privacy.unmask(msg, _priv_ctx.mapping)
            final_text = msg
            q.put(("chunk", (json.dumps({"message": {"content": msg}}) + "\n").encode()))

        try:
            # Cola de generación: esperar turno (1 generación simultánea)
            # La cola de generación solo serializa el hardware LOCAL (Ollama):
            # las llamadas a APIs externas y las respuestas deterministas
            # (código Python, sin GPU) NO pasan por la cola. El slot se toma
            # justo antes de la llamada a Ollama (abajo).
            slot_acquired = False

            last_user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), None) if messages else None
            
            # --- URL Detection: scrape URLs found in the user's message ---
            if last_user_msg:
                urls_in_message = extract_urls(last_user_msg)
                if urls_in_message:
                    q.put(("chunk", json.dumps({"message": {"role": "assistant", "content": "🔗 *Analizando enlaces...*\n\n"}})))
                    
                    scraped_contents = []
                    for url in urls_in_message[:3]:  # Limit to 3 URLs
                        content = scrape_url_content(url)
                        if content:
                            scraped_contents.append(content)
                    
                    if scraped_contents:
                        url_context = "\n\n---\n\n".join(scraped_contents)
                        url_system_prompt = f"""El usuario ha compartido uno o más enlaces. A continuación se muestra el contenido extraído de esas páginas web.
Usa esta información para responder a la pregunta del usuario sobre estos enlaces.
Basa tu respuesta ÚNICAMENTE en el contenido extraído. No inventes información que no aparezca en el texto.

--- CONTENIDO DE LOS ENLACES ---
{url_context}
--- FIN DEL CONTENIDO ---"""
                        if len(payload["messages"]) > 0:
                            # Contenido externo (web scraping): puede contener cualquier dato.
                            # Se deja que el gateway lo procese en la ruta de enmascarado.
                            payload["messages"].insert(-1, {"role": "system", "content": url_system_prompt})
            
            # --- Workspace Context Injection ---
            workspace_id = data.get("workspace_id")
            if workspace_id:
                ws_files = repository.get_workspace_files(workspace_id)
                if ws_files:
                    ws_context_parts = []
                    for f in ws_files:
                        content = repository.get_workspace_file_content(f["id"])
                        ws_context_parts.append(f"--- Archivo: {f['filename']} ---\n{content}\n")
                    
                    if ws_context_parts:
                        ws_prompt = "Tienes acceso a los siguientes archivos del Espacio de Trabajo (Workspace) actual. Úsalos como contexto para responder a las preguntas del usuario:\n\n" + "\n".join(ws_context_parts)
                        # Insert right before the last user message
                        if len(payload["messages"]) > 0:
                            # El contenido del Workspace puede incluir PII (nombres,
                            # IBANs, teléfonos en documentos del usuario). No usar
                            # _mask=False: el gateway debe procesarlo.
                            payload["messages"].insert(-1, {"role": "system", "content": ws_prompt})

            # --- Web Search Mode ---
            if data.get("search_mode") and last_user_msg:
                q.put(("chunk", json.dumps({"message": {"role": "assistant", "content": "🔍 *Buscando en la web...*\n\n"}})))
                
                # La consulta al buscador es una salida a terceros: enmascarar
                # antes de enviarla a DuckDuckGo (igual que con cualquier API externa).
                _safe_query, _ = privacy.mask_conversation_with_context(
                    [{"role": "user", "content": last_user_msg}], _priv_ctx
                )
                search_query = _safe_query[0]["content"]
                search_results = perform_web_search(search_query)
                system_prompt = f"""INSTRUCCIONES CRÍTICAS PARA ESTA RESPUESTA:
1. A continuación se te proporcionan resultados REALES extraídos de internet en tiempo real.
2. Responde ÚNICAMENTE con la información que aparece textualmente en estos resultados.
3. NO inventes, supongas ni completes NINGÚN dato que no esté explícitamente en los resultados (fechas, marcadores, nombres, lugares, etc.).
4. Si los resultados no contienen suficiente información para responder completamente, di explícitamente: "Según los resultados de búsqueda disponibles, solo puedo confirmar que..." y limita tu respuesta a lo que sí aparece.
5. Cita las fuentes cuando sea posible.
6. NUNCA menciones tu fecha de corte de conocimiento. Usa SOLO estos resultados.

--- RESULTADOS DE BÚSQUEDA WEB EN TIEMPO REAL ---
{search_results}
--- FIN DE RESULTADOS ---"""
                
                # Inject as a system message right before the last user message
                if len(payload["messages"]) > 0:
                    # Contenido externo (resultados de búsqueda): puede contener
                    # nombres o datos que el gateway debe procesar.
                    payload["messages"].insert(-1, {"role": "system", "content": system_prompt})
                        
            is_external = False
            external_api_key = None
            external_api_url = None
            actual_model_name = model
            
            if model.startswith("API:"):
                is_external = True
                rest = model.split(":", 1)[1].strip()
                # Formato "API: openrouter:google/gemini-2.5-flash" -> proveedor
                # openrouter + id de modelo concreto del catálogo.
                sub_model = None
                provider = rest
                if ":" in rest:
                    provider, _, sub_model = rest.partition(":")
                    provider = provider.strip()
                    sub_model = sub_model.strip()
                key_data = None
                if uid:
                    key_data = repository.get_api_key(uid, provider)
                    if key_data:
                        external_api_key = key_data["api_key"]
                        external_api_url = key_data["api_url"]

                _prov = provider.lower()
                if _prov == "deepseek":
                    actual_model_name = sub_model or "deepseek-chat"
                    external_api_url = external_api_url or "https://api.deepseek.com"
                elif _prov == "openai":
                    actual_model_name = sub_model or "gpt-3.5-turbo"
                    external_api_url = external_api_url or "https://api.openai.com/v1"
                elif _prov == "openrouter":
                    actual_model_name = sub_model or (key_data or {}).get("model") or "openrouter/auto"
                    external_api_url = external_api_url or "https://openrouter.ai/api/v1"
                else:
                    actual_model_name = sub_model or provider
                    external_api_url = external_api_url or "https://api.openai.com/v1"
            
            if data.get("external_provider"):
                is_external = True
                provider = data["external_provider"]
                actual_model_name = data.get("model")
                if uid:
                    key_data = repository.get_api_key(uid, provider)
                    if key_data:
                        external_api_key = key_data["api_key"]
                        external_api_url = key_data["api_url"]
                if provider.lower() == "openrouter" and not external_api_url:
                    external_api_url = "https://openrouter.ai/api/v1"

            # ¿El modelo externo de OpenRouter soporta tools/tool_choice?
            # (se consulta el catálogo cacheado: supported_parameters)
            external_tools = False
            external_tool_choice = True
            if is_external and provider and provider.lower() == "openrouter" and sub_model:
                _catalog = _fetch_openrouter_catalog() or []
                _entry = next((m for m in _catalog if (m or {}).get("id") == sub_model), None)
                _params = (_entry or {}).get("supported_parameters") or []
                external_tools = "tools" in _params
                external_tool_choice = "tool_choice" in _params

            # Agente con herramientas controladas (asistente de agenda)
            # Funciona con CUALQUIER modelo: tools nativas si las soporta,
            # y si no, el modelo responde en un formato JSON guiado por el
            # prompt que el servidor parsea y ejecuta (whitelist segura).
            last_user_text = next(
                (m.get("content", "") for m in reversed(payload.get("messages", []))
                 if isinstance(m, dict) and m.get("role") == "user"),
                "",
            )
            # Modo Normal ('normal'): chat libre, sin herramientas ni inyección
            # de agenda. Modo Agenda (por defecto): pipeline determinista+tools.
            chat_mode = str(data.get("mode", "") or "").strip().lower()
            agenda_disabled = chat_mode == "normal"
            agenda_intent = (not agenda_disabled) and tools.is_agenda_request(last_user_text)
            user_lang = tools.detect_lang(last_user_text)
            buffer_all = agenda_intent
            # Prompt del sistema según el modo: SOLO en modo agenda se inyecta
            # el prompt del agente de agenda (con sus herramientas); en modo
            # normal el modelo recibe un prompt neutro de chat libre.
            if agenda_disabled:
                _system_prompt = (
                    "Eres un asistente de IA útil. Responde al usuario de forma "
                    "clara y concisa, en el mismo idioma en que te escribe."
                )
            else:
                _system_prompt = tools.build_agent_prompt(extraction=agenda_intent)
            
            if sys_directive:
                _system_prompt += "\n" + sys_directive
                
            agent_messages = [{"role": "system", "content": _system_prompt}] + list(payload.get("messages", []))
            # Contexto general: SIEMPRE se inyectan los próximos eventos, para que
            # el modelo pueda razonar con datos reales en cualquier consulta
            # relacionada con tiempo/planificación (exámenes, citas, "me da tiempo...")
            # sin depender de detectar palabras clave concretas.
            injected_events = None
            _future_exams: list = []
            _data_backed = False
            if not is_external and not agenda_disabled:
                injected_events = tools.execute_tool("list_upcoming_events", {"days": 30}, uid)
                if isinstance(injected_events, dict) and injected_events.get("events"):
                    _data_backed = True
                    agent_messages.insert(1, {
                        "role": "system",
                        "content": (
                            "Contexto de agenda del usuario (úsalo SOLO si es relevante para la "
                            "pregunta: fechas límite, planificación, disponibilidad; no lo menciones "
                            "si no aporta; si necesitas más datos usa list_upcoming_events). "
                            "Si el usuario pregunta por algo que NO está en esta lista, responde "
                            "que no está registrado en su agenda y NO inventes fechas ni datos: "
                            + json.dumps(injected_events, ensure_ascii=False)
                        ),
                    })
            # Inyección determinista para intenciones de agenda detectadas:
            # lecturas con periodo, exámenes y filtros de trabajo se resuelven en
            # el servidor (independiente del modelo). El modelo solo redacta.
            if agenda_intent:
                _period = tools.detect_read_period(last_user_text)
                if _period:
                    injected_events = tools.execute_tool(
                        "list_upcoming_events",
                        {"period": _period},
                        uid,
                    )
                    if (isinstance(injected_events, dict) and injected_events.get("events")):
                        _data_backed = True
                    if (not re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE)
                            and isinstance(injected_events, dict)
                            and not (injected_events.get("events") or injected_events.get("summary"))):
                        injected_events["summary"] = (
                            "No tienes eventos registrados en ese periodo."
                            if user_lang != "en" else
                            "You have no events registered in that period."
                        )
                # Consultas de estudio/examen: mensaje de sistema dedicado con el
                # examen real y su fecha límite (o el caso negativo: no existe)
                if re.search(r"examen|estudiar|estudio|exam|study", last_user_text, re.IGNORECASE):
                    _exams_all = tools.execute_tool("list_upcoming_events", {"query": "examen"}, uid)
                    _exams = _exams_all.get("events") or [] if isinstance(_exams_all, dict) else []
                    _today_iso = __import__('datetime').date.today().isoformat()
                    _future_exams = [e for e in _exams if (e.get("date") or "") >= _today_iso]
                    _past_exams = [e for e in _exams if (e.get("date") or "") < _today_iso]
                    if not _exams:
                        _data_backed = True
                        agent_messages.insert(1, {
                            "role": "system",
                            "content": (
                                "AVISO: no hay ningún examen registrado en la agenda del usuario. "
                                "Si pregunta por un examen concreto o una fecha, responde que no "
                                "está registrado en su agenda y NO inventes fechas ni datos."
                            ),
                        })
                    elif not _future_exams and _past_exams:
                        _data_backed = True
                        _last = max(_past_exams, key=lambda e: e.get("date") or "")
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                f"No hay exámenes próximos en la agenda; el último fue "
                                f"\"{_last.get('title', '')}\" el {_last.get('date', '')}. "
                                "Si pregunta por la fecha de un examen pasado, usa este dato; "
                                "no inventes fechas."
                            ),
                        })
                    if _future_exams:
                        _data_backed = True
                        _nearest = min(_future_exams, key=lambda e: e.get("date") or "9999")
                        _exam_date = None
                        try:
                            _exam_date = __import__('datetime').date.fromisoformat(_nearest.get("date") or "")
                        except Exception:
                            _exam_date = None
                        _last_sunday = ""
                        if _exam_date:
                            _last_sunday = (_exam_date - __import__('datetime').timedelta(days=(_exam_date.weekday() + 1) % 7)).isoformat()
                        # TODOS los exámenes próximos (el plan puede cubrir varios)
                        _exams_list = " | ".join(
                            f"\"{e.get('title', '')}\" el {e.get('date', '?')}"
                            for e in sorted(_future_exams, key=lambda e: e.get("date") or "9999")
                        )
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                "DATOS DE LOS EXÁMENES (fechas límite OBLIGATORIAS del plan de estudio): "
                                f"{_exams_list}. "
                                f"Hoy es {_nearest.get('_hoy', '') or __import__('datetime').date.today().isoformat()}. "
                                "NO preguntes al usuario las fechas de los exámenes ni cuántas semanas "
                                "tiene: ya las conoces. Responde DIRECTAMENTE con el plan completo "
                                "repartiendo los temas en SEMANAS COMPLETAS entre hoy y el primer "
                                "examen (no un tema por día). Si hay varios exámenes, reparte el "
                                "tiempo entre todos y termina antes de cada fecha límite. Ejemplo de "
                                "formato: 'Tu examen es el 2026-09-01. Este es tu plan:\n- Semana 1 "
                                "(17-23 agosto): Lógica y Teoría de conjuntos\n- Semana 2 (24-30 "
                                "agosto): Teoría de números y Combinatoria\n- Semana 3 (31 agosto-1 "
                                "septiembre): Grafos y repaso'. NO escribas rangos de fechas entre "
                                "paréntesis: escribe solo 'Semana 1', 'Semana 2', etc. (evita errores "
                                "de fechas). El plan debe cubrir los temas entre hoy y cada examen, "
                                "terminando antes de cada fecha límite. Si el usuario pide APUNTAR "
                                "las sesiones en el calendario (p. ej. 'apúntalo', 'apunta el plan'), "
                                "crea UNA TAREA POR CADA SEMANA del plan (create_task con la fecha de "
                                "inicio de cada semana, categoría 'estudio'), cubriendo TODAS las "
                                "semanas desde hoy hasta el primer examen sin dejar huecos, y una "
                                "tarea de repaso general justo antes de cada examen."
                            ),
                        })

                # Si el mensaje actual no menciona estudio/examen pero la
                # conversación reciente sí (p. ej. seguimiento: "apúntalo en el
                # calendario" tras un plan de estudio), se recupera el contexto
                # del plan: las fechas de las tareas saldrán de los exámenes
                # reales, no de lo que invente el modelo.
                if not _future_exams and any(
                    isinstance(m, dict)
                    and re.search(r"examen|estudi|plan\s+de\s+estudio|sesiones?\s+de\s+estudio",
                                  m.get("content") or "", re.IGNORECASE)
                    for m in (payload.get("messages") or [])[-6:]
                ):
                    _ctx_exams = tools.execute_tool("list_upcoming_events", {"query": "examen"}, uid)
                    _ctx_list = _ctx_exams.get("events") or [] if isinstance(_ctx_exams, dict) else []
                    _today_iso = date.today().isoformat()
                    _future_exams = [e for e in _ctx_list if (e.get("date") or "") >= _today_iso]

                # Consultas de trabajo: si hay periodo ('esta semana') se filtran
                # los eventos de ese periodo; si no ('¿cuándo he trabajado en la
                # empresa A?') se busca en TODO el historial por empresa o trabajo
                _work_query = None
                if re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE) and not _period:
                    _company = tools.extract_company(last_user_text)
                    _work_query = _company or "trabajo"
                    injected_events = tools.execute_tool("list_upcoming_events", {"query": _work_query}, uid)
                    if isinstance(injected_events, dict) and injected_events.get("events"):
                        _data_backed = True
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                f"Registros de trabajo del usuario (búsqueda \"{_work_query}\" en todo "
                                "el historial; responde con las fechas reales): "
                                + json.dumps(injected_events, ensure_ascii=False)
                            ),
                        })
                if _period and re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE):
                    _data_backed = True
                    _work_events = [
                        e for e in ((injected_events or {}).get("events") or [])
                        if re.search(r"trabaj|work", e.get("title") or "", re.IGNORECASE)
                    ]
                    injected_events = {"events": _work_events, "total": len(_work_events)}
                    if re.search(r"cu[áa]ntos?|cu[áa]ntas?|how\s+many|d[ií]as|days|veces", last_user_text, re.IGNORECASE) and _work_events:
                        _dates = [e.get("date", "") for e in _work_events]
                        if user_lang == "en":
                            _dates_txt = (", ".join(_dates[:-1]) + " and " + _dates[-1] if len(_dates) > 1 else _dates[0])
                            injected_events["summary"] = (
                                "You worked " + str(len(_work_events)) + " days in the requested period: " + _dates_txt + "."
                            )
                        else:
                            _dates_txt = (", ".join(_dates[:-1]) + " y " + _dates[-1] if len(_dates) > 1 else _dates[0])
                            injected_events["summary"] = (
                                "Has trabajado " + str(len(_work_events)) + " días en el periodo consultado: " + _dates_txt + "."
                            )
                # Consultas de un día concreto ('¿qué evento tengo mañana?',
                # '¿tengo algo el martes?', 'el 25 de diciembre'): el día se
                # resuelve en el servidor y la respuesta final es determinista,
                # sin depender de que el modelo (débil) calcule la fecha.
                _target = tools.resolve_target_day(last_user_text)
                if _target:
                    if injected_events is None:
                        # Modelos externos: sin contexto previo, pero el día
                        # concreto se resuelve igualmente en el servidor.
                        injected_events = {"events": [], "total": 0}
                    _data_backed = True
                    _day_iso, _day_label, _day_label_en = _target
                    _day_events = [
                        e for e in ((injected_events or {}).get("events") or [])
                        if (e.get("date") or "") == _day_iso
                    ]
                    if _day_events:
                        _parts = []
                        for _e in _day_events:
                            _t = _e.get("startTime") or ""
                            _ti = _e.get("title") or ("Tarea" if _e.get("type") == "task" else "Evento")
                            _parts.append(f'"{_ti}"' + (f" a las {_t}" if _t else ""))
                        if user_lang == "en":
                            _noun = "event" if len(_day_events) == 1 else "events"
                            _summary = (f"You have {len(_day_events)} {_noun} {_day_label_en} "
                                        f"({_day_iso}): " + ", ".join(_parts) + ".")
                        else:
                            _noun = "evento" if len(_day_events) == 1 else "eventos"
                            _summary = (f"Tienes {len(_day_events)} {_noun} {_day_label} "
                                        f"({_day_iso}): " + ", ".join(_parts) + ".")
                    else:
                        _summary = (f"You have no events {_day_label_en} ({_day_iso})."
                                    if user_lang == "en"
                                    else f"No tienes eventos {_day_label} ({_day_iso}).")
                    injected_events["summary"] = _summary
                    if _day_events:
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                f"Datos del día consultado ({_day_iso}) en la agenda del usuario "
                                "(responde con estos datos reales, en texto normal y sin JSON): "
                                + json.dumps({"events": _day_events}, ensure_ascii=False)
                            ),
                        })
                # Consultas de festivos/puentes/vacaciones: NO son conocimiento
                # general. Se consulta la agenda real (query en todo el historial
                # o period this_week para el finde) y la respuesta es determinista:
                # si no hay nada registrado, se dice exactamente eso.
                _holiday_intent = bool(re.search(
                    r"puente|festivo|vacaciones|vacaci[oó]n|Semana Santa|\bfinde\b|"
                    r"fin\s+de\s+semana|se\s+celebra|d[ií]a\s+de\s+la\s+semana\s+cae|"
                    r"cu[áa]ndo\s+cae|qu[eé]\s+partido\s+hay|qui[eé]n\s+juega",
                    last_user_text, re.IGNORECASE))
                if _holiday_intent:
                    _data_backed = True
                    _hol_finde = bool(re.search(
                        r"finde|fin\s+de\s+semana", last_user_text, re.IGNORECASE))
                    if _hol_finde:
                        _hol_result = tools.execute_tool(
                            "list_upcoming_events", {"period": "this_week"}, uid)
                        _hol_events = ((_hol_result.get("events") or [])
                                       if isinstance(_hol_result, dict) else [])
                        if _hol_events:
                            injected_events = _hol_result
                        else:
                            injected_events = {
                                "events": [], "total": 0,
                                "summary": (
                                    "No tienes nada anotado para este fin de semana."
                                    if user_lang != "en" else
                                    "You don't have anything scheduled for this weekend."
                                ),
                            }
                    else:
                        _hol_query = tools.extract_holiday_query(last_user_text)
                        _hol_result = tools.execute_tool(
                            "list_upcoming_events", {"query": _hol_query}, uid)
                        _hol_events = ((_hol_result.get("events") or [])
                                       if isinstance(_hol_result, dict) else [])
                        if _hol_events:
                            injected_events = _hol_result
                            agent_messages.insert(1, {
                                "role": "system",
                                "content": (
                                    f"Registros de la agenda del usuario para la consulta "
                                    f"\"{_hol_query}\" (responde con estos datos reales): "
                                    + json.dumps(injected_events, ensure_ascii=False)
                                ),
                            })
                        else:
                            if _hol_query == "partido":
                                _hol_msg = ("No tienes ningún partido anotado en tu agenda."
                                            if user_lang != "en" else
                                            "You don't have any game scheduled in your calendar.")
                            elif _hol_query == "vacaciones":
                                _hol_msg = ("No tienes vacaciones anotadas en tu agenda."
                                            if user_lang != "en" else
                                            "You have no vacations noted in your calendar.")
                            elif re.match(r"^\d{1,2}\s+de\s+", _hol_query):
                                _hol_msg = (
                                    f"No tienes ningún puente ni festivo anotado para "
                                    f"el {_hol_query} en tu agenda."
                                    if user_lang != "en" else
                                    f"You don't have any holiday or day off noted for "
                                    f"{_hol_query} in your calendar.")
                            else:
                                _hol_msg = (
                                    f"No tienes nada de {_hol_query} anotado en tu agenda."
                                    if user_lang != "en" else
                                    f"You don't have anything about {_hol_query} noted "
                                    "in your calendar.")
                            injected_events = {"events": [], "total": 0,
                                               "summary": _hol_msg}
                if isinstance(injected_events, dict) and "events" in injected_events:
                    if (injected_events or {}).get("events") or (injected_events or {}).get("summary"):
                        _data_backed = True
                    agent_messages.insert(1, {
                        "role": "system",
                        "content": (
                            "Datos reales de la agenda del usuario obtenidos por el sistema "
                            "(úsalos para responder preguntas sobre eventos próximos; dirígete "
                            "al usuario en segunda persona: 'has trabajado', 'tienes', 'tu agenda'): "
                            + json.dumps(injected_events, ensure_ascii=False)
                        ),
                    })
            executed_tool_calls = {}

            # Borrado determinista: si el usuario pide eliminar y el parser
            # encuentra el evento real, se borra aquí (garantizado, sin pasar
            # por el modelo, que a veces crea eventos basura en vez de borrar).
            skip_model = False
            delete_not_found = False
            del_all_count = None
            if not agenda_disabled and re.search(r"borra(?:r)?|elimina(?:r)?|quita(?:r)?|quitar|\bdelete\b|\bremove\b", last_user_text, re.IGNORECASE):
                # Seguridad: los borrados SOLO los decide el parser determinista
                # (con el id real del evento). El modelo nunca borra (puede
                # tomar un id equivocado del contexto y borrar lo que no toca).
                skip_model = True
                if re.search(r"\btod[oa]s?\b|\b(all|everything)\b|\btodo\s+el\s+historial\b", last_user_text, re.IGNORECASE):
                    # "Elimina todos los eventos/tareas": borrado completo
                    # determinista, filtrando por tipo si se menciona.
                    _all_events = tools.get_user_events(uid)
                    _target_type = None
                    if re.search(r"\btareas?\b|\btasks?\b", last_user_text, re.IGNORECASE):
                        _target_type = "task"
                    elif re.search(r"\beventos?\b|\bappointments?\b|\bevents?\b|\bcitas?\b", last_user_text, re.IGNORECASE):
                        _target_type = "event"
                    del_all_count = 0
                    del_all_type = _target_type
                    for _e in _all_events:
                        if _target_type and (_e.get("type") or "event") != _target_type:
                            continue
                        _r, _ex = _run_tool_once(executed_tool_calls, "delete_event", {"id": _e["id"]}, uid, last_user_text)
                        if _r and _r.get("ok"):
                            del_all_count += 1
                else:
                    _del_call = tools.parse_user_event_request(last_user_text, user_lang, uid)
                    if _del_call and _del_call[0] == "delete_event" and _del_call[1].get("id"):
                        _del_result, _exec = _run_tool_once(executed_tool_calls, "delete_event", {"id": _del_call[1]["id"]}, uid, last_user_text)
                    else:
                        delete_not_found = True

            # Petición de creación incompleta: el usuario quiere crear un
            # evento/tarea pero no dio título y/o fecha. Se pregunta por lo
            # que falta SIN pasar por el modelo (determinista y garantizado).
            missing_fields = None
            if not agenda_disabled and agenda_intent and not skip_model:
                try:
                    missing_fields = tools.missing_create_fields(last_user_text, user_lang)
                except Exception:
                    missing_fields = None
                if missing_fields:
                    skip_model = True

            # ─── Privacidad: enmascarado SOLO para la ruta de extracción estructurada ───
            # El enmascarado de la conversación completa se realiza por-petición
            # dentro del while True (más abajo), usando _priv_ctx compartido.
            # agent_messages NUNCA se mutará a la versión enmascarada.
            if (is_external and external_api_key and last_user_text and not skip_model):
                if not agenda_disabled:
                    # Modo agenda: extracción estructurada enmascarada
                    _extracted, _mask_mapping, _masked_text = _run_external_extraction(
                        uid, last_user_text, external_api_key, external_api_url, actual_model_name,
                        priv_ctx=_priv_ctx,
                    )
                    if _extracted and _extracted.get("action") in ("log_work", "create_event", "list_events"):
                        _resp = _handle_extracted_action(
                            uid, _extracted, _mask_mapping, last_user_text, user_lang,
                        )
                        if _resp:
                            # _priv_ctx ya contiene el mapping: se usó directamente
                            # en _run_external_extraction. No hay que hacer update.
                            _final(_resp)
                            return

            use_tools = (not agenda_disabled
                         and tools.model_supports_tools(model) is not False
                         and (not is_external or external_tools))
            tools_supported = True
            tool_rounds = 0

            while True:
                if skip_model:
                    break
                # ─── Privacidad: enmascarado por-petición (P0 fix) ───
                # agent_messages SIEMPRE contiene datos reales.
                # El payload que sale al proveedor externo se construye
                # enmascarado en cada iteración, incluyendo tool results
                # de rondas anteriores. Nunca se muta agent_messages.
                if is_external and external_api_key:
                    _safe_msgs, _ = privacy.mask_conversation_with_context(
                        agent_messages, _priv_ctx
                    )
                    model_payload = {**payload, "messages": _safe_msgs}
                else:
                    model_payload = {**payload, "messages": agent_messages}
                if use_tools and tools_supported:
                    model_payload["tools"] = tools.CALENDAR_TOOLS
                    # tool_choice solo si el modelo lo soporta (4 modelos de
                    # OpenRouter soportan tools pero no tool_choice)
                    model_payload["_tool_choice"] = external_tool_choice

                if is_external and external_api_key:
                    model_payload["model"] = actual_model_name
                    # API externa: NO usa hardware local -> no pasa por la cola
                    streamer = external_client.stream_chat(model_payload, external_api_key, external_api_url)
                else:
                    # Ollama local: tomar el slot justo antes de generar (solo
                    # el trabajo de GPU se serializa; el resto no espera).
                    if not slot_acquired:
                        slot_acquired = _acquire_generation_slot(gen_key, _queue_notify, _is_cancelled)
                        if not slot_acquired:
                            if _is_cancelled():
                                return  # cancelado mientras esperaba: fin silencioso
                            raise _GenerationQueueTimeout(
                                f"La cola de generación está saturada: se agotó el tiempo de "
                                f"espera ({int(QUEUE_MAX_WAIT)}s). Inténtalo de nuevo."
                            )
                    streamer = ollama_client.stream_chat(model_payload)

                tool_calls = []
                tools_unsupported = False
                round_content = ""
                buffered_round = []
                in_think_block = False
                think_buffer = ""
                for chunk in streamer:
                    if _is_cancelled():
                        break
                    try:
                        parsed = json.loads(chunk)
                    except (json.JSONDecodeError, TypeError):
                        q.put(("chunk", chunk))
                        continue
                    if parsed.get("error"):
                        if use_tools and tools_supported and "tools" in str(parsed.get("error", "")).lower():
                            # El modelo local no soporta tools: se reintenta sin ellas
                            tools_unsupported = True
                            continue
                        # Cualquier otro error del motor (contexto demasiado largo,
                        # modelo no disponible, límites de la API...) debe llegar
                        # al usuario; NO tragarlo en silencio (dejaba el stream
                        # vacío sin respuesta ni aviso).
                        raise RuntimeError(_friendly_error(str(parsed.get("error"))))
                    
                    delta = parsed.get("message", {}).get("content", "")
                    extracted_r_delta = ""
                    
                    if delta:
                        think_buffer += delta
                        delta = ""
                        while think_buffer:
                            if not in_think_block:
                                think_idx = think_buffer.find("<think>")
                                if think_idx != -1:
                                    delta += think_buffer[:think_idx]
                                    in_think_block = True
                                    think_buffer = think_buffer[think_idx + 7:]
                                else:
                                    partial_found = False
                                    for i in range(1, 7):
                                        if think_buffer.endswith("<think>"[:i]):
                                            delta += think_buffer[:-i]
                                            think_buffer = think_buffer[-i:]
                                            partial_found = True
                                            break
                                    if not partial_found:
                                        delta += think_buffer
                                        think_buffer = ""
                                    else:
                                        break  # Break out of while loop to wait for more chunks
                            else:
                                end_idx = think_buffer.find("</think>")
                                if end_idx != -1:
                                    extracted_r_delta += think_buffer[:end_idx]
                                    in_think_block = False
                                    think_buffer = think_buffer[end_idx + 8:]
                                else:
                                    partial_found = False
                                    for i in range(1, 8):
                                        if think_buffer.endswith("</think>"[:i]):
                                            extracted_r_delta += think_buffer[:-i]
                                            think_buffer = think_buffer[-i:]
                                            partial_found = True
                                            break
                                    if not partial_found:
                                        extracted_r_delta += think_buffer
                                        think_buffer = ""
                                    else:
                                        break  # Break out of while loop to wait for more chunks

                    if "message" in parsed:
                        parsed["message"]["content"] = delta
                    
                    if delta and _priv_ctx.mapping:
                        # Desenmascarar antes de mostrar/persistir
                        delta = privacy.unmask(delta, _priv_ctx.mapping)
                        if "message" in parsed:
                            parsed["message"]["content"] = delta

                    if delta:
                        round_content += delta
                        full_response += delta
                        # En chats de agenda se bufferiza TODO: si el modelo
                        # escribe JSON o formatos de llamada, no debe llegar
                        # al usuario (se limpia antes de mostrar).
                        if buffer_all or (tool_rounds == 0 and use_tools):
                            if _priv_ctx.mapping and not parsed.get("message", {}).get("tool_calls"):
                                chunk = (json.dumps(parsed) + "\n").encode()
                            else:
                                chunk = (json.dumps(parsed) + "\n").encode()
                            buffered_round.append(chunk)
                            continue
                    
                    if "message" in parsed and not parsed["message"].get("tool_calls"):
                        # Evitar reenviar el chunk crudo si hemos extraido <think> o desenmascarado
                        q.put(("chunk", (json.dumps(parsed) + "\n").encode()))
                    else:
                        q.put(("chunk", (json.dumps(parsed) + "\n").encode()))

                    # Razonamiento ("thinking") del modelo
                    r_delta = ((parsed.get("message", {}) or {}).get("reasoning")
                               or (parsed.get("message", {}) or {}).get("reasoning_content")
                               or extracted_r_delta)
                    if r_delta and reasoning_mode:
                        if _priv_ctx.mapping:
                            r_delta = privacy.unmask(r_delta, _priv_ctx.mapping)
                        q.put(("chunk", (json.dumps({"reasoning": r_delta}) + "\n").encode()))
                    tc = parsed.get("message", {}).get("tool_calls") or []
                    if tc:
                        tool_calls.extend(tc)

                if _is_cancelled():
                    break
                if tools_unsupported and use_tools:
                    # El modelo local no soporta tools: reintentar sin ellas
                    tools_supported = False
                    tools.remember_model_tools(model, False)
                    continue

                # Llamadas nativas
                if tool_calls:
                    if tool_rounds >= tools.MAX_TOOL_ROUNDS:
                        break
                    tool_rounds += 1
                    # Construir versión interna con argumentos reales (no enmascarados)
                    # para mantener agent_messages como estado canónico real.
                    # La versión enmascarada se regenera en cada iteración del while True
                    # mediante mask_conversation_with_context antes de cada llamada externa.
                    internal_tool_calls = []
                    for tc in tool_calls:
                        fn = dict(tc.get("function") or {})
                        raw_args = fn.get("arguments") or {}
                        if isinstance(raw_args, str):
                            try:
                                tc_args = json.loads(raw_args)
                            except (json.JSONDecodeError, TypeError):
                                tc_args = {}
                        elif isinstance(raw_args, dict):
                            tc_args = raw_args
                        else:
                            tc_args = {}
                        if _priv_ctx.mapping and isinstance(tc_args, dict):
                            tc_args = {
                                k: privacy.unmask(v, _priv_ctx.mapping) if isinstance(v, str) else v
                                for k, v in tc_args.items()
                            }
                        fn["arguments"] = json.dumps(tc_args, ensure_ascii=False)
                        internal_tool_calls.append({**tc, "function": fn})
                    agent_messages.append({
                        "role": "assistant",
                        "content": "",
                        "tool_calls": internal_tool_calls,
                    })
                    for tc in tool_calls:
                        fn = tc.get("function") or {}
                        name = str(fn.get("name") or "")
                        raw_args = fn.get("arguments") or {}
                        if isinstance(raw_args, str):
                            try:
                                args = json.loads(raw_args)
                            except (json.JSONDecodeError, TypeError):
                                args = {}
                        elif isinstance(raw_args, dict):
                            args = raw_args
                        else:
                            args = {}
                        # Desenmascaro para ejecutar la tool local (datos reales).
                        # Ya hecho arriba en internal_tool_calls, pero se repite
                        # aquí porque el loop usa el `tc` original del modelo.
                        if _priv_ctx.mapping and isinstance(args, dict):
                            args = {
                                k: privacy.unmask(v, _priv_ctx.mapping) if isinstance(v, str) else v
                                for k, v in args.items()
                            }
                        result, executed = _run_tool_once(executed_tool_calls, name, args, uid, last_user_text, study_plan_ctx=bool(_future_exams))
                        agent_messages.append({
                            "role": "tool",
                            "content": json.dumps(result, ensure_ascii=False),
                        })
                    continue

                # Llamadas escritas como texto (cualquier formato)
                if tool_rounds < tools.MAX_TOOL_ROUNDS:
                    text_calls, clean_text = tools.extract_text_tool_calls(round_content)
                    if text_calls:
                        tool_rounds += 1
                        agent_messages.append({
                            "role": "assistant",
                            "content": clean_text,
                        })
                        for name, args in text_calls:
                            result, executed = _run_tool_once(executed_tool_calls, name, args, uid, last_user_text, study_plan_ctx=bool(_future_exams))
                            agent_messages.append({
                                "role": "system",
                                "_mask": True,
                                "content": (
                                    "Resultado real de la consulta a la agenda: "
                                    + json.dumps(result, ensure_ascii=False)
                                    + ". Responde al usuario usando SOLO estos datos, con texto normal y SIN JSON."
                                ),
                            })
                        continue

                    if tool_rounds == 0 and tools.has_tool_attempt(round_content):
                        # Intento de llamada no parseable: pedir el formato exacto
                        tool_rounds += 1
                        agent_messages.append({
                            "role": "assistant",
                            "content": clean_text,
                        })
                        agent_messages.append({
                            "role": "system",
                            "content": (
                                "La llamada a herramienta que escribiste no es válida. "
                                "Responde SOLO con el JSON exacto: "
                                '{"tool": "list_upcoming_events", "args": {"days": 30}} '
                                "u otra herramienta con sus argumentos. Nada de texto adicional."
                            ),
                        })
                        continue

                # Respuesta final
                if buffer_all:
                    _, clean_text = tools.extract_text_tool_calls(round_content)
                    user_call = tools.parse_user_event_request(last_user_text, user_lang, uid)
                    write_done = False
                    if user_call:
                        # ¿La operación pedida ya se ejecutó con éxito?
                        for (name, _), result in executed_tool_calls.items():
                            if name == user_call[0] and isinstance(result, dict) and result.get("ok"):
                                write_done = True
                                break

                    if user_call and not write_done and user_call[0] == "delete_event" and not user_call[1].get("id"):
                        # Borrado sin coincidencia: no inventar ni ejecutar
                        _final((
                            "No he encontrado ese evento en tu agenda." if user_lang != "en"
                            else "I could not find that event in your calendar."
                        ))
                    elif user_call and not write_done:
                        # Petición de escritura que el modelo no completó:
                        # último recurso determinista sobre el mensaje del usuario
                        result, executed = _run_tool_once(executed_tool_calls, user_call[0], user_call[1], uid, last_user_text, study_plan_ctx=bool(_future_exams))
                        if executed and isinstance(result, dict) and result.get("ok"):
                            a = user_call[1]
                            if user_lang == "en":
                                noun = "task" if user_call[0] == "create_task" else "event"
                                msg = f'I have created the {noun} "{a.get("title", "")}" for {a.get("date", "")}'
                                if a.get("startTime"):
                                    msg += f" at {a['startTime']}"
                                msg += "."
                            else:
                                noun = "la tarea" if user_call[0] == "create_task" else "el evento"
                                msg = f'He creado {noun} "{a.get("title", "")}" para el {a.get("date", "")}'
                                if a.get("startTime"):
                                    msg += f" a las {a['startTime']}"
                                msg += "."
                            _final(msg)
                        elif executed and isinstance(result, dict) and result.get("error"):
                            _final("No he podido completar la petición: " + str(result["error"]))
                        else:
                            _final("No he podido entender la petición. Inténtalo de nuevo.")
                    elif _write_confirmation(executed_tool_calls, user_lang):
                        # Escritura ejecutada con éxito: confirmación clara y
                        # determinista, sin depender de lo que escriba el modelo
                        _final(_write_confirmation(executed_tool_calls, user_lang))
                    elif clean_text.strip():
                        # Respuestas deterministas para lecturas: si la pregunta
                        # pedía un conteo, se usa el conteo real calculado por el
                        # servidor (los modelos débiles cuentan mal). Si el modelo
                        # afirma que no hay nada pero el sistema sí tiene datos
                        # (alucinación), se muestra la lista real.
                        has_events = bool(injected_events and isinstance(injected_events, dict) and injected_events.get("events"))
                        claims_empty = bool(re.search(
                            r"no\s+(hay|tienes|existen|quedan|hay días|ha trabajado|hay\s+ninguno)\s*(eventos?|tareas?|nada|d[ií]as|trabajado)?"
                            r"|no\s+(upcoming\s+)?(events?|tasks?|items|days)"
                            r"|didn'?t\s+(work|have)"
                            r"|no\s+(trabajé|trabajado|worked)",
                            clean_text, re.IGNORECASE))
                        if isinstance(injected_events, dict) and injected_events.get("summary"):
                            _final(injected_events["summary"])
                        elif _period and re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE) and has_events:
                            # Lectura de trabajo ('¿dónde he trabajado esta semana?'):
                            # respuesta determinista con los datos reales filtrados
                            _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                        elif _future_exams and re.search(
                                r"can'?t\s+do|no\s+puedo\s+hacerlo|no\s+puedo|cannot|not\s+able",
                                clean_text, re.IGNORECASE):
                            # El modelo se niega a hacer el plan de estudio: se
                            # responde con un plan determinista de los exámenes reales
                            _final(_build_study_plan(_future_exams, user_lang))
                        elif has_events and re.search(
                                r"can'?t\s+do|no\s+puedo\s+hacerlo|no\s+puedo|cannot|not\s+able",
                                clean_text, re.IGNORECASE):
                            # El modelo se niega ("I can't do that."): con datos
                            # reales inyectados se responde de forma determinista
                            _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                        elif has_events and claims_empty and tools.has_events_for_scope(injected_events.get("events") or [], last_user_text):
                            _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                        elif _future_exams and re.search(
                                r"can'?t\s+do|no\s+puedo\s+hacerlo|no\s+puedo|cannot|not\s+able",
                                clean_text, re.IGNORECASE):
                            # El modelo se niega a hacer el plan de estudio: se
                            # responde con un plan determinista de los exámenes reales
                            _final(_build_study_plan(_future_exams, user_lang))
                        elif _data_backed:
                            # El modelo respondió respaldado por datos reales inyectados
                            _final(clean_text)
                        else:
                            # Sin datos reales que respalden la respuesta: no fabricar
                            _cant = "I can't do that." if user_lang == "en" else "No puedo hacerlo."
                            _final(_cant)
                    elif executed_tool_calls:
                        _final(_fallback_summary(executed_tool_calls, user_lang))
                    elif injected_events is not None and isinstance(injected_events, dict):
                        _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                    else:
                        _cant = "I can't do that." if user_lang == "en" else "No puedo hacerlo."
                        _final(_cant)
                else:
                    for b in buffered_round:
                        q.put(("chunk", b))
                break
            if skip_model:
                if missing_fields:
                    # Petición de creación incompleta: preguntar exactamente qué
                    # falta (título y/o fecha), de forma determinista.
                    _parts_es = {
                        "title": "el nombre (¿cómo se llama?)",
                        "date": "el día (¿para qué día lo pongo?)",
                    }
                    _parts_en = {
                        "title": "the name (what should it be called?)",
                        "date": "the day (what day should I set it for?)",
                    }
                    _parts = _parts_en if user_lang == "en" else _parts_es
                    _p = " y ".join([_parts[k] for k in missing_fields["missing"]])
                    msg = (
                        f"I could not create {_parts_en and ('the task' if missing_fields['kind'] == 'task' else 'the event')}: I'm missing {_p}."
                        if user_lang == "en" else
                        f"No he podido crear {'la tarea' if missing_fields['kind'] == 'task' else 'el evento'}: me falta {_p}."
                    )
                elif delete_not_found:
                    msg = ("No he encontrado ese evento en tu agenda." if user_lang != "en"
                           else "I could not find that event in your calendar.")
                elif del_all_count is not None:
                    if del_all_count:
                        _what = {"task": "tareas", "event": "eventos"}.get(del_all_type, "elementos")
                        _what_en = {"task": "tasks", "event": "events"}.get(del_all_type, "items")
                        msg = (f"He eliminado {del_all_count} {_what} de tu agenda."
                               if user_lang != "en"
                               else f"I have deleted {del_all_count} {_what_en} from your calendar.")
                    else:
                        msg = ("No tenías eventos en tu agenda." if user_lang != "en"
                               else "You had no events in your calendar.")
                else:
                    msg = _write_confirmation(executed_tool_calls, user_lang) or ("Hecho." if user_lang != "en" else "Done.")
                _final(msg)
        except _GenerationQueueTimeout as e:
            q.put(("error", _friendly_error(str(e))))
        except Exception as e:
            q.put(("error", _friendly_error(str(e))))
        finally:
            if slot_acquired:
                _release_generation_slot()
            _dequeue_generation(gen_key)
            q.put(("done", None))
            # Clean up generation tracking
            cancelled = _is_cancelled()
            if session_id:
                # Solo limpiar si la entrada sigue siendo NUESTRA generación
                # (una petición nueva con la misma sesión creó la suya propia)
                entry = ACTIVE_GENERATIONS.get(session_id)
                if entry and entry.get("gen_id") == gen_id:
                    ACTIVE_GENERATIONS.pop(session_id, None)
            CANCELED_GENS.discard(gen_id)
            # Persistir la respuesta final (también la determinista y aunque
            # el cliente se haya desconectado: se completa en segundo plano y
            # se guarda en la sesión para que aparezca al volver). ÚNICA
            # excepción: cancelación explícita.
            if uid and session_id:
                text = final_text if final_text is not None else tools.strip_text_tool_calls(full_response)
                if _priv_ctx.mapping and text:
                    text = privacy.unmask(text, _priv_ctx.mapping)
                # Cancelación explícita: NO persistir la respuesta (ni siquiera
                # parcial). El usuario canceló: el mensaje no debe reaparecer
                # en la sesión como si se hubiera completado.
                if text and not cancelled:
                    repository.save_message(uid, session_id, "assistant", text, model)
                    # La respuesta se completó en segundo plano y el cliente no
                    # llegó a ver el final del stream (no fue una cancelación
                    # explícita): notificar en la sala del usuario para que el
                    # widget/panel muestre una notificación y marque no leído.
                    if not cancelled and not _state["consumed"]:
                        preview = re.sub(r"[#*`>\n]", " ", text).strip()[:120]
                        if getattr(socketio, "server", None) is not None:
                            socketio.emit(
                                "ai_response_ready",
                                {"session_id": session_id, "preview": preview},
                                room=f"user_{uid}",
                            )

    threading.Thread(target=background_worker, daemon=True).start()

    try:
        while True:
            try:
                msg_type, msg_data = q.get(timeout=0.1)
                if msg_type == "chunk":
                    yield msg_data
                elif msg_type == "error":
                    yield json.dumps({"error": msg_data}).encode() + b"\n"
                    break
                elif msg_type == "done":
                    _state["consumed"] = True
                    break
            except queue.Empty:
                # Enviar un "keep-alive" vacío para que Gunicorn y el navegador
                # no cierren la conexión por timeout mientras la IA "piensa" o carga
                yield b"\n"
    except GeneratorExit:
        # El cliente cerró la conexión prematuramente
        # Salimos del generador, pero background_worker seguirá trabajando
        pass
