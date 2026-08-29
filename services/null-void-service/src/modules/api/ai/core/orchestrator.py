"""Motor de orquestación, streaming de chat, bucle de herramientas e inferencia."""
import base64
import json
import os
import queue
import re
import sys
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from core.socket_ext import socketio
from ..clients import ollama_client, external_client
from ..security import privacy
from .. import web_search, repository
from .. import workspaces
from .. import agenda as tools
from .concurrency import (
    _acquire_generation_slot,
    _release_generation_slot,
    _dequeue_generation,
    CANCELED_GENS,
    ACTIVE_GENERATIONS,
    _GenerationQueueTimeout,
    _friendly_error,
    QUEUE_MAX_WAIT,
)
from .models import (
    _resolve_requested_model,
    _fetch_openrouter_catalog,
    PROVIDER_REGISTRY,
    OpenAICompatibleProvider,
)


EXTRACTION_SYSTEM_PROMPT = """Eres un motor de extracción estructurada para una agenda personal y registro de actividades.
Tu única tarea es analizar el texto del usuario y devolver un objeto JSON estricto según las instrucciones.

REGLAS:
1. No inventes información. Si un dato no está presente, usa null.
2. Conserva intactos todos los identificadores opacos con formato <PII:tipo:id>.
   Nunca alteres, acortes, traduzcas ni reformatees un tag PII. Cópialos exactamente.
3. Clasifica la intención en una de estas acciones:
   - "log_work": Registros de horas trabajadas o tareas realizadas.
   - "create_event": Nuevas citas o eventos programados a futuro.
   - "list_events": Consultas sobre eventos o agenda.
   - "delete_event": Cancelaciones o borrados.
   - "unknown": Si no coincide con ninguna acción de agenda/registro.
4. Devuelve ÚNICAMENTE el JSON, sin bloques de código markdown, explicaciones ni saludos.

SCHEMA JSON DE SALIDA:
{
  "action": "log_work" | "create_event" | "list_events" | "delete_event" | "unknown",
  "title": string | null,
  "entity": string | null,
  "location": string | null,
  "duration_hours": number | null,
  "target_date_raw": string | null,
  "target_time_raw": string | null,
  "notes": string | null
}"""


def _parse_tool_args(raw_args, priv_ctx=None):
    """Parsea y desenmascara los argumentos de una herramienta."""
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args)
        except (json.JSONDecodeError, TypeError):
            args = {}
    elif isinstance(raw_args, dict):
        args = raw_args
    else:
        args = {}
    if priv_ctx is not None and priv_ctx.mapping and isinstance(args, dict):
        args = {
            k: privacy.unmask(v, priv_ctx.mapping) if isinstance(v, str) else v
            for k, v in args.items()
        }
    return args


def _build_study_plan(exams, lang="es"):
    """Plan de estudio determinista a partir de los exámenes reales."""
    en = lang == "en"
    sorted_exams = sorted(exams, key=lambda e: (e.get("date") or "9999"))
    today = date.today()
    lines = []
    if en:
        lines.append(f"You have {len(sorted_exams)} upcoming exam(s):")
    else:
        lines.append(f"Tienes {len(sorted_exams)} exámenes próximos:")
    for e in sorted_exams:
        d = e.get("date") or "?"
        lines.append(f'  - "{e.get("title", "")}" el {d}')
    first = (sorted_exams[0] or {}).get("date")
    first_d = None
    try:
        first_d = date.fromisoformat(first) if first else None
    except (TypeError, ValueError):
        first_d = None
    if first_d and first_d >= today:
        weeks = max(1, ((first_d - today).days // 7) + 1)
        half = max(1, weeks // 2) if len(sorted_exams) > 1 else None
        if en:
            lines.append(f"Until the first exam ({first}) there are about {weeks} full week(s).")
            lines.append("Proposed plan (from today to the exam):")
        else:
            lines.append(f"Desde hoy hasta el primer examen ({first}) hay unas {weeks} semana(s) completas.")
            lines.append("Plan propuesto (de hoy al examen):")
        for i in range(weeks):
            start = today + timedelta(weeks=i)
            end = start + timedelta(days=6)
            if half is not None:
                if i < half:
                    target = 1
                    label = f'examen {1}: "{sorted_exams[0].get("title", "")}"'
                else:
                    target = 2
                    label = f'examen {2}: "{sorted_exams[1].get("title", "")}"' if len(sorted_exams) > 1 else "repaso general"
            else:
                target = 1
                label = f'examen {1}: "{sorted_exams[0].get("title", "")}"'
            if en:
                lines.append(f"- Week {i+1} ({start:%d-%m} to {end:%d-%m}): study for {label}")
            else:
                lines.append(f"- Semana {i+1} ({start:%d-%m} a {end:%d-%m}): estudiar para {label}")
        if en:
            lines.append("If you want, I can create these study sessions as tasks in your calendar.")
        else:
            lines.append("Si quieres, puedo apuntar estas sesiones de estudio como tareas en tu calendario.")
    return "\n".join(lines)


def _run_external_extraction(uid, text, api_key, api_url, model_name, priv_ctx=None):
    """Enmascara el texto y pide el JSON estricto a la API externa."""
    if priv_ctx is not None:
        _msgs, mapping = privacy.mask_conversation_with_context(
            [{"role": "user", "content": text}], priv_ctx
        )
        masked = _msgs[0]["content"]
    else:
        masked, mapping = privacy.mask_sensitive(text, mode="full")
    today = date.today().isoformat()
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Fecha actual: {today}. Mensaje: {masked}"},
        ],
        "temperature": 0.1,
        "max_tokens": 300,
    }
    try:
        content = external_client.complete(payload, api_key, api_url, timeout=45)
    except Exception:
        return None, mapping, masked
    data = tools._tolerant_json(content)
    if not isinstance(data, dict):
        return None, mapping, masked
    return data, mapping, masked


def _handle_extracted_action(uid, data, mapping, user_text, lang="es"):
    """Ejecuta la acción extraída y devuelve una respuesta estructurada local."""
    en = lang == "en"
    action = str(data.get("action") or "unknown").strip().lower()
    if action not in ("log_work", "create_event", "list_events"):
        return None

    def _v(key):
        raw = data.get(key)
        if raw is None:
            return None
        return privacy.unmask(str(raw).strip(), mapping) or None

    title = _v("title")
    entity = _v("entity")
    location = _v("location")
    date_raw = _v("target_date_raw")
    time_raw = _v("target_time_raw")
    notes = _v("notes")
    try:
        duration = float(data["duration_hours"]) if data.get("duration_hours") is not None else None
    except (TypeError, ValueError):
        duration = None

    if action == "list_events":
        period = tools.detect_read_period(user_text) or (date_raw or None)
        args = {"period": period} if period else {}
        result = tools.execute_tool("list_upcoming_events", args, uid)
        if isinstance(result, dict) and result.get("events") is not None:
            return tools.format_events_summary(result, lang)
        return None

    if action == "log_work":
        if not title and entity:
            title = f"Trabajo en {entity}"
        title = title or "Trabajo"
        args = {"title": title, "category": "trabajo"}
        if location:
            args["location"] = location
        if duration or notes:
            parts = [f"Trabajo de {duration:g}h" if duration else None, notes]
            args["description"] = " · ".join(p for p in parts if p)
        args["date"] = date_raw or date.today().isoformat()
    else:  # create_event
        args = {}
        if title:
            args["title"] = title
        if date_raw:
            args["date"] = date_raw
        if time_raw:
            args["startTime"] = time_raw
        if location:
            args["location"] = location
        if notes:
            args["description"] = notes

    result = tools.execute_tool("create_event", args, uid)
    if isinstance(result, dict) and result.get("error"):
        return None
    if isinstance(result, dict) and result.get("ok"):
        normalized = tools.normalize_tool_args("create_event", args) or args
        d = normalized.get("date") or args.get("date") or date.today().isoformat()
        if en:
            noun = "work" if action == "log_work" else "event"
            return f'I have recorded the {noun} "{args.get("title")}" for {d}.'
        noun = "el trabajo" if action == "log_work" else "el evento"
        return f'He registrado {noun} "{args.get("title")}" para el {d}.'
    return None


def _run_tool_once(executed_tool_calls, name, args, uid, last_user_text=None):
    """Ejecuta una herramienta evitando llamadas duplicadas."""
    if not isinstance(args, dict):
        args = {}
    call_key = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
    if call_key in executed_tool_calls:
        return executed_tool_calls[call_key], False

    result = tools.execute_tool(name, args, uid)
    if name == "list_upcoming_events" and last_user_text:
        period = tools.detect_read_period(last_user_text)
        if period:
            filtered = tools.execute_tool("list_upcoming_events", {"period": period}, uid)
            if re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE):
                evs = [
                    e for e in (filtered.get("events") or [])
                    if re.search(r"trabaj|work", e.get("title") or "", re.IGNORECASE)
                ]
                filtered = {"events": evs, "total": len(evs)}
            result = filtered
    executed_tool_calls[call_key] = result
    return result, True


