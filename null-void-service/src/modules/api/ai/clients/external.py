"""Cliente HTTP para comunicación con proveedores externos (OpenAI, OpenRouter, Google, DeepSeek)."""
import json
import logging
import re
import requests

logger = logging.getLogger("ai.external_client")

# Palabras clave que indican rechazo del proveedor por políticas de datos,
# guardrails o restricciones de privacidad (p. ej. "No endpoints available
# matching your guardrail restrictions" de OpenRouter).
_GUARDRAIL_KEYWORDS = (
    "guardrail", "no endpoints available", "data policy", "data-privacy",
    "data privacy", "privacy", "restriction", "restricted", "policy",
    "politica", "politicas", "privacidad", "content policy", "moderation",
    "pii", "sensitive data", "compliance", "data compliance",
)


def _extract_link(detail: str):
    """Devuelve la primera URL (p. ej. enlace del dashboard del proveedor)."""
    if not detail:
        return None
    for token in re.findall(r"https?://[^\s\)\]\},\"']+", detail):
        return token
    return None


def _friendly_provider_error(status, detail: str):
    """Detecta rechazos por política/guardrails del proveedor.

    Devuelve un mensaje limpio para el usuario final (con el enlace útil si el
    proveedor lo incluye) o ``None`` si el error no encaja. El texto técnico
    crudo se conserva en el log, no en la burbuja de chat.
    """
    detail = (detail or "").strip()
    d = detail.lower()
    try:
        status = int(status or 0)
    except (TypeError, ValueError):
        status = 0
    status_related = status in (403, 404, 422)
    guardrail_hit = any(k in d for k in _GUARDRAIL_KEYWORDS)

    if not (status_related or guardrail_hit):
        return None

    if guardrail_hit:
        # Capturamos el texto técnico para diagnóstico, sin exponerlo al usuario.
        logger.warning("[AI] proveedor rechazó por política/guardrails: HTTP %s body=%s", status, detail[:500])

    friendly = (
        "El proveedor externo ha rechazado la solicitud debido a restricciones "
        "de política de datos o privacidad. Revisa la configuración de "
        "privacidad de tu cuenta (ej. OpenRouter)."
    )
    link = _extract_link(detail)
    if link:
        friendly = f"{friendly}\nEnlace de ayuda: {link}"
    return friendly


def _headers(api_key):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


def _chat_completions_url(api_url):
    """Normaliza la URL base del proveedor."""
    base = str(api_url or "").strip().rstrip("/")
    if not base:
        return None
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _is_google(api_url):
    return bool(api_url) and "generativelanguage.googleapis.com" in str(api_url).lower()


def _normalize_google_model(model, api_url):
    """La API OpenAI-compatible de Google requiere el prefijo `models/`."""
    if _is_google(api_url):
        m = str(model or "").strip()
        if m and not m.startswith("models/"):
            return f"models/{m}"
    return model


def _format_response_error(response, api_url: str = "") -> str:
    """Extrae y formatea un mensaje amigable a partir de una respuesta HTTP errónea."""
    status = response.status_code
    is_google = _is_google(api_url)

    if status == 503 and is_google:
        return "Error: HTTP 503 — El modelo de Google está temporalmente sobrecargado de peticiones. Prueba más tarde o selecciona otro modelo."

    detail = ""
    try:
        data = response.json()
        if isinstance(data, dict):
            err = data.get("error") or {}
            if isinstance(err, dict):
                detail = err.get("message", "")
            elif isinstance(err, str):
                detail = err
    except Exception:
        detail = response.text[:250] if response.text else ""

    # Detección de modelo no válido / retirado (400 / 404)
    if status in (400, 404) and any(p in detail.lower() for p in ["not found", "invalid model", "not supported", "no longer available", "unknown model"]):
        return f"Error: HTTP {status} — El modelo seleccionado no es válido o no está disponible. Por favor, selecciona otro modelo."

    # Rechazo del proveedor por política de datos / guardrails / privacidad
    guardrail_msg = _friendly_provider_error(status, detail)
    if guardrail_msg:
        return guardrail_msg

    # Errores de permisos en Google API (403)
    if status == 403 and is_google:
        detail += (" — Habilitar la Generative Language API en Google Cloud "
                   "o crear una clave desde [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)")

    return f"Error: HTTP {status}: {detail}".strip()


