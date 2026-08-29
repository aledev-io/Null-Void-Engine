"""Gateway de Privacidad del agente de agenda y registro de actividades.

Arquitectura híbrida para enmascarar PII y datos sensibles antes de enviar
texto a proveedores externos (APIs de terceros):

- Validadores algorítmicos para datos estructurados: DNI/NIE (módulo 23),
  tarjetas (Luhn), IBAN (ISO 13616 / mod-97), teléfonos y emails.
- Secretos y credenciales: API keys (OpenAI, GitHub, AWS, JWT, Bearer),
  claves privadas (RSA/SSH), contraseñas y tokens.
- Direcciones de red: IPv4, IPv6 y direcciones MAC.
- NER bilingüe con spaCy (``es_core_news_sm`` y ``en_core_web_sm``) con solo el
  pipe de NER activo para PERSONA / ORGANIZACIÓN / LOCALIZACIÓN.
- Manejo por spans [start, end) con resolución determinista de solapamientos
  (Prioridad > Confianza > Longitud) y sustitución con tags opacos
  ``<PII:tipo:id>``.
- Tags aleatorios por contexto (secrets.token_hex): la misma entidad recibe
  el mismo tag DENTRO del mismo MaskingContext (dedup por valor), pero tags
  distintos entre peticiones distintas → no correlacionables entre sesiones.
- ``unmask`` es una frontera segura: solo restaura tags generados y presentes
  en el mapping autorizado del contexto.

INVARIANTE DE SEGURIDAD:
    Nunca debe pasarse agent_messages (datos reales) directamente a una
    llamada externa. El flujo correcto es siempre:
        safe_msgs, _ = mask_conversation_with_context(agent_messages, ctx)
        external_client.call(safe_msgs)
"""
from __future__ import annotations

import re
import secrets
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Iterable, Optional, Protocol

try:
    import spacy
    _SPACY_AVAILABLE = True
except Exception:
    spacy = None
    _SPACY_AVAILABLE = False


_ES_NER_MODEL = "es_core_news_sm"
_EN_NER_MODEL = "en_core_web_sm"
_nlps: Dict[str, Any] = {"es": None, "en": None}
_nlp_lock = threading.Lock()


class PIIType(Enum):
    EMAIL = "email"
    CUENTA = "cuenta"          # IBAN / CCC
    TARJETA = "tarjeta"        # tarjetas bancarias (Luhn)
    DNI = "dni"
    NIE = "nie"
    NIF = "nif"                # CIF de empresa
    SEGSOCIAL = "segsocial"
    TELEFONO = "telefono"
    PERSONA = "persona"
    ORGANIZACION = "organizacion"
    LOCALIZACION = "localizacion"
    API_KEY = "api_key"        # Bearer tokens, OpenAI keys, JWT, secrets
    SECRET = "secret"          # Contraseñas, claves privadas
    IP_ADDRESS = "ip"          # IPv4, IPv6
    MAC_ADDRESS = "mac"        # MAC addresses


@dataclass(frozen=True)
class Candidate:
    """Coincidencia de una entidad sensible en el texto (span [start, end))."""
    start: int
    end: int
    value: str
    pii_type: PIIType
    priority: int
    confidence: float = 1.0
    source: str = "regex"


@dataclass
class MaskingContext:
    """Estado del enmascarado para una generación completa.

    Garantías:
    - La misma entidad (tipo + valor) recibe siempre el mismo tag dentro del
      mismo contexto (dedup por valor). Acumulativo entre rondas del agente.
    - Los tags son aleatorios: no correlacionables entre contextos distintos.
    - El mapping es la única fuente de verdad para unmask; no duplicar en
      estructuras externas.
    """
    mapping: dict[str, str] = field(default_factory=dict)
    _by_value: dict[tuple[str, str], str] = field(default_factory=dict)
    mode: str = "full"

    def tag_for(self, pii_type: PIIType, value: str) -> str:
        key = (pii_type.value, value)
        tag = self._by_value.get(key)
        if tag is None:
            tag = f"<PII:{pii_type.value}:{secrets.token_hex(8)}>"
            while tag in self.mapping:
                tag = f"<PII:{pii_type.value}:{secrets.token_hex(8)}>"
            self._by_value[key] = tag
            self.mapping[tag] = value
        return tag

    def apply(self, text: str, candidates: Iterable[Candidate]) -> str:
        """Sustituye los spans resueltos por tags opacos."""
        resolved = _resolve_spans(candidates)
        pieces: list[str] = []
        last = 0
        for c in resolved:
            pieces.append(text[last:c.start])
            pieces.append(self.tag_for(c.pii_type, c.value))
            last = c.end
        pieces.append(text[last:])
        return "".join(pieces)


