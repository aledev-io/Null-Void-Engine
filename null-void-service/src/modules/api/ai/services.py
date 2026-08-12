import collections
import ipaddress
import json
import os
import re
import socket
import threading
import time
import requests
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
from core.socket_ext import socketio
from . import ollama_client, repository, external_client

active_ai_users = {}
container_running = False
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
    global container_running
    while True:
        time.sleep(5)
        now = time.time()
        
        # Eliminar usuarios inactivos
        for uid in list(active_ai_users.keys()):
            if now - active_ai_users[uid] > 60:
                del active_ai_users[uid]

        # Si no hay nadie, no hay generaciones activas ni cola, y el
        # contenedor corre: apagarlo. Nunca cortar una generación en curso.
        with _GEN_LOCK:
            idle = (len(active_ai_users) == 0
                    and _gen_active == 0 and not _gen_waiters)
        if container_running and idle:
            ollama_client.unload_all_models()
            time.sleep(1) # Pequeño margen para la descarga
            _stop_ollama_container()
            container_running = False


threading.Thread(target=_inactivity_watcher, daemon=True).start()


def handle_heartbeat(uid: str = "anonymous"):
    global container_running
    active_ai_users[uid] = time.time()
    # Verificar el estado REAL del contenedor: si está parado (aunque la
    # app lo crea activo), arrancarlo.
    if _ollama_container_running():
        container_running = True
    elif _start_ollama_container():
        container_running = True
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
                    
                    # Update state
                    status_text = parsed.get("status", "")
                    if "completed" in parsed and "total" in parsed:
                        completed_mb = parsed["completed"] / 1024 / 1024
                        total_mb = parsed["total"] / 1024 / 1024
                        status_text = f"{status_text} ({completed_mb:.1f}MB / {total_mb:.1f}MB)"
                    
                    ACTIVE_DOWNLOADS[model_name]["progress"] = status_text
                    socketio.emit('model_pull_progress', {"model": model_name, "status": "downloading", "progress": status_text, "raw": parsed})
                except (json.JSONDecodeError, TypeError):
                    pass
            
            # If successfully finished
            if model_name in ACTIVE_DOWNLOADS and ACTIVE_DOWNLOADS[model_name].get("status") != "error":
                ACTIVE_DOWNLOADS[model_name] = {"status": "success", "progress": "Descarga completada."}
                socketio.emit('model_pull_progress', {"model": model_name, "status": "success"})
                _invalidate_models_cache()
                # We can remove it from active downloads after some time, or let the frontend clear it
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
    """Extract all URLs from a text string."""
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
        
        # Remove non-content elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'iframe',
                         'noscript', 'aside', 'form', 'button', 'svg', 'meta', 'link']):
            tag.decompose()
        
        # Try to find main content area first
        main = soup.find('main') or soup.find('article') or soup.find(attrs={"role": "main"})
        container = main if main else soup.find('body') or soup
        
        # Get page title
        title = ""
        title_el = soup.find('title')
        if title_el:
            title = title_el.get_text(strip=True)[:200]
        
        # Extract text preserving some structure
        lines = []
        for el in container.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'td', 'th', 'span', 'div', 'dd', 'dt']):
            text = el.get_text(separator=' ', strip=True)
            if text and len(text) > 10:  # Skip very short fragments
                lines.append(text)
        
        # Also extract price-like elements specifically
        price_elements = container.select('[class*="price"], [class*="Price"], [itemprop="price"], [data-price]')
        for el in price_elements[:10]:
            text = el.get_text(strip=True)
            if text and any(c.isdigit() for c in text):
                lines.append(f"[PRECIO]: {text}")
        
        if not lines:
            # Fallback: just get all text
            text = container.get_text(separator='\n', strip=True)
            lines = [l.strip() for l in text.split('\n') if l.strip() and len(l.strip()) > 10]
        
        # Deduplicate while preserving order
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
    """Detect if the user is asking about product prices."""
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
    """Try to extract price-relevant content from a URL."""
    try:
        import cloudscraper
        from bs4 import BeautifulSoup
        
        scraper = cloudscraper.create_scraper()
        resp = scraper.get(url, timeout=5)
        if resp.status_code != 200:
            return None
            
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Remove script/style elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'iframe']):
            tag.decompose()
        
        # Look for price patterns in common selectors
        price_texts = []
        
        # Common price CSS classes/attributes across major stores
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
        
        # Also look for product title
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
                # For price queries: search across multiple stores
                stores = ["amazon.es", "pccomponentes.com", "mediamarkt.es", "el corte inglés", "fnac.es"]
                
                # First, do a general price search
                general_results = list(ddgs.text(f"{query} precio", max_results=4))
                for res in general_results:
                    title = res.get('title', '')
                    snippet = res.get('body', '')
                    url = res.get('href', '')
                    if title and snippet:
                        results.append(f"Fuente: {title}\nURL: {url}\nInformación: {snippet}")
                
                # Then, search specific stores
                for store in stores[:3]:  # Limit to 3 stores to avoid slow down
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
                
                # Try scraping actual pages for real prices (top 3 URLs)
                seen_urls = []
                for res in general_results[:3]:
                    url = res.get('href', '')
                    if url and url not in seen_urls:
                        seen_urls.append(url)
                        scraped = _scrape_page_prices(url)
                        if scraped:
                            results.append(f"[PRECIO EXTRAÍDO DE PÁGINA]\nURL: {url}\n{scraped}")
            else:
                # Normal search
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

