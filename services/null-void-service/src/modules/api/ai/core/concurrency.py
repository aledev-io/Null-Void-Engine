"""Gestión de concurrencia GPU, cola de turnos, limitador de tasa y cancelaciones."""
import collections
import os
import threading
import time
from typing import Dict, List, Optional, Set, Tuple

MAX_CONCURRENT_GENERATIONS = int(os.environ.get("AI_MAX_CONCURRENT", "1"))
QUEUE_MAX_WAIT = float(os.environ.get("AI_QUEUE_MAX_WAIT", "300"))
QUEUE_POLL_INTERVAL = 0.5
_GEN_LOCK = threading.Lock()
_gen_active = 0
_gen_waiters: List[str] = []

CANCELED_GENS: Set[str] = set()
ACTIVE_GENERATIONS: Dict[str, dict] = {}

MAX_MESSAGES = 50
MAX_MESSAGE_CHARS = 131072
RATE_MAX = 30
RATE_WINDOW = 60.0
_RATE_LIMITS: Dict[str, collections.deque] = {}


class _GenerationQueueTimeout(Exception):
    pass


def _friendly_error(msg: str) -> str:
    """Traduce errores comunes del motor local de IA a mensajes accionables."""
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
    if any(k in m for k in (
        "peg-native", "does not match the expected",
        "peg", "grammar",
    )):
        return (
            "El modelo no respeta el formato de respuesta esperado por el motor "
            "(incompatible con el modo agenda/JSON). Prueba con el modo normal "
            "(/normal) o con otro modelo. Si el problema persiste, reinicia el "
            "motor de IA para limpiar su estado."
        )
    # Rechazo del proveedor externo por política de datos / guardrails / privacidad
    if any(k in m for k in (
        "guardrail", "no endpoints available", "data policy", "data privacy",
        "privacy", "restriction", "policy", "politica", "privacidad",
        "content policy", "moderation", "pii", "compliance",
    )):
        return (
            "El proveedor externo ha rechazado la solicitud debido a "
            "restricciones de política de datos o privacidad. Revisa la "
            "configuración de privacidad de tu cuenta (ej. OpenRouter)."
        )
    return msg


def _dequeue_generation(key: str):
    with _GEN_LOCK:
        if key in _gen_waiters:
            _gen_waiters.remove(key)


def _acquire_generation_slot(key: str, notify, is_cancelled=None) -> bool:
    """Espera (FIFO) hasta conseguir slot de generación."""
    global _gen_active
    deadline = time.time() + QUEUE_MAX_WAIT
    _dequeue_generation(key)
    
    with _GEN_LOCK:
        if _gen_active < MAX_CONCURRENT_GENERATIONS and not _gen_waiters:
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


def has_active_generations() -> bool:
    """Comprueba si hay alguna generación en ejecución o esperando en cola."""
    with _GEN_LOCK:
        return _gen_active > 0 or bool(_gen_waiters)


def is_rate_limited(uid: Optional[str], ip: Optional[str]) -> Tuple[bool, int]:
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


def validate_chat_payload(data: dict) -> Optional[str]:
    """Valida el payload de /api/ai/chat. Devuelve un mensaje de error o None."""
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
    """Cancela una generación activa o en espera por su session_id."""
    if not session_id:
        return
        
    entry = ACTIVE_GENERATIONS.pop(session_id, None)
    if entry and entry.get("gen_id"):
        CANCELED_GENS.add(entry["gen_id"])
        
    prefix = f"{session_id}:"
    with _GEN_LOCK:
        to_remove = [k for k in _gen_waiters if k.startswith(prefix)]
        for k in to_remove:
            _gen_waiters.remove(k)
            gid = k.split(":", 1)[1] if ":" in k else None
            if gid:
                CANCELED_GENS.add(gid)


def get_all_active_generations() -> dict:
    return dict(ACTIVE_GENERATIONS)