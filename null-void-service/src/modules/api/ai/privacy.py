"""Gateway de Privacidad del agente de agenda y registro de actividades.

Arquitectura híbrida para enmascarar PII antes de enviar texto a proveedores
externos (APIs de terceros):

- Validadores algorítmicos para datos estructurados: DNI/NIE (módulo 23),
  tarjetas (Luhn), IBAN (ISO 13616 / mod-97), teléfonos y emails.
- NER local con spaCy (``es_core_news_sm``) cargado SOLO con el pipe de NER
  para PERSONA / ORGANIZACIÓN / LOCALIZACIÓN.
- Sin regex de triggers de contexto ("con mi amigo X", "trabajé en Y"): el NER
  los sustituye.
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

API pública estable:
    mask_sensitive(text: str) -> tuple[str, dict[str, str]]
    mask_conversation(messages: list[dict]) -> tuple[list[dict], dict[str, str]]
    mask_conversation_with_context(
        messages: list[dict],
        context: MaskingContext,
    ) -> tuple[list[dict], dict[str, str]]
    unmask(text: str, mapping: dict[str, str]) -> str
"""
from __future__ import annotations

import re
import secrets
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Protocol

try:  # spaCy es OPCIONAL: si no está, el gateway degrada a solo regex
    import spacy  # type: ignore[import-not-found]
    _SPACY_AVAILABLE = True
except Exception:  # pragma: no cover - entorno sin spaCy
    spacy = None  # type: ignore[assignment]
    _SPACY_AVAILABLE = False

# ─────────────────────────────────────────────────────────────────────────────
# Modelos de datos
# ─────────────────────────────────────────────────────────────────────────────

_ES_NER_MODEL = "es_core_news_sm"
_nlp = None
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

    def tag_for(self, pii_type: PIIType, value: str) -> str:
        key = (pii_type.value, value)
        tag = self._by_value.get(key)
        if tag is None:
            # Tag aleatorio: 64 bits → no correlacionable entre peticiones.
            # Bucle de unicidad: probabilidad de colisión ~5×10⁻¹⁷ por llamada,
            # pero la garantía formal no cuesta nada.
            tag = f"<PII:{pii_type.value}:{secrets.token_hex(8)}>"
            while tag in self.mapping:
                tag = f"<PII:{pii_type.value}:{secrets.token_hex(8)}>"
            self._by_value[key] = tag
            self.mapping[tag] = value
        return tag

    def apply(self, text: str, candidates: Iterable[Candidate]) -> str:
        """Sustituye los spans resueltos por tags opacos (sin replace ciego)."""
        resolved = _resolve_spans(candidates)
        pieces: list[str] = []
        last = 0
        for c in resolved:
            pieces.append(text[last:c.start])
            pieces.append(self.tag_for(c.pii_type, c.value))
            last = c.end
        pieces.append(text[last:])
        return "".join(pieces)


# ─────────────────────────────────────────────────────────────────────────────
# Validadores algorítmicos
# ─────────────────────────────────────────────────────────────────────────────

_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"


def _is_valid_dni(value: str) -> bool:
    """DNI/NIE: módulo 23 sobre la letra de control (DNI 8 dígitos; NIE
    X/Y/Z + 7 dígitos, con X=0, Y=1, Z=2 como primer dígito)."""
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
    """IBAN: ISO 13616, validación mod-97 (mover 4 primeros, letras->números)."""
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


# ─────────────────────────────────────────────────────────────────────────────
# Patrones (solo formato; sin triggers de contexto)
# ─────────────────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}?\b", re.IGNORECASE)
_CCC_RE = re.compile(r"\b\d{20}\b")
_CARD_RE = re.compile(r"(?<!\d)(?:\d[\s-]*){13,19}(?!\d)")
_DNI_RE = re.compile(r"\b\d{8}[A-Z]\b", re.IGNORECASE)
_NIE_RE = re.compile(r"\b[XYZ]\d{7}[A-Z]\b", re.IGNORECASE)
_NIF_RE = re.compile(r"\b[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]\b", re.IGNORECASE)
_SS_RE = re.compile(r"\b\d{12}\b")
_TEL_RE = re.compile(r"(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\d)")
_COMPANY_SUFFIX_RE = re.compile(
    r"\b([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]*){0,4}?)\s+"
    r"(?:S\.L\.U\.|S\.L\.|S\.A\.|S\.A\.U\.|S\.L\.E\.|S\.C\.|S\.Coop\.|"
    r"Ltd\.?|GmbH|Inc\.?|Corp\.?|S\.L\.L\.)(?!\w)",
    re.IGNORECASE
)

