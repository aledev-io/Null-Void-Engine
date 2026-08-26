"""Registro de modelos locales y catálogos externos (Google AI Studio, OpenRouter,
OpenAI, DeepSeek, Groq, Mistral, etc.) con caché y adaptadores por proveedor."""
import json
import logging
import os
import threading
import time
from typing import List, Optional, Set, Tuple

import requests

from ..clients import ollama_client
from .. import repository

logger = logging.getLogger("ai.models")

_DATA_DIR = os.environ.get("DATA_DIR", "/app/data")

_MODELS_CACHE: dict = {"ts": 0.0, "models": None}
MODELS_CACHE_TTL = 300.0

_OPENROUTER_CACHE: dict = {"ts": 0.0, "models": None}
OPENROUTER_CACHE_TTL = 86400.0  # 24h

_CATALOG_REFRESHING: Set[str] = set()


def _ui_entry(provider: str, mid: Optional[str] = None, **extra) -> dict:
    """Entrada de modelo formateada para el frontend (`API: <provider>[:<model>]`)."""
    if mid is None:
        label = f"API: {provider}"
        modified_at = "External API"
    else:
        label = f"API: {provider}:{mid}"
        modified_at = "Google AI Studio" if provider == "google" else "External API"
    return {
        "name": label,
        "id": label,
        "size": "N/A",
        "modified_at": extra.get("modified_at", modified_at),
        "is_external": True,
        "provider": provider,
        "context_length": extra.get("context_length", 131072),
        "max_output_tokens": extra.get("max_output_tokens", 32768),
        "pricing": extra.get("pricing", {}),
        "supported_parameters": extra.get("supported_parameters", []),
    }


class BaseProviderAdapter:
    """Contrato común para todos los proveedores externos de modelos."""

    def __init__(self, provider: str, default_url: str = ""):
        self.provider = provider
        self.default_url = default_url
        self._cache = {"timestamp": 0.0, "models": []}
        self.cache_ttl = 3600.0

    def fetch_models(self, api_key: str, base_url: str = None) -> list:
        raise NotImplementedError

    def get_models_cached(self, api_key: str, base_url: str = None) -> list:
        now = time.time()
        if self._cache["models"] and (now - self._cache["timestamp"] < self.cache_ttl):
            return self._cache["models"]
        models = self.fetch_models(api_key, base_url)
        if models:
            self._cache = {"timestamp": now, "models": models}
        return models

    def get_ui_models(self, uid: Optional[str], key_data: dict) -> list:
        """Lista formateada `API: <provider>:<model>` más la entrada genérica del proveedor."""
        api_key = (key_data or {}).get("api_key", "")
        api_url = (key_data or {}).get("api_url")
        models = self.get_models_cached(api_key, api_url)
        entries = [_ui_entry(self.provider, mid) for mid in models]
        entries.append(_ui_entry(self.provider))
        return entries


_GOOGLE_EXCLUDED_PATTERNS = [
    "deep-research", "antigravity", "embedding", "tts", "image",
    "veo", "lyria", "aqa", "robotics", "computer-use",
]


def _google_model_chat_compatible(item: dict) -> bool:
    """True si el modelo soporta generateContent y es de una familia de texto/chat estándar."""
    if "generateContent" not in item.get("supportedGenerationMethods", []):
        return False
    name = (item.get("name") or "").lower()
    return not any(pat in name for pat in _GOOGLE_EXCLUDED_PATTERNS)


class GoogleProvider(BaseProviderAdapter):
    def __init__(self):
        super().__init__("google", "https://generativelanguage.googleapis.com/v1beta/openai")

    def fetch_models(self, api_key: str, base_url: str = None) -> list:
        if not api_key:
            logger.warning("[AI] GoogleProvider.fetch_models sin api_key -> []")
            return []

        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        try:
            resp = requests.get(url, headers={"User-Agent": "Null-Void-Engine"}, timeout=8)
            if resp.status_code != 200:
                logger.error(
                    "[AI] Google /models respondió status=%s body=%s",
                    resp.status_code, resp.text[:300],
                )
            else:
                data = resp.json()
                models = [
                    item["name"].replace("models/", "").strip()
                    for item in data.get("models", [])
                    if _google_model_chat_compatible(item)
                ]
                if models:
                    sorted_models = sorted(models)
                    logger.info("[AI] Google /models devolvió %d modelos", len(sorted_models))
                    _save_disk_catalog("google_models.json", sorted_models)
                    return sorted_models
                logger.warning("[AI] Google /models OK pero 0 modelos compatibles con chat")
        except Exception as e:
            logger.error("[AI] Error al consultar modelos dinámicos de Google: %r", e)

        # Si falla la red, recurrir únicamente a lo que se guardó previamente en disco
        disk_data = _load_disk_catalog("google_models.json")
        if disk_data:
            logger.info("[AI] Google modelos desde caché en disco: %d", len(disk_data))
        return disk_data or []