def _fallback_summary(executed_tool_calls, lang="es"):
    """Resumen determinista cuando el modelo no genera texto legible."""
    en = lang == "en"
    last_list = None
    last_ok_name = None
    for (name, _), result in executed_tool_calls.items():
        if isinstance(result, dict):
            if "events" in result:
                last_list = result
            if result.get("ok"):
                last_ok_name = name
    if last_list is not None:
        return tools.format_events_summary(last_list, lang)
    if last_ok_name:
        if en:
            verb = {
                "create_event": "created the event",
                "create_task": "created the task",
                "update_event": "updated the item",
                "delete_event": "deleted the item",
            }.get(last_ok_name)
            if verb:
                return f"Done. I have {verb} in your calendar."
        else:
            verb = {
                "create_event": "creado el evento",
                "create_task": "creada la tarea",
                "update_event": "actualizado el elemento",
                "delete_event": "eliminado el elemento",
            }.get(last_ok_name)
            if verb:
                return f"Hecho. He {verb} en tu agenda."
    return "Done." if en else "Hecho."


def _write_confirmation(executed_tool_calls, lang="es"):
    """Confirmación determinista de las escrituras ejecutadas con éxito."""
    created = []
    updated_or_deleted = None
    for (name, args_dump), result in executed_tool_calls.items():
        if not (isinstance(result, dict) and result.get("ok")):
            continue
        try:
            args = json.loads(args_dump)
        except (json.JSONDecodeError, TypeError):
            args = {}
        if name in ("create_event", "create_task"):
            created.append((name, args))
        elif name in ("update_event", "delete_event"):
            updated_or_deleted = (name, args)

    en = lang == "en"
    parts = []

    if created:
        if len(created) == 1:
            name, args = created[0]
            title = args.get("title") or ""
            if name == "create_task":
                msg = 'I have created the task "{0}"' if en else 'He creado la tarea "{0}"'
            else:
                msg = 'I have created the event "{0}"' if en else 'He creado el evento "{0}"'
            msg = msg.format(title)
            if args.get("date"):
                msg += (f" for {args['date']}" if en else f" para el {args['date']}")
            if args.get("startTime"):
                msg += (f" at {args['startTime']}" if en else f" a las {args['startTime']}")
            parts.append(msg + ".")
        else:
            if en:
                parts.append(f"I have created {len(created)} items in your calendar:")
            else:
                parts.append(f"He creado {len(created)} tareas/eventos en tu agenda:")
            for (name, args) in created[:8]:
                title = args.get("title") or ""
                d = args.get("date") or ""
                t = args.get("startTime") or ""
                line = f'  - "{title}"'
                if d:
                    line += f" ({d}" + (f" {t})" if t else ")")
                parts.append(line)
            if len(created) > 8:
                parts.append(f"  - ...y {len(created) - 8} más" if not en
                             else f"  - ...and {len(created) - 8} more")

    if updated_or_deleted is not None:
        name, args = updated_or_deleted
        if name == "update_event":
            parts.append("I have updated the item in your calendar." if en
                         else "He actualizado el elemento en tu agenda.")
        else:
            parts.append("I have deleted the item from your calendar." if en
                         else "He eliminado el elemento de tu agenda.")

    return "\n".join(parts) if parts else None


def _persist_attachments(uid, attachments):
    """Guarda los adjuntos con payload en el almacenamiento de cloud."""
    # El storage de IA pasa por el StorageContract. get_token() es acceso al
    # token de la petición (infraestructura neutral), no una operación de
    # almacenamiento, por lo que se toma de _infra (no de cloud.services).
    from modules.storage import store
    from modules.api.cloud import _infra
    from modules.session import session as sess
    token = _infra.get_token()
    if not token or not uid:
        return attachments
    username = sess.get_user(token)
    out = []
    for att in attachments or []:
        if not isinstance(att, dict):
            if att:
                out.append({"id": att})
            continue
        data = att.get("data")
        if data:
            filename = att.get("name") or "archivo"
            try:
                if data.startswith("data:"):
                    raw = data.split(",", 1)[1] if "," in data else data
                    payload = base64.b64decode(raw)
                else:
                    payload = data.encode("utf-8")
            except Exception:
                out.append(att)
                continue
            ref = store.ai_save_file(token, filename, payload, username, uid)
            if "error" in ref:
                out.append(att)
                continue
            out.append({"id": ref["id"]})
            continue
        att_id = att.get("id") if isinstance(att, dict) else att
        if att_id:
            out.append({"id": att_id})
    return out