_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"


def _is_valid_dni(value: str) -> bool:
    """DNI/NIE: módulo 23 sobre la letra de control."""
    m = re.fullmatch(r"([XYZ]?)(\d{7,8})([A-Z])", value.strip().upper())
    if not m:
        return False
    prefix, digits, letter = m.groups()
    if prefix:
        if len(digits) != 7:
            return False
        num = {"X": 0, "Y": 1, "Z": 2}[prefix] * 10_000_000 + int(digits)
    else:
        if len(digits) != 8:
            return False
        num = int(digits)
    return letter == _DNI_LETTERS[num % 23]


def _is_valid_iban(value: str) -> bool:
    """IBAN: ISO 13616, validación mod-97."""
    s = re.sub(r"[\s-]", "", value).upper()
    if not (15 <= len(s) <= 34):
        return False
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", s):
        return False
    rearranged = s[4:] + s[:4]
    num = "".join(str(ord(c) - 55) if c.isalpha() else c for c in rearranged)
    return int(num) % 97 == 1


def _is_luhn_valid(value: str) -> bool:
    """Algoritmo de Luhn para tarjetas bancarias."""
    digits = [int(ch) for ch in value if ch.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _is_valid_phone(value: str) -> bool:
    s = re.sub(r"[\s().-]", "", value)
    if s.startswith("00"):
        s = s[2:]
    s = s.lstrip("+")
    return 9 <= len(s) <= 15 and s.isdigit()


_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,8}\b", re.IGNORECASE)
_CCC_RE = re.compile(r"\b\d{20}\b")
_CARD_RE = re.compile(r"(?<!\d)(?:\d[\s-]*){13,19}(?!\d)")
_DNI_RE = re.compile(r"\b\d{8}[A-Z]\b", re.IGNORECASE)
_NIE_RE = re.compile(r"\b[XYZ]\d{7}[A-Z]\b", re.IGNORECASE)
_NIF_RE = re.compile(r"\b[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]\b", re.IGNORECASE)
_SS_RE = re.compile(r"\b\d{12}\b")
_TEL_RE = re.compile(r"(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\d)")

# API keys, tokens y credenciales
_API_KEY_RE = re.compile(
    r"\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|"
    r"xox[baprs]-[a-zA-Z0-9]{10,}|glpat-[a-zA-Z0-9_-]{20,}|"
    r"eyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_=]{10,}\.?[A-Za-z0-9-_.+/=]*|"
    r"Bearer\s+[A-Za-z0-9-._~+/]+=*)\b",
    re.IGNORECASE
)

_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----[\s\S]+?-----END\s+[A-Z\s]+PRIVATE\s+KEY-----"
)

_PASSWORD_FIELD_RE = re.compile(
    r"(?i)\b(?:password|passwd|clave|contrase[ñn]a|secret|api_key|token)\s*[:=]\s*([^\s,;]+)"
)

_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b"
)
_IPV6_RE = re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b")
_MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}(?:[0-9A-Fa-f]{2})\b")

_COMPANY_SUFFIX_RE = re.compile(
    r"\b([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]*){0,4}?)\s+"
    r"(?:S\.L\.U\.|S\.L\.|S\.A\.|S\.A\.U\.|S\.L\.E\.|S\.C\.|S\.Coop\.|"
    r"Ltd\.?|GmbH|Inc\.?|Corp\.?|S\.L\.L\.)(?!\w)",
    re.IGNORECASE
)

# Palabras de relleno para recortar bordes de entidades NER
_EDGE_TRIM = {
    "ayer", "hoy", "el", "la", "los", "las", "un", "una", "unos", "unas",
    "al", "del", "en", "de", "para", "con", "por", "a", "mi", "tu", "su",
    "nuestro", "nuestra", "este", "esta", "ese", "esa", "aquí", "también",
    "que", "y", "o", "e", "don", "doña", "the", "on", "in", "at", "to", "for", "with",
}
_SINGLE_SKIP = _EDGE_TRIM | {
    "fui", "fue", "es", "era", "ser", "está", "estuve", "estuvo", "estoy",
    "tengo", "tiene", "hay", "hace", "hizo", "hacer", "voy", "va", "ir",
    "llamó", "llamé", "llamar", "dice", "dijo", "trabaja", "trabajé",
    "trabajo", "trabaje", "estudia", "quiere", "puede", "días", "semana",
    "mes", "año", "día", "lunes", "martes", "miércoles", "viernes",
    "sábado", "domingo", "enero", "febrero", "marzo", "abril", "mayo",
    "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
    "diciembre", "todo", "toda", "tarde", "noche", "mañana",
    "apúntame", "apunta", "apuntar", "ponme", "pon", "ponle", "ponlo",
    "haz", "hazme", "hazlo", "quiero", "quisiera", "dame", "dime", "mira",
    "cuéntame", "avísame", "recuérdame", "reserva", "reservar", "llámame",
    "escríbeme", "necesito", "hablé", "hablado", "quedé", "quedado",
    "fuimos", "fuiste", "hemos", "estamos", "estaba", "estaban", "he", "ha",
    "han", "son", "estás", "dijo", "dice", "me", "te", "se", "le", "les",
    "create", "make", "add", "delete", "remove", "schedule", "work", "worked",
}

