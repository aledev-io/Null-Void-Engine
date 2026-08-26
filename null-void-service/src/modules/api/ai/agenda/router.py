"""Router, detector de intención y clasificación semántica/ML para el modo agenda."""
import re
import sys
import unicodedata
from datetime import date, timedelta
from pathlib import Path
from typing import Optional, Tuple

try:
    import fasttext
except ImportError:
    fasttext = None

_MODELS_DIR = Path(__file__).parent.parent.parent.parent / "models"
_MODEL_PATH = _MODELS_DIR / "agenda.ftz"
_fasttext_model = None
_fasttext_error = None

_SPACY_NLPS = {"es": None, "en": None}

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

_AGENDA_VERB_STEMS = {
    "cre", "agend", "anot", "apunt", "registr", "añad", "agreg", "borr",
    "elimin", "quit", "complet", "marc", "guard", "pon", "hac", "trabaj",
    "estudi", "prepar", "organiz", "ten", "ca", "celebr", "jug", "qued",
    "cen", "com", "list", "planific", "reserv", "program", "hab", "hay",
    "creat", "mak", "add", "delet", "remov", "complet", "set", "book",
    "studi", "hav", "schedul", "plan", "prepar", "attend", "reserv",
}
_AGENDA_STRONG_VERB_STEMS = {
    "apunt", "anot", "registr", "agend", "añad", "borr", "elimin", "quit",
    "complet", "marc", "creat", "add", "delet", "remov", "set", "book",
    "schedul", "reserv",
}
_AGENDA_NOUN_STEMS = {
    "event", "tare", "cit", "reunion", "agend", "calendari", "recordatori",
    "horari", "examen", "clas", "partid", "conciert", "entrevist", "cen",
    "comid", "quedad", "empres", "junt", "consult", "dentist",
    "medic", "doctor", "puent", "festiv", "vacacion", "finde", "cumpleañ",
    "curso", "plan", "estudi", "qued", "revisi", "exam", "appointment",
    "meeting", "task", "calendar", "reminder", "schedule",
    "holiday", "weekend", "birthday", "study", "class", "match", "concert",
    "interview", "dinner", "company", "semana santa", "fiesta",
}
_TEMPORAL_STEMS = {
    "semana", "mes", "año", "dia", "hoy", "mañana", "manana", "ayer",
    "tarde", "noche", "finde", "proximo", "proxima", "lunes", "martes",
    "miercoles", "jueves", "viernes", "sabado", "domingo",
    "week", "month", "today", "tomorrow", "yesterday", "weekend", "next",
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
    "january", "jan", "february", "feb", "march", "mar", "april", "apr",
    "may", "june", "jun", "july", "jul", "august", "aug", "september",
    "sep", "sept", "october", "oct", "november", "nov", "december", "dec",
}

_INTERROG_RE = re.compile(
    r"¿|\b(qu[eé]|cu[áa]ndo|cu[áa]nto|cu[áa]ntos|qui[eén]|d[oó]nde|hay|what|when|how many|who|where)\b|\?\s*$",
    re.IGNORECASE,
)

_EN_WORDS_RE = re.compile(
    r"\b(the|is|are|was|were|in|on|at|for|with|about|what|when|where|how|why|who|please|"
    r"can|could|would|should|do|does|did|will|i|you|my|your|have|has|had|create|add|delete|"
    r"remove|schedule|calendar|task|event|explain|tell|give|tomorrow|today|yesterday|week|month)\b",
    re.IGNORECASE,
)
_ES_WORDS_RE = re.compile(
    r"\b(el|la|los|las|un|una|unos|unas|de|del|en|para|por|con|que|qué|cuándo|dónde|cómo|"
    r"quién|puedes|podrías|tengo|tienes|hay|es|son|fue|era|mi|mis|tu|tus|su|sus|crea|crear|"
    r"añade|añadir|apunta|apúntame|borra|elimina|agenda|calendario|tarea|evento|cita|reunión|"
    r"hoy|mañana|ayer|semana|mes|explica|dime|cuenta|cuéntame)\b",
    re.IGNORECASE,
)


def detect_lang(text: str) -> str:
    """Detecta el idioma del texto (es / en) comparando densidad léxica."""
    src = text or ""
    en_matches = len(_EN_WORDS_RE.findall(src))
    es_matches = len(_ES_WORDS_RE.findall(src))
    if en_matches > es_matches:
        return "en"
    return "es"


def _normalize(text: str) -> str:
    """Normaliza texto (sin acentos, minúsculas, espacios colapsados)."""
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", t.lower()).strip()


# ─── FastText Classifier ──────────────────────────────────────────────────────

def get_fasttext_model():
    """Carga perezosa del modelo FastText."""
    global _fasttext_model, _fasttext_error
    if fasttext is None:
        return None
    if _fasttext_model is not None:
        return _fasttext_model
    if _fasttext_error is not None or not _MODEL_PATH.exists():
        return None
    try:
        _fasttext_model = fasttext.load_model(str(_MODEL_PATH))
        return _fasttext_model
    except Exception as e:
        _fasttext_error = str(e)
        return None