# Palabras de relleno para recortar bordes de entidades NER (nunca triggers)
_EDGE_TRIM = {
    "ayer", "hoy", "el", "la", "los", "las", "un", "una", "unos", "unas",
    "al", "del", "en", "de", "para", "con", "por", "a", "mi", "tu", "su",
    "nuestro", "nuestra", "este", "esta", "ese", "esa", "aquí", "también",
    "que", "y", "o", "e", "don", "doña",
}
_SINGLE_SKIP = _EDGE_TRIM | {
    "fui", "fue", "es", "era", "ser", "está", "estuve", "estuvo", "estoy",
    "tengo", "tiene", "hay", "hace", "hizo", "hacer", "voy", "va", "ir",
    "llamó", "llamé", "llamar", "dice", "dijo", "trabaja", "trabajé",
    "trabajo", "trabaje", "estudia", "quiere", "puede", "días", "semana",
    "mes", "año", "día", "lunes", "martes", "miércoles", "jueves", "viernes",
    "sábado", "domingo", "enero", "febrero", "marzo", "abril", "mayo",
    "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
    "diciembre", "todo", "toda", "tarde", "noche", "mañana",
    # Verbos y formas que es_core_news_sm etiqueta erróneamente como PER
    "apúntame", "apunta", "apuntar", "ponme", "pon", "ponle", "ponlo",
    "haz", "hazme", "hazlo", "quiero", "quisiera", "dame", "dime", "mira",
    "cuéntame", "avísame", "recuérdame", "reserva", "reservar", "llámame",
    "escríbeme", "necesito", "hablé", "hablado", "quedé", "quedado",
    "fuimos", "fuiste", "hemos", "estamos", "estaba", "estaban", "he", "ha",
    "han", "son", "estás", "dijo", "dice", "me", "te", "se", "le", "les",
}


# ─────────────────────────────────────────────────────────────────────────────
# Detectores (Protocol extensible)
# ─────────────────────────────────────────────────────────────────────────────

class Detector(Protocol):
    priority: int
    confidence: float
    source: str

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        ...


class RegexDetector:
    """Detector por patrón de formato + validador algorítmico opcional."""

    def __init__(
        self,
        pii_type: PIIType,
        pattern: re.Pattern[str],
        validator=None,          # callable(str) -> bool, opcional
        priority: int = 5,
        confidence: float = 1.0,
        source: str = "regex",
    ) -> None:
        self._pii_type = pii_type
        self._pattern = pattern
        self._validator = validator
        self.priority = priority
        self.confidence = confidence
        self.source = source

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        out: list[Candidate] = []
        for m in self._pattern.finditer(text):
            value = m.group(0).strip()
            if not value:
                continue
            if self._validator is not None and not self._validator(value):
                continue
            out.append(Candidate(
                start=m.start(), end=m.end(), value=value,
                pii_type=self._pii_type, priority=self.priority,
                confidence=self.confidence, source=self.source,
            ))
        return out


# Palabras que NUNCA deben tratarse como entidad NER (etiquetas de PII
# estructurada y términos de contexto); el modelo sm a veces las etiqueta.
_PROTECTED_WORDS = {
    "DNI", "NIE", "NIF", "CIF", "IBAN", "CCC", "SS", "TARJETA", "CUENTA",
    "EMAIL", "TELÉFONO", "TELEFONO", "BANCO", "BANCARIA", "PAY", "NÚMERO",
    "NUMERO", "DOCUMENTO", "IDENTIFICACIÓN", "IDENTIFICACION", "CLAVE",
}