class OpenAICompatibleProvider(BaseProviderAdapter):
    """Maneja DeepSeek, OpenAI, Groq, OpenRouter, Mistral, Together, vLLM, etc."""

    def __init__(self, provider: str, default_url: str = ""):
        super().__init__(provider, default_url)

    def fetch_models(self, api_key: str, base_url: str = None) -> list:
        url = (base_url or self.default_url).rstrip("/") + "/models"
        try:
            headers = {"Authorization": f"Bearer {api_key}", "User-Agent": "Null-Void-Engine"}
            resp = requests.get(url, headers=headers, timeout=8)
            if resp.status_code != 200:
                logger.error("[AI] %s /models status=%s", self.provider, resp.status_code)
                return []
            data = resp.json()
            return sorted([m["id"] for m in data.get("data", []) if "id" in m])
        except Exception as e:
            logger.error("[AI] Error al consultar modelos de %s: %r", self.provider, e)
            return []


class OpenRouterProvider(OpenAICompatibleProvider):
    def __init__(self):
        super().__init__("openrouter", "https://openrouter.ai/api/v1")

    def get_ui_models(self, uid: Optional[str], key_data: dict) -> list:
        catalog = _openrouter_catalog_cached()
        if catalog:
            entries = []
            for m in catalog:
                mid = (m or {}).get("id")
                if not mid:
                    continue
                ctx_len = (m or {}).get("context_length") or 131072
                top_prov = (m or {}).get("top_provider") or {}
                max_comp = top_prov.get("max_completion_tokens") or 32768
                entries.append(_ui_entry(
                    "openrouter", mid,
                    context_length=ctx_len,
                    max_output_tokens=max_comp,
                    pricing=(m or {}).get("pricing") or {},
                    supported_parameters=(m or {}).get("supported_parameters") or [],
                ))
            entries.append(_ui_entry("openrouter"))
            return entries
        return super().get_ui_models(uid, key_data)


# Registro centralizado de proveedores (sin ramas if/else en el llamador)
PROVIDER_REGISTRY: dict[str, BaseProviderAdapter] = {
    "google": GoogleProvider(),
    "openai": OpenAICompatibleProvider("openai", "https://api.openai.com/v1"),
    "deepseek": OpenAICompatibleProvider("deepseek", "https://api.deepseek.com"),
    "openrouter": OpenRouterProvider(),
    "groq": OpenAICompatibleProvider("groq", "https://api.groq.com/openai/v1"),
    "mistral": OpenAICompatibleProvider("mistral", "https://api.mistral.ai/v1"),
}


def _load_disk_catalog(filename: str):
    try:
        p = os.path.join(_DATA_DIR, filename)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def _save_disk_catalog(filename: str, data):
    try:
        p = os.path.join(_DATA_DIR, filename)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp_p = p + f".{time.time()}.tmp"
        with open(tmp_p, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_p, p)
    except Exception:
        pass


def _prov_defaults(provider: str) -> str:
    """Modelo por defecto dinámico o fallback general."""
    prov_key = provider.lower() if provider else ""
    adapter = PROVIDER_REGISTRY.get(prov_key)
    if adapter and adapter._cache["models"]:
        return adapter._cache["models"][0]
    
    return {
        "deepseek": "deepseek-chat",
        "openai": "gpt-4o-mini",
        "openrouter": "openrouter/auto",
        "google": "gemini-flash-latest",
        "groq": "llama-3.3-70b-versatile",
        "mistral": "mistral-large-latest",
    }.get(prov_key, "")


def _fetch_openrouter_catalog() -> Optional[list]:
    """Catálogo completo de modelos de OpenRouter."""
    if (_OPENROUTER_CACHE["models"] is not None
            and time.time() - _OPENROUTER_CACHE["ts"] < OPENROUTER_CACHE_TTL):
        return _OPENROUTER_CACHE["models"]
    try:
        resp = requests.get("https://openrouter.ai/api/v1/models",
                            headers={"User-Agent": "Null-Void-Engine"}, timeout=15)
        if resp.status_code == 200:
            data = resp.json().get("data", [])
            if data:
                _OPENROUTER_CACHE["models"] = data
                _OPENROUTER_CACHE["ts"] = time.time()
                _save_disk_catalog("openrouter_catalog.json", data)
                return data
    except Exception:
        pass
    disk_data = _load_disk_catalog("openrouter_catalog.json")
    if disk_data:
        _OPENROUTER_CACHE["models"] = disk_data
        _OPENROUTER_CACHE["ts"] = time.time()
        return disk_data
    return _OPENROUTER_CACHE["models"]


def _openrouter_catalog_cached() -> Optional[list]:
    return _fetch_openrouter_catalog()


def _spawn_catalog_refresh(uid: Optional[str], provider: str):
    """Lanza el refresco del catálogo en segundo plano."""
    if provider in _CATALOG_REFRESHING:
        return
    _CATALOG_REFRESHING.add(provider)

    try:
        threading.Thread(
            target=_refresh_external_catalogs_async,
            args=(uid, provider),
            daemon=True,
        ).start()
    except Exception:
        _CATALOG_REFRESHING.discard(provider)