def is_agenda_request_fasttext(text: str, threshold: float = 0.65) -> Tuple[bool, float, str]:
    """Predice si es agenda usando el clasificador FastText."""
    if not text or not text.strip():
        return False, 0.0, "empty"
    model = get_fasttext_model()
    if model is None:
        return False, 0.0, "model_unavailable"
    try:
        predictions = model.predict(text, k=1)
        if not predictions or not predictions[0]:
            return False, 0.0, "error"
        label = predictions[0][0]
        confidence = float(predictions[1][0])
        is_agenda = label == "__label__agenda"
        if is_agenda:
            return True, confidence, "model_confident" if confidence >= threshold else "model_probable"
        return False, 1.0 - confidence, "model_other"
    except Exception:
        return False, 0.0, "error"


def train_classifier(training_file: str) -> bool:
    """Entrena el clasificador FastText."""
    if fasttext is None:
        print("❌ fasttext no está instalado")
        return False
    if not Path(training_file).exists():
        raise FileNotFoundError(f"Archivo no encontrado: {training_file}")
    try:
        model = fasttext.train_supervised(
            input=training_file, epoch=25, lr=1.0, wordNgrams=2, dim=100,
            loss="softmax", minn=3, maxn=6, verbose=2,
        )
        _MODELS_DIR.mkdir(parents=True, exist_ok=True)
        model.save_model(str(_MODEL_PATH))
        return True
    except Exception as e:
        print(f"❌ Error al entrenar: {e}")
        return False


# ─── spaCy NLP & Semantic Scoring ─────────────────────────────────────────────

def _get_spacy_nlp(lang: str):
    global _SPACY_NLPS
    lang = "en" if lang == "en" else "es"
    if _SPACY_NLPS.get(lang) is not None:
        return _SPACY_NLPS[lang] or None
    try:
        import spacy
        model = "en_core_web_sm" if lang == "en" else "es_core_news_sm"
        _SPACY_NLPS[lang] = spacy.load(model, disable=["ner", "textcat"])
    except Exception:
        _SPACY_NLPS[lang] = False
    return _SPACY_NLPS[lang] or None


def _stem_matches(word: str, stems: set) -> bool:
    w = _normalize(word)
    if not w:
        return False
    candidates = {w}
    w2 = re.sub(r"(me|te|se|le|lo|la|os|les|los|las|nos)$", "", w)
    if w2 != w:
        candidates.add(w2)
    for c in list(candidates):
        if len(c) > 3 and c[-1] in "aeios":
            candidates.add(c[:-1])
    if len(w) <= 2:
        return bool(candidates & stems)
    for c in candidates:
        if any(c.startswith(s) for s in stems if s):
            return True
    return False


def _agenda_intent_nlp(src: str) -> Optional[bool]:
    """Detección de intención usando dependency parsing con spaCy."""
    lang = detect_lang(src)
    nlp = _get_spacy_nlp(lang)
    if nlp is None:
        return None
    doc = nlp(src)
    root = next((t for t in doc if t.dep_ == "ROOT"), None)
    negated = bool(
        root is not None
        and any(
            (c.dep_ == "neg" or (c.dep_ == "advmod" and c.text.lower() in ("no", "not", "nunca", "jamas", "jamás")))
            for c in root.children
        )
    )
    if negated:
        return False

    v_words = [t.text for t in doc if t.pos_ in ("VERB", "AUX")]
    n_words = [t.text for t in doc if t.pos_ in ("NOUN", "PROPN")]
    temp_words = [t.text for t in doc if t.pos_ in ("NOUN", "PROPN", "ADV", "NUM", "ADJ")]

    # 1. Verbo fuerte en ROOT
    if root is not None and _stem_matches(root.text, _AGENDA_STRONG_VERB_STEMS):
        return True

    # 2. Sustantivo de agenda + verbo de agenda
    has_agenda_noun = any(_stem_matches(w, _AGENDA_NOUN_STEMS) for w in n_words)
    has_agenda_verb = any(_stem_matches(w, _AGENDA_VERB_STEMS) for w in v_words)
    if has_agenda_noun and has_agenda_verb:
        return True

    # 3. Pregunta con sustantivo de agenda o término temporal
    if _INTERROG_RE.search(src):
        if has_agenda_noun:
            return True
        if any(_stem_matches(t, _TEMPORAL_STEMS) for t in temp_words) and has_agenda_verb:
            return True

    return False