_PROTECTED_WORDS = {
    "DNI", "NIE", "NIF", "CIF", "IBAN", "CCC", "SS",
    "TARJETA", "CUENTA", "EMAIL", "TELÉFONO", "TELEFONO",
    "BANCO", "BANCARIA", "PAY", "NÚMERO", "NUMERO", "DOCUMENTO",
    "IDENTIFICACIÓN", "IDENTIFICACION", "CLAVE", "API", "KEY",
    "TOKEN", "BEARER", "PASSWORD", "SECRET",
    "APUNTA", "APUNTAME", "APÚNTAME", "APÚNTALE", "ANOTA", "ANOTAME", "APÚNTALO",
    "ANÓTAME", "ANOTALO", "HAZME", "HAZLO", "HAZLA", "PONME", "PONLO", "PONLA",
    "REGISTRA", "REGISTRAME", "REGISTRALO", "GUARDAME", "GUARDALO", "GUÁRDALO",
    "BORRA", "BORRALO", "ELIMINA", "ELIMINALO", "MARCA", "MARCALO",
    "COMPLETA", "COMPLETALO", "CREATE", "ADD", "DELETE", "TASK", "EVENT",
}

_AGENDA_CONTEXT = {
    "dentista", "médico", "medico", "doctor", "fisioterapeuta", "psicólogo",
    "psiquiatra", "terapeuta", "enfermera", "cirujano",
    "hospital", "farmacia", "clínica", "clinica", "consulta",
    "cita", "citas", "reunión", "reunion", "reuniones",
    "clase", "clases", "examen", "exámenes", "examenes",
    "tarea", "tareas", "evento", "eventos", "recordatorio", "recordatorios",
    "junta", "juntas", "entrevista", "entrevistas",
    "conferencia", "charla", "presentación", "presentacion",
    "trabajo", "trabajos", "empresa", "empresas", "proyecto", "proyectos",
    "comida", "comidas", "cena", "cenas", "almuerzo", "almuerzos",
    "fiesta", "fiestas", "cumpleaños", "quedada", "quedadas",
    "concierto", "conciertos", "partido", "partidos", "cine", "película",
    "viaje", "viajes", "vacaciones", "excursión", "excursiones",
    "semana", "semanas", "mes", "meses", "año", "años",
    "lunes", "martes", "miércoles", "miercoles", "jueves", "viernes",
    "sábado", "sabado", "domingo", "día", "dia", "días", "dias",
    "hora", "horas", "minuto", "minutos", "segundo", "segundos",
    "dentist", "doctor", "hospital", "exam", "meeting", "class", "task",
    "calendar", "schedule", "reminder", "holiday", "birthday",
}


class Detector(Protocol):
    priority: int
    confidence: float
    source: str

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        ...


class RegexDetector:
    """Detector por patrón regex con validador algorítmico opcional."""

    def __init__(
        self,
        pii_type: PIIType,
        pattern: re.Pattern[str],
        validator: Optional[Callable[[str], bool]] = None,
        priority: int = 5,
        confidence: float = 1.0,
        source: str = "regex",
    ) -> None:
        self.pii_type = pii_type
        self._pattern = pattern
        self._validator = validator
        self.priority = priority
        self.confidence = confidence
        self.source = source

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        out: list[Candidate] = []
        for m in self._pattern.finditer(text):
            raw = m.group(0)
            lead = len(raw) - len(raw.lstrip())
            trail = len(raw) - len(raw.rstrip())
            value = raw.strip()
            if not value:
                continue
            if self._validator is not None and not self._validator(value):
                continue
            out.append(Candidate(
                start=m.start() + lead, end=m.end() - trail, value=value,
                pii_type=self.pii_type, priority=self.priority,
                confidence=self.confidence, source=self.source,
            ))
        return out


