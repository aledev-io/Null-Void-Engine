from flask import jsonify, request, abort
from modules.session import session as sess
from . import events_bp
from .services import get_user_events, create_user_event, update_user_event, delete_user_event

@events_bp.route('', methods=['GET'])
def get_events():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    try:
        events = get_user_events(uid)
        return jsonify(events)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('', methods=['POST'])
def create_event():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    try:
        event_id = create_user_event(uid, data)
        return jsonify(ok=True, id=event_id)
    except ValueError as e:
        abort(400, description=str(e))
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('/<event_id>', methods=['PUT'])
def update_event(event_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    try:
        update_user_event(uid, event_id, data)
        return jsonify(ok=True)
    except KeyError as e:
        abort(404, description=str(e))
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('/<event_id>', methods=['DELETE'])
def delete_event(event_id):
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    try:
        delete_user_event(uid, event_id)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error="Error interno del servidor"), 500

@events_bp.route('/parse-ai', methods=['POST'])
def parse_ai_events():
    token = request.cookies.get('token') or request.args.get('token')
    uid = sess.get_user_id(token)
    if not uid:
        return jsonify(error='No autorizado'), 401

    data = request.get_json(silent=True) or {}
    text = data.get('text', '')
    if not text:
        return jsonify(error='No se proporcionó texto'), 400

    import requests, json, os
    ollama_url = os.environ.get("OLLAMA_HOST", "http://ollama:11434")
    
    prompt = f"""Analiza el siguiente texto de notas/apuntes y extrae una lista de eventos o visitas a sitios para el calendario.
Responde ÚNICAMENTE con un objeto JSON con el siguiente formato, sin explicaciones ni markdown adicional:
{{
  "events": [
    {{
      "title": "Visita a ...",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "description": "Detalles del sitio o notas",
      "category": "trabajo"
    }}
  ]
}}

Texto a analizar:
{text}"""

    try:
        r = requests.post(f"{ollama_url}/api/generate", json={
            "model": data.get("model", "llama3"),
            "prompt": prompt,
            "stream": False,
            "format": "json"
        }, timeout=45)
        
        if r.status_code == 200:
            res_json = r.json()
            raw_response = res_json.get("response", "{}")
            parsed = json.loads(raw_response)
            created_events = []
            for ev_data in parsed.get("events", []):
                if ev_data.get("title") and ev_data.get("date"):
                    ev_id = create_user_event(uid, ev_data)
                    ev_data["id"] = ev_id
                    created_events.append(ev_data)
            return jsonify(ok=True, created_events=created_events)
        else:
            return jsonify(error=f"Error en el modelo IA local: {r.text}"), 502
    except Exception as e:
        return jsonify(error=f"Excepción al conectar con IA local: {str(e)}"), 500