CANCELED_SESSIONS = set()
ACTIVE_GENERATIONS = {}  # session_id -> {"model": str, "started_at": float}

# ── Cola de generación: hardware limitado, una sola generación a la vez ──
MAX_CONCURRENT_GENERATIONS = int(os.environ.get("AI_MAX_CONCURRENT", "1"))
QUEUE_MAX_WAIT = float(os.environ.get("AI_QUEUE_MAX_WAIT", "300"))
QUEUE_POLL_INTERVAL = 0.5
_GEN_LOCK = threading.Lock()
_gen_active = 0
_gen_waiters: list[str] = []


class _GenerationQueueTimeout(Exception):
    pass


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


def _acquire_generation_slot(key: str, notify) -> bool:
    """Espera (FIFO) hasta conseguir slot de generación. notify(pos) en cada
    cambio de posición. Devuelve False si se canceló o se agotó el tiempo."""
    global _gen_active
    deadline = time.time() + QUEUE_MAX_WAIT
    _dequeue_generation(key)
    with _GEN_LOCK:
        if _gen_active < MAX_CONCURRENT_GENERATIONS and not _gen_waiters:
            _gen_active += 1
            notify(0)
            return True
        if key not in _gen_waiters:
            _gen_waiters.append(key)
    last_emitted = -1
    while True:
        if key in CANCELED_SESSIONS:
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
MAX_MESSAGE_CHARS = 8000
RATE_MAX = 30
RATE_WINDOW = 60.0
_RATE_LIMITS: dict[str, collections.deque] = {}

_MODELS_CACHE: dict = {"ts": 0.0, "models": None}
MODELS_CACHE_TTL = 300.0


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
        CANCELED_SESSIONS.add(session_id)
        ACTIVE_GENERATIONS.pop(session_id, None)

def get_generation_status(session_id: str) -> dict:
    """Check if a session is currently generating."""
    if session_id and session_id in ACTIVE_GENERATIONS:
        return {"generating": True, **ACTIVE_GENERATIONS[session_id]}
    return {"generating": False}

def get_all_active_generations() -> dict:
    """Return all currently active generations."""
    return dict(ACTIVE_GENERATIONS)