class PasswordFieldDetector:
    """Detecta contraseñas en pares clave:valor (password=..., clave: ...)."""
    priority = 8
    confidence = 1.0
    source = "regex_pass"
    pii_type = PIIType.SECRET

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        out: list[Candidate] = []
        for m in _PASSWORD_FIELD_RE.finditer(text):
            val = m.group(1).strip()
            if len(val) >= 3 and val.upper() not in _PROTECTED_WORDS:
                out.append(Candidate(
                    start=m.start(1), end=m.end(1), value=val,
                    pii_type=self.pii_type, priority=self.priority,
                    confidence=self.confidence, source=self.source,
                ))
        return out


class SpacyNERDetector:
    """NER bilingüe local (es_core_news_sm y en_core_web_sm) con solo el pipe de NER activo."""
    priority = 3
    confidence = 0.7
    source = "ner"
    pii_types = frozenset({
        PIIType.PERSONA, PIIType.ORGANIZACION, PIIType.LOCALIZACION,
    })

    _LABEL_MAP = {
        "PER": PIIType.PERSONA,
        "PERSON": PIIType.PERSONA,
        "ORG": PIIType.ORGANIZACION,
        "LOC": PIIType.LOCALIZACION,
        "GPE": PIIType.LOCALIZACION,
    }

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        if not _SPACY_AVAILABLE or not text.strip():
            return []

        # Seleccionar modelo según idioma del texto
        from ..agenda.router import detect_lang
        lang = detect_lang(text)
        nlp = _get_nlp(lang)
        if nlp is None:
            return []

        out: list[Candidate] = []
        doc = nlp(text)
        for ent in doc.ents:
            pii_type = self._LABEL_MAP.get(ent.label_)
            if pii_type is None:
                continue
            tokens = list(ent)
            start, end = 0, len(tokens)
            while start < end and tokens[start].text.lower() in _EDGE_TRIM:
                start += 1
            while end > start and tokens[end - 1].text.lower() in _EDGE_TRIM:
                end -= 1
            if start >= end:
                continue
            value = text[tokens[start].idx:tokens[end - 1].idx + len(tokens[end - 1])]
            if len(value) < 2 or value.isdigit():
                continue
            if value.strip().upper() in _PROTECTED_WORDS:
                continue
            if value.lower() in _AGENDA_CONTEXT:
                continue
            if start + 1 == end and tokens[start].text.lower() in _SINGLE_SKIP:
                continue
            out.append(Candidate(
                start=tokens[start].idx,
                end=tokens[end - 1].idx + len(tokens[end - 1]),
                value=value, pii_type=pii_type,
                priority=self.priority, confidence=self.confidence,
                source=self.source,
            ))
        return out


def _get_nlp(lang: str = "es"):
    global _nlps
    lang = "en" if lang == "en" else "es"
    if _nlps[lang] is not None or not _SPACY_AVAILABLE:
        return _nlps[lang]
    with _nlp_lock:
        if _nlps[lang] is None:
            try:
                model_name = _EN_NER_MODEL if lang == "en" else _ES_NER_MODEL
                _nlps[lang] = spacy.load(
                    model_name,
                    disable=["parser", "tagger", "attribute_ruler",
                             "morphologizer", "lemmatizer", "senter"],
                )
            except Exception:
                _nlps[lang] = None
    return _nlps[lang]


def _resolve_spans(candidates: Iterable[Candidate]) -> list[Candidate]:
    accepted: list[Candidate] = []
    for c in sorted(
        candidates,
        key=lambda c: (-c.priority, -c.confidence, -(c.end - c.start)),
    ):
        if any(not (c.end <= a.start or c.start >= a.end) for a in accepted):
            continue
        accepted.append(c)
    return sorted(accepted, key=lambda c: c.start)