class SpacyNERDetector:
    """NER local (es_core_news_sm) con SOLO el pipe de NER activo.

    Mapea PER→PERSONA, ORG→ORGANIZACION, LOC/GPE→LOCALIZACION. MISC se omite
    deliberadamente: es demasiado ruidoso y genera falsos positivos (entidades
    ambiguas clasificadas erróneamente como personas). El NER debe ser
    conservador: mejor no detectar una entidad dudosa que clasificarla mal.

    Carga perezosa y cacheada; si el modelo no está disponible, no detecta
    nada (el gateway sigue funcionando con los detectores regex).
    """

    priority = 2
    confidence = 0.6
    source = "ner"

    _LABEL_MAP = {
        "PER": PIIType.PERSONA,
        "PERSON": PIIType.PERSONA,
        # MISC omitido deliberadamente: demasiado agresivo. Puede clasificar
        # como PERSONA entidades que no lo son (proyectos, objetos, conceptos).
        # El NER debe ser conservador: mejor no detectar una entidad dudosa
        # que convertirla erróneamente en persona.
        "ORG": PIIType.ORGANIZACION,
        "LOC": PIIType.LOCALIZACION,
        "GPE": PIIType.LOCALIZACION,
    }

    def detect(self, text: str, context: MaskingContext) -> list[Candidate]:
        nlp = _get_nlp()
        if nlp is None:
            return []
        out: list[Candidate] = []
        doc = nlp(text)
        for ent in doc.ents:
            pii_type = self._LABEL_MAP.get(ent.label_)
            if pii_type is None:
                continue
            # Recortar bordes (determinantes/preposiciones/temporales)
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


def _get_nlp():
    """Carga perezosa de spaCy con únicamente el pipe de NER (ahorra memoria:
    se desactivan parser, tagger, lemmatizer y attribute_ruler)."""
    global _nlp
    if _nlp is not None or not _SPACY_AVAILABLE:
        return _nlp
    with _nlp_lock:
        if _nlp is None:
            try:
                _nlp = spacy.load(
                    _ES_NER_MODEL,
                    disable=["parser", "tagger", "attribute_ruler",
                             "morphologizer", "lemmatizer", "senter"],
                )
            except Exception:  # modelo no descargado / incompatibilidad
                _nlp = None
    return _nlp


# ─────────────────────────────────────────────────────────────────────────────
# Resolución de solapamientos: Prioridad > Confianza > Longitud
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_spans(candidates: Iterable[Candidate]) -> list[Candidate]:
    accepted: list[Candidate] = []
    for c in sorted(
        candidates,
        key=lambda c: (-c.priority, -c.confidence, -(c.end - c.start)),
    ):
        if any(not (c.end <= a.start or c.start >= a.end) for a in accepted):
            continue  # solapa con un candidato ya aceptado
        accepted.append(c)
    return sorted(accepted, key=lambda c: c.start)


# ─────────────────────────────────────────────────────────────────────────────
# Detectores registrados (orden no relevante: resuelve el resolver)
# ─────────────────────────────────────────────────────────────────────────────

_DETECTORS: tuple[Detector, ...] = (
    RegexDetector(PIIType.TARJETA, _CARD_RE, _is_luhn_valid, priority=9),
    RegexDetector(PIIType.CUENTA, _IBAN_RE, _is_valid_iban, priority=8),
    RegexDetector(PIIType.CUENTA, _CCC_RE, None, priority=8),
    RegexDetector(PIIType.DNI, _DNI_RE, _is_valid_dni, priority=7),
    RegexDetector(PIIType.NIE, _NIE_RE, _is_valid_dni, priority=7),
    RegexDetector(PIIType.NIF, _NIF_RE, None, priority=7),
    RegexDetector(PIIType.SEGSOCIAL, _SS_RE, None, priority=6),
    RegexDetector(PIIType.EMAIL, _EMAIL_RE, None, priority=6),
    RegexDetector(PIIType.TELEFONO, _TEL_RE, _is_valid_phone, priority=5),
    RegexDetector(PIIType.ORGANIZACION, _COMPANY_SUFFIX_RE, None,
                  priority=4, confidence=0.9),
    SpacyNERDetector(),
)


# ─────────────────────────────────────────────────────────────────────────────
# API pública
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Roles que se enmascaran por defecto
# ─────────────────────────────────────────────────────────────────────────────

