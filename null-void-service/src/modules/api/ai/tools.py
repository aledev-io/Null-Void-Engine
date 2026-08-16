"""Herramientas controladas (whitelist) para el asistente de agenda del chat IA.

Solo las operaciones registradas en CALENDAR_TOOLS pueden ejecutarse. Todas
pasan por los servicios existentes de eventos (SQL parametrizado) y quedan
acotadas al uid del usuario: la IA nunca ejecuta consultas arbitrarias ni
toca tablas fuera de la agenda del propio usuario.
"""
import json
import os
import re
from datetime import date, datetime, timedelta

import requests

from core.socket_ext import socketio
from modules.api.events.services import (
    get_user_events,
    create_user_event,
    update_user_event,
    delete_user_event,
    link_series,
    series_count,
)

_OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://ollama:11434")

# Caché de soporte de tools por modelo: True / False / None (desconocido)
_tool_cap_cache = {}

# Modelos preferidos para tareas de agenda (orden de prioridad): el primero
# disponible y con tools se usa cuando el prompt es de agenda.
PREFERRED_TOOL_MODELS = [
    "qwen2.5:0.5b-agenda",
    "qwen2.5:3b",
    "qwen2.5:7b",
    "llama3.2:3b",
    "qwen2.5:1.5b",
]

_AGENDA_PATTERNS = [
    r"\bagenda\b|\bcalendario\b|\bcitas?\b|\breuniones?\b|\breunión(?:es)?\b|\bhorario\b|\brecordatorios?\b",
    r"qu[eé]\s+(?:eventos?|tareas?|citas?|reuniones?|reunión(?:es)?|algo|cosas?|planes?|pendientes?)?\s*tengo|qu[eé]\s+me\s+queda|qu[eé]\s+hay|\btengo\s+algo\b",
    r"(?:quiero|quisiera|necesito|me\s+gustar[ií]a)\s+(?:dejar\s+)?(?:anotad[oa]|apuntad[oa]|registrad[oa])\s+que\b|(?:dejar\s+anotado|anotar|apuntar)\s+que\b",
    r"(?:quiero|quisiera|necesito|me\s+gustar[ií]a|puedes|podr[ií]as)\s+que\s+(?:me\s+)?(?:apuntes|apunte|anotes|anote|registres|registre|gu[áa]rdes|guarde)\s+que\b",
    r"próximos?|proximos?|próximas?|proximas?|próximamente|proximamente",
    r"mis\s+eventos?|mis\s+tareas?|mis\s+citas?",
    r"marcar\s+como\s+completad|completar",
    r"(?:crea(?:r)?(?:me)?|créa(?:r)?(?:me)?|a[ñn]ade(?:me)?|a[ñn]adir|borra|elimina|registra|apunta|hazme|hacer(?:me)?|pon(?:me)?|anota(?:me)?|ap[úu]nta(?:me)?|guard(?:a|ar)|(?:he\s+)?trabaj(?:\u00e9|e|ado))\b.{0,30}?\b(?:eventos?|tareas?|citas?|reuniones?|reunión(?:es)?|empresa)\b",
    r"(?:ap[úu]nta(?:me)?|anota(?:me)?|registra|hazme|pon(?:me)?|a[ñn]ade(?:me)?|gu[áa]rd[a]?(?:r)?(?:me)?)\b.{0,40}?\b(?:cena|quedada|comida|reunión|reunion|cita|evento|tarea|recordatorio|dentista|médico|medico|examen|clase|partido|concierto|entrevista|trabajo|junta|consulta)\b",
    r"\b(?:cena|quedada|comida|reunión|reunion|cita|evento|tarea|recordatorio|dentista|médico|medico|examen|clase|partido|concierto|entrevista|trabajo|junta|consulta)\b",
    r"\bexamen(?:es)?\b|\bexam(?:s)?\b|\bestudiar\b|\bestudio\b|\bstudy\b|\bstudying\b",
    r"plan\s+de\s+estudio|study\s+plan|preparar(?:me)?\s+para|organiz(?:arme|a)\s+el\s+estudio",
    r"(?:dime|d[oó]nde|donde|c[ua][aá]ndo|cu[áa]ntos|cu[áa]nto|qu[eé]\s+d[ií]as)\b.{0,40}?\b(?:trabaj|empresa|trabajo)",
    r"trabaj(?:é|e|ado).{0,25}?(?:semana|mes|hoy|ayer|este|esta)",
    r"\btrabaj(?:é|e|ado)\b.{0,50}?\b(?:hoy|ayer|esta\s+ma[ñn]ana|ap[úu]?ntalo|apunta|an[óo]?talo|anota|registra|gu[áa]rdalo|\d+\s*h|a\s+las)",
    r"(?:where|when|how\s+many\s+days).{0,40}?\b(?:worked|work)\b",
    r"\bwhat\s+(?:events?|tasks?|appointments?|anything|plans?)?\s*do\s+I\s+have\b|\bwhat'?s\s+(?:on|in)\s+my\b|\bmy\s+events?\b|\bmy\s+tasks?\b|\bmy\s+appointments?\b",
    r"\blist\s+my\b|\bschedule\b|\bcalendar\b|\bappointments?\b",
    r"\b(create|make|add|delete|remove|complete|set up|book)\b.{0,30}?\b(?:event|task|appointment)\b",
    r"puente|festivo(?:s)?|vacaciones|vacaci[oó]n|Semana Santa|\bfinde\b|fin\s+de\s+semana|"
    r"se\s+celebra|d[ií]a\s+de\s+la\s+semana\s+cae|cu[áa]ndo\s+cae|qu[eé]\s+d[ií]a\s+cae|"
    r"qu[eé]\s+partido\s+hay|qui[eé]n\s+juega|tengo\s+(?:algo|plan|planes)\s+(?:el\s+)?finde|"
    r"(?:hay|es)\s+fiesta",
]
_AGENDA_RE = re.compile("|".join(_AGENDA_PATTERNS), re.IGNORECASE)
_NEGATION_RE = re.compile(
    r"no\s+(?:quiero|necesito|me pidas|me des)\s+(?:tareas?|eventos?|citas?|agenda)",
    re.IGNORECASE,
)


def is_agenda_request(text):
    """¿El prompt del usuario parece de agenda/calendario/tareas?"""
    src = text or ""
    if _NEGATION_RE.search(src):
        return False
    return bool(_AGENDA_RE.search(src))


AGENDA_EXTRACTION_PROMPT = (
    "IMPORTANTE: si la consulta del usuario requiere usar su agenda, responde "
    "PRIMERO con un único JSON (o varios JSON, uno por línea, si pide varias cosas) "
    "en este formato (sin texto adicional, sin markdown, con comillas dobles):\n"
    '- {"tool": "list_upcoming_events", "args": {"days": 30}}\n'
    '- {"tool": "create_event", "args": {"title": "Reunión con Juan", "date": "2026-08-14", "startTime": "10:30", "endTime": "11:30", "category": "trabajo", "type": "event"}}\n'
    '- {"tool": "create_task", "args": {"title": "Estudiar mates", "date": "2026-08-14", "startTime": "09:00", "category": "estudio"}}\n'
    '- {"tool": "create_reminder", "args": {"title": "Tomar medicación", "date": "2026-08-14", "startTime": "08:00", "category": "salud"}}\n'
    '- {"tool": "update_event", "args": {"title": "Título del evento", "date_raw": "mañana"}}\n'
    '- {"tool": "delete_event", "args": {"title": "Título a borrar"}}\n'
    "Si el usuario pide varias cosas enlistadas ('apúntame esto, eso y lo otro'), "
    "emite una línea JSON por cada elemento a crear o modificar.\n"
    "La categoría (category) debe ser UNA de: personal, trabajo, salud, estudio, "
    "ocio, otros. La fecha (date) en formato YYYY-MM-DD o date_raw para texto.\n"
    'Si el usuario pregunta por algo concreto del PASADO ("¿cuándo he trabajado en la '
    'empresa A?", "¿cuándo fue la cita?", "¿cuántas veces...?"), usa list_upcoming_events '
    'con el argumento query: "texto a buscar" (busca en todo el historial).\n'
    "Si el usuario solo quiere ver información de su agenda, usa list_upcoming_events "
    "(con args period: \"this_week\", \"this_month\" o \"all\" si pregunta por "
    "esa semana/mes/historial, p. ej. \"dónde he trabajado esta semana\").\n"
    "Si el usuario pregunta por festivos, puentes, vacaciones o tiempo libre "
    "(\"¿hay puente el 24 de mayo?\", \"¿es festivo el viernes?\", \"¿cuándo cae "
    "Semana Santa?\", \"¿qué hago este finde?\", \"¿qué partido hay el domingo?\"), "
    "usa list_upcoming_events con args {\"query\": \"24 de mayo\"} (o {\"query\": "
    "\"puente\"}, {\"query\": \"festivo\"}, {\"query\": \"vacaciones\"}, {\"query\": "
    "\"Semana Santa\"}, {\"query\": \"partido\"}) o {\"period\": \"this_week\"} para "
    "el fin de semana. Si la agenda no tiene nada, el sistema lo dirá: no inventes "
    "puentes ni festivos oficiales.\n"
    "Si no necesitas ninguna herramienta, responde directamente."
)


def model_supports_tools(model: str):
    """¿Soporta tools el modelo local? True/False, o None si no se puede saber.

    Fuentes: capabilities de /api/show (caché) + aprendizaje en runtime
    (remember_model_tools cuando Ollama responde con error de tools).
    """
    model = str(model or "")
    if not model:
        return None
    if model in _tool_cap_cache:
        return _tool_cap_cache[model]
    try:
        r = requests.post(f"{_OLLAMA_URL}/api/show", json={"model": model}, timeout=5)
        if r.status_code == 200:
            caps = r.json().get("capabilities") or []
            supported = "tools" in caps
            _tool_cap_cache[model] = supported
            return supported
    except Exception:
        pass
    _tool_cap_cache[model] = None
    return None


def remember_model_tools(model: str, supported: bool):
    """Registra lo aprendido en runtime (p. ej. tras un 400 por tools)."""
    model = str(model or "")
    if model:
        _tool_cap_cache[model] = bool(supported)