_DETECTORS: tuple[Detector, ...] = (
    RegexDetector(PIIType.SECRET, _PRIVATE_KEY_RE, None, priority=10),
    RegexDetector(PIIType.API_KEY, _API_KEY_RE, None, priority=9),
    PasswordFieldDetector(),
    RegexDetector(PIIType.TARJETA, _CARD_RE, _is_luhn_valid, priority=9),
    RegexDetector(PIIType.CUENTA, _IBAN_RE, _is_valid_iban, priority=9),
    RegexDetector(PIIType.CUENTA, _CCC_RE, None, priority=8),
    RegexDetector(PIIType.DNI, _DNI_RE, _is_valid_dni, priority=8),
    RegexDetector(PIIType.NIE, _NIE_RE, _is_valid_dni, priority=8),
    RegexDetector(PIIType.NIF, _NIF_RE, None, priority=8),
    RegexDetector(PIIType.SEGSOCIAL, _SS_RE, None, priority=7),
    RegexDetector(PIIType.EMAIL, _EMAIL_RE, None, priority=7),
    RegexDetector(PIIType.TELEFONO, _TEL_RE, _is_valid_phone, priority=6),
    RegexDetector(PIIType.IP_ADDRESS, _IPV4_RE, None, priority=5),
    RegexDetector(PIIType.IP_ADDRESS, _IPV6_RE, None, priority=5),
    RegexDetector(PIIType.MAC_ADDRESS, _MAC_RE, None, priority=5),
    RegexDetector(PIIType.ORGANIZACION, _COMPANY_SUFFIX_RE, None, priority=4, confidence=0.9),
    SpacyNERDetector(),
)

_SOFT_MASK_TYPES = frozenset({
    PIIType.EMAIL, PIIType.TELEFONO, PIIType.PERSONA,
    PIIType.ORGANIZACION, PIIType.LOCALIZACION,
    PIIType.IP_ADDRESS, PIIType.MAC_ADDRESS,
})

_PRIVACY_MODES: dict[str, frozenset[PIIType]] = {
    "full": frozenset(),
    "moderate": frozenset({
        PIIType.PERSONA, PIIType.ORGANIZACION, PIIType.LOCALIZACION,
    }),
    "free": frozenset(_SOFT_MASK_TYPES),
}


def _get_detectors(mode: str = "full") -> tuple[Detector, ...]:
    excluded = _PRIVACY_MODES.get(mode or "", frozenset())
    if not excluded:
        return _DETECTORS
    out: list[Detector] = []
    for d in _DETECTORS:
        d_types = getattr(d, "pii_type", None)
        if d_types is None:
            d_types = getattr(d, "pii_types", frozenset())
        else:
            d_types = frozenset({d_types})
        if d_types & excluded:
            continue
        out.append(d)
    return tuple(out)


_ALWAYS_MASK_ROLES = {"user", "assistant", "tool", "system"}


def mask_sensitive(text: str, mode: str = "full") -> tuple[str, dict[str, str]]:
    """Enmascara PII de un texto. Devuelve (texto_enmascarado, mapping)."""
    ctx = MaskingContext(mode=mode)
    candidates = [c for d in _get_detectors(ctx.mode) for c in d.detect(text or "", ctx)]
    masked = ctx.apply(text or "", candidates)
    return masked, ctx.mapping


def mask_conversation_with_context(
    messages: list[dict],
    context: MaskingContext,
    mode: str | None = None,
) -> tuple[list[dict], dict[str, str]]:
    """Enmascara una conversación usando un MaskingContext acumulativo."""
    detectors = _get_detectors(mode or context.mode)
    out: list[dict] = []
    for m in messages or []:
        if not isinstance(m, dict):
            out.append(m)
            continue
        role = m.get("role")
        if m.get("_mask") is False:
            clean = {k: v for k, v in m.items() if k != "_mask"}
            out.append(clean)
            continue
        if role not in _ALWAYS_MASK_ROLES and not m.get("_mask"):
            out.append(m)
            continue
        content = m.get("content")
        if isinstance(content, list):
            masked_content = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text" and "text" in part:
                    text_val = part.get("text") or ""
                    candidates = [c for d in detectors for c in d.detect(text_val, context)]
                    masked_text = context.apply(text_val, candidates)
                    masked_content.append({**part, "text": masked_text})
                else:
                    masked_content.append(part)
            clean = {k: v for k, v in m.items() if k != "_mask"}
            out.append({**clean, "content": masked_content})
        else:
            content_str = content or ""
            candidates = [c for d in detectors for c in d.detect(content_str, context)]
            masked = context.apply(content_str, candidates)
            clean = {k: v for k, v in m.items() if k != "_mask"}
            out.append({**clean, "content": masked})
    return out, context.mapping


_TAG_RE = re.compile(r"<PII:([a-z_]+):([0-9a-f]{16})>")


def unmask(text: str, mapping: dict[str, str]) -> str:
    """Restaura de forma segura los tags presentes en el mapping."""
    if not text or not mapping:
        return text

    def _replace(m: re.Match[str]) -> str:
        return mapping.get(m.group(0), m.group(0))

    return _TAG_RE.sub(_replace, text)
