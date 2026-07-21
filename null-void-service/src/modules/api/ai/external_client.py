import json
import requests

def stream_chat(payload: dict, api_key: str, api_url: str):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    # Transform payload to match OpenAI format
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

    try:
        response = requests.post(
            f"{api_url.rstrip('/')}/chat/completions",
            json=openai_payload,
            headers=headers,
            stream=True,
            timeout=60
        )
        response.raise_for_status()

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
                        if choices:
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield json.dumps({
                                    "message": {"content": content},
                                    "done": False
                                }) + "\n"
                    except json.JSONDecodeError:
                        pass
        
        yield json.dumps({"done": True}) + "\n"
        
    except requests.exceptions.RequestException as e:
        yield json.dumps({"error": str(e)}) + "\n"
