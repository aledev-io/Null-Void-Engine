"""Núcleo del motor de IA: contenedor, concurrencia, modelos y orquestación."""
from .container import (
    active_ai_users,
    container_running,
    container_stopping,
    ACTIVE_DOWNLOADS,
    handle_heartbeat,
    pull_ai_model,
    delete_ai_model,
)

from .models import (
    get_available_models,
    get_provider_model_suggestions,
    BaseProviderAdapter,
    GoogleProvider,
    OpenAICompatibleProvider,
    PROVIDER_REGISTRY,
)

from .concurrency import (
    is_rate_limited,
    validate_chat_payload,
    cancel_generation,
    get_all_active_generations,
    has_active_generations,
)

from .orchestrator import (
    stream_chat,
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
    "BaseProviderAdapter",
    "GoogleProvider",
    "OpenAICompatibleProvider",
    "PROVIDER_REGISTRY",
    "is_rate_limited",
    "validate_chat_payload",
    "cancel_generation",
    "get_all_active_generations",
    "has_active_generations",
    "stream_chat",
]