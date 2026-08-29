"""Herramientas de agenda: esquemas, prompts, parsing y ejecución contra base de datos."""
import json
import os
import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests
from core.socket_ext import socketio

MAX_TOOL_ROUNDS = 2
ALLOWED_CATEGORIES = {"personal", "trabajo", "salud", "estudio", "ocio", "otros"}

_OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://ollama:11434")
_tool_cap_cache: Dict[str, Optional[bool]] = {}

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
                        "description": "Filtrar por tipo: event, task o reminder. Opcional.",
                        "enum": ["event", "task", "reminder"],
                    },
                    "period": {
                        "type": "string",
                        "description": "Periodo: this_week, last_week, next_week, this_month, next_month, all, o dinámico como 'X_days', 'X_weeks', 'X_months', 'month_N'. Opcional.",
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
            "description": "Crea un evento (type=event), tarea (type=task) o recordatorio (type=reminder) en la agenda del usuario. Requiere título y fecha.",
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
            "description": "Crea un RECORDATORIO o aviso en la agenda del usuario (type=reminder). Requiere título y fecha.",
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
            "description": "Modifica un evento o tarea existente por su id (o descripción). Solo cambia los campos indicados.",
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
            "description": "Elimina un evento o tarea por su id o título.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Id del evento o tarea a eliminar (opcional si se da title)"},
                    "title": {"type": "string", "description": "Título del evento a eliminar (opcional si se da id)"},
                },
                "required": [],
            },
        },
    },
]

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
    "list_upcoming_events o su título.\n"
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

AGENDA_EXTRACTION_PROMPT = (
    "IMPORTANTE: si la consulta del usuario requiere usar su agenda, responde "
    "PRIMERO con un único JSON (o varios JSON, uno por línea, si pide varias cosas) "
    "en este formato (sin texto adicional, sin markdown, con comillas dobles):\n"
    '- {"tool": "list_upcoming_events", "args": {"days": 30}}\n'
    '- {"tool": "create_event", "args": {"title": "Reunión con Juan", "date": "2026-08-14", "startTime": "10:30", "endTime": "11:30", "category": "trabajo", "type": "event"}}\n'
    '- {"tool": "create_task", "args": {"title": "Estudiar mates", "date": "2026-08-14", "startTime": "09:00", "category": "estudio"}}\n'
    '- {"tool": "create_reminder", "args": {"title": "Tomar medicación", "date": "2026-08-14", "startTime": "08:00", "category": "salud"}}\n'
    '- {"tool": "update_event", "args": {"title": "Título del evento", "date": "2026-08-15"}}\n'
    '- {"tool": "delete_event", "args": {"title": "Título a borrar"}}\n'
    "Si el usuario pide varias cosas enlistadas ('apúntame esto, eso y lo otro'), "
    "emite una línea JSON por cada elemento a crear o modificar.\n"
    "La categoría (category) debe ser UNA de: personal, trabajo, salud, estudio, "
    "ocio, otros. La fecha (date) en formato YYYY-MM-DD.\n"
    'Si el usuario pregunta por algo concreto del PASADO ("¿cuándo he trabajado en la '
    'empresa A?", "¿cuándo fue la cita?", "¿cuántas veces...?"), usa list_upcoming_events '
    'con el argumento query: "texto a buscar" (busca en todo el historial).\n'
    "Si el usuario solo quiere ver información de su agenda, usa list_upcoming_events "
    "(con args period: \"this_week\", \"this_month\" o \"all\" si pregunta por "
    "esa semana/mes/historial, p. ej. \"dónde he trabajado esta semana\").\n"
    "Si el usuario pregunta por festivos, puentes, vacaciones o tiempo libre, "
    "usa list_upcoming_events con query o period='this_week'. Si la agenda no tiene nada, "
    "el sistema lo dirá: no inventes festivos ni eventos.\n"
    "Si no necesitas ninguna herramienta, responde directamente."
)


def _normalize_title(title: str) -> str:
    t = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", t.lower()).strip()


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


def _guess_category(text: str) -> Optional[str]:
    for cat, pat in _CATEGORY_PATTERNS:
        if pat.search(text or ""):
            return cat
    return None


def _parse_date(value: Any, field="date") -> date:
    if not isinstance(value, str):
        raise ValueError(f"{field}: debe ser texto en formato YYYY-MM-DD")
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"{field}: formato inválido, usa YYYY-MM-DD")


def _parse_time(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,2}:\d{2}", value.strip()):
        raise ValueError("startTime/endTime: formato inválido, usa HH:MM")
    h, m = value.strip().split(":")
    if not (0 <= int(h) <= 23 and 0 <= int(m) <= 59):
        raise ValueError("startTime/endTime: hora fuera de rango")
    return f"{int(h):02d}:{int(m):02d}"


def resolve_date_from_text(text: str, today: Optional[date] = None, lang: str = "es", past: bool = False) -> Optional[str]:
    if not text or not text.strip():
        return None
    try:
        from dateparser.search import search_dates
        base_dt = datetime.combine(today or date.today(), datetime.min.time())
        settings = {
            'RELATIVE_BASE': base_dt,
            'PREFER_DATES_FROM': 'past' if past else 'future',
            'STRICT_PARSING': False,
        }
        results = search_dates(text, languages=[lang], settings=settings)
        return results[0][1].date().isoformat() if results else None
    except Exception:
        return None


def resolve_time_from_text(text: str, lang: str = "es") -> Optional[str]:
    if not text or not text.strip():
        return None
    try:
        from dateparser.search import search_dates
        results = search_dates(text, languages=[lang])
        if results and (results[0][1].hour != 0 or results[0][1].minute != 0):
            return results[0][1].strftime("%H:%M")
    except Exception:
        pass
    return None


def _shift_month(d: date, n: int) -> date:
    import calendar
    total = d.month - 1 + n
    year = d.year + total // 12
    month = total % 12 + 1
    max_day = calendar.monthrange(year, month)[1]
    day = min(d.day, max_day)
    return date(year, month, day)


_TOOL_NAMES_PATTERN = "list_upcoming_events|create_event|create_task|create_reminder|update_event|delete_event"
_TEXT_TOOL_PATTERN = re.compile(
    r"\[\[\s*(" + _TOOL_NAMES_PATTERN + r")\s*(\{.*?\})?\s*\]\]"
    r"|(?<!\w)(" + _TOOL_NAMES_PATTERN + r")\s*\(\s*(\{.*?\})?\s*\)",
    re.DOTALL,
)
_FUNCTION_OBJ_RE = re.compile(r"['\"]function['\"]\s*:\s*\{")
_NAMED_TOOL_OBJ_RE = re.compile(r'\{\s*"?(' + _TOOL_NAMES_PATTERN + r')"?\s*,')
_TOOL_KEY_RE = re.compile(r"['\"](?:tool|name)['\"]\s*:\s*['\"](" + _TOOL_NAMES_PATTERN + r")['\"]")
_TAGGED_TOOL_RE = re.compile(
    r"<\|tool_call_begin\|>\s*(?:functions\.)?(" + _TOOL_NAMES_PATTERN + r")\s*:\s*\d+\s*"
    r"<\|tool_call_argument_begin\|>\s*(.*?)<\|tool_call_end\|>",
    re.DOTALL,
)
_TOOL_ATTEMPT_RE = re.compile(r'(?<!\w)(' + _TOOL_NAMES_PATTERN + r')\s*[{(",\[]')