# Todos estos roles se enmascaran. Un mensaje puede excluirse explícitamente
# con _mask=False, SOLO para mensajes generados por código de confianza del
# servidor (prompts de control, instrucciones estáticas) sin datos del usuario.
#
# NUNCA usar _mask=False en mensajes que puedan contener datos del usuario:
# actuaría como bypass del gateway de privacidad.
_ALWAYS_MASK_ROLES = {"user", "assistant", "tool", "system"}


def mask_sensitive(text: str) -> tuple[str, dict[str, str]]:
    """Enmascara PII de un texto. Devuelve (texto_enmascarado, mapping)."""
    ctx = MaskingContext()
    candidates = [c for d in _DETECTORS for c in d.detect(text or "", ctx)]
    masked = ctx.apply(text or "", candidates)
    return masked, ctx.mapping


def mask_conversation_with_context(
    messages: list[dict],
    context: MaskingContext,
) -> tuple[list[dict], dict[str, str]]:
    """Enmascara una conversación usando un MaskingContext existente (acumulativo).

    Debe llamarse con el historial REAL (agent_messages) antes de cada request
    externa. NUNCA pasar una versión ya enmascarada: el contexto acumula tags
    y las entidades previas mantienen su tag; las nuevas (p. ej. en resultados
    de tool de rondas posteriores) reciben tags nuevos en el mismo contexto.

    Uso correcto en services.py (dentro del while True, antes de cada llamada):

        safe_msgs, _ = mask_conversation_with_context(agent_messages, _priv_ctx)
        model_payload["messages"] = safe_msgs
        # NO: agent_messages = safe_msgs  ← pierde el historial real

    Devuelve (lista_enmascarada, context.mapping). El mapping de retorno es
    una referencia al mismo dict del contexto → fuente única de verdad.
    """
    out: list[dict] = []
    for m in messages or []:
        if not isinstance(m, dict):
            out.append(m)
            continue
        role = m.get("role")
        # _mask=False: excluido explícitamente (solo prompts de control del servidor)
        if m.get("_mask") is False:
            clean = {k: v for k, v in m.items() if k != "_mask"}
            out.append(clean)
            continue
        # Enmascarar si el rol está en la lista o si _mask=True fue forzado
        if role not in _ALWAYS_MASK_ROLES and not m.get("_mask"):
            out.append(m)
            continue
        content = m.get("content")
        if isinstance(content, list):
            masked_content = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text" and "text" in part:
                    text_val = part.get("text") or ""
                    candidates = [c for d in _DETECTORS for c in d.detect(text_val, context)]
                    masked_text = context.apply(text_val, candidates)
                    masked_content.append({**part, "text": masked_text})
                else:
                    masked_content.append(part)
            clean = {k: v for k, v in m.items() if k != "_mask"}
            out.append({**clean, "content": masked_content})
        else:
            content_str = content or ""
            candidates = [c for d in _DETECTORS for c in d.detect(content_str, context)]
            masked = context.apply(content_str, candidates)
            clean = {k: v for k, v in m.items() if k != "_mask"}
            out.append({**clean, "content": masked})
    return out, context.mapping


