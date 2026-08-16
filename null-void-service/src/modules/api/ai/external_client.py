import json
import requests


def _headers(api_key):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


def complete(payload: dict, api_key: str, api_url: str, timeout=60):
    """Llamada NO-streaming (respuesta completa). Devuelve el texto del
    primer choice, o "" si no hay contenido. Usado por la extracción
    estructurada con enmascarado (privacidad)."""
    body = {k: v for k, v in (payload or {}).items() if k != "stream"}
    body["stream"] = False
    r = requests.post(
        f"{api_url.rstrip('/')}/chat/completions",
        json=body,
        headers=_headers(api_key),
        timeout=timeout,
    )
    r.raise_for_status()
    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("message") or {}).get("content") or ""


def stream_chat(payload: dict, api_key: str, api_url: str):
    headers = _headers(api_key)

    options = payload.get("options", {}) or {}
    temperature = options.get("temperature", payload.get("temperature", 0.7))
    max_tokens  = options.get("num_predict", payload.get("max_tokens", 2048))

    openai_payload = {
        "model": payload.get("model"),
        "messages": payload.get("messages", []),
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    # Tools nativas (formato OpenAI) si el modelo las soporta
    tools = payload.get("tools")
    if tools:
        openai_payload["tools"] = tools
        if payload.get("_tool_choice") is not False:
            openai_payload["tool_choice"] = "auto"

    try:
        response = requests.post(
            f"{api_url.rstrip('/')}/chat/completions",
            json=openai_payload,
            headers=headers,
            stream=True,
            timeout=60
        )
        response.raise_for_status()

        # Las tool_calls llegan fragmentadas en varios deltas (id + nombre +
        # argumentos por partes): se acumulan y se emiten de una sola vez al
        # terminar el stream.
        tool_call_acc = {}

        for line in response.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
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
                        # Razonamiento ("thinking") del modelo (campo no
                        # estándar: reasoning_content o reasoning)
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
        yield json.dumps({"error": str(e)}) + "\n"