AGENT_PROMPT = (
    "Eres el asistente personal de agenda de Null-Void Engine. "
    "Tu función es ayudar al usuario con los eventos y tareas de su calendario.\n"
    "Reglas:\n"
    "- Si el usuario pregunta por eventos o tareas próximas o qué tiene en agenda, usa "
    "la herramienta list_upcoming_events y responde con los datos reales que devuelva.\n"
    "- Si quiere crear un evento, usa create_event SOLO cuando el usuario haya "
    "dado título y fecha. Si falta información, pregúntale antes de llamar a la herramienta.\n"
    "- Si quiere crear una TAREA, usa la herramienta create_task (no create_event).\n"
    "- Si quiere modificar un evento o tarea (cambiar título, fecha, hora, categoría, "
    "marcar como completada...), usa update_event con su id y SOLO los campos que el usuario indique.\n"
    "- Al crear o actualizar un evento o tarea, asigna SIEMPRE la categoría (category) con "
    "UNA de estas etiquetas exactas: 'personal', 'trabajo', 'salud', 'estudio', 'ocio', 'otros'. "
    "Infiérela del contenido: médico/dentista/hospital → salud; examen/clase/estudiar → estudio; "
    "reunión/empresa/proyecto → trabajo; cine/fiesta/viaje → ocio; peluquería/banco/trámites → "
    "personal. Si no encaja en ninguna, usa 'otros'.\n"
    "- Si quiere eliminar un evento o tarea, usa delete_event con el id que devuelve "
    "list_upcoming_events y solo tras confirmación explícita del usuario.\n"
    "- Si el usuario pide ayuda para estudiar o preparar un examen, usa "
    "list_upcoming_events para encontrar el examen real en su agenda (título con "
    "\"examen\" o \"exam\"), usa su fecha como fecha límite del plan de estudio, "
    "y propón el reparto por semanas entre hoy y esa fecha. Si el usuario lo pide, "
    "puedes crear las sesiones de estudio como tareas (create_task) con sus fechas.\n"
    "- Actividades repetidas (p. ej. trabajar en la misma empresa varios días) se "
    "vinculan automáticamente en una serie (series_id): el resultado de create_event "
    "indica series_count. Cuando sea relevante, menciona al usuario cuántos días lleva "
    "registrados en esa serie.\n"
    "- Si el usuario pregunta por festivos, puentes, vacaciones o tiempo libre "
    "(p. ej. '¿hay puente el 24 de mayo?', '¿es festivo el viernes?', '¿cuándo cae "
    "Semana Santa?', '¿tengo vacaciones en mayo?', '¿qué hago este finde?', "
    "'¿qué partido hay el domingo?'), usa list_upcoming_events con query "
    "('puente', 'festivo', 'vacaciones', 'Semana Santa', la fecha o 'partido') o "
    "period this_week para el fin de semana. Si su agenda no tiene nada registrado, "
    "dilo con los datos reales, p. ej. 'No tienes ningún puente ni festivo anotado "
    "para el 24 de mayo en tu agenda'. NUNCA inventes festivos oficiales ni "
    "calendarios laborales.\n"
    "- NUNCA inventes eventos, exámenes, tareas ni fechas que no aparezcan en los "
    "datos proporcionados. Si el usuario pregunta por algo que no está en su agenda "
    "(p. ej. un examen que no existe), di claramente que no está registrado: "
    "'No tengo eso registrado en tu agenda'. No inventes fechas ni detalles.\n"
    "- Si una herramienta devuelve error, comunícalo al usuario tal cual.\n"
    "- Si no sabes la respuesta o no puedes hacer lo que te pide el usuario, responde "
    "exactamente 'No puedo hacerlo'. Nunca inventes datos, fechas ni respuestas.\n"
    "- Si no hay eventos que mostrar, dilo de forma natural.\n"
    "- Dirígete SIEMPRE al usuario en segunda persona: 'has trabajado', 'tienes', "
    "'tu agenda', 'puedes'. Nunca uses primera persona para los datos del usuario "
    "('he trabajado', 'mi agenda').\n"
    "Responde siempre en el mismo idioma en que te escribe el usuario."
)

CALENDAR_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_upcoming_events",
            "description": (
                "Lista los próximos eventos y tareas de la agenda del usuario (desde hoy, "
                "ordenados por fecha). Solo lectura, no modifica nada."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Horizonte en días (1-365). Por defecto 30.",
                        "minimum": 1,
                        "maximum": 365,
                    },
                    "category": {
                        "type": "string",
                        "description": "Filtrar por categoría: personal, trabajo, salud, estudio, ocio, otros. Opcional.",
                    },
                    "type": {
                        "type": "string",
                        "description": "Filtrar por tipo: event o task. Opcional.",
                        "enum": ["event", "task"],
                    },
                    "period": {
                        "type": "string",
                        "description": "Periodo: this_week, this_month, all, o dinámico como 'X_days', 'X_weeks' etc. Opcional.",
                    },
                    "query": {
                        "type": "string",
                        "description": "Texto a buscar en TODO el historial (títulos, categorías, descripciones), p. ej. 'puente', 'festivo', 'vacaciones', 'Semana Santa', '24 de mayo', 'partido', una empresa o un evento pasado. Opcional.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "Crea un evento (type=event) o tarea (type=task) en la agenda del usuario. Requiere título y fecha.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Título del evento o tarea"},
                    "date": {"type": "string", "description": "Fecha en formato YYYY-MM-DD"},
                    "startTime": {"type": "string", "description": "Hora de inicio en formato HH:MM (opcional)"},
                    "endTime": {"type": "string", "description": "Hora de fin en formato HH:MM (opcional)"},
                    "category": {"type": "string", "description": "Categoría: UNA de personal, trabajo, salud, estudio, ocio, otros (por defecto trabajo)"},
                    "description": {"type": "string", "description": "Notas o detalles (opcional)"},
                    "location": {"type": "string", "description": "Ubicación o lugar del evento (opcional)"},
                    "isImportant": {"type": "boolean", "description": "Marcar como importante o urgente (opcional)"},
                    "type": {"type": "string", "description": "event (por defecto), task o reminder", "enum": ["event", "task", "reminder"]},
                },
                "required": ["title", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": "Crea una TAREA en la agenda del usuario (type=task). Requiere título y fecha.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Título de la tarea"},
                    "date": {"type": "string", "description": "Fecha en formato YYYY-MM-DD"},
                    "startTime": {"type": "string", "description": "Hora de inicio en formato HH:MM (opcional)"},
                    "endTime": {"type": "string", "description": "Hora de fin en formato HH:MM (opcional)"},
                    "category": {"type": "string", "description": "Categoría: UNA de personal, trabajo, salud, estudio, ocio, otros (por defecto trabajo)"},
                    "description": {"type": "string", "description": "Notas o detalles (opcional)"},
                    "isImportant": {"type": "boolean", "description": "Marcar como importante o urgente (opcional)"},
                },
                "required": ["title", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": "Crea un RECORDATORIO o aviso personalizado en la agenda del usuario (type=reminder). Requiere título y fecha.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Título o mensaje del recordatorio"},
                    "date": {"type": "string", "description": "Fecha en formato YYYY-MM-DD"},
                    "startTime": {"type": "string", "description": "Hora del aviso en formato HH:MM (opcional)"},
                    "category": {"type": "string", "description": "Categoría: UNA de personal, trabajo, salud, estudio, ocio, otros (por defecto personal)"},
                    "description": {"type": "string", "description": "Notas o detalles adicionales (opcional)"},
                    "isImportant": {"type": "boolean", "description": "Marcar como importante o urgente (opcional)"},
                },
                "required": ["title", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_event",
            "description": "Modifica un evento o tarea existente por su id (lo devuelve list_upcoming_events). Solo cambia los campos indicados.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Id del evento o tarea a modificar"},
                    "title": {"type": "string", "description": "Nuevo título (opcional)"},
                    "date": {"type": "string", "description": "Nueva fecha en formato YYYY-MM-DD (opcional)"},
                    "startTime": {"type": "string", "description": "Nueva hora de inicio HH:MM (opcional)"},
                    "endTime": {"type": "string", "description": "Nueva hora de fin HH:MM (opcional)"},
                    "category": {"type": "string", "description": "Nueva categoría: UNA de personal, trabajo, salud, estudio, ocio, otros"},
                    "description": {"type": "string", "description": "Nuevas notas (opcional)"},
                    "location": {"type": "string", "description": "Nueva ubicación (opcional)"},
                    "isImportant": {"type": "boolean", "description": "Marcar como importante (opcional)"},
                    "completed": {"type": "boolean", "description": "Marcar como completada (tareas) (opcional)"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": "Elimina un evento o tarea por su id. Usar solo tras confirmación del usuario.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Id del evento o tarea a eliminar (lo devuelve list_upcoming_events)"},
                },
                "required": ["id"],
            },
        },
    },
]

MAX_TOOL_ROUNDS = 2


def build_agent_prompt(extraction=False):
    """Prompt del asistente con la fecha de hoy inyectada para que el modelo
    interprete correctamente fechas relativas (mañana, el lunes que viene...).

    Si extraction=True se añade la instrucción de formato JSON universal
    (funciona con cualquier modelo, tenga o no tool calling nativo).
    """
    hoy = date.today().isoformat()
    prompt = (
        AGENT_PROMPT
        + f"\nLa fecha de hoy es {hoy}. Usa SIEMPRE esta fecha como referencia "
        "para interpretar fechas relativas que diga el usuario (mañana, pasado "
        "mañana, esta semana, el próximo lunes...)."
    )
    if extraction:
        prompt += "\n\n" + AGENDA_EXTRACTION_PROMPT
    return prompt


def _parse_date(value, field="date"):
    if not isinstance(value, str):
        raise ValueError(f"{field}: debe ser texto en formato YYYY-MM-DD")
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"{field}: formato inválido, usa YYYY-MM-DD")


def _parse_time(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,2}:\d{2}", value.strip()):
        raise ValueError("startTime/endTime: formato inválido, usa HH:MM")
    h, m = value.strip().split(":")
    if not (0 <= int(h) <= 23 and 0 <= int(m) <= 59):
        raise ValueError("startTime/endTime: hora fuera de rango")
    return value.strip()


def _shift_month(d, n):
    """Día 1 del mes desplazado n meses respecto a d (n puede ser negativo)."""
    total = d.month - 1 + n
    year = d.year + total // 12
    month = total % 12 + 1
    return date(year, month, 1)