def mask_conversation(messages: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Enmascara una conversación con un contexto nuevo (wrapper de conveniencia).

    Para flujos multi-turno donde la misma entidad debe recibir el mismo tag
    en rondas sucesivas del agente, usar directamente
    mask_conversation_with_context con un MaskingContext compartido.
    """
    ctx = MaskingContext()
    return mask_conversation_with_context(messages, ctx)


# Tags: 16 hex chars = 64 bits de aleatoriedad (secrets.token_hex(8))
_TAG_RE = re.compile(r"<PII:([a-z_]+):([0-9a-f]{16})>")


def unmask(text: str, mapping: dict[str, str]) -> str:
    """Frontera segura: restaura SOLO tags generados por este módulo y
    presentes en el mapping autorizado del contexto. Tags de otros contextos
    o tags falsos se dejan intactos."""
    if not text or not mapping:
        return text

    def _replace(m: re.Match[str]) -> str:
        return mapping.get(m.group(0), m.group(0))

    return _TAG_RE.sub(_replace, text)


# ─────────────────────────────────────────────────────────────────────────────
# Verificación (python -m modules.api.ai.privacy)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    demo = "mi IBAN es ES9121000418450200051332 y DNI 12345678Z"
    masked, mapping = mask_sensitive(demo)
    print("ENTRADA :", demo)
    print("MASCARA :", masked)
    print("MAPPING :", mapping)

    assert "ES9121000418450200051332" not in masked, "IBAN debe estar enmascarado"
    assert "12345678Z" not in masked, "DNI debe estar enmascarado"
    assert unmask(masked, mapping) == demo, "roundtrip"

    # Test NER (solo si spaCy está disponible)
    if _SPACY_AVAILABLE and _get_nlp() is not None:
        demo_ner = "Ayer Laura me llamó para una reunión en Gamito S.L."
        masked_ner, mapping_ner = mask_sensitive(demo_ner)
        assert "Laura" not in masked_ner, "Laura debe estar enmascarada (NER)"
        assert "Gamito" not in masked_ner, "Gamito S.L. debe estar enmascarada (NER)"
        print("NER OK: personas y organizaciones enmascaradas")
    else:
        print("spaCy no disponible: tests NER omitidos (solo regex activo)")

    # Deduplicación DENTRO del mismo contexto (multi-turno) — usando IBAN repetido
    ctx = MaskingContext()
    iban = "ES9121000418450200051332"
    msgs = [
        {"role": "user", "content": f"mi cuenta es {iban}"},
        {"role": "tool", "content": f'{{"result": "Cuenta {iban} procesada"}}'},
    ]
    safe, mp = mask_conversation_with_context(msgs, ctx)
    tags_iban = [tag for tag, val in mp.items() if val == iban]
    assert len(tags_iban) == 1, "dedup: IBAN → un único tag dentro del contexto"
    assert tags_iban[0] in safe[0]["content"]
    assert tags_iban[0] in safe[1]["content"]

    # Re-enmascarado: nueva entidad en ronda 2, IBAN original mantiene su tag
    iban2 = "ES7921000813610123456789"
    msgs2 = msgs + [
        {"role": "tool", "content": f'{{"result": "Transferencia a {iban2} confirmada, origen {iban}"}}'},
    ]
    safe2, mp2 = mask_conversation_with_context(msgs2, ctx)
    assert tags_iban[0] in safe2[2]["content"], "IBAN original mantiene su tag en ronda 2"
    tags_iban2 = [tag for tag, val in mp2.items() if val == iban2]
    assert len(tags_iban2) == 1, "IBAN nuevo recibe tag nuevo"
    assert tags_iban2[0] in safe2[2]["content"]

    # Entre contextos distintos los tags son aleatorios (distintos)
    ctx_b = MaskingContext()
    safe_b, mp_b = mask_conversation_with_context(
        [{"role": "user", "content": f"cuenta {iban}"}], ctx_b
    )
    tags_iban_b = [tag for tag, val in mp_b.items() if val == iban]
    assert len(tags_iban_b) == 1
    assert tags_iban[0] != tags_iban_b[0], "tags distintos entre contextos (aleatorios)"

    # unmask seguro: tag de otro contexto no se restaura con el mapping actual
    assert unmask(tags_iban_b[0], mapping) == tags_iban_b[0], \
        "tag de otro contexto no se desenmascara"

    # system se enmascara por defecto
    dni_demo = "00000001R"  # DNI válido para test sin NER
    safe_sys, _ = mask_conversation(
        [{"role": "system", "content": f"El usuario tiene el DNI {dni_demo}"}]
    )
    assert dni_demo not in safe_sys[0]["content"], "system se enmascara por defecto"

    # system con _mask=False no se enmascara (prompt de control del servidor)
    safe_ctrl, _ = mask_conversation(
        [{"role": "system", "_mask": False, "content": "Eres un asistente útil."}]
    )
    assert safe_ctrl[0]["content"] == "Eres un asistente útil.", \
        "_mask=False: prompt de control no enmascarado"

    print("VERIFICACIÓN OK: tags aleatorios, dedup intra-contexto, re-enmascarado "
          "multi-turno, system por defecto, _mask=False, unmask seguro.")