def complete(payload: dict, api_key: str, api_url: str, timeout=60):
    """Llamada NO-streaming (respuesta completa)."""
    body = {k: v for k, v in (payload or {}).items() if k != "stream"}
    body["stream"] = False
    body["model"] = _normalize_google_model(body.get("model"), api_url)
    url = _chat_completions_url(api_url)
    logger.info("[AI] complete -> %s modelo=%s", url, body.get("model"))
    
    r = requests.post(
        url,
        json=body,
        headers=_headers(api_key),
        timeout=timeout if timeout else 120,
    )
    if r.status_code >= 400:
        logger.error("[AI] complete %s status=%s body=%s payload=%s",
                     url, r.status_code, r.text[:500], json.dumps(body)[:500])
        raise requests.exceptions.HTTPError(_format_response_error(r, api_url), response=r)
        
    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("message") or {}).get("content") or ""


def stream_chat(payload: dict, api_key: str, api_url: str):
    headers = _headers(api_key)

    options = payload.get("options", {}) or {}
    temperature = options.get("temperature", payload.get("temperature", 0.7))
    max_tokens = options.get("num_predict") or options.get("max_tokens") or payload.get("max_tokens") or 32768

    model = _normalize_google_model(payload.get("model"), api_url)
    openai_payload = {
        "model": model,
        "messages": payload.get("messages", []),
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    tools = payload.get("tools")
    if tools:
        openai_payload["tools"] = tools
        if payload.get("_tool_choice") is not False:
            openai_payload["tool_choice"] = "auto"

    url = _chat_completions_url(api_url)
    logger.info("[AI] stream_chat -> %s modelo=%s", url, model)
    
    try:
        response = requests.post(
            url,
            json=openai_payload,
            headers=headers,
            stream=True,
            timeout=120
        )
        if response.status_code >= 400:
            logger.error("[AI] stream_chat %s status=%s body=%s payload=%s",
                         url, response.status_code, response.text[:500],
                         json.dumps(openai_payload)[:500])
            err_msg = _format_response_error(response, api_url)
            yield json.dumps({"error": err_msg}) + "\n"
            return

        tool_call_acc = {}

        for line in response.iter_lines():
            if not line:
                continue

            decoded_line = line.decode('utf-8')

            # Manejo de error estructurado en el cuerpo del stream
            if decoded_line.lstrip().startswith("{") and "error" in decoded_line.lower():
                try:
                    err_data = json.loads(decoded_line)
                    if "error" in err_data:
                        err_msg = err_data["error"].get("message", str(err_data["error"])) if isinstance(err_data["error"], dict) else str(err_data["error"])
                        friendly = _friendly_provider_error(0, err_msg) or f"API Error: {err_msg}"
                        yield json.dumps({"error": friendly}) + "\n"
                        return
                except Exception:
                    pass

            if decoded_line.startswith("data: "):
                data_str = decoded_line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    chunk_data = json.loads(data_str)
                    choices = chunk_data.get("choices", [])
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield json.dumps({
                            "message": {"content": content},
                            "done": False
                        }) + "\n"
                    reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                    if reasoning:
                        yield json.dumps({
                            "message": {"content": "", "reasoning": reasoning},
                            "done": False
                        }) + "\n"
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        slot = tool_call_acc.setdefault(
                            idx,
                            {"id": "", "type": "function",
                             "function": {"name": "", "arguments": ""}},
                        )
                        fn = tc.get("function") or {}
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        if fn.get("name"):
                            slot["function"]["name"] += fn["name"]
                        slot["function"]["arguments"] += fn.get("arguments") or ""
                except json.JSONDecodeError:
                    pass

        if tool_call_acc:
            yield json.dumps({
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [tool_call_acc[i] for i in sorted(tool_call_acc)],
                },
                "done": False,
            }) + "\n"

        yield json.dumps({"done": True}) + "\n"

    except requests.exceptions.RequestException as e:
        if getattr(e, "response", None) is not None:
            yield json.dumps({"error": _format_response_error(e.response, api_url)}) + "\n"
        else:
            yield json.dumps({"error": f"Error de conexión: {e}"}) + "\n"