def _log_ai_conversation_audit(uid, model_name, privacy_mode, original_msgs, sent_msgs):
    """Registra en logs el mensaje original y el procesado enviado a la IA."""
    try:
        log_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "logs")
        os.makedirs(log_dir, exist_ok=True)
        file_path = os.path.join(log_dir, "ai_conversations_audit.txt")

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        lines = [
            "=" * 80,
            f"FECHA Y HORA : {timestamp}",
            f"USUARIO ID   : {uid or 'Anon'}",
            f"MODELO       : {model_name}",
            f"MODO PRIV.   : {privacy_mode}",
            "-" * 80,
            "[ 1. MENSAJE ORIGINAL (HISTORIAL REAL EN SERVIDOR) ]",
            json.dumps(original_msgs, ensure_ascii=False, indent=2),
            "-" * 80,
            "[ 2. MENSAJE PROCESADO / ENMASCARADO (ENVIADO A LA IA) ]",
            json.dumps(sent_msgs, ensure_ascii=False, indent=2),
            "=" * 80 + "\n\n"
        ]
        with open(file_path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines))
    except Exception:
        pass


def stream_chat(uid: Optional[str], data: dict):
    model = _resolve_requested_model(data.get("model"))
    messages = data.get("messages", [])
    session_id = data.get("session_id")
    title = data.get("title", "New Chat")
    reasoning_mode = bool(data.get("reasoning_mode", False))

    if uid and messages:
        last_msg = messages[-1]
        if last_msg.get("role") == "user":
            workspace_id = data.get("workspace_id")
            session_id = repository.create_session(uid, model, title, session_id, workspace_id)

            _prev = repository.get_session_messages(uid, session_id)
            _prev_pool = [(r.get("role"), r.get("content"), r.get("model"), r.get("attachments")) for r in _prev]
            _used = set()

            def _prev_meta_for(role, content):
                for i, (r, c, mdl, atts) in enumerate(_prev_pool):
                    if i in _used:
                        continue
                    if r == role and c == content:
                        _used.add(i)
                        return mdl, atts
                return None, None

            rows = []
            for m in messages:
                _m_model, _m_atts = _prev_meta_for(m.get("role"), m.get("content"))
                _m_model = _m_model or model
                _m_atts = m.get("attachments") or _m_atts
                if m["role"] == "user" and _m_atts:
                    _m_atts = _persist_attachments(uid, _m_atts)
                rows.append({"role": m["role"], "content": m["content"], "model": _m_model, "attachments": _m_atts})
            repository.replace_session_messages(uid, session_id, rows)

    options = dict(data.get("options") or {})
    if reasoning_mode:
        options.setdefault("temperature", 0.6)
        options.setdefault("num_predict", 32768)
        sys_directive = ""
    else:
        options.setdefault("temperature", 0.7)
        options.setdefault("num_predict", 32768)
        sys_directive = ""

    payload = {**data, "keep_alive": "30s", "options": options}
    q = queue.Queue()
    gen_id = uuid.uuid4().hex
    _state = {"consumed": False}

    opts = data.get("options", {})
    privacy_mode = opts.get("privacy_mode") or "full"
    if privacy_mode not in ("full", "moderate", "free"):
        privacy_mode = "full"
    _priv_ctx = privacy.MaskingContext(mode=privacy_mode)

    if session_id:
        q.put(("chunk", json.dumps({"session_id": session_id}) + "\n"))
        ACTIVE_GENERATIONS[session_id] = {
            "model": model, "started_at": time.time(), "gen_id": gen_id,
        }

    def _is_cancelled() -> bool:
        return gen_id in CANCELED_GENS

    def background_worker():
        full_response = ""
        final_text = None
        slot_acquired = False
        last_qpos = [-1]
        worker_error = None
        gen_key = f"{session_id or 'anon'}:{gen_id}"

        def _queue_notify(position):
            if position != last_qpos[0]:
                last_qpos[0] = position
                q.put(("chunk", json.dumps({"queue": {"position": position}}) + "\n"))

        def _final(msg):
            nonlocal final_text
            if _priv_ctx is not None and _priv_ctx.mapping:
                msg = privacy.unmask(msg, _priv_ctx.mapping)
            final_text = msg
            q.put(("chunk", (json.dumps({"message": {"content": msg}}) + "\n").encode()))

        try:
            slot_acquired = False
            last_user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), None) if messages else None

            # --- Detección de URLs ---
            if last_user_msg:
                urls_in_message = web_search.extract_urls(last_user_msg)
                if urls_in_message:
                    q.put(("chunk", json.dumps({"message": {"role": "assistant", "content": "🔗 *Analizando enlaces...*\n\n"}})))
                    scraped_contents = []
                    for url in urls_in_message[:3]:
                        content = web_search.scrape_url_content(url)
                        if content:
                            scraped_contents.append(content)

                    if scraped_contents:
                        url_context = "\n\n---\n\n".join(scraped_contents)
                        url_system_prompt = (
                            "El usuario ha compartido uno o más enlaces. A continuación se muestra el contenido extraído de esas páginas web.\n"
                            "Usa esta información para responder a la pregunta del usuario sobre estos enlaces.\n"
                            "Basa tu respuesta ÚNICAMENTE en el contenido extraído. No inventes información que no aparezca en el texto.\n\n"
                            f"--- CONTENIDO DE LOS ENLACES ---\n{url_context}\n--- FIN DEL CONTENIDO ---"
                        )
                        if len(payload["messages"]) > 0:
                            payload["messages"].insert(-1, {"role": "system", "content": url_system_prompt})

            # --- Inyección de contexto de Workspace ---
            workspace_id = data.get("workspace_id")
            if workspace_id:
                ws_prompt = workspaces.build_workspace_context(workspace_id)
                if ws_prompt and len(payload["messages"]) > 0:
                    payload["messages"].insert(-1, {"role": "system", "content": ws_prompt})

            # --- Inyección de contexto de Archivos Adjuntos ---
            if uid and messages:
                last_user_msg_obj = next((m for m in reversed(messages) if m.get("role") == "user"), None)
                if last_user_msg_obj and last_user_msg_obj.get("attachments"):
                    att_context_parts = []
                    for att in last_user_msg_obj.get("attachments"):
                        att_id = att.get("id") or att.get("fileId")
                        att_name = att.get("name") or "archivo"
                        att_text = None

                        if att.get("data") and isinstance(att.get("data"), str) and not att.get("data").startswith("data:"):
                            att_text = att.get("data")

                        if not att_text and att_id:
                            try:
                                from modules.storage import store
                                file_path = store.ai_download_file_by_uid(uid, att_id)
                                if file_path and os.path.exists(file_path):
                                    ext = os.path.splitext(file_path)[1].lower()
                                    flags = store.ai_ext_flags(file_path)
                                    if flags.get("is_text"):
                                        with open(file_path, "r", encoding="utf-8", errors="replace") as af:
                                            att_text = af.read()
                                    elif ext == ".pdf":
                                        try:
                                            import pypdf
                                            reader = pypdf.PdfReader(file_path)
                                            att_text = "\n".join([page.extract_text() or "" for page in reader.pages])
                                        except Exception:
                                            pass
                            except Exception:
                                pass

                        if att_text:
                            safe_content = att_text.replace("```", "\\`\\`\\`")
                            att_context_parts.append(f"[Contenido del archivo: {att_name}]\n```\n{safe_content}\n```")

                    if att_context_parts:
                        last_content = last_user_msg_obj.get("content", "")
                        has_inlined = any(f"[Contenido del archivo: {att.get('name')}]" in last_content or f"[Contenido del archivo adjunto: {att.get('name')}]" in last_content for att in last_user_msg_obj.get("attachments", []))
                        if not has_inlined and len(payload.get("messages", [])) > 0:
                            att_prompt = (
                                "El usuario ha adjuntado los siguientes archivos para esta consulta. "
                                "Analiza y usa su contenido para responder:\n\n" + "\n\n".join(att_context_parts)
                            )
                            payload["messages"].insert(-1, {"role": "system", "content": att_prompt})

            # --- Modo Búsqueda Web ---
            if data.get("search_mode") and last_user_msg:
                q.put(("chunk", json.dumps({"message": {"role": "assistant", "content": "🔍 *Buscando en la web...*\n\n"}})))
                _safe_query, _ = privacy.mask_conversation_with_context(
                    [{"role": "user", "content": last_user_msg}], _priv_ctx
                )
                search_query = _safe_query[0]["content"]
                search_results = web_search.perform_web_search(search_query)
                system_prompt = (
                    "INSTRUCCIONES CRÍTICAS PARA ESTA RESPUESTA:\n"
                    "1. A continuación se te proporcionan resultados REALES extraídos de internet en tiempo real.\n"
                    "2. Responde ÚNICAMENTE con la información que aparece textualmente en estos resultados.\n"
                    "3. NO inventes, supongas ni completes NINGÚN dato que no esté explícitamente en los resultados.\n"
                    "4. Si los resultados no contienen suficiente información, dilo explícitamente.\n"
                    "5. Cita las fuentes cuando sea posible.\n"
                    "6. NUNCA menciones tu fecha de corte de conocimiento.\n\n"
                    f"--- RESULTADOS DE BÚSQUEDA WEB EN TIEMPO REAL ---\n{search_results}\n--- FIN DE RESULTADOS ---"
                )
                if len(payload["messages"]) > 0:
                    payload["messages"].insert(-1, {"role": "system", "content": system_prompt})

            is_external = False
            external_api_key = None
            external_api_url = None
            actual_model_name = model
            provider = ""
            sub_model = None
            key_data = None

            if model.startswith("API:"):
                is_external = True
                rest = model.split(":", 1)[1].strip()
                provider = rest
                if ":" in rest:
                    provider, _, sub_model = rest.partition(":")
                    provider = provider.strip()
                    sub_model = sub_model.strip()
            elif model.startswith("gemini-"):
                is_external = True
                provider = "google"
                sub_model = model
            elif model.startswith("openrouter/") or (uid and "/" in model and repository.get_api_key(uid, "openrouter")):
                is_external = True
                provider = "openrouter"
                sub_model = model

            if data.get("external_provider"):
                is_external = True
                provider = data["external_provider"]
                if data.get("model"):
                    sub_model = data["model"]

            if is_external:
                if uid and provider:
                    key_data = repository.get_api_key(uid, provider)
                    if key_data:
                        external_api_key = key_data.get("api_key")
                        external_api_url = key_data.get("api_url")

                provider_key = (provider or "").lower()
                adapter = (PROVIDER_REGISTRY.get(provider_key)
                           or OpenAICompatibleProvider(provider_key, external_api_url or "https://api.openai.com/v1"))

                # 1. URL por defecto del proveedor si no se especificó una propia
                external_api_url = external_api_url or adapter.default_url

                # 2. Obtener catálogo dinámico desde el adaptador correspondiente
                available_models = adapter.get_models_cached(external_api_key, external_api_url) if external_api_key else []

                # 3. Resolución universal del modelo sin excepciones por proveedor
                requested = (sub_model or (key_data or {}).get("model") or ("" if model.startswith("API:") else model)).strip()
                if requested and (not available_models or requested in available_models):
                    actual_model_name = requested
                elif available_models:
                    actual_model_name = available_models[0]
                else:
                    actual_model_name = requested or provider_key

                external_tools = True
                external_tool_choice = True
                if provider_key == "openrouter" and sub_model:
                    _catalog = _fetch_openrouter_catalog() or []
                    _entry = next((m for m in _catalog if (m or {}).get("id") == sub_model), None)
                    _params = (_entry or {}).get("supported_parameters") or []
                    external_tools = "tools" in _params
                    external_tool_choice = "tool_choice" in _params
            else:
                external_tools = False
                external_tool_choice = True

            last_user_text = next(
                (m.get("content", "") for m in reversed(payload.get("messages", []))
                 if isinstance(m, dict) and m.get("role") == "user"),
                "",
            )
            chat_mode = str(data.get("mode", "") or "").strip().lower()
            agenda_disabled = chat_mode == "normal"
            agenda_intent = (not agenda_disabled) and tools.is_agenda_request(last_user_text)
            user_lang = tools.detect_lang(last_user_text)
            buffer_all = agenda_intent

            if agenda_disabled:
                _system_prompt = None
            else:
                _system_prompt = tools.build_agent_prompt(extraction=agenda_intent)
                if sys_directive:
                    _system_prompt += "\n" + sys_directive

            agent_messages = (
                ([{"role": "system", "content": _system_prompt}] if _system_prompt else [])
                + list(payload.get("messages", []))
            )

            injected_events = None
            _future_exams: list = []
            _data_backed = False
            if not is_external and not agenda_disabled:
                injected_events = tools.execute_tool("list_upcoming_events", {"days": 30}, uid)
                if isinstance(injected_events, dict) and injected_events.get("events"):
                    _data_backed = True
                    agent_messages.insert(1, {
                        "role": "system",
                        "content": (
                            "Contexto de agenda del usuario (úsalo SOLO si es relevante para la "
                            "pregunta: fechas límite, planificación, disponibilidad; no lo menciones "
                            "si no aporta; si necesitas más datos usa list_upcoming_events). "
                            "Si el usuario pregunta por algo que NO está en esta lista, responde "
                            "que no está registrado en su agenda y NO inventes fechas ni datos: "
                            + json.dumps(injected_events, ensure_ascii=False)
                        ),
                    })

            if agenda_intent:
                _period = tools.detect_read_period(last_user_text)
                if _period:
                    injected_events = tools.execute_tool("list_upcoming_events", {"period": _period}, uid)
                    if (isinstance(injected_events, dict) and injected_events.get("events")):
                        _data_backed = True
                    if (not re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE)
                            and isinstance(injected_events, dict)
                            and not (injected_events.get("events") or injected_events.get("summary"))):
                        injected_events["summary"] = (
                            "No tienes eventos registrados en ese periodo."
                            if user_lang != "en" else
                            "You have no events registered in that period."
                        )

                if re.search(r"examen|estudiar|estudio|exam|study", last_user_text, re.IGNORECASE):
                    _exams_all = tools.execute_tool("list_upcoming_events", {"query": "examen"}, uid)
                    _exams = _exams_all.get("events") or [] if isinstance(_exams_all, dict) else []
                    _today_iso = date.today().isoformat()
                    _future_exams = [e for e in _exams if (e.get("date") or "") >= _today_iso]
                    _past_exams = [e for e in _exams if (e.get("date") or "") < _today_iso]
                    if not _exams:
                        _data_backed = True
                        agent_messages.insert(1, {
                            "role": "system",
                            "content": (
                                "AVISO: no hay ningún examen registrado en la agenda del usuario. "
                                "Si pregunta por un examen concreto o una fecha, responde que no "
                                "está registrado en su agenda y NO inventes fechas ni datos."
                            ),
                        })
                    elif not _future_exams and _past_exams:
                        _data_backed = True
                        _last = max(_past_exams, key=lambda e: e.get("date") or "")
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                f"No hay exámenes próximos en la agenda; el último fue "
                                f"\"{_last.get('title', '')}\" el {_last.get('date', '')}. "
                                "Si pregunta por la fecha de un examen pasado, usa este dato; "
                                "no inventes fechas."
                            ),
                        })
                    if _future_exams:
                        _data_backed = True
                        _exams_list = " | ".join(
                            f"\"{e.get('title', '')}\" el {e.get('date', '?')}"
                            for e in sorted(_future_exams, key=lambda e: e.get("date") or "9999")
                        )
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                "DATOS DE LOS EXÁMENES (fechas límite OBLIGATORIAS del plan de estudio): "
                                f"{_exams_list}. "
                                f"Hoy es {date.today().isoformat()}. "
                                "NO preguntes al usuario las fechas de los exámenes. Responde DIRECTAMENTE con el plan completo "
                                "repartiendo los temas en SEMANAS COMPLETAS entre hoy y el primer examen."
                            ),
                        })

                if not _future_exams and any(
                    isinstance(m, dict)
                    and re.search(r"examen|estudi|plan\s+de\s+estudio|sesiones?\s+de\s+estudio",
                                  m.get("content") or "", re.IGNORECASE)
                    for m in (payload.get("messages") or [])[-6:]
                ):
                    _ctx_exams = tools.execute_tool("list_upcoming_events", {"query": "examen"}, uid)
                    _ctx_list = _ctx_exams.get("events") or [] if isinstance(_ctx_exams, dict) else []
                    _today_iso = date.today().isoformat()
                    _future_exams = [e for e in _ctx_list if (e.get("date") or "") >= _today_iso]

                _work_query = None
                if re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE) and not _period:
                    _company = tools.extract_company(last_user_text)
                    _work_query = _company or "trabajo"
                    injected_events = tools.execute_tool("list_upcoming_events", {"query": _work_query}, uid)
                    if isinstance(injected_events, dict) and injected_events.get("events"):
                        _data_backed = True
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                f"Registros de trabajo del usuario (búsqueda \"{_work_query}\" en todo "
                                "el historial; responde con las fechas reales): "
                                + json.dumps(injected_events, ensure_ascii=False)
                            ),
                        })
                if _period and re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE):
                    _data_backed = True
                    _work_events = [
                        e for e in ((injected_events or {}).get("events") or [])
                        if re.search(r"trabaj|work", e.get("title") or "", re.IGNORECASE)
                    ]
                    injected_events = {"events": _work_events, "total": len(_work_events)}
                    if re.search(r"cu[áa]ntos?|cu[áa]ntas?|how\s+many|d[ií]as|days|veces", last_user_text, re.IGNORECASE) and _work_events:
                        _dates = [e.get("date", "") for e in _work_events]
                        if user_lang == "en":
                            _dates_txt = (", ".join(_dates[:-1]) + " and " + _dates[-1] if len(_dates) > 1 else _dates[0])
                            injected_events["summary"] = f"You worked {len(_work_events)} days in the requested period: {_dates_txt}."
                        else:
                            _dates_txt = (", ".join(_dates[:-1]) + " y " + _dates[-1] if len(_dates) > 1 else _dates[0])
                            injected_events["summary"] = f"Has trabajado {len(_work_events)} días en el periodo consultado: {_dates_txt}."

                _target = tools.resolve_target_day(last_user_text)
                if _target:
                    if injected_events is None:
                        injected_events = {"events": [], "total": 0}
                    _data_backed = True
                    _day_iso, _day_label, _day_label_en = _target
                    _day_events = [
                        e for e in ((injected_events or {}).get("events") or [])
                        if (e.get("date") or "") == _day_iso
                    ]
                    if _day_events:
                        _parts = []
                        for _e in _day_events:
                            _t = _e.get("startTime") or ""
                            _ti = _e.get("title") or ("Tarea" if _e.get("type") == "task" else "Evento")
                            _parts.append(f'"{_ti}"' + (f" a las {_t}" if _t else ""))
                        if user_lang == "en":
                            _noun = "event" if len(_day_events) == 1 else "events"
                            _summary = f"You have {len(_day_events)} {_noun} {_day_label_en} ({_day_iso}): " + ", ".join(_parts) + "."
                        else:
                            _noun = "evento" if len(_day_events) == 1 else "eventos"
                            _summary = f"Tienes {len(_day_events)} {_noun} {_day_label} ({_day_iso}): " + ", ".join(_parts) + "."
                    else:
                        _summary = f"You have no events {_day_label_en} ({_day_iso})." if user_lang == "en" else f"No tienes eventos {_day_label} ({_day_iso})."
                    injected_events["summary"] = _summary
                    if _day_events:
                        agent_messages.insert(1, {
                            "role": "system",
                            "_mask": True,
                            "content": (
                                f"Datos del día consultado ({_day_iso}) en la agenda del usuario: "
                                + json.dumps({"events": _day_events}, ensure_ascii=False)
                            ),
                        })

                _holiday_intent = bool(re.search(
                    r"puente|festivo|vacaciones|vacaci[oó]n|Semana Santa|\bfinde\b|"
                    r"fin\s+de\s+semana|se\s+celebra|d[ií]a\s+de\s+la\s+semana\s+cae|"
                    r"cu[áa]ndo\s+cae|qu[eé]\s+partido\s+hay|qui[eé]n\s+juega",
                    last_user_text, re.IGNORECASE))
                if _holiday_intent:
                    _data_backed = True
                    _hol_finde = bool(re.search(r"finde|fin\s+de\s+semana", last_user_text, re.IGNORECASE))
                    if _hol_finde:
                        _hol_result = tools.execute_tool("list_upcoming_events", {"period": "this_week"}, uid)
                        _hol_events = ((_hol_result.get("events") or []) if isinstance(_hol_result, dict) else [])
                        if _hol_events:
                            injected_events = _hol_result
                        else:
                            injected_events = {
                                "events": [], "total": 0,
                                "summary": "No tienes nada anotado para este fin de semana." if user_lang != "en" else "You don't have anything scheduled for this weekend.",
                            }
                    else:
                        _hol_query = tools.extract_holiday_query(last_user_text)
                        _hol_result = tools.execute_tool("list_upcoming_events", {"query": _hol_query}, uid)
                        _hol_events = ((_hol_result.get("events") or []) if isinstance(_hol_result, dict) else [])
                        if _hol_events:
                            injected_events = _hol_result
                            agent_messages.insert(1, {
                                "role": "system",
                                "content": (
                                    f"Registros de la agenda del usuario para la consulta \"{_hol_query}\": "
                                    + json.dumps(injected_events, ensure_ascii=False)
                                ),
                            })
                        else:
                            if _hol_query == "partido":
                                _hol_msg = "No tienes ningún partido anotado en tu agenda." if user_lang != "en" else "You don't have any game scheduled in your calendar."
                            elif _hol_query == "vacaciones":
                                _hol_msg = "No tienes vacaciones anotadas en tu agenda." if user_lang != "en" else "You have no vacations noted in your calendar."
                            elif re.match(r"^\d{1,2}\s+de\s+", _hol_query):
                                _hol_msg = f"No tienes ningún puente ni festivo anotado para el {_hol_query} en tu agenda." if user_lang != "en" else f"You don't have any holiday or day off noted for {_hol_query} in your calendar."
                            else:
                                _hol_msg = f"No tienes nada de {_hol_query} anotado en tu agenda." if user_lang != "en" else f"You don't have anything about {_hol_query} noted in your calendar."
                            injected_events = {"events": [], "total": 0, "summary": _hol_msg}

                if isinstance(injected_events, dict) and "events" in injected_events:
                    if (injected_events or {}).get("events") or (injected_events or {}).get("summary"):
                        _data_backed = True
                    agent_messages.insert(1, {
                        "role": "system",
                        "content": (
                            "Datos reales de la agenda del usuario obtenidos por el sistema "
                            "(úsalos para responder preguntas sobre eventos próximos; dirígete "
                            "al usuario en segunda persona: 'has trabajado', 'tienes', 'tu agenda'): "
                            + json.dumps(injected_events, ensure_ascii=False)
                        ),
                    })

            executed_tool_calls = {}
            skip_model = False
            delete_not_found = False
            del_all_count = None
            missing_fields = None

            if not agenda_disabled and re.search(r"borra(?:r)?|elimina(?:r)?|quita(?:r)?|quitar|\bdelete\b|\bremove\b", last_user_text, re.IGNORECASE):
                skip_model = True
                if re.search(r"\btod[oa]s?\b|\b(all|everything)\b|\btodo\s+el\s+historial\b", last_user_text, re.IGNORECASE):
                    from modules.api.events.services import get_user_events
                    _all_events = get_user_events(uid)
                    _target_type = None
                    if re.search(r"\btareas?\b|\btasks?\b", last_user_text, re.IGNORECASE):
                        _target_type = "task"
                    elif re.search(r"\beventos?\b|\bappointments?\b|\bevents?\b|\bcitas?\b", last_user_text, re.IGNORECASE):
                        _target_type = "event"
                    del_all_count = 0
                    del_all_type = _target_type
                    for _e in _all_events:
                        if _target_type and (_e.get("type") or "event") != _target_type:
                            continue
                        _r, _ex = _run_tool_once(executed_tool_calls, "delete_event", {"id": _e["id"]}, uid, last_user_text)
                        if _r and _r.get("ok"):
                            del_all_count += 1
                else:
                    _del_call = tools.parse_user_event_request(last_user_text, user_lang, uid)
                    if _del_call and _del_call[0] == "delete_event" and _del_call[1].get("id"):
                        _del_result, _exec = _run_tool_once(executed_tool_calls, "delete_event", {"id": _del_call[1]["id"]}, uid, last_user_text)
                    else:
                        delete_not_found = True

            # Petición de creación incompleta: el usuario quiere crear un
            # evento/tarea pero no dio título y/o fecha. Se pregunta por lo
            # que falta SIN pasar por el modelo (determinista y garantizado).
            if not agenda_disabled and agenda_intent and not skip_model:
                try:
                    missing_fields = tools.missing_create_fields(last_user_text, user_lang)
                except Exception:
                    missing_fields = None
                if missing_fields:
                    skip_model = True

            if (is_external and external_api_key and last_user_text and not skip_model):
                if not agenda_disabled:
                    _extracted, _mask_mapping, _masked_text = _run_external_extraction(
                        uid, last_user_text, external_api_key, external_api_url, actual_model_name,
                        priv_ctx=_priv_ctx,
                    )
                    if _extracted and _extracted.get("action") in ("log_work", "create_event", "list_events"):
                        _resp = _handle_extracted_action(
                            uid, _extracted, _mask_mapping, last_user_text, user_lang,
                        )
                        if _resp:
                            _final(_resp)
                            return

            use_tools = (not agenda_disabled
                         and tools.model_supports_tools(model) is not False
                         and (not is_external or external_tools))
            tools_supported = True
            tool_rounds = 0

            while True:
                if skip_model:
                    break

                if is_external and external_api_key:
                    _safe_msgs, _ = privacy.mask_conversation_with_context(
                        agent_messages, _priv_ctx
                    )
                    model_payload = {**payload, "messages": _safe_msgs}
                else:
                    model_payload = {**payload, "messages": agent_messages}

                if use_tools and tools_supported:
                    model_payload["tools"] = tools.CALENDAR_TOOLS
                    model_payload["_tool_choice"] = external_tool_choice
                elif not is_external and agenda_intent:
                    model_payload["format"] = "json"

                _log_ai_conversation_audit(uid, model, privacy_mode, agent_messages, model_payload.get("messages", []))

                if is_external and external_api_key:
                    model_payload["model"] = actual_model_name
                    streamer = external_client.stream_chat(model_payload, external_api_key, external_api_url)
                else:
                    if not slot_acquired:
                        slot_acquired = _acquire_generation_slot(gen_key, _queue_notify, _is_cancelled)
                        if not slot_acquired:
                            if _is_cancelled():
                                return
                            raise _GenerationQueueTimeout(
                                f"La cola de generación está saturada: se agotó el tiempo de espera ({int(QUEUE_MAX_WAIT)}s)."
                            )
                    streamer = ollama_client.stream_chat(model_payload)

                tool_calls = []
                tools_unsupported = False
                round_content = ""
                buffered_round = []
                in_think_block = False
                think_buffer = ""

                for chunk in streamer:
                    if _is_cancelled():
                        break
                    try:
                        parsed = json.loads(chunk)
                    except (json.JSONDecodeError, TypeError):
                        q.put(("chunk", chunk))
                        continue

                    if parsed.get("error"):
                        _err_text = str(parsed.get("error", "")).lower()
                        if use_tools and tools_supported and (
                            "tools" in _err_text
                            or "input stream" in _err_text
                            or "peg-native" in _err_text
                            or "does not match the expected" in _err_text
                        ):
                            tools_unsupported = True
                            continue
                        raise RuntimeError(_friendly_error(str(parsed.get("error"))))

                    delta = parsed.get("message", {}).get("content", "")
                    extracted_r_delta = ""

                    if delta:
                        think_buffer += delta
                        delta = ""
                        while think_buffer:
                            if not in_think_block:
                                think_idx = think_buffer.find("<think>")
                                if think_idx != -1:
                                    delta += think_buffer[:think_idx]
                                    in_think_block = True
                                    think_buffer = think_buffer[think_idx + 7:]
                                else:
                                    partial_found = False
                                    for i in range(1, 7):
                                        if think_buffer.endswith("<think>"[:i]):
                                            delta += think_buffer[:-i]
                                            think_buffer = think_buffer[-i:]
                                            partial_found = True
                                            break
                                    if not partial_found:
                                        delta += think_buffer
                                        think_buffer = ""
                                    else:
                                        break
                            else:
                                end_idx = think_buffer.find("</think>")
                                if end_idx != -1:
                                    extracted_r_delta += think_buffer[:end_idx]
                                    in_think_block = False
                                    think_buffer = think_buffer[end_idx + 8:]
                                else:
                                    partial_found = False
                                    for i in range(1, 8):
                                        if think_buffer.endswith("</think>"[:i]):
                                            extracted_r_delta += think_buffer[:-i]
                                            think_buffer = think_buffer[-i:]
                                            partial_found = True
                                            break
                                    if not partial_found:
                                        extracted_r_delta += think_buffer
                                        think_buffer = ""
                                    else:
                                        break

                    if "message" in parsed:
                        parsed["message"]["content"] = delta

                    if delta and _priv_ctx is not None and _priv_ctx.mapping:
                        delta = privacy.unmask(delta, _priv_ctx.mapping)
                        if "message" in parsed:
                            parsed["message"]["content"] = delta

                    if delta:
                        round_content += delta
                        full_response += delta
                        if buffer_all or (tool_rounds == 0 and use_tools):
                            buffered_round.append((json.dumps(parsed) + "\n").encode())
                            continue

                    q.put(("chunk", (json.dumps(parsed) + "\n").encode()))

                    r_delta = ((parsed.get("message", {}) or {}).get("reasoning")
                               or (parsed.get("message", {}) or {}).get("reasoning_content")
                               or extracted_r_delta)
                    if r_delta and reasoning_mode:
                        if _priv_ctx is not None and _priv_ctx.mapping:
                            r_delta = privacy.unmask(r_delta, _priv_ctx.mapping)
                        q.put(("chunk", (json.dumps({"reasoning": r_delta}) + "\n").encode()))

                    tc = parsed.get("message", {}).get("tool_calls") or []
                    if tc:
                        tool_calls.extend(tc)

                if _is_cancelled():
                    break
                if tools_unsupported and use_tools:
                    tools_supported = False
                    tools.remember_model_tools(model, False)
                    continue

                if tool_calls:
                    if tool_rounds >= tools.MAX_TOOL_ROUNDS:
                        break
                    tool_rounds += 1

                    internal_tool_calls = []
                    for tc in tool_calls:
                        fn = dict(tc.get("function") or {})
                        tc_args = _parse_tool_args(fn.get("arguments"), _priv_ctx)
                        fn["arguments"] = json.dumps(tc_args, ensure_ascii=False)
                        internal_tool_calls.append({**tc, "function": fn})

                    agent_messages.append({
                        "role": "assistant",
                        "content": "",
                        "tool_calls": internal_tool_calls,
                    })

                    for tc in tool_calls:
                        fn = tc.get("function") or {}
                        name = str(fn.get("name") or "")
                        args = _parse_tool_args(fn.get("arguments"), _priv_ctx)
                        result, executed = _run_tool_once(executed_tool_calls, name, args, uid, last_user_text)
                        agent_messages.append({
                            "role": "tool",
                            "content": json.dumps(result, ensure_ascii=False),
                        })
                    continue

                if tool_rounds < tools.MAX_TOOL_ROUNDS:
                    text_calls, clean_text = tools.extract_text_tool_calls(round_content)
                    if text_calls:
                        tool_rounds += 1
                        agent_messages.append({
                            "role": "assistant",
                            "content": clean_text,
                        })
                        for name, args in text_calls:
                            result, executed = _run_tool_once(executed_tool_calls, name, args, uid, last_user_text)
                            agent_messages.append({
                                "role": "system",
                                "_mask": True,
                                "content": (
                                    "Resultado real de la consulta a la agenda: "
                                    + json.dumps(result, ensure_ascii=False)
                                    + ". Responde al usuario usando SOLO estos datos, con texto normal y SIN JSON."
                                ),
                            })
                        continue

                    if tool_rounds == 0 and tools.has_tool_attempt(round_content):
                        tool_rounds += 1
                        agent_messages.append({
                            "role": "assistant",
                            "content": clean_text,
                        })
                        agent_messages.append({
                            "role": "system",
                            "content": (
                                "La llamada a herramienta que escribiste no es válida. "
                                "Responde SOLO con el JSON exacto: "
                                '{"tool": "list_upcoming_events", "args": {"days": 30}} '
                                "u otra herramienta con sus argumentos. Nada de texto adicional."
                            ),
                        })
                        continue

                if buffer_all:
                    _, clean_text = tools.extract_text_tool_calls(round_content)
                    user_call = tools.parse_user_event_request(last_user_text, user_lang, uid)
                    write_done = False
                    if user_call:
                        for (name, _), result in executed_tool_calls.items():
                            if name == user_call[0] and isinstance(result, dict) and result.get("ok"):
                                write_done = True
                                break

                    conf_msg = _write_confirmation(executed_tool_calls, user_lang)
                    if user_call and not write_done and user_call[0] == "delete_event" and not user_call[1].get("id"):
                        _final("No he encontrado ese evento en tu agenda." if user_lang != "en" else "I could not find that event in your calendar.")
                    elif user_call and not write_done:
                        result, executed = _run_tool_once(executed_tool_calls, user_call[0], user_call[1], uid, last_user_text)
                        if executed and isinstance(result, dict) and result.get("ok"):
                            a = user_call[1]
                            if user_lang == "en":
                                noun = "task" if user_call[0] == "create_task" else "event"
                                msg = f'I have created the {noun} "{a.get("title", "")}" for {a.get("date", "")}'
                                if a.get("startTime"):
                                    msg += f" at {a['startTime']}"
                                msg += "."
                            else:
                                noun = "la tarea" if user_call[0] == "create_task" else "el evento"
                                msg = f'He creado {noun} "{a.get("title", "")}" para el {a.get("date", "")}'
                                if a.get("startTime"):
                                    msg += f" a las {a['startTime']}"
                                msg += "."
                            _final(msg)
                        elif executed and isinstance(result, dict) and result.get("error"):
                            _final("No he podido completar la petición: " + str(result["error"]))
                        else:
                            _final("No he podido entender la petición. Inténtalo de nuevo.")
                    elif conf_msg:
                        _final(conf_msg)
                    elif clean_text.strip():
                        has_events = bool(injected_events and isinstance(injected_events, dict) and injected_events.get("events"))
                        claims_empty = bool(re.search(
                            r"no\s+(hay|tienes|existen|quedan|hay días|ha trabajado|hay\s+ninguno)\s*(eventos?|tareas?|nada|d[ií]as|trabajado)?"
                            r"|no\s+(upcoming\s+)?(events?|tasks?|items|days)"
                            r"|didn'?t\s+(work|have)"
                            r"|no\s+(trabajé|trabajado|worked)",
                            clean_text, re.IGNORECASE))
                        if isinstance(injected_events, dict) and injected_events.get("summary"):
                            _final(injected_events["summary"])
                        elif _period and re.search(r"trabaj|empresa|work", last_user_text, re.IGNORECASE) and has_events:
                            _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                        elif _future_exams and re.search(r"can'?t\s+do|no\s+puedo\s+hacerlo|no\s+puedo|cannot|not\s+able", clean_text, re.IGNORECASE):
                            _final(_build_study_plan(_future_exams, user_lang))
                        elif has_events and re.search(r"can'?t\s+do|no\s+puedo\s+hacerlo|no\s+puedo|cannot|not\s+able", clean_text, re.IGNORECASE):
                            _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                        elif has_events and claims_empty and tools.has_events_for_scope(injected_events.get("events") or [], last_user_text):
                            _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                        elif _data_backed:
                            _final(clean_text)
                        else:
                            _cant = "I can't do that." if user_lang == "en" else "No puedo hacerlo."
                            _final(_cant)
                    elif executed_tool_calls:
                        _final(_fallback_summary(executed_tool_calls, user_lang))
                    elif injected_events is not None and isinstance(injected_events, dict):
                        _final(tools.format_events_summary(injected_events, user_lang, search=bool(_work_query)))
                    else:
                        _cant = "I can't do that." if user_lang == "en" else "No puedo hacerlo."
                        _final(_cant)
                else:
                    for b in buffered_round:
                        q.put(("chunk", b))
                break

            if skip_model:
                if missing_fields:
                    _parts_es = {
                        "title": "el nombre (¿cómo se llama?)",
                        "date": "el día (¿para qué día lo pongo?)",
                    }
                    _parts_en = {
                        "title": "the name (what should it be called?)",
                        "date": "the day (what day should I set it for?)",
                    }
                    _parts = _parts_en if user_lang == "en" else _parts_es
                    _p = " y ".join([_parts[k] for k in missing_fields["missing"]])
                    _kind = "la tarea" if missing_fields["kind"] == "task" else "el evento"
                    _kind_en = "the task" if missing_fields["kind"] == "task" else "the event"
                    msg = (
                        f"I could not create {_kind_en}: I'm missing {_p}."
                        if user_lang == "en" else
                        f"No he podido crear {_kind}: me falta {_p}."
                    )
                elif delete_not_found:
                    msg = "No he encontrado ese evento en tu agenda." if user_lang != "en" else "I could not find that event in your calendar."
                elif del_all_count is not None:
                    if del_all_count:
                        _what = {"task": "tareas", "event": "eventos"}.get(del_all_type, "elementos")
                        _what_en = {"task": "tasks", "event": "events"}.get(del_all_type, "items")
                        msg = f"He eliminado {del_all_count} {_what} de tu agenda." if user_lang != "en" else f"I have deleted {del_all_count} {_what_en} from your calendar."
                    else:
                        msg = "No tenías eventos en tu agenda." if user_lang != "en" else "You had no events in your calendar."
                else:
                    msg = _write_confirmation(executed_tool_calls, user_lang) or ("Hecho." if user_lang != "en" else "Done.")
                _final(msg)

        except _GenerationQueueTimeout as e:
            worker_error = _friendly_error(str(e))
            q.put(("error", worker_error))
        except Exception as e:
            worker_error = _friendly_error(str(e))
            q.put(("error", worker_error))
        finally:
            if slot_acquired:
                _release_generation_slot()
            _dequeue_generation(gen_key)
            q.put(("done", None))

            cancelled = _is_cancelled()
            final_text_saved = None

            if uid and session_id:
                text = final_text if final_text is not None else tools.strip_text_tool_calls(full_response)
                if _priv_ctx is not None and _priv_ctx.mapping and text:
                    text = privacy.unmask(text, _priv_ctx.mapping)
                try:
                    # Cancelación explícita: la BD NO persiste interrupciones.
                    # Sin mensaje assistant (ni siquiera vacío con cancelled=True);
                    # el frontend recupera el marcador desde almacenamiento local.
                    if not cancelled:
                        if worker_error:
                            err_suffix = f"\n\n*Error: {worker_error}*"
                            text = (text + err_suffix) if text else err_suffix
                        if text:
                            repository.save_message(uid, session_id, "assistant", text, model)
                            final_text_saved = text
                except Exception as e:
                    sys.stderr.write(f"[AI][WARN] Respuesta sin persistir (sesión eliminada?): {e}\n")

            if session_id:
                entry = ACTIVE_GENERATIONS.get(session_id)
                if entry and entry.get("gen_id") == gen_id:
                    ACTIVE_GENERATIONS.pop(session_id, None)
            CANCELED_GENS.discard(gen_id)

            if final_text_saved and not cancelled and not worker_error and not _state["consumed"]:
                preview = re.sub(r"[#*`>\n]", " ", final_text_saved).strip()[:120]
                if getattr(socketio, "server", None) is not None:
                    socketio.emit(
                        "ai_response_ready",
                        {"session_id": session_id, "preview": preview},
                        room=f"user_{uid}",
                    )

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
                    _state["consumed"] = True
                    break
            except queue.Empty:
                yield b"\n"
    except GeneratorExit:
        pass