def stream_chat(uid: str | None, data: dict):
    import queue
    
    model = data.get("model", "llama3")
    messages = data.get("messages", [])
    session_id = data.get("session_id")
    title = data.get("title", "New Chat")

    if uid and messages:
        last_msg = messages[-1]
        if last_msg.get("role") == "user":
            workspace_id = data.get("workspace_id")
            session_id = repository.create_session(uid, model, title, session_id, workspace_id)
            
            # Sync the entire message history to handle edits (truncation)
            repository.clear_session_messages(uid, session_id)
            for m in messages:
                repository.save_message(uid, session_id, m["role"], m["content"], model)

    payload = {**data, "keep_alive": "30s"}
    q = queue.Queue()
    
    # Send session_id to frontend so it can sync its local chat ID
    if session_id:
        q.put(("chunk", json.dumps({"session_id": session_id}) + "\n"))
    
    if session_id in CANCELED_SESSIONS:
        CANCELED_SESSIONS.remove(session_id)
    
    # Mark this session as actively generating
    if session_id:
        ACTIVE_GENERATIONS[session_id] = {"model": model, "started_at": time.time()}

    def background_worker():
        full_response = ""
        slot_acquired = False
        last_qpos = [-1]
        gen_key = session_id or f"anon:{threading.get_ident()}"

        def _queue_notify(position):
            if position != last_qpos[0]:
                last_qpos[0] = position
                q.put(("chunk", json.dumps({"queue": {"position": position}}) + "\n"))

        try:
            # ── Cola de generación: esperar turno (1 generación simultánea) ──
            slot_acquired = _acquire_generation_slot(gen_key, _queue_notify)
            if not slot_acquired:
                if gen_key in CANCELED_SESSIONS:
                    return  # cancelado mientras esperaba: fin silencioso
                raise _GenerationQueueTimeout(
                    f"La cola de generación está saturada: se agotó el tiempo de "
                    f"espera ({int(QUEUE_MAX_WAIT)}s). Inténtalo de nuevo."
                )

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
                            payload["messages"].insert(-1, {"role": "system", "content": ws_prompt})

            # --- Web Search Mode ---
            if data.get("search_mode") and last_user_msg:
                # Notify frontend we are searching
                q.put(("chunk", json.dumps({"message": {"role": "assistant", "content": "🔍 *Buscando en la web...*\n\n"}})))
                
                search_results = perform_web_search(last_user_msg)
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
                    payload["messages"].insert(-1, {"role": "system", "content": system_prompt})
                        
            # Check if it's an external model
            is_external = False
            external_api_key = None
            external_api_url = None
            actual_model_name = model
            
            # The model string might be "API: deepseek:deepseek-chat" or similar
            # Let's say if it starts with "API:"
            if model.startswith("API:"):
                is_external = True
                # Format: API: {provider}
                provider = model.split(":", 1)[1].strip()
                if uid:
                    key_data = repository.get_api_key(uid, provider)
                    if key_data:
                        external_api_key = key_data["api_key"]
                        external_api_url = key_data["api_url"] or "https://api.openai.com/v1"
                
                if provider.lower() == "deepseek":
                    actual_model_name = "deepseek-chat"
                elif provider.lower() == "openai":
                    actual_model_name = "gpt-3.5-turbo"
                else:
                    actual_model_name = provider
            
            if data.get("external_provider"):
                is_external = True
                provider = data["external_provider"]
                actual_model_name = data.get("model")
                if uid:
                    key_data = repository.get_api_key(uid, provider)
                    if key_data:
                        external_api_key = key_data["api_key"]
                        external_api_url = key_data["api_url"] or "https://api.openai.com/v1"

            if is_external and external_api_key:
                payload["model"] = actual_model_name
                streamer = external_client.stream_chat(payload, external_api_key, external_api_url)
            else:
                streamer = ollama_client.stream_chat(payload)

            for chunk in streamer:
                if session_id and session_id in CANCELED_SESSIONS:
                    break
                q.put(("chunk", chunk))
                try:
                    parsed = json.loads(chunk)
                    delta = parsed.get("message", {}).get("content", "")
                    full_response += delta
                except (json.JSONDecodeError, TypeError):
                    pass
        except _GenerationQueueTimeout as e:
            q.put(("error", str(e)))
        except Exception as e:
            q.put(("error", str(e)))
        finally:
            if slot_acquired:
                _release_generation_slot()
            _dequeue_generation(gen_key)
            q.put(("done", None))
            # Clean up generation tracking
            if session_id:
                ACTIVE_GENERATIONS.pop(session_id, None)
                CANCELED_SESSIONS.discard(session_id)
            if uid and session_id and full_response:
                repository.save_message(uid, session_id, "assistant", full_response, model)

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
                    break
            except queue.Empty:
                # Enviar un "keep-alive" vacío para que Gunicorn y el navegador
                # no cierren la conexión por timeout mientras la IA "piensa" o carga
                yield b"\n"
    except GeneratorExit:
        # El cliente cerró la conexión prematuramente
        # Salimos del generador, pero background_worker seguirá trabajando
        pass