def _list_upcoming_events(uid, args):
    days = args.get("days")
    if days is not None:
        try:
            days = max(1, min(365, int(days)))
        except (TypeError, ValueError):
            days = None
    category = args.get("category")
    if isinstance(category, str):
        category = category.strip() or None
    ev_type = args.get("type")
    if isinstance(ev_type, str):
        ev_type = ev_type.strip().lower() or None
    period = args.get("period")
    if isinstance(period, str):
        period = period.strip().lower() or None
    query = args.get("query")
    if isinstance(query, str):
        query = query.strip().lower() or None

    today = date.today()
    events = get_user_events(uid)
    upcoming = list(events)
    if query:
        # Búsqueda por texto en TODO el historial (títulos, categorías,
        # descripciones), sin filtrar por fecha
        qn = _normalize_title(query)
        upcoming = [
            e for e in events
            if qn in _normalize_title(e.get("title") or "")
            or qn in _normalize_title(e.get("category") or "")
            or qn in _normalize_title(e.get("description") or "")
        ]
    elif period == "this_week":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        upcoming = [e for e in events if start.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
        end = start + timedelta(days=6)
        upcoming = [e for e in events if start.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period == "next_week":
        start = today + timedelta(days=(7 - today.weekday()) % 7)
        end = start + timedelta(days=6)
        upcoming = [e for e in events if start.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period == "this_month":
        start = today.replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        upcoming = [e for e in events if start.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period == "next_month":
        start = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        upcoming = [e for e in events if start.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif re.match(r"^\d+_months$", period or ""):
        # 'en 2 meses' -> period "2_months": los próximos N meses desde hoy
        n = int(period.split("_")[0])
        end = _shift_month(today, n)
        upcoming = [e for e in events if today.isoformat() <= (e.get("date") or "") < end.isoformat()]
    elif re.match(r"^\d+_weeks$", period or ""):
        # 'en 2 semanas' -> period "2_weeks": los próximos N semanas desde hoy
        n = int(period.split("_")[0])
        end = today + timedelta(weeks=n)
        upcoming = [e for e in events if today.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif re.match(r"^\d+_days$", period or ""):
        # 'en 5 días' -> period "5_days": los próximos N días desde hoy
        n = int(period.split("_")[0])
        end = today + timedelta(days=n)
        upcoming = [e for e in events if today.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif re.match(r"^\d+_hours$", period or ""):
        # 'en 3 horas' -> period "3_hours": eventos que empiezan en las próximas N horas
        n = int(period.split("_")[0])
        now = datetime.now()
        end = now + timedelta(hours=n)

        def _in_hours_window(e):
            d = (e.get("date") or "")
            try:
                day = datetime.fromisoformat(d)
            except (TypeError, ValueError):
                return False
            t = e.get("startTime") or ""
            if t:
                try:
                    hh, mm = t.split(":")
                    start = day.replace(hour=int(hh), minute=int(mm))
                except (TypeError, ValueError):
                    start = day
                end_ev = day + timedelta(days=1) if e.get("allDay") else start + timedelta(hours=1)
            else:
                start, end_ev = day, day + timedelta(days=1)
            return start < end and end_ev > now

        upcoming = [e for e in events if _in_hours_window(e)]
    elif period == "all":
        upcoming = list(events)
    else:
        upcoming = [e for e in events if (e.get("date") or "") >= today.isoformat()]
    if days is not None and not query:
        limit = (today + timedelta(days=days)).isoformat()
        upcoming = [e for e in upcoming if (e.get("date") or "") <= limit]
    if category:
        upcoming = [e for e in upcoming if (e.get("category") or "").lower() == category.lower()]
    if ev_type:
        upcoming = [e for e in upcoming if (e.get("type") or "event").lower() == ev_type]
    upcoming = sorted(upcoming, key=lambda e: (e.get("date") or "", e.get("startTime") or ""))[:20]

    result = []
    for e in upcoming:
        result.append({
            "id": e.get("id"),
            "title": e.get("title"),
            "date": e.get("date"),
            "startTime": e.get("startTime"),
            "endTime": e.get("endTime"),
            "allDay": bool(e.get("allDay")),
            "category": e.get("category"),
            "description": e.get("description") or "",
            "type": e.get("type") or "event",
            "completed": bool(e.get("completed")),
            "seriesId": e.get("seriesId"),
        })
    return {"events": result, "total": len(result)}


def _create_event(uid, args):
    title = str(args.get("title") or "").strip()
    if not title:
        raise ValueError("title es obligatorio")
    if len(title) > 200:
        raise ValueError("title demasiado largo (máx 200 caracteres)")
    date_str = str(args.get("date") or "").strip()
    _parse_date(date_str)

    data = {"title": title, "date": date_str, "category": "trabajo"}
    if args.get("startTime"):
        data["startTime"] = _parse_time(args["startTime"])
    if args.get("endTime"):
        data["endTime"] = _parse_time(args["endTime"])
    if args.get("category"):
        cat = str(args["category"]).strip().lower()
        if cat in {"personal", "trabajo", "salud", "estudio", "ocio", "otros"}:
            data["category"] = cat
        else:
            data["category"] = _guess_category(title) or "otros"
    if args.get("description"):
        desc = str(args["description"])[:2000]
        if desc:
            data["description"] = desc
    if args.get("location"):
        data["location"] = str(args["location"])[:200]
    if "isImportant" in args or "is_important" in args:
        data["isImportant"] = bool(args.get("isImportant") or args.get("is_important"))
    if "allDay" in args or "all_day" in args:
        data["allDay"] = bool(args.get("allDay") or args.get("all_day"))
    if "completed" in args:
        data["completed"] = bool(args.get("completed"))
    ev_type = str(args.get("type") or "event").strip().lower()
    if ev_type not in ("event", "task", "reminder"):
        raise ValueError("type debe ser event, task o reminder")
    data["type"] = ev_type

    # Serie: si ya existe un evento con el mismo título (actividad repetida,
    # p. ej. trabajo en la misma empresa), se vincula a la misma serie.
    series = _find_matching_series(uid, title, ev_type)

    event_id = create_user_event(uid, data)
    link_series(uid, event_id, series)
    return _series_result(uid, event_id, ev_type, series)


def _normalize_title(title):
    import unicodedata
    t = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", t.lower()).strip()


# Categorías reales del calendario (coinciden con el mapa de colores del frontend)
_CATEGORY_PATTERNS = (
    ("salud", re.compile(
        r"dentist|m[eé]dic|doctor|fisio|psicolog|psiquiatr|terapeut|enfermer|"
        r"hospital|vacun|an[áa]lisis\s+de\s+sangre|revisi[óo]n\s+m[ée]dica|"
        r"farmacia|consulta|cirug|operaci[óo]n|dolor|fiebre|gimnasio|gym|"
        r"entrenamiento|ejercicio", re.IGNORECASE)),
    ("estudio", re.compile(
        r"examen|ex[áa]mene|estudi|clase|universidad|instituto|colegio|deberes|"
        r"matr[íi]cula|tutor[íi]a|facultad|aprender|homework|lecture|study|exam|class",
        re.IGNORECASE)),
    ("ocio", re.compile(
        r"cine|pel[íi]cula|peli|concierto|partido|fiesta|cumple|quedada|"
        r"restaurante|bar|cena|comida|almuerzo|viaje|vacaciones|excursi[óo]n|"
        r"salida|movie|cinema|party|birthday|concert|trip|vacation|game|dinner|hangout",
        re.IGNORECASE)),
    ("trabajo", re.compile(
        r"reuni[óo]n|reuniones|trabaj|empresa|oficina|cliente|jef[ae]|informe|"
        r"proyecto|junta|entrevista|videollamada|conferencia|presentaci[óo]n|"
        r"meeting|company|office|boss|client|project|report|interview|deadline|work",
        re.IGNORECASE)),
    ("personal", re.compile(
        r"peluquer|peluquero|banco|tr[áa]mite|compra|supermercado|mudanza|"
        r"pasaporte|seguro|haircut|barber|bank|appointment|\bcita\b", re.IGNORECASE)),
)


def _guess_category(text):
    """Infiere la categoría del evento/tarea por palabras clave.
    Orden de prioridad: salud, estudio, ocio, trabajo, personal.
    Devuelve None si no hay indicios (se usa el default 'trabajo')."""
    for cat, pat in _CATEGORY_PATTERNS:
        if pat.search(text or ""):
            return cat
    return None


def _find_matching_series(uid, title, ev_type):
    """Busca el evento más reciente del usuario con el mismo título
    (normalizado, sin distinguir mayúsculas ni acentos) y mismo tipo."""
    norm = _normalize_title(title)
    best = None
    for e in get_user_events(uid):
        if (e.get("type") or "event") != ev_type:
            continue
        if _normalize_title(e.get("title") or "") != norm:
            continue
        if best is None or (e.get("date") or "") >= (best.get("date") or ""):
            best = e
    if not best:
        return None
    return {
        "id": best.get("id"),
        "series_id": best.get("seriesId") or best.get("id"),
    }


# series tracking has been moved to services.py


def _series_result(uid, event_id, ev_type, series):
    if series:
        return {
            "ok": True,
            "id": event_id,
            "type": ev_type,
            "series_id": series["series_id"],
            "series_count": series_count(uid, series["series_id"]),
            "linked_to": series["id"],
        }
    return {
        "ok": True,
        "id": event_id,
        "type": ev_type,
        "series_id": event_id,
        "series_count": 1,
    }


def _update_event(uid, args):
    event_id = str(args.get("id") or "").strip()
    if not event_id and (args.get("title") or args.get("description")):
        try:
            _ev = _find_event_by_desc(uid, args.get("title") or args.get("description"), args.get("date"), is_destructive=True)
            if _ev:
                event_id = str(_ev.get("id") or "").strip()
        except ValueError as e:
            if str(e) == "AMBIGUOUS":
                return {"ok": False, "error": "Hay varios eventos que coinciden con esa descripción. Por favor, sé más específico o usa la herramienta list_upcoming_events."}
            raise
    if not event_id:
        raise ValueError("id es obligatorio")

    current = [e for e in get_user_events(uid) if str(e.get("id")) == event_id]
    if not current:
        raise ValueError("Evento no encontrado")
    cur = current[0]

    data = {
        "title": cur.get("title") or "",
        "date": cur.get("date"),
        "startTime": cur.get("startTime"),
        "endTime": cur.get("endTime"),
        "allDay": bool(cur.get("allDay")),
        "category": cur.get("category") or "trabajo",
        "description": cur.get("description") or "",
        "completed": bool(cur.get("completed")),
        "isImportant": bool(cur.get("isImportant")),
        "type": cur.get("type") or "event",
        "location": cur.get("location") or "",
        "guests": cur.get("guests") or [],
    }

    if args.get("title"):
        title = str(args["title"]).strip()
        if not title:
            raise ValueError("title no puede quedar vacío")
        if len(title) > 200:
            raise ValueError("title demasiado largo (máx 200 caracteres)")
        data["title"] = title
    if args.get("date"):
        data["date"] = str(args["date"]).strip()
        _parse_date(data["date"])
    if args.get("startTime"):
        data["startTime"] = _parse_time(args["startTime"])
    if args.get("endTime"):
        data["endTime"] = _parse_time(args["endTime"])
    if args.get("category"):
        cat = str(args["category"]).strip().lower()
        if cat in {"personal", "trabajo", "salud", "estudio", "ocio", "otros"}:
            data["category"] = cat
        else:
            data["category"] = _guess_category(args.get("title") or cur.get("title")) or "otros"
    if args.get("description"):
        desc = str(args["description"])[:2000]
        if desc:
            data["description"] = desc
    if args.get("location") is not None:
        data["location"] = str(args["location"])[:200]
    if args.get("completed") is not None:
        data["completed"] = bool(args["completed"])
    if args.get("isImportant") is not None:
        data["isImportant"] = bool(args["isImportant"])

    update_user_event(uid, event_id, data)
    return {"ok": True, "id": event_id}


def _delete_event(uid, args):
    event_id = str(args.get("id") or "").strip()
    if not event_id and (args.get("title") or args.get("description")):
        try:
            _ev = _find_event_by_desc(uid, args.get("title") or args.get("description"), args.get("date"), is_destructive=True)
            if _ev:
                event_id = str(_ev.get("id") or "").strip()
        except ValueError as e:
            if str(e) == "AMBIGUOUS":
                return {"ok": False, "error": "Hay varios eventos que coinciden con esa descripción. Por favor, sé más específico o usa la herramienta list_upcoming_events."}
            raise
    if not event_id:
        raise ValueError("id es obligatorio")
    affected = delete_user_event(uid, event_id)
    if not affected:
        return {"ok": False, "error": "No se encontró ningún evento con ese id"}
    return {"ok": True}


def _create_task(uid, args):
    """Crea una tarea (type=task). Misma validación que create_event."""
    result = _create_event(uid, {**args, "type": "task"})
    return result


def _create_reminder(uid, args):
    """Crea un recordatorio / aviso personalizado (type=reminder). Misma validación que create_event."""
    result = _create_event(uid, {**args, "type": "reminder"})
    return result


_ALLOWED = {
    "list_upcoming_events": _list_upcoming_events,
    "create_event": _create_event,
    "create_task": _create_task,
    "create_reminder": _create_reminder,
    "update_event": _update_event,
    "delete_event": _delete_event,
}

_TOOL_NAMES_PATTERN = "list_upcoming_events|create_event|create_task|create_reminder|update_event|delete_event"
_TEXT_TOOL_PATTERN = re.compile(
    r"\[\[\s*(" + _TOOL_NAMES_PATTERN + r")\s*(\{.*?\})?\s*\]\]"
    r"|(?<!\w)(" + _TOOL_NAMES_PATTERN + r")\s*\(\s*(\{.*?\})?\s*\)",
    re.DOTALL,
)


def _tolerant_json(raw):
    """Parsea JSON roto producido por modelos locales. Repara, por orden:

    1. Cercas markdown (```json ... ```) y texto alrededor: busca el primer
       '{' y el último '}' del texto.
    2. Claves sin comillas ({title: "x"}), comillas simples, comas finales.
    3. True/False/None -> true/false/null.
    4. Llaves desbalanceadas: recorta desde el primer '{' hasta el último
       '}' que permita un parse coherente (barrido de secundos).
    """
    raw = (raw or "").strip()
    if not raw:
        return {}

    def _try(s):
        try:
            return json.loads(s)
        except Exception:
            return None

    obj = _try(raw)
    if obj is not None:
        return obj if isinstance(obj, dict) else {}

    # 1) recortar al rango { ... } (ignora explicaciones previas/posteriores)
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    raw = raw[start:end + 1]

    # 2) claves sin comillas, comillas simples en strings, comas finales
    fixed = re.sub(r"([{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', raw)
    fixed = re.sub(r"(?<![a-zA-Z0-9_])'|'(?![a-zA-Z0-9_])", '"', fixed)
    fixed = re.sub(r",\s*([}\]])", r"\1", fixed)

    # 3) literales python
    fixed = re.sub(r"\bTrue\b", "true", fixed)
    fixed = re.sub(r"\bFalse\b", "false", fixed)
    fixed = re.sub(r"\bNone\b", "null", fixed)

    obj = _try(fixed)
    if obj is not None:
        return obj if isinstance(obj, dict) else {}

    # 4) llaves rotas: intentar todos los cierres posibles desde el final
    for k in range(len(fixed) - 1, -1, -1):
        if fixed[k] == "}":
            obj = _try(fixed[:k + 1])
            if obj is not None:
                return obj if isinstance(obj, dict) else {}
    return {}


def _balanced_object(text, open_idx):
    """Devuelve (span_end, texto_del_objeto) para el '{' en open_idx."""
    depth = 0
    k = open_idx
    while k < len(text):
        ch = text[k]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return k + 1, text[open_idx:k + 1]
        k += 1
    return None, None


def _root_open(text, pos):
    """Busca hacia atrás el '{' que abre el objeto que contiene 'pos'."""
    depth = 0
    i = pos
    while i >= 0:
        ch = text[i]
        if ch == "}":
            depth += 1
        elif ch == "{":
            if depth == 0:
                return i
            depth -= 1
        i -= 1
    return None


_FUNCTION_OBJ_RE = re.compile(r"['\"]function['\"]\s*:\s*\{")

# Formato alternativo de modelos débiles: { "create_event", {"title": ...} }
_NAMED_TOOL_OBJ_RE = re.compile(r'\{\s*"?(' + _TOOL_NAMES_PATTERN + r')"?\s*,')

# Formato universal guiado por prompt: {"tool": "create_event", "args": {...}}
_TOOL_KEY_RE = re.compile(r"['\"](?:tool|name)['\"]\s*:\s*['\"](" + _TOOL_NAMES_PATTERN + r")['\"]")

# Formato de tool calls con marcadores XML de proveedor:
# <|tool_call_begin|>functions.list_upcoming_events:0<|tool_call_argument_begin|>{"period": ...}<|tool_call_end|>
_TAGGED_TOOL_RE = re.compile(
    r"<\|tool_call_begin\|>\s*(?:functions\.)?(" + _TOOL_NAMES_PATTERN + r")\s*:\s*\d+\s*"
    r"<\|tool_call_argument_begin\|>\s*(.*?)<\|tool_call_end\|>",
    re.DOTALL,
)

# Indicio de intento de llamada: nombre de herramienta seguido de
# { ( " , [  (aunque el formato concreto no se pueda parsear)
_TOOL_ATTEMPT_RE = re.compile(
    r'(?<!\w)(' + _TOOL_NAMES_PATTERN + r')\s*[{(",\[]'
)


def has_tool_attempt(text):
    """¿Parece que el texto contiene un intento de llamada a herramienta?"""
    return bool(_TOOL_ATTEMPT_RE.search(text or ""))


def extract_text_tool_calls(text):
    """Detecta llamadas a herramientas escritas como texto (fallback para
    modelos sin tool calling nativo fiable). Reconoce:

    - Marcadores: 'list_upcoming_events({days: 1})' o '[[create_task {...}]]'
    - Objetos JSON: {"type":"function","function":{"name":"create_event","parameters":{...}}}

    Devuelve (calls, texto_limpio) donde texto_limpio tiene los marcadores
    eliminados.
    """
    src = text or ""
    calls = []
    spans = []

    for m in _TEXT_TOOL_PATTERN.finditer(src):
        name = m.group(1) or m.group(3)
        raw = m.group(2) or m.group(4) or ""
        calls.append((name, _tolerant_json(raw)))
        spans.append((m.start(), m.end()))

    for m in _FUNCTION_OBJ_RE.finditer(src):
        open_idx = src.find("{", m.start())
        if open_idx == -1:
            continue
        end, obj = _balanced_object(src, open_idx)
        if not obj:
            continue
        name, params = _parse_function_object(obj)
        if name:
            calls.append((name, params))
            root_start = _root_open(src, m.start())
            spans.append((root_start if root_start is not None else m.start(), end))

    for m in _NAMED_TOOL_OBJ_RE.finditer(src):
        root_start = m.start()
        end, obj = _balanced_object(src, root_start)
        if not obj:
            continue
        comma = src.find(",", root_start)
        if comma == -1:
            continue
        args_open = src.find("{", comma)
        if args_open == -1 or args_open > end:
            continue
        args_end, args_obj = _balanced_object(src, args_open)
        if not args_obj:
            continue
        calls.append((m.group(1), _tolerant_json(args_obj)))
        spans.append((root_start, end))

    for m in _TOOL_KEY_RE.finditer(src):
        root_start = _root_open(src, m.start())
        if root_start is None:
            continue
        end, obj = _balanced_object(src, root_start)
        if not obj:
            continue
        d = _tolerant_json(obj)
        if not isinstance(d, dict):
            continue
        if "function" in d or "parameters" in d:
            continue  # ya cubierto por _FUNCTION_OBJ_RE
        args = d.get("args")
        if not isinstance(args, dict):
            args = d.get("arguments")
        if not isinstance(args, dict):
            args = {}
        calls.append((m.group(1), args))
        spans.append((root_start, end))

    for m in _TAGGED_TOOL_RE.finditer(src):
        calls.append((m.group(1), _tolerant_json(m.group(2))))
        spans.append((m.start(), m.end()))

    clean = src
    for start, end in sorted(spans, reverse=True):
        clean = clean[:start] + clean[end:]
    # Limpiar los marcadores de sección que envuelven las llamadas
    clean = re.sub(r"<\|tool_calls_section_(?:begin|end)\|>", "", clean)
    return calls, clean.strip()


def _parse_function_object(obj_str):
    """Extrae (name, parameters) de un objeto function JSON escrito como texto."""
    d = _tolerant_json(obj_str)
    if not isinstance(d, dict):
        return None, None
    name = str(d.get("name") or "")
    if name not in _ALLOWED:
        return None, None
    params = d.get("parameters")
    if not isinstance(params, dict):
        params = {}
    return name, params


def parse_text_tool_calls(text):
    calls, _ = extract_text_tool_calls(text)
    return calls


def strip_text_tool_calls(text):
    _, clean = extract_text_tool_calls(text)
    return clean


def format_events_summary(result, lang="es", search=False):
    """Genera un texto legible a partir del resultado de list_upcoming_events
    (fallback determinista cuando el modelo no sabe responder).

    Con search=True (resultado de una búsqueda en el historial) se usa un
    encabezado neutro en lugar de "próximos elementos"."""
    head_search = ("Registros encontrados en tu agenda:\n" if lang != "en"
                   else "Records found in your calendar:\n")
    if not isinstance(result, dict):
        return ("No hay datos de agenda disponibles." if lang != "en" else "No calendar data available.")
    events = result.get("events") or []
    if not events:
        return ("No tienes eventos ni tareas próximos en tu agenda." if lang != "en"
                else "You have no upcoming events or tasks in your calendar.")
    lines = []
    for e in events:
        day = e.get("date") or ""
        time_str = e.get("startTime") or ""
        ttype = "Tarea" if (e.get("type") or "event") == "task" else "Evento"
        if e.get("completed"):
            ttype += " (completada)"
        title = e.get("title") or "Sin título"
        if lang == "en":
            ttype = "Task" if (e.get("type") or "event") == "task" else "Event"
            if e.get("completed"):
                ttype += " (completed)"
            title = e.get("title") or "Untitled"
            if time_str:
                lines.append(f"• {ttype} \"{title}\" on {day} at {time_str}")
            else:
                lines.append(f"• {ttype} \"{title}\" on {day}")
        else:
            if time_str:
                lines.append(f"• {ttype} \"{title}\" el {day} a las {time_str}")
            else:
                lines.append(f"• {ttype} \"{title}\" el {day}")
    head = ("Tienes los siguientes elementos próximos en tu agenda:\n" if lang != "en"
            else "You have the following upcoming items in your calendar:\n")
    return (head_search if search else head) + "\n".join(lines)


_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}
_EN_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}
_EN_LANG_RE = re.compile(
    r"\b(tomorrow|today|day after tomorrow|create|make|add|set up|"
    r"event|task|appointment|schedule|calendar|please|book|"
    r"work|worked|working|month|week)\b",
    re.IGNORECASE,
)


def detect_lang(text):
    """Detección simple de idioma del mensaje (es/en) para los textos
    generados por el servidor (confirmaciones, resúmenes)."""
    return "en" if _EN_LANG_RE.search(text or "") else "es"
_AGENDA_VERBS = re.compile(
    r"^\s*(?:por favor\s*)?(?:puedes\s*)?(?:crea(?:r)?(?:me)?\s*|créa(?:r)?(?:me)?\s*|"
    r"a[ñn]ade(?:me)?\s*|a[ñn]adir\s*|registra(?:r)?\s*|apunta\s*|"
    r"agenda\s*|hazme\s*|hacer(?:me)?\s*|pon(?:me)?\s*|anota(?:me)?\s*|"
    r"ap[úu]nta(?:me)?\s*|gu[áa]rda(?:r)?\s*|(?:he\s+)?trabaj(?:\u00e9|e|ado)\s+)(?:una|un|el|la|los|las)?\s*(?:evento|tarea|recordatorio)?\s*"
    r"(?:para\s+|por\s+)?",
    re.IGNORECASE,
)
_TITLE_TRAIL_RE = re.compile(
    r"\s*(?:para\s+)?(?:el\s+)?(?:d[ií]a\s+)?(?:hoy|ma[ñn]ana|pasado\s+ma[ñn]ana|(?:lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo))\s*"
    r"|(?:el\s+)?\d{1,2}\s+de\s+[a-záéíóúñ]+\s*(?:de\s+\d{2,4})?\s*"
    r"|(?:el\s+)?\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s*"
    r"|\d{4}-\d{1,2}-\d{1,2}\s*"
    r"|(?:a\s+)?(?:las|la|a)\s+\d{1,2}[:.]\d{2}\s*"
    r"|(?:a\s+)?\d{1,2}\s*(?:h(?!oras?|rs?)\b|horas?|pm|am)\s*"
    r"|(?:de|desde|a|hasta)\s+(?:las|la)\s+\d{1,2}[:.]?\d{0,2}\s*"
    r"|(?:un|una)\s+(?:evento|tarea|recordatorio)\s*(?:para\s+|en\s+|a\s+)?[:;,.]?\s*"
    r"|\s*[:;,]\s*"
    r"|(?:la\s+)?semana\s+(?:que\s+viene|siguiente|pr[oó]xima)\s*|next\s+week\s*|\s+$",
    re.IGNORECASE,
)


def _valid_date(year, month, day):
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


_WEEKDAYS_ES = {
    "lunes": 0, "martes": 1, "miercoles": 2, "miércoles": 2,
    "jueves": 3, "viernes": 4, "sabado": 5, "sábado": 5, "domingo": 6,
}
_WEEKDAYS_EN = {
    "monday": 0, "tuesday": 1, "wednesday": 2,
    "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
}


def _resolve_weekday(text, today, lang, past=False):
    """'el martes' -> próxima ocurrencia (hoy si es el mismo día).

    Con past=True (registros en pasado tipo 'he trabajado el martes') se
    resuelve a la ocurrencia MÁS RECIENTE (esta semana / hoy).
    """
    names = _WEEKDAYS_ES if lang == "es" else _WEEKDAYS_EN
    alt = "|".join(sorted(names, key=len, reverse=True))
    m = re.search(r"\b(" + alt + r")\b", text, re.IGNORECASE)
    if not m:
        return None
    wd = names[m.group(1).lower()]
    if wd is None:
        return None
    if past:
        delta = (today.weekday() - wd) % 7
        return (today - timedelta(days=delta)).isoformat()
    delta = (wd - today.weekday()) % 7
    if delta == 0 and re.search(r"de\s+nuevo|otra\s+vez|semana|next\s+week|again", text, re.IGNORECASE):
        delta = 7
    return (today + timedelta(days=delta)).isoformat()


import dateparser
from dateparser.search import search_dates


def _extract_datetime_from_text(text, today_date=None, lang="es", past=False):
    """Busca y parsea fechas/horas en un texto completo usando dateparser.

    Optimizado especifícando el idioma para mantener mínima latencia y uso de RAM.
    """
    if not text or not text.strip():
        return None

    base_dt = datetime.combine(today_date or date.today(), datetime.min.time())
    settings = {
        'RELATIVE_BASE': base_dt,
        'PREFER_DATES_FROM': 'past' if past else 'future',
        'STRICT_PARSING': False,
        'PARSERS': ['absolute-time', 'custom-formats', 'relative-time', 'timestamp']
    }

    try:
        results = search_dates(text, languages=[lang], settings=settings)
        if results:
            return results[0][1]
    except Exception:
        pass
    return None


def _resolve_date(text, today):
    dt = _extract_datetime_from_text(text, today_date=today, lang="es", past=False)
    return dt.date().isoformat() if dt else None


def _resolve_date_en(text, today):
    dt = _extract_datetime_from_text(text, today_date=today, lang="en", past=False)
    return dt.date().isoformat() if dt else None


def _resolve_time(text):
    # Detección por dateparser (o fallback regex si no viene fecha explícita)
    dt = _extract_datetime_from_text(text, lang="es")
    if dt and (dt.hour != 0 or dt.minute != 0):
        return dt.strftime("%H:%M")
    m = re.search(r"(?:a\s+)?(?:las|la)?\s*(\d{1,2})[:.](\d{2})", text or "")
    if m:
        h, mm = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mm <= 59:
            return f"{h:02d}:{mm:02d}"
    return None


def _resolve_time_en(text):
    dt = _extract_datetime_from_text(text, lang="en")
    if dt and (dt.hour != 0 or dt.minute != 0):
        return dt.strftime("%H:%M")
    m = re.search(r"(?:at|@|\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text or "", re.IGNORECASE)
    if m:
        h = int(m.group(1))
        mm = int(m.group(2) or 0)
        mer = (m.group(3) or "").lower()
        if 1 <= h <= 12 and 0 <= mm <= 59:
            if mer == "pm" and h < 12:
                h += 12
            elif mer == "am" and h == 12:
                h = 0
            return f"{h:02d}:{mm:02d}"
    return None


def _extract_create_title(src, lang):
    """Título del evento/tarea tras quitar verbos, fechas, horas y conectores.
    Devuelve '' si el mensaje no aporta ningún título."""
    src = src or ""
    if lang == "en":
        title = _EN_VERBS.sub("", src)
        title = _EN_TITLE_TRAIL_RE.sub(" ", title)
        return re.sub(r"\s+", " ", title).strip(" .,;:¿?¡!-")
    title = re.sub(r"^(?:tengo|hay)\s+(?:un|una)\s+", "", src, flags=re.IGNORECASE)
    title = _AGENDA_VERBS.sub("", title)
    title = re.sub(r"(?:de|desde|entre)\s+(\d{1,2}[:.]\d{2})\s+(?:a|hasta|y)\s+(?:las|la)?\s*(\d{1,2}[:.]\d{2})", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\d{1,2}[:.]\d{2}", " ", title)
    title = _TITLE_TRAIL_RE.sub(" ", title)
    # Quitar conectores de redacción: 'que sea', 'que se llame', 'llamado/a', 'título:', 'called', 'named'...
    title = re.sub(
        r"\bque\s+(?:me\s+)?(?:se\s+)?(?:llame|llaman|sea|ser[áa]|es)\s+",
        " ", title, flags=re.IGNORECASE)
    title = re.sub(
        r"\b(?:llamad[oa]s?\s*[=:]?\s*|titulad[oa]s?\s*[=:]?\s*|called\s+|named\s+)",
        " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title).strip(" .,;:¿?¡!-«»\"'“”‘’")
    title = re.sub(r"[\"'”’«»]+", "", title).strip()
    title = re.sub(
        r"\s*(?:ap[úu]?ntalo|an[óo]?talo|gu[áa]rdalo|registr[áa]?lo)?\s*(?:en\s+el\s+calendario|en\s+la\s+agenda)?\s*$",
        "", title, flags=re.IGNORECASE).strip()
    title = re.sub(
        r"\s+(?:para|a|en|el|la|los|las|ap[úu]?ntalo|an[óo]?talo|gu[áa]rdalo|"
        r"registr[áa]?lo|toma\s+nota)$",
        "", title, flags=re.IGNORECASE).strip()
    title = re.sub(r"\s+(?:el|la|los|las|para|en|por)?\s*(?:d[ií]a\s*)?$", "", title, flags=re.IGNORECASE).strip()
    return title.strip(" .,;:¿?¡!-«»\"'“”‘’")


# Cualquier mención de día/fecha en un mensaje (para no pedir datos que ya
# están en el texto). Es la fuente única: también la usa services.py.
DATE_MSG_RE = re.compile(
    r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|"
    r"\b(?:hoy|ma[ñn]ana|ayer|today|tomorrow|yesterday)\b|"
    r"pasado\s+ma[ñn]ana|day\s+after\s+tomorrow|"
    r"\b(?:lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|"
    r"(?:el|para\s+el|on\s+(?:the\s+)?|del\s+|desde\s+el\s+)?\d{1,2}(?:\s+de|\s+al|\b(?:st|nd|rd|th)?\b)|"
    r"semana\s+(?:que\s+viene|siguiente|pr[oó]xima)|next\s+week|this\s+week|"
    r"\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|"
    r"fin\s+de\s+semana|finde|weekend|este\s+mes|pr[oó]ximo\s+mes|this\s+month|next\s+month",
    re.IGNORECASE,
)


# Exenciones de la exigencia de fecha: jornada ('he trabajado' = hoy) y planes
# de estudio (las fechas derivan del examen real inyectado).
# El usuario delega la elección de la fecha ("en la fecha que quieras",
# "cuando quieras", "you choose"...): no debe bloquearse, se usa el día de hoy.
_DATE_DELEGATED_RE = re.compile(
    r"la\s+fecha\s+que\s+(?:quieras|prefieras|elijas)|el\s+d[ií]a\s+que\s+(?:quieras|prefieras|elijas)|"
    r"cuando\s+quieras|elige\s+t[úu]|fecha\s+a\s+tu\s+elecci[oó]n|"
    r"(?:any|whatever)\s+(?:date|day)|whenever\s+you\s+want|you\s+choose|you\s+decide|"
    r"the\s+(?:date|day)\s+you\s+want",
    re.IGNORECASE,
)

_DATE_GATE_EXEMPT_RE = re.compile(
    r"trabaj(?:é|e|ado)|worked|had\s+work|"
    r"plan\s+de\s+estudio|study\s+plan|sesiones?\s+de\s+estudio|preparar(?:me)?\s+para|"
    r"reparte|repartir\s+el\s+plan|"
    r"la\s+fecha\s+que\s+(?:quieras|prefieras|elijas)|el\s+d[ií]a\s+que\s+(?:quieras|prefieras|elijas)|"
    r"cuando\s+quieras|elige\s+t[úu]|(?:any|whatever)\s+(?:date|day)|you\s+choose|you\s+decide|"
    r"the\s+(?:date|day)\s+you\s+want|"
    r"\b(?:s[ií]|vale|ok|okay|yes|sure|yep|claro|por\s+supuesto|adelante|hazlo|cr[ée]alos|contin[úu]a|do\s+it|go\s+ahead)\b|"
    r"usa\s+(?:el\s+)?json|herramienta|tool",
    re.IGNORECASE,
)


def missing_create_fields(text, lang="es"):
    """Detecta un intento de CREAR evento/tarea y qué campos obligatorios
    faltan en el mensaje. Devuelve None si no aplica (consulta, borrado,
    jornada, plan de estudio...) o {'kind', 'missing'} con los campos
    ausentes de ['title', 'date'] (la hora es opcional)."""
    src = (text or "").strip()
    if not src:
        return None
    if re.search(_DATE_GATE_EXEMPT_RE, src):
        return None
    s = _DATE_PREFIX_RE.sub("", src, count=1)
    if lang == "en":
        if not _VERB_FIRST_EN.match(s):
            return None
    elif not _VERB_FIRST_ES.match(s):
        return None
    if re.search(r"borra(?:r)?|elimina(?:r)?|quita(?:r)?|quitar|delete|remove|"
                 r"marcar\s+como\s+completad|completar|mark\s+(?:as\s+)?(?:complete|completed|done)",
                 src, re.IGNORECASE):
        return None
    is_task = bool(re.search(r"\btarea\b|\btareas\b", src, re.IGNORECASE)) and \
        not re.search(r"\bevento\b|\beventos\b|\bcita\b", src, re.IGNORECASE)
    missing = []
    if not _extract_create_title(src, lang):
        missing.append("title")
    if not DATE_MSG_RE.search(src) and not _DATE_DELEGATED_RE.search(src):
        missing.append("date")
    if not missing:
        return None
    return {"kind": "task" if is_task else "event", "missing": missing}


def enrich_update_args(args, text):
    """Rellena campos que faltan en una llamada update_event usando el mensaje
    del usuario (los modelos débiles omiten description/title en sus llamadas).
    Solo toca campos que el usuario mencionó explícitamente en su texto."""
    args = dict(args or {})
    src = (text or "")
    if not src:
        return args
    # Separa en cláusulas: '... a X y ponle de descripción Y' -> dos piezas.
    # Sin IGNORECASE: la "Y" inglesa (pronombre) no debe partir la cláusula.
    clauses = re.split(r"\s*[,;]\s*(?:y\s+|and\s+)?|\s+y\s+|\s+and\s+", src)
    if not (args.get("title") or "").strip():
        # El nuevo título termina donde empieza otra instrucción
        # ('con descripción...', 'y notas...') o al final de la cláusula.
        _stop = r"(?=\s+(?:con|with)\s+(?:una\s+)?(?:descrip(?:t|c)i[oó]n|notas?)\b|$)"
        for c in clauses:
            m = re.search(
                r"(?:(?:nombre|t[ií]tulo|name|title)\s+de\s+|of\s+)"
                r"(?:el\s+|la\s+|los\s+|the\s+)?"
                r"(?P<old>.*?)\s+(?:a|por|como|por\s+el\s+de|to|by|as)\s+"
                r"(?P<new>.+?)" + _stop,
                c, re.IGNORECASE)
            if m:
                new_title = m.group("new").strip().strip("\"'., ")
                if new_title:
                    args["title"] = new_title[:200]
                break
            m2 = re.search(
                r"(?:renombr(?:a|ar)|rename)\s+(?:el\s+|la\s+|los\s+|the\s+)?"
                r"(?P<old2>.*?)\s+(?:a|como|por|to|as)\s+(?P<new2>.+?)" + _stop,
                c, re.IGNORECASE)
            if m2:
                new_title = m2.group("new2").strip().strip("\"'., ")
                if new_title:
                    args["title"] = new_title[:200]
                break
    if not (args.get("description") or "").strip():
        for c in clauses:
            m = re.search(
                r"(?:descrip(?:t|c)i[oó]n|notas?)\s*(?::\s*|\s+de\s+|\s+como\s+|\s+que\s+diga\s+|\s+)"
                r"[\"']?(?P<desc>.+?)[\"']?\s*$",
                c, re.IGNORECASE)
            if m:
                desc = m.group("desc").strip().strip("\"'., ")
                if desc:
                    args["description"] = desc[:2000]
                break
    return args


def parse_user_event_request(text, lang="es", uid=None):
    """Último recurso determinista: extrae la petición de agenda directamente
    del mensaje del usuario, sin depender del modelo. Devuelve (tool, args) o
    None si no se reconoce ninguna petición. Soporta es y en."""
    src = (text or "").strip()
    if not src:
        return None
    today = date.today()

    if re.search(r"(marcar\s+como\s+completad|completar|mark\s+(?:as\s+)?(?:complete|completed|done))", src, re.IGNORECASE):
        return ("update_event", {"id": "", "completed": True})

    if lang == "en":
        if not _first_word_is_verb(src, "en"):
            if re.search(r"delete|remove", src, re.IGNORECASE):
                _rest = re.sub(r"^(?:the|my|a|an)\s+|,?\s*(?:delete|remove)(?: it| them)?\s*$", "", src, flags=re.IGNORECASE)
                _day = _resolve_date_en(_rest, today) or _resolve_weekday(_rest, today, "en", past=False)
                _ev = _find_event_by_desc(uid, _rest, _day) if uid else None
                return ("delete_event", {"id": _ev["id"] if _ev else ""})
            return None
        _del_match = re.search(r"\b(delete|remove)\b", src, re.IGNORECASE)
        if _del_match:
            _rest = src[_del_match.end():]
            _rest = re.sub(r"^(?:the|my|a|an|this|that)\s+", "", _rest, flags=re.IGNORECASE)
            _day = _resolve_date_en(_rest, today) or _resolve_weekday(_rest, today, "en", past=False)
            _ev = _find_event_by_desc(uid, _rest, _day)
            return ("delete_event", {"id": _ev["id"] if _ev else ""})
        is_task = bool(re.search(r"\btask\b|\btasks\b", src, re.IGNORECASE)) and not re.search(r"\bevent\b|\bappointment\b|\bmeeting\b", src, re.IGNORECASE)
        tool = "create_task" if is_task else "create_event"
        past_work = bool(re.search(r"(?:i\s+)?(?:worked|had\s+work)", src, re.IGNORECASE))
        day = _resolve_date_en(src, today) or _resolve_weekday(src, today, "en", past=past_work)
        time_str = _resolve_time_en(src)
        if not day:
            if past_work and not _IS_QUESTION_RE.search(src):
                day = today.isoformat()
            else:
                return None
        title = _extract_create_title(src, "en")
        if not title:
            title = "Event"
        if re.search(r"(?:i\s+)?(?:worked|work)", src, re.IGNORECASE):
            place = re.sub(r"^(?:i\s+)?(?:worked|work|had\s+work)\s+", "", title, flags=re.IGNORECASE)
            place = re.sub(r"^at\s+(?:the\s+)?", "", place, flags=re.IGNORECASE)
            if place.strip() and not place.lower().startswith("work"):
                title = "Work at " + place.strip()
        if len(title) > 200:
            title = title[:200]
        args = {"title": title, "date": day}
        cat = _guess_category(src)
        if cat:
            args["category"] = cat
        if time_str:
            args["startTime"] = time_str
        return (tool, args)

    if not _first_word_is_verb(src, "es"):
        # Borrado con verbo no inicial ('la cita del dentista, elimínala')
        if re.search(r"borra(?:r)?|elimina(?:r)?|quita(?:r)?|quitar", src, re.IGNORECASE):
            _desc = _AGENDA_VERBS.sub("", src) if _AGENDA_VERBS.match(src) else re.sub(
                r"^(?:el|la|los|las|un|una|ese|esa|este|esta)\s+|,?\s+(?:borra|elimina|quita)(?:r)?(?:la|lo|las|los)?\s*$", "", src, flags=re.IGNORECASE)
            _day = _resolve_date(_desc, today) or _resolve_weekday(_desc, today, "es", past=False)
            _ev = _find_event_by_desc(uid, _desc, _day) if uid else None
            return ("delete_event", {"id": _ev["id"] if _ev else ""})
        return None

    # Borrado directo ('elimina la cita del dentista')
    _del_match = re.search(r"\b(borra(?:r)?|elimina(?:r)?|quita(?:r)?|quitar)\b", src, re.IGNORECASE)
    if _del_match:
        _rest = src[_del_match.end():]
        _rest = re.sub(r"^(?:el|la|los|las|un|una|de|del)\s+", "", _rest, flags=re.IGNORECASE)
        _day = _resolve_date(_rest, today) or _resolve_weekday(_rest, today, "es", past=False)
        _ev = _find_event_by_desc(uid, _rest, _day) if uid else None
        return ("delete_event", {"id": _ev["id"] if _ev else ""})

    is_task = bool(re.search(r"tarea|tareas", src, re.IGNORECASE)) and not re.search(r"evento|eventos|cita", src, re.IGNORECASE)
    tool = "create_task" if is_task else "create_event"

    past_work = bool(re.search(r"(?:he\s+)?trabaj(?:é|e|ado)", src, re.IGNORECASE))
    day = _resolve_date(src, today) or _resolve_weekday(src, today, "es", past=past_work)
    time_str = _resolve_time(src)
    if not day:
        if past_work and not _IS_QUESTION_RE.search(src):
            day = today.isoformat()
        else:
            return None

    title = _extract_create_title(src, "es")
    if not title:
        title = "Evento"
    if len(title) > 200:
        title = title[:200]

    # Registro de jornada: 'he trabajado el martes en la empresa A' /
    # 'hoy he trabajado en Gamito SL 4h, apuntalo'
    # -> título consistente 'Trabajo en empresa A (4h)' (clave para la serie)
    if re.search(r"(?:he\s+)?trabaj(?:é|e|ado)", src, re.IGNORECASE):
        dur_match = re.search(r"\b(\d+(?:[.,]\d+)?\s*(?:h(?:oras?|rs?)?))\b", src, re.IGNORECASE)
        place = re.sub(
            r"^(?:(?:hoy|ya|esta\s+ma[ñn]ana)\s+)?(?:he\s+)?trabaj(?:é|e|ado)\s+",
            "", title, flags=re.IGNORECASE)
        place = re.sub(r"\s+de\s+nuevo\s+", " ", place, flags=re.IGNORECASE)
        place = re.sub(r"^en\s+(?:la|el|los|las)\s+|^en\s+", "", place, flags=re.IGNORECASE)
        if dur_match:
            place = place.replace(dur_match.group(1), "")
        place = place.strip(" .,;:¿?¡!-")
        if place.strip() and not place.lower().startswith("trabajo"):
            title = "Trabajo en " + place.strip()
            tool = "create_event"
            if dur_match:
                title += f" ({dur_match.group(1)})"

    args = {"title": title, "date": day}
    cat = _guess_category(src)
    if cat:
        args["category"] = cat
    range_m = re.search(r"(?:de|desde|entre)\s+(\d{1,2}[:.]\d{2})\s+(?:a|hasta|y)\s+(?:las|la)?\s*(\d{1,2}[:.]\d{2})", src, re.IGNORECASE)
    if range_m:
        st = _resolve_time(range_m.group(1))
        et = _resolve_time(range_m.group(2))
        if st:
            args["startTime"] = st
        if et:
            args["endTime"] = et
    elif time_str:
        args["startTime"] = time_str
    return (tool, args)


def normalize_tool_args(name, args):
    """Normaliza y valida los argumentos de una herramienta ANTES de ejecutarla
    (válido para tool calling nativo y para extracción por texto). Devuelve
    dict limpio o None si faltan datos obligatorios (la llamada se descarta).

    - Fechas: acepta YYYY-MM-DD y relativas ('mañana', 'el viernes') resueltas
      contra HOY.
    - Horas: solo HH:MM válidas; si vienen mal, se descartan.
    - Categoría: SOLO las 6 reales del calendario; si no es válida se infiere
      por palabras clave; si no se infiere, se deja el default ('trabajo').
    """
    if not isinstance(args, dict):
        return None
    args = dict(args)
    today = date.today()

    def _valid_date(v):
        v = str(v or "").strip()
        if not v:
            return None
        try:
            _parse_date(v)
            return v
        except Exception:
            pass
        return (_resolve_date(v, today) or _resolve_weekday(v, today, "es")
                or _resolve_weekday(v, today, "en"))

    def _valid_time(v):
        if not v:
            return None
        v = str(v).strip()
        if re.fullmatch(r"\d{1,3}[:.]\d{1,2}\s*(?:am|pm)?", v, re.IGNORECASE):
            m = re.match(r"(\d{1,3})[:.](\d{1,2})\s*(am|pm)?", v, re.IGNORECASE)
            h, mm = int(m.group(1)), int(m.group(2))
            if m.group(3) and m.group(3).lower() == "pm" and h < 12:
                h += 12
            if m.group(3) and m.group(3).lower() == "am" and h == 12:
                h = 0
            if 0 <= h <= 23 and 0 <= mm <= 59:
                return f"{h:02d}:{mm:02d}"
        try:
            return _parse_time(v)
        except Exception:
            return None

    def _valid_category(v):
        v = str(v or "").strip().lower()
        if v in ("personal", "trabajo", "salud", "estudio", "ocio", "otros"):
            return v
        return _guess_category(v)

    if name in ("create_event", "create_task", "create_reminder"):
        title = str(args.get("title") or "").strip()
        if not title:
            return None
        if len(title) > 200:
            title = title[:200]
        args["title"] = re.sub(r"\s+", " ", title).strip(" .,;:¿?¡!-")

        raw_date = (args.get("date") or args.get("fecha") or
                    args.get("date_raw") or args.get("fecha_raw"))
        d = _valid_date(raw_date)
        if not d:
            return None
        args["date"] = d

        for tkey in ("startTime", "start_time", "time_raw", "hora_raw", "time", "hora", "endTime", "end_time"):
            raw = args.pop(tkey, None)
            if raw:
                t = _valid_time(raw)
                if t:
                    args["startTime" if not tkey.startswith("end") else "endTime"] = t

        cat = _valid_category(args.get("category"))
        args.pop("category", None)
        if cat:
            args["category"] = cat

        ev_type = str(args.get("type") or "").strip().lower()
        if ev_type not in ("event", "task", "reminder"):
            if name == "create_task":
                ev_type = "task"
            elif name == "create_reminder":
                ev_type = "reminder"
            else:
                ev_type = "event"
        args["type"] = ev_type
        for k in ("allDay", "all_day", "completed", "isImportant", "is_important"):
            if k in args:
                args[k] = bool(args[k])
        allowed = {"title", "date", "startTime", "endTime", "category", "type",
                   "description", "location", "allDay", "completed", "isImportant"}
        args = {k: v for k, v in args.items() if k in allowed}
        return args

    if name == "update_event":
        eid = str(args.get("id") or "").strip()
        orig = dict(args)
        args = {}
        if eid:
            args["id"] = eid
        if orig.get("title") is not None:
            args["title"] = str(orig["title"]).strip()[:200] or None
        raw_date = orig.get("date") or orig.get("date_raw")
        if raw_date:
            d = _valid_date(raw_date)
            if d:
                args["date"] = d
        for tkey in ("startTime", "start_time", "time_raw", "hora_raw", "endTime", "end_time"):
            raw = orig.get(tkey)
            if raw:
                t = _valid_time(raw)
                if t:
                    args["startTime" if not tkey.startswith("end") else "endTime"] = t
        if orig.get("category"):
            cat = _valid_category(orig["category"])
            if cat:
                args["category"] = cat
        if orig.get("completed") is not None:
            args["completed"] = bool(orig["completed"])
        if orig.get("description") is not None:
            desc = str(orig["description"]).strip()[:2000]
            if desc:
                args["description"] = desc
        if orig.get("location") is not None:
            loc = str(orig["location"]).strip()[:200]
            if loc:
                args["location"] = loc
        if orig.get("type") is not None:
            t = str(orig["type"]).strip().lower()
            if t in ("event", "task"):
                args["type"] = t
        if orig.get("isImportant") is not None:
            args["isImportant"] = bool(orig["isImportant"])
        allowed = {"id", "title", "date", "startTime", "endTime", "category",
                   "completed", "description", "location", "type", "isImportant"}
        res = {k: v for k, v in args.items() if k in allowed}
        return res if (res.get("id") or res.get("title") or res.get("description")) else None

    if name == "delete_event":
        eid = str(args.get("id") or "").strip()
        title = str(args.get("title") or "").strip()
        raw_date = args.get("date") or args.get("date_raw")
        d = _valid_date(raw_date) if raw_date else None
        res = {}
        if eid:
            res["id"] = eid
        if title:
            res["title"] = title
        if d:
            res["date"] = d
        return res if res else None

    if name == "list_upcoming_events":
        # Algunos proveedores usan "time_range" en vez de "period"
        if "time_range" in args and args["time_range"] and not args.get("period"):
            args["period"] = args["time_range"]
        if "days" in args and args["days"] is not None:
            try:
                args["days"] = max(1, min(365, int(args["days"])))
            except (TypeError, ValueError):
                args["days"] = 30
        allowed = {"days", "category", "type", "period", "query"}
        args = {k: v for k, v in args.items() if k in allowed}
        return args

    return args


def execute_tool(name, args, uid):
    """Ejecuta una herramienta SOLO si está en la whitelist. Nunca lanza."""
    fn = _ALLOWED.get(name)
    if not fn:
        return {"error": f"Operación no permitida: {name}"}
    normalized = normalize_tool_args(name, args)
    if normalized is None:
        return {"error": f"Faltan datos obligatorios para {name}"}
    try:
        result = fn(uid, normalized)
    except Exception as e:
        return {"error": f"Error al ejecutar {name}: {e}"}
    # Notificar en tiempo real al resto de vistas (dashboard, calendario)
    if name in ("create_event", "create_task", "update_event", "delete_event") and result.get("ok"):
        try:
            socketio.emit("events_changed", {}, room=f"user_{uid}")
        except Exception:
            pass
    return result

_VERB_FIRST_ES = re.compile(
    r"^[\s¿¡!?.,;:]*"
    r"(?:por\s+favor\s+|puedes\s+|me\s+puedes\s+|podr[ií]as\s+)?"
    r"(créa(?:r)?(?:me)?|crea(?:r)?(?:me)?|hazme|hacer(?:me)?|pon(?:me)?|anota(?:me)?|"
    r"ap[úu]nta(?:me)?|gu[áa]rda(?:r)?|agenda|apunta|registra|a[ñn]ade(?:me)?|anade(?:me)?|"
    r"borra|elimina|marca|(?:he\s+)?trabaj(?:\u00e9|e|ado))\b",
    re.IGNORECASE,
)
_VERB_FIRST_EN = re.compile(
    r"^[\s¿¡!?.,;:]*"
    r"(?:please\s+|can you\s+|could you\s+|can we\s+|may I\s+)?"
    r"(?:i\s+)?(?:worked|work|had work)|(create|make|add|set|plan|schedule|book|remind|put|delete|remove|complete)\b",
    re.IGNORECASE,
)


_DATE_PREFIX_RE = re.compile(
    r"^(?:(?:el|the|on|para|por)\s+)?"
    r"(?:(?:lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+|"
    r"(?:hoy|ma[ñn]ana|tomorrow|today)\s+|"
    r"pasado\s+ma[ñn]ana\s+|day\s+after\s+tomorrow\s+|"
    r"\d{1,2}\s+de\s+[a-záéíóúñ]+\s+|"
    r"(?:la\s+)?semana\s+(?:que\s+viene|siguiente|pr[oó]xima)\s+|"
    r"next\s+week\s+)",
    re.IGNORECASE,
)


def _first_word_is_verb(text, lang):
    """¿La primera palabra significativa del mensaje es un verbo de agenda?
    Permite una fecha/hora inicial ('el miércoles he trabajado...'). Rechaza
    frases desordenadas tipo 'evento ... crear'."""
    src = _DATE_PREFIX_RE.sub("", text or "", count=1)
    if lang == "en":
        return bool(_VERB_FIRST_EN.match(src))
    return (
        bool(_VERB_FIRST_ES.match(src))
        or bool(re.search(r"\b(ap[úu]?ntalo|an[óo]?talo|gu[áa]rdalo|registr[áa]?lo)\b", text or "", re.IGNORECASE))
        or bool(re.search(r"^\s*(?:tengo|hay)\s+(?:un|una)\s+(?:examen|cita|reuni[óo]n|tarea|evento)\b", text or "", re.IGNORECASE))
    )


# Frases interrogativas: nunca se registran datos; se tratan como consultas
_IS_QUESTION_RE = re.compile(
    r"¿|d[oó]nde|cu[áa]ndo|cu[áa]nto|cu[áa]ntas|alguna\s+vez|alg[úu]n\s+d[ií]a|"
    r"verdad|cierto|\?\s*$",
    re.IGNORECASE,
)

def detect_read_period(text):
    """Periodo de lectura sugerido por la consulta (para la inyección).

    Devuelve 'next_month', 'next_week', 'this_month', 'this_week', 'all' o
    'N_months'/'N_weeks' (p. ej. 'en 2 meses' -> '2_months').
    """
    src = text or ""
    m = re.search(r"(?:en|dentro\s+de|de\s+aqu[ií]\s+a)\s+(\d+)\s+horas?|in\s+(\d+)\s+hours?", src, re.IGNORECASE)
    if m:
        return f"{int(m.group(1) or m.group(2))}_hours"
    m = re.search(r"(?:en|dentro\s+de)\s+(\d+)\s+d[ií]as?|in\s+(\d+)\s+days?", src, re.IGNORECASE)
    if m:
        return f"{int(m.group(1) or m.group(2))}_days"
    m = re.search(r"(?:en|dentro\s+de|de\s+aqu[ií]\s+a)\s+(\d+)\s+mes(es)?|in\s+(\d+)\s+months?", src, re.IGNORECASE)
    if m:
        n = m.group(1) or m.group(3)
        return f"{int(n)}_months"
    m = re.search(r"(?:en|dentro\s+de)\s+(\d+)\s+semanas?|in\s+(\d+)\s+weeks?", src, re.IGNORECASE)
    if m:
        n = m.group(1) or m.group(2)
        return f"{int(n)}_weeks"
    if re.search(r"pr[oó]xim[oa]\s+mes(es)?|el\s+mes\s+que\s+viene|next\s+month", src, re.IGNORECASE):
        return "next_month"
    if re.search(r"pr[oó]xim[oa]\s+semana|la\s+semana\s+que\s+viene|next\s+week", src, re.IGNORECASE):
        return "next_week"
    if re.search(r"este\s+mes|this\s+month", src, re.IGNORECASE):
        return "this_month"
    if re.search(r"esta\s+semana|this\s+week|ayer|yesterday|esta\s+mañana|this\s+morning", src, re.IGNORECASE):
        return "this_week"
    if re.search(r"todo|historial|all|history", src, re.IGNORECASE):
        return "all"
    return None

def resolve_target_day(text):
    """Día concreto mencionado en la consulta ('mañana', 'hoy', 'el martes',
    'el 25 de diciembre', 'tomorrow'...). Devuelve (iso, label_es, label_en)
    o None si no menciona ningún día específico."""
    src = text or ""
    today = date.today()
    day = (
        _resolve_date(src, today)
        or _resolve_date_en(src, today)
        or _resolve_weekday(src, today, "es")
        or _resolve_weekday(src, today, "en")
    )
    if not day:
        return None
    if day == (today + timedelta(days=1)).isoformat():
        return day, "mañana", "tomorrow"
    if day == today.isoformat():
        return day, "hoy", "today"
    if day == (today + timedelta(days=2)).isoformat():
        return day, "pasado mañana", "the day after tomorrow"
    _wd_es = _resolve_weekday(src, today, "es")
    _wd_en = _resolve_weekday(src, today, "en")
    if _wd_es == day or _wd_en == day:
        _names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
        _names_en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        return day, f"el {_names[date.fromisoformat(day).weekday()]}", f"on {_names_en[date.fromisoformat(day).weekday()]}"
    return day, f"el {day}", f"on {day}"


def has_events_for_scope(events, text):
    """¿Existen eventos dentro del ámbito que el usuario consulta?

    Si la consulta indica una fecha concreta ('el 25 de diciembre', 'mañana',
    'el martes'), se comprueba esa fecha exacta. Si no, cualquier evento del
    listado cuenta. Sirve para que el guard anti-alucinación no reemplace
    respuestas correctas tipo 'no tienes eventos ese día'."""
    if not events:
        return False
    today = date.today()
    day = (
        _resolve_date(text, today)
        or _resolve_date_en(text, today)
        or _resolve_weekday(text, today, "es")
        or _resolve_weekday(text, today, "en")
    )
    if day:
        return any((e.get("date") or "") == day for e in events)
    return True

def extract_company(text):
    """Extrae la empresa mencionada en la consulta (es/en)."""
    src = text or ""
    m = re.search(r"empresa\s+([a-z0-9áéíóúñ]+)", src, re.IGNORECASE)
    if m:
        return "empresa " + m.group(1).lower()
    m = re.search(r"(?:at\s+)?company\s+([a-z0-9áéíóúñ]+)", src, re.IGNORECASE)
    if m:
        return "company " + m.group(1).lower()
    m = re.search(r"\bat\s+(?:the\s+)?([a-z0-9áéíóúñ]+)", src, re.IGNORECASE)
    if m:
        return m.group(1).lower()
    return None


def extract_holiday_query(text):
    """Texto a buscar en la agenda para consultas de festivos/puentes/vacaciones.

    Prioridad: fecha concreta ('24 de mayo') > el término tras '¿cuándo cae X?'
    > Semana Santa > vacaciones > puente > festivo > partido.
    Devuelve la query (nunca None)."""
    src = text or ""
    m = re.search(
        r"\b(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)(?:\s+de\s+\d{2,4})?",
        src, re.IGNORECASE)
    if m and m.group(2).lower() in _MESES:
        return f"{m.group(1)} de {m.group(2)}"
    m = re.search(
        r"(?:cu[áa]ndo|qu[eé]\s+d[ií]a)\s+(?:cae|es)\s+(.*?)(?:\s*\?|$)",
        src, re.IGNORECASE)
    if m:
        q = m.group(1).strip()
        q = re.sub(r"^(el|la|los|las)\s+", "", q, flags=re.IGNORECASE)
        if q:
            return q
    if re.search(r"Semana Santa", src, re.IGNORECASE):
        return "Semana Santa"
    if re.search(r"vacaciones|vacaci[oó]n", src, re.IGNORECASE):
        return "vacaciones"
    if re.search(r"puente", src, re.IGNORECASE):
        return "puente"
    if re.search(r"festivo|fiesta", src, re.IGNORECASE):
        return "festivo"
    if re.search(r"partido|juega", src, re.IGNORECASE):
        return "partido"
    return "festivo"

from rapidfuzz import fuzz, process


def _find_event_by_desc(uid, text, day=None, is_destructive=False):
    """Busca el evento que mejor coincide con la descripción del usuario
    usando Fuzzy Matching (distancia de Levenshtein optimizada en C++).

    Devuelve el evento o None si la coincidencia está por debajo del umbral.
    Usamos un umbral estricto (85%) para operaciones de borrado/actualización
    para evitar modificaciones accidentales.
    """
    if not text:
        return None

    events = get_user_events(uid)
    if day:
        events = [e for e in events if (e.get("date") or "") == day]

    if not events:
        return None

    query = _normalize_title(text)
    if not query:
        return None

    choices = {str(e.get("id")): _normalize_title(e.get("title") or "") for e in events if e.get("id")}

    threshold = 85 if is_destructive else 60
    matches = process.extract(
        query,
        choices,
        scorer=fuzz.token_set_ratio,
        score_cutoff=threshold,
        limit=None
    )

    if not matches:
        return None

    max_score = max(m[1] for m in matches)
    top_matches = [m for m in matches if m[1] == max_score]

    if is_destructive and len(top_matches) > 1:
        raise ValueError("AMBIGUOUS")

    event_id = top_matches[0][2]
    for e in events:
        if str(e.get("id")) == str(event_id):
            return e

    return None

assert set(_ALLOWED.keys()) == {t["function"]["name"] for t in CALENDAR_TOOLS}, "Mismatch entre _ALLOWED y CALENDAR_TOOLS"