def _score_agenda(text: str) -> int:
    """Scoring semántico de fallback (ES / EN)."""
    score = 0
    text_norm = _normalize(text or "")
    
    strong = len(re.findall(
        r"\b(apunt\w*|anot\w*|registr\w*|agend\w*|crea\w*|borr\w*|elimin\w*|quit\w*|complet\w*|marc\w*|"
        r"creat\w*|add\w*|delet\w*|remov\w*|schedul\w*|book\w*|set\s+up)\b", text_norm
    ))
    score += 30 * strong
    
    nouns = len(re.findall(
        r"\b(event\w*|tare\w*|cit\w*|reuni\w*|calendari\w*|agend\w*|recordatori\w*|examen\w*|trabaj\w*|empres\w*|"
        r"festiv\w*|vacaci\w*|puent\w*|finde|semana santa|partid\w*|fiest\w*|"
        r"task\w*|appointment\w*|meeting\w*|calendar\w*|reminder\w*|exam\w*|study|holiday\w*|match\w*)\b",
        text_norm
    ))
    score += 20 * nouns
    
    if re.search(r"\b(que|cuando|hay|tengo|what|when|do i have|on my)\b", text_norm):
        score += 15
    
    temporal = len(re.findall(
        r"\b(hoy|manana|semana\w*|lunes|martes|miercoles|jueves|viernes|sabado|domingo|"
        r"today|tomorrow|week\w*|weekend\w*|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        text_norm
    ))
    score += min(temporal * 8, 24)
    return min(score, 100)


def is_agenda_request(text: str) -> bool:
    """Pipeline principal de clasificación de intención de agenda."""
    src = (text or "").strip()
    if not src:
        return False
    
    # 1. Negación explícita rápida
    if re.search(
        r"(?:no\s+(?:quiero|necesito|me pidas|dame|mandes)\s+(?:tareas|eventos|citas|agenda))|"
        r"(?:don'?t\s+(?:want|need|add)\s+(?:tasks?|events?|appointments?|calendar|agenda))",
        src, re.IGNORECASE
    ):
        return False
    
    # 2. Modelo ML FastText si está entrenado
    try:
        is_ag, confidence, reason = is_agenda_request_fasttext(src)
        if reason in ("model_confident", "model_probable"):
            if confidence >= 0.65:
                return is_ag
            if confidence >= 0.35:
                return _score_agenda(src) >= 40
    except Exception:
        pass
    
    # 3. Fallback spaCy NLP
    nlp_res = _agenda_intent_nlp(src)
    if nlp_res is not None:
        return nlp_res
    
    # 4. Fallback semántico
    return _score_agenda(src) >= 40


# ─── Context Extraction Helpers ───────────────────────────────────────────────

def detect_read_period(text: str) -> Optional[str]:
    """Periodo de lectura sugerido por la consulta."""
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
    
    _month_names = {**_MESES, **_EN_MONTHS}
    for _name, _num in _month_names.items():
        if re.search(rf"\b{_name}\b", src, re.IGNORECASE):
            return f"month_{_num}"
    if re.search(r"esta\s+semana|this\s+week|ayer|yesterday|esta\s+mañana|this\s+morning", src, re.IGNORECASE):
        return "this_week"
    if re.search(r"todo|historial|all|history", src, re.IGNORECASE):
        return "all"
    return None


def resolve_target_day(text: str) -> Optional[Tuple[str, str, str]]:
    """Resuelve un día específico mencionado en la consulta ('mañana', 'el martes', etc.)."""
    from .tools import resolve_date_from_text
    src = text or ""
    today = date.today()
    day = resolve_date_from_text(src, today=today)
    if not day:
        return None
    
    if day == (today + timedelta(days=1)).isoformat():
        return day, "mañana", "tomorrow"
    if day == today.isoformat():
        return day, "hoy", "today"
    if day == (today + timedelta(days=2)).isoformat():
        return day, "pasado mañana", "the day after tomorrow"
    
    d_obj = date.fromisoformat(day)
    names_es = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    names_en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    wd = d_obj.weekday()
    return day, f"el {names_es[wd]}", f"on {names_en[wd]}"


def has_events_for_scope(events: list, text: str) -> bool:
    """Comprueba si existen eventos en el día o ámbito de la consulta."""
    if not events:
        return False
    from .tools import resolve_date_from_text
    target = resolve_date_from_text(text, today=date.today())
    if target:
        return any((e.get("date") or "") == target for e in events)
    return True


def extract_company(text: str) -> Optional[str]:
    """Extrae el nombre de la empresa mencionada en la consulta."""
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


def extract_holiday_query(text: str) -> str:
    """Texto a buscar en la agenda para consultas de festivos/puentes/vacaciones."""
    src = text or ""
    m = re.search(r"\b(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)(?:\s+de\s+\d{2,4})?", src, re.IGNORECASE)
    if m and m.group(2).lower() in _MESES:
        return f"{m.group(1)} de {m.group(2)}"
    m = re.search(r"(?:cu[áa]ndo|qu[eé]\s+d[ií]a)\s+(?:cae|es)\s+(.*?)(?:\s*\?|$)", src, re.IGNORECASE)
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


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "train":
        f = sys.argv[2] if len(sys.argv) > 2 else "data/agenda_training.txt"
        success = train_classifier(f)
        sys.exit(0 if success else 1)