def _refresh_external_catalogs_async(uid: Optional[str], provider: str):
    try:
        adapter = PROVIDER_REGISTRY.get(provider)
        if provider == "openrouter":
            _fetch_openrouter_catalog()
        elif provider == "google" and uid:
            _real_key = repository.get_api_key(uid, "google")
            _real_key_val = (_real_key or {}).get("api_key")
            if adapter and _real_key_val:
                adapter.get_models_cached(_real_key_val)
    except Exception:
        pass
    finally:
        _CATALOG_REFRESHING.discard(provider)


def _models_cache_fresh() -> bool:
    return (_MODELS_CACHE["models"] is not None
            and time.time() - _MODELS_CACHE["ts"] < MODELS_CACHE_TTL)


def _get_ollama_models_cached() -> Optional[list]:
    return list(_MODELS_CACHE["models"]) if _models_cache_fresh() else None


def _invalidate_models_cache():
    _MODELS_CACHE["models"] = None


_CTX_PROFILES = (
    (32768, 8192, ("0.5b", "1.5b", "agenda")),
    (65536, 16384, ("2b", "3b", "7b", "phi3")),
    (131072, 32768, ("27b", "32b", "70b", "qwen", "llama3")),
)


def _ollama_context_for(model_name: str):
    """Devuelve (context_length, max_output_tokens) según los tags del nombre."""
    for ctx_len, max_out, tags in _CTX_PROFILES:
        if any(tag in model_name for tag in tags):
            return ctx_len, max_out
    return 131072, 32768


def _resolve_requested_model(model: Optional[str]) -> str:
    """Modelo solicitado, o el primer modelo local disponible si viene vacío."""
    if model and isinstance(model, str) and model.strip():
        return model.strip()
    try:
        raw = _get_ollama_models_cached()
        if raw is None:
            raw = ollama_client.fetch_models()
            if raw:
                _MODELS_CACHE["ts"] = time.time()
                _MODELS_CACHE["models"] = raw
        if raw:
            for m in raw:
                name = (m.get("name") if isinstance(m, dict) else str(m)) or ""
                if name.strip():
                    return name.strip()
    except Exception:
        pass
    return "llama3"


def get_provider_model_suggestions(uid: Optional[str], provider: str) -> List[str]:
    """Sugerencias de modelos (máx 5) para el diálogo de API keys."""
    suggestions = []
    default = _prov_defaults(provider)
    if default:
        suggestions.append(default)

    prov_key = provider.lower() if provider else ""
    key_data = repository.get_api_key(uid, provider) if uid else None
    api_key = (key_data or {}).get("api_key", "")
    api_url = (key_data or {}).get("api_url")

    adapter = PROVIDER_REGISTRY.get(prov_key)
    if adapter and api_key:
        models = adapter.get_models_cached(api_key, api_url)
        if models:
            suggestions.extend(models)
    elif prov_key == "openrouter":
        catalog = _fetch_openrouter_catalog() or []
        for m in catalog:
            mid = (m or {}).get("id") if isinstance(m, dict) else None
            if mid:
                suggestions.append(mid)

    seen, out = set(), []
    for m in suggestions:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
        if len(out) >= 5:
            break
    return out


def get_available_models(uid: Optional[str] = None) -> Tuple[List[dict], Optional[str]]:
    """Modelos locales de Ollama + modelos de proveedores externos."""
    raw_models = _get_ollama_models_cached()
    if raw_models is None:
        try:
            raw_models = ollama_client.fetch_models()
            if raw_models:
                _MODELS_CACHE["ts"] = time.time()
                _MODELS_CACHE["models"] = raw_models
        except Exception as e:
            if _MODELS_CACHE["models"] is not None:
                raw_models = _MODELS_CACHE["models"]
            else:
                return [], str(e)

    models = []
    if raw_models:
        for m in list(raw_models):
            m_dict = dict(m) if isinstance(m, dict) else {"name": str(m)}
            m_name = (m_dict.get("name") or "").lower()

            ctx_len = m_dict.get("context_length")
            max_out = m_dict.get("max_output_tokens")
            if not ctx_len:
                ctx_len, max_out = _ollama_context_for(m_name)

            m_dict["context_length"] = ctx_len
            m_dict["max_output_tokens"] = max_out or 32768
            m_dict["provider"] = "ollama"
            m_dict["is_external"] = False
            models.append(m_dict)

    if uid:
        try:
            keys = repository.get_user_api_keys(uid)
            for key in keys:
                provider = key.get("provider", "API")
                prov_key = provider.lower()
                adapter = (PROVIDER_REGISTRY.get(prov_key)
                           or OpenAICompatibleProvider(provider, "https://api.openai.com/v1"))

                # get_user_api_keys censura la api_key (••••••••) por seguridad.
                # Para listar modelos necesitamos la clave real del proveedor.
                real_key = repository.get_api_key(uid, provider) or {}
                ui_key = {
                    "provider": provider,
                    "api_key": real_key.get("api_key") or key.get("api_key"),
                    "api_url": real_key.get("api_url") or key.get("api_url"),
                    "model": key.get("model"),
                }
                models.extend(adapter.get_ui_models(uid, ui_key))
        except Exception:
            pass
    return models, None