def tolerant_json(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    raw_str = (str(raw) if raw is not None else "").strip()
    if not raw_str:
        return {}

    try:
        return json.loads(raw_str)
    except Exception:
        pass

    start = raw_str.find("{")
    end = raw_str.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    clipped = raw_str[start:end + 1]

    fixed = re.sub(r"([{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', clipped)
    fixed = re.sub(r"(?<![a-zA-Z0-9_])'|'(?![a-zA-Z0-9_])", '"', fixed)
    fixed = re.sub(r",\s*([}\]])", r"\1", fixed)
    fixed = re.sub(r"\bTrue\b", "true", fixed)
    fixed = re.sub(r"\bFalse\b", "false", fixed)
    fixed = re.sub(r"\bNone\b", "null", fixed)

    try:
        return json.loads(fixed)
    except Exception:
        pass

    for k in range(len(fixed) - 1, -1, -1):
        if fixed[k] == "}":
            try:
                return json.loads(fixed[:k + 1])
            except Exception:
                pass
    return {}


_tolerant_json = tolerant_json


def _balanced_object(text: str, open_idx: int) -> Tuple[Optional[int], Optional[str]]:
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


def _root_open(text: str, pos: int) -> Optional[int]:
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


def has_tool_attempt(text: str) -> bool:
    return bool(_TOOL_ATTEMPT_RE.search(text or ""))


def extract_text_tool_calls(text: str) -> Tuple[List[Tuple[str, Dict[str, Any]]], str]:
    src = text or ""
    calls: List[Tuple[str, Dict[str, Any]]] = []
    spans: List[Tuple[int, int]] = []

    for m in _TEXT_TOOL_PATTERN.finditer(src):
        name = m.group(1) or m.group(3)
        raw = m.group(2) or m.group(4) or ""
        calls.append((name, tolerant_json(raw)))
        spans.append((m.start(), m.end()))

    for m in _FUNCTION_OBJ_RE.finditer(src):
        open_idx = src.find("{", m.start())
        if open_idx == -1:
            continue
        end, obj = _balanced_object(src, open_idx)
        if not obj:
            continue
        d = tolerant_json(obj)
        name = str(d.get("name") or "")
        if re.match(f"^({_TOOL_NAMES_PATTERN})$", name):
            params = d.get("parameters") if isinstance(d.get("parameters"), dict) else {}
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
        _, args_obj = _balanced_object(src, args_open)
        if args_obj:
            calls.append((m.group(1), tolerant_json(args_obj)))
            spans.append((root_start, end))

    for m in _TOOL_KEY_RE.finditer(src):
        root_start = _root_open(src, m.start())
        if root_start is None:
            continue
        end, obj = _balanced_object(src, root_start)
        if not obj:
            continue
        d = tolerant_json(obj)
        if not isinstance(d, dict) or "function" in d or "parameters" in d:
            continue
        args = d.get("args") or d.get("arguments") or {}
        if not isinstance(args, dict):
            args = {}
        calls.append((m.group(1), args))
        spans.append((root_start, end))

    for m in _TAGGED_TOOL_RE.finditer(src):
        calls.append((m.group(1), tolerant_json(m.group(2))))
        spans.append((m.start(), m.end()))

    clean = src
    for start, end in sorted(spans, reverse=True):
        clean = clean[:start] + clean[end:]
    clean = re.sub(r"<\|tool_calls_section_(?:begin|end)\|>", "", clean)
    return calls, clean.strip()


def strip_text_tool_calls(text: str) -> str:
    _, clean = extract_text_tool_calls(text)
    return clean


# ─── Detección determinista de campos de creación incompletos ────────────────

# Exenciones de la exigencia de fecha: jornada ('he trabajado' = hoy) y planes
# de estudio (las fechas derivan del examen real inyectado), además de la
# delegación de la fecha al sistema y respuestas de confirmación.
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

# El usuario delega la elección de la fecha ("en la fecha que quieras",
# "cuando quieras", "you choose"...): no debe bloquearse, se usa el día de hoy.
_DATE_DELEGATED_RE = re.compile(
    r"la\s+fecha\s+que\s+(?:quieras|prefieras|elijas)|el\s+d[ií]a\s+que\s+(?:quieras|prefieras|elijas)|"
    r"cuando\s+quieras|elige\s+t[úu]|fecha\s+a\s+tu\s+elecci[oó]n|"
    r"(?:any|whatever)\s+(?:date|day)|whenever\s+you\s+want|you\s+choose|you\s+decide|"
    r"the\s+(?:date|day)\s+you\s+want",
    re.IGNORECASE,
)

# Cualquier mención de día/fecha en un mensaje (para no pedir datos que ya
# están en el texto).
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

# El verbo de agenda debe ser la primera palabra significativa del mensaje.
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
_EN_VERBS = re.compile(
    r"^\s*(?:please\s+)?(?:can you\s+)?(?:create|make|add|set|plan|schedule|book|remind|put|log|register)\s+"
    r"(?:an?\s+)?(?:event|task|reminder|appointment)?\s*(?:for\s+|on\s+|at\s+)?",
    re.IGNORECASE,
)
_EN_TITLE_TRAIL_RE = re.compile(
    r"\s*(?:on|for|at)\s+(?:the\s+)?(?:day\s+)?(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*"
    r"|\s*(?:on|for)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+[a-z]+\s*(?:\d{2,4})?\s*"
    r"|\d{4}-\d{1,2}-\d{1,2}\s*"
    r"|(?:at\s+)\d{1,2}[:.]\d{2}\s*|\s+$",
    re.IGNORECASE,
)


def _extract_create_title(src: str, lang: str) -> str:
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


def missing_create_fields(text: str, lang: str = "es") -> Optional[Dict[str, Any]]:
    """Detecta un intento de CREAR evento/tarea y qué campos obligatorios
    faltan en el mensaje. Devuelve None si no aplica (consulta, borrado,
    jornada, plan de estudio...) o {'kind', 'missing'} con los campos
    ausentes de ['title', 'date'] (la hora es opcional)."""
    src = (text or "").strip()
    if not src:
        return None
    if _DATE_GATE_EXEMPT_RE.search(src):
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


def parse_user_event_request(text: str, lang: str = "es", uid: Optional[str] = None) -> Optional[Tuple[str, Dict[str, Any]]]:
    src = (text or "").strip()
    if not src:
        return None
    today = date.today()
    if re.search(r"\b(borra|elimina|quita|delete|remove)\b", src, re.IGNORECASE):
        title = re.sub(r"^.*?(borra|elimina|quita|delete|remove)\b\s*", "", src, flags=re.IGNORECASE)
        title = title.strip().strip(".,;:¿?¡!")[:200]
        return ("delete_event", {"title": title})

    if not re.search(r"\b(crea|crear|make|create|add|apunta|anota|pon|hazme|añade|guarda|registra|schedule|recordatorio|recuérdame|recuerdame|remind\s+me)\b", src, re.IGNORECASE):
        return None

    is_task = bool(re.search(r"\btarea\b|\btask\b", src, re.IGNORECASE))
    date_str = resolve_date_from_text(src, today=today, lang=lang) or today.isoformat()
    time_str = resolve_time_from_text(src, lang=lang)
    clean_title = re.sub(r"^(crear|make|create|add|apunta|anota|pon|hazme|añade|guarda|registra)\s+", "", src, flags=re.IGNORECASE).strip(" .,;:¿?¡!-")[:200]

    args = {"title": clean_title or ("Task" if is_task else "Event"), "date": date_str}
    if time_str:
        args["startTime"] = time_str
    if cat := _guess_category(src):
        args["category"] = cat
    return ("create_task" if is_task else "create_event", args)


def _find_matching_series(uid: str, title: str, ev_type: str) -> Optional[Dict[str, Any]]:
    from modules.api.events.services import get_user_events
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
    return {"id": best.get("id"), "series_id": best.get("seriesId") or best.get("id")}


def _series_result(uid: str, event_id: str, ev_type: str, series: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    from modules.api.events.services import series_count
    if series:
        return {
            "ok": True, "id": event_id, "type": ev_type,
            "series_id": series["series_id"],
            "series_count": series_count(uid, series["series_id"]),
            "linked_to": series["id"],
        }
    return {"ok": True, "id": event_id, "type": ev_type, "series_id": event_id, "series_count": 1}


def _find_event_by_desc(uid: str, text: str, day: Optional[str] = None, is_destructive: bool = False) -> Optional[Dict[str, Any]]:
    from modules.api.events.services import get_user_events
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

    try:
        from rapidfuzz import fuzz, process
        choices = {str(e.get("id")): _normalize_title(e.get("title") or "") for e in events if e.get("id")}
        threshold = 85 if is_destructive else 60
        matches = process.extract(query, choices, scorer=fuzz.token_set_ratio, score_cutoff=threshold, limit=None)
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
    except ImportError:
        for e in events:
            if query in _normalize_title(e.get("title") or ""):
                return e
    return None


def _list_upcoming_events(uid: str, args: Dict[str, Any]) -> Dict[str, Any]:
    from modules.api.events.services import get_user_events
    days = args.get("days")
    if days is not None:
        try:
            days = max(1, min(365, int(days)))
        except (TypeError, ValueError):
            days = None
    category = args.get("category").strip() if isinstance(args.get("category"), str) else None
    ev_type = args.get("type").strip().lower() if isinstance(args.get("type"), str) else None
    period = args.get("period").strip().lower() if isinstance(args.get("period"), str) else None
    query = args.get("query").strip().lower() if isinstance(args.get("query"), str) else None

    today = date.today()
    events = get_user_events(uid)
    upcoming = list(events)

    if query:
        qn = _normalize_title(query)
        upcoming = [
            e for e in events
            if qn in _normalize_title(e.get("title") or "")
            or qn in _normalize_title(e.get("category") or "")
            or qn in _normalize_title(e.get("description") or "")
        ]
        if not upcoming:
            try:
                from rapidfuzz import fuzz
                for e in events:
                    title_n = _normalize_title(e.get("title") or "")
                    cat_n = _normalize_title(e.get("category") or "")
                    desc_n = _normalize_title(e.get("description") or "")
                    best = max(
                        fuzz.partial_ratio(qn, title_n),
                        fuzz.partial_ratio(qn, cat_n),
                        fuzz.partial_ratio(qn, desc_n),
                        fuzz.token_set_ratio(qn, title_n),
                        fuzz.token_sort_ratio(qn, title_n),
                    )
                    if best >= 60:
                        e_copy = dict(e)
                        e_copy["_match_score"] = best
                        upcoming.append(e_copy)
                upcoming.sort(key=lambda e: -e.get("_match_score", 0))
            except ImportError:
                pass
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
    elif period and period.endswith("_months") and period.split("_")[0].isdigit():
        n = int(period.split("_")[0])
        end = _shift_month(today, n)
        upcoming = [e for e in events if today.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period and period.startswith("month_") and period.split("_")[1].isdigit():
        n = int(period.split("_")[1])
        year = today.year
        if n < today.month:
            year += 1
        start = date(year, n, 1)
        import calendar
        max_day = calendar.monthrange(year, n)[1]
        end = date(year, n, max_day)
        upcoming = [e for e in events if start.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period and period.endswith("_weeks") and period.split("_")[0].isdigit():
        n = int(period.split("_")[0])
        end = today + timedelta(weeks=n)
        upcoming = [e for e in events if today.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period and period.endswith("_days") and period.split("_")[0].isdigit():
        n = int(period.split("_")[0])
        end = today + timedelta(days=n)
        upcoming = [e for e in events if today.isoformat() <= (e.get("date") or "") <= end.isoformat()]
    elif period and period.endswith("_hours") and period.split("_")[0].isdigit():
        n = int(period.split("_")[0])
        now_dt = datetime.now()
        end_dt = now_dt + timedelta(hours=n)
        upcoming = []
        for e in events:
            d_str = e.get("date") or ""
            t_str = e.get("startTime") or e.get("start_time") or "00:00"
            try:
                dt = datetime.fromisoformat(f"{d_str}T{t_str}")
                if now_dt <= dt <= end_dt:
                    upcoming.append(e)
            except Exception:
                if d_str == today.isoformat():
                    upcoming.append(e)
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


def _create_event(uid: str, args: Dict[str, Any]) -> Dict[str, Any]:
    from modules.api.events.services import create_user_event, link_series
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
        data["category"] = cat if cat in ALLOWED_CATEGORIES else (_guess_category(title) or "otros")
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

    series = _find_matching_series(uid, title, ev_type)
    event_id = create_user_event(uid, data)
    link_series(uid, event_id, series)
    return _series_result(uid, event_id, ev_type, series)


def _create_task(uid: str, args: Dict[str, Any]) -> Dict[str, Any]:
    return _create_event(uid, {**args, "type": "task"})


def _create_reminder(uid: str, args: Dict[str, Any]) -> Dict[str, Any]:
    return _create_event(uid, {**args, "type": "reminder"})


def _update_event(uid: str, args: Dict[str, Any]) -> Dict[str, Any]:
    from modules.api.events.services import get_user_events, update_user_event
    event_id = str(args.get("id") or "").strip()
    if not event_id and (args.get("title") or args.get("description")):
        try:
            _ev = _find_event_by_desc(uid, args.get("title") or args.get("description"), args.get("date"), is_destructive=True)
            if _ev:
                event_id = str(_ev.get("id") or "").strip()
        except ValueError as e:
            if str(e) == "AMBIGUOUS":
                return {"ok": False, "error": "Hay varios eventos que coinciden con esa descripción. Por favor, sé más específico."}
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
        data["title"] = title[:200]
    if args.get("date"):
        data["date"] = str(args["date"]).strip()
        _parse_date(data["date"])
    if args.get("startTime"):
        data["startTime"] = _parse_time(args["startTime"])
    if args.get("endTime"):
        data["endTime"] = _parse_time(args["endTime"])
    if args.get("category"):
        cat = str(args["category"]).strip().lower()
        data["category"] = cat if cat in ALLOWED_CATEGORIES else (_guess_category(args.get("title") or cur.get("title")) or "otros")
    if args.get("description"):
        data["description"] = str(args["description"])[:2000]
    if args.get("location") is not None:
        data["location"] = str(args["location"])[:200]
    if args.get("completed") is not None:
        data["completed"] = bool(args["completed"])
    if args.get("isImportant") is not None:
        data["isImportant"] = bool(args["isImportant"])

    update_user_event(uid, event_id, data)
    return {"ok": True, "id": event_id}


def _delete_event(uid: str, args: Dict[str, Any]) -> Dict[str, Any]:
    from modules.api.events.services import delete_user_event
    event_id = str(args.get("id") or "").strip()
    if not event_id and (args.get("title") or args.get("description")):
        try:
            _ev = _find_event_by_desc(uid, args.get("title") or args.get("description"), args.get("date"), is_destructive=True)
            if _ev:
                event_id = str(_ev.get("id") or "").strip()
        except ValueError as e:
            if str(e) == "AMBIGUOUS":
                return {"ok": False, "error": "Hay varios eventos que coinciden con esa descripción. Por favor, sé más específico."}
            raise
    if not event_id:
        raise ValueError("id o title es obligatorio para eliminar")
    affected = delete_user_event(uid, event_id)
    if not affected:
        return {"ok": False, "error": "No se encontró ningún evento con ese id"}
    return {"ok": True}


def get_user_events(uid):
    """Re-export público perezoso de events.services.get_user_events.

    Preserva la API de agenda sin arrastrar el dominio events en el import de
    modules.api.ai; el dominio events solo se carga al llamar a esta función.
    """
    from modules.api.events.services import get_user_events as _get_user_events
    return _get_user_events(uid)


_ALLOWED_OPERATIONS = {
    "list_upcoming_events": _list_upcoming_events,
    "create_event": _create_event,
    "create_task": _create_task,
    "create_reminder": _create_reminder,
    "update_event": _update_event,
    "delete_event": _delete_event,
}


def normalize_tool_args(name: str, args: Any) -> Optional[Dict[str, Any]]:
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
        return resolve_date_from_text(v, today=today)

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
        return v if v in ALLOWED_CATEGORIES else _guess_category(v)

    if name in ("create_event", "create_task", "create_reminder"):
        title = str(args.get("title") or "").strip()
        if not title:
            return None
        args["title"] = re.sub(r"\s+", " ", title[:200]).strip(" .,;:¿?¡!-")

        raw_date = args.get("date") or args.get("fecha") or args.get("date_raw")
        d = _valid_date(raw_date) if raw_date else today.isoformat()
        if not d:
            d = today.isoformat()
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
            ev_type = "task" if name == "create_task" else "reminder" if name == "create_reminder" else "event"
        args["type"] = ev_type

        for k in ("allDay", "all_day", "completed", "isImportant", "is_important"):
            if k in args:
                args[k] = bool(args[k])
        allowed = {"title", "date", "startTime", "endTime", "category", "type",
                   "description", "location", "allDay", "completed", "isImportant"}
        return {k: v for k, v in args.items() if k in allowed}

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
            args["description"] = str(orig["description"]).strip()[:2000]
        if orig.get("location") is not None:
            args["location"] = str(orig["location"]).strip()[:200]
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
        if "time_range" in args and args["time_range"] and not args.get("period"):
            args["period"] = args["time_range"]
        if "days" in args and args["days"] is not None:
            try:
                args["days"] = max(1, min(365, int(args["days"])))
            except (TypeError, ValueError):
                args["days"] = 30
        allowed = {"days", "category", "type", "period", "query"}
        return {k: v for k, v in args.items() if k in allowed}

    return args


def enrich_update_args(args: Dict[str, Any], text: str) -> Dict[str, Any]:
    """Rellena campos omitidos por el modelo en update_event extrayéndolos del texto del usuario."""
    res = dict(args or {})
    if not text:
        return res
    if not res.get("description"):
        m = re.search(r'(?:descripci[oó]n|description)\s*["\']?([^"\']+)["\']?', text, re.IGNORECASE)
        if m:
            res["description"] = m.group(1).strip()
    if not res.get("title"):
        m = re.search(r'(?:a|to)\s*["\']([^"\']+)["\']', text, re.IGNORECASE)
        if m:
            res["title"] = m.group(1).strip()
        else:
            m = re.search(r'(?:name of \w+ to|nombre de [^a]+ a)\s*(\w+)', text, re.IGNORECASE)
            if m:
                res["title"] = m.group(1).strip()
    return res


def execute_tool(name: str, args: Any, uid: str) -> Dict[str, Any]:
    fn = _ALLOWED_OPERATIONS.get(name)
    if not fn:
        return {"error": f"Operación no permitida: {name}"}
    normalized = normalize_tool_args(name, args)
    if normalized is None:
        return {"error": f"Faltan datos obligatorios para {name}"}
    try:
        result = fn(uid, normalized)
    except Exception as e:
        return {"error": f"Error al ejecutar {name}: {e}"}

    if name in ("create_event", "create_task", "create_reminder", "update_event", "delete_event") and result.get("ok"):
        try:
            socketio.emit("events_changed", {}, room=f"user_{uid}")
        except Exception:
            pass
    return result


def build_agent_prompt(extraction: bool = False) -> str:
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


def format_events_summary(result: Any, lang: str = "es", search: bool = False) -> str:
    head_search = ("Registros encontrados en tu agenda:\n" if lang != "en" else "Records found in your calendar:\n")
    if not isinstance(result, dict):
        return ("No hay datos de agenda disponibles." if lang != "en" else "No calendar data available.")
    events = result.get("events") or []
    if not events:
        return ("No tienes eventos ni tareas próximos en tu agenda." if lang != "en" else "You have no upcoming events or tasks in your calendar.")
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
    head = ("Tienes los siguientes elementos próximos en tu agenda:\n" if lang != "en" else "You have the following upcoming items in your calendar:\n")
    return (head_search if search else head) + "\n".join(lines)


def model_supports_tools(model: str) -> Optional[bool]:
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


def remember_model_tools(model: str, supported: bool) -> None:
    model = str(model or "")
    if model:
        _tool_cap_cache[model] = bool(supported)
