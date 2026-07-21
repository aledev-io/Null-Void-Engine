import os
import requests
import json

OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://ollama:11434")


def fetch_models() -> list[dict]:
    for attempt in range(5):
        try:
            r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
            if r.status_code == 200:
                return r.json().get("models", [])
            return []
        except (requests.RequestException, ValueError):
            if attempt == 4:
                return []
            import time
            time.sleep(1)
    return []


def pull_model(model_name: str):
    try:
        r = requests.post(f"{OLLAMA_URL}/api/pull", json={"name": model_name}, stream=True, timeout=(5, 300))
        if r.status_code == 200:
            for line in r.iter_lines():
                if line:
                    yield line + b"\n"
        else:
            yield (json.dumps({"error": f"Error descargando el modelo: {r.text}"}) + "\n").encode("utf-8")
    except requests.RequestException as e:
        yield (json.dumps({"error": f"Error de red con Ollama: {str(e)}"}) + "\n").encode("utf-8")


def delete_model(model_name: str) -> dict:
    try:
        r = requests.delete(f"{OLLAMA_URL}/api/delete", json={"name": model_name}, timeout=10)
        if r.status_code == 200:
            return {"status": "success", "message": f"Modelo {model_name} eliminado"}
        elif r.status_code == 404:
            return {"status": "success", "message": "Modelo no encontrado"}
        else:
            return {"error": f"Error eliminando modelo: {r.text}"}
    except requests.RequestException as e:
        return {"error": f"Error de red con Ollama: {str(e)}"}


def unload_all_models():
    try:
        r = requests.get(f"{OLLAMA_URL}/api/ps", timeout=2)
        if r.status_code == 200:
            models = r.json().get("models", [])
            for m in models:
                requests.post(f"{OLLAMA_URL}/api/generate", json={"model": m["name"], "keep_alive": 0}, timeout=2)
    except Exception:
        pass



def stream_chat(payload: dict):
    if not isinstance(payload, dict):
        yield (json.dumps({"error": "Payload inválido"}) + "\n").encode("utf-8")
        return

    messages = payload.get("messages")
    if not isinstance(messages, list):
        yield (json.dumps({"error": "Formato de mensajes inválido"}) + "\n").encode("utf-8")
        return

    allowed_model = str(payload.get("model", ""))

    clean_messages = []
    total_chars = 0

    for msg in messages:
        if not isinstance(msg, dict):
            continue

        role = str(msg.get("role", ""))
        content = str(msg.get("content", ""))

        if role not in ("user", "assistant", "system"):
            continue

        total_chars += len(content)
        if total_chars > 300000:
            yield (json.dumps({"error": "Límite de caracteres excedido (máx 300,000)"}) + "\n").encode("utf-8")
            return

        clean_messages.append({
            "role": role,
            "content": content
        })

    if not clean_messages:
        yield (json.dumps({"error": "No hay mensajes válidos"}) + "\n").encode("utf-8")
        return

    strict_payload = {
        "model": allowed_model,
        "messages": clean_messages,
        "keep_alive": "30m"
    }

    if "options" in payload and isinstance(payload["options"], dict):
        strict_options = {}
        for opt in ("temperature", "top_p", "seed", "num_predict", "repeat_penalty", "num_thread", "num_ctx"):
            if opt in payload["options"]:
                strict_options[opt] = payload["options"][opt]
        if strict_options:
            strict_payload["options"] = strict_options

    try:
        with requests.post(
            f"{OLLAMA_URL}/api/chat",
            json=strict_payload,
            stream=True,
            timeout=(10, 600)
        ) as r:

            if r.status_code != 200:
                yield (json.dumps({
                    "error": f"Ollama HTTP {r.status_code}"
                }) + "\n").encode("utf-8")
                return

            chunks_count = 0

            for line in r.iter_lines():
                if line:
                    yield line + b"\n"
                    chunks_count += 1
                    if chunks_count > 3000:
                        break

    except requests.Timeout:
        yield (json.dumps({
            "error": "Timeout en la comunicación con el motor de IA"
        }) + "\n").encode("utf-8")

    except requests.RequestException as e:
        yield (json.dumps({
            "error": f"Error de red con Ollama: {str(e)}"
        }) + "\n").encode("utf-8")