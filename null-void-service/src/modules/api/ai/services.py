"""Fachada pública del servicio de Inteligencia Artificial de Null-Void.

Re-exporta la interfaz unificada consumida por routes.py y el resto de la aplicación,
delegando en submódulos especializados por dominio:
- core.container: Ciclo de vida de Ollama, socket Docker, monitor de inactividad y descargas.
- core.models: Catálogos de modelos locales y externos (OpenRouter, Google) y sugerencias.
- core.concurrency: Cola FIFO de GPUs, cancelaciones, rate limiting y estado de sesión.
- core.orchestrator: Motor de generación, streaming, ejecución de herramientas y persistencia.
- security.privacy: Gateway de privacidad y enmascarado PII.
- clients: Clientes HTTP para proveedores locales y externos.
- agenda: Subpaquete de calendario y gestión de eventos.
- web_search: Subpaquete de búsqueda web y scraping seguro.
"""

from .core.container import (
    active_ai_users,
    container_running,
    container_stopping,
    ACTIVE_DOWNLOADS,
    handle_heartbeat,
    pull_ai_model,
    delete_ai_model,
)

from .core.models import (
    get_available_models,
    get_provider_model_suggestions,
    _prov_defaults,
    _fetch_openrouter_catalog,
    _get_ollama_models_cached,
)

import requests

from .clients import external_client, ollama_client
from .security import privacy

from .core.concurrency import (
    is_rate_limited,
    validate_chat_payload,
    cancel_generation,
    get_all_active_generations,
    CANCELED_GENS,
    ACTIVE_GENERATIONS,
    _gen_active,
    _gen_waiters,
    _GEN_LOCK,
)

from .core.orchestrator import (
    stream_chat,
    _persist_attachments,
    _run_tool_once,
    _write_confirmation,
)

__all__ = [
    "active_ai_users",
    "container_running",
    "container_stopping",
    "ACTIVE_DOWNLOADS",
    "handle_heartbeat",
    "pull_ai_model",
    "delete_ai_model",
    "get_available_models",
    "get_provider_model_suggestions",
    "_prov_defaults",
    "_fetch_openrouter_catalog",
    "_get_ollama_models_cached",
    "is_rate_limited",
    "validate_chat_payload",
    "cancel_generation",
    "get_all_active_generations",
    "stream_chat",
    "_persist_attachments",
    "external_client",
    "ollama_client",
    "privacy",
    "requests",
    "CANCELED_GENS",
    "ACTIVE_GENERATIONS",
]
