import os
import re
import subprocess
from datetime import datetime


def parse_pdf(file_path: str) -> dict:
    try:
        result = subprocess.run(
            ['pdftotext', '-layout', file_path, '-'],
            capture_output=True, text=True, check=True
        )
        text = result.stdout
    except Exception as e:
        print(f"Error procesando PDF con pdftotext: {e}")
        text = ""
    return parse_text(text)


def parse_text(text: str) -> dict:
    return {
        "raw_text": text,
        "invoice_number": _extract_invoice_number(text),
        "date": _extract_date(text),
        "total": _extract_total(text),
        "client": _extract_client(text),
        "client_cif": _extract_client_cif(text),
        "provider": _extract_provider(text),
        "provider_cif": _extract_provider_cif(text),
        "iban": _extract_iban(text),
        "payment_due": _extract_payment_due(text),
        "items": _extract_items(text),
    }


def _extract_invoice_number(text: str) -> str:
    m = re.search(r'Nº\s*Factura.*?\n\s*([A-Za-z0-9/.-]+)', text)
    if not m:
        m = re.search(r'(?:Nº|Número|Num)\s*(?:Factura|Facturae?)\s*:?\s*([A-Za-z0-9/.-]+)', text)
    if not m:
        m = re.search(r'Factura\s*Nº?\s*:?\s*([A-Za-z0-9/.-]+)', text)
    if not m:
        m = re.search(r'Factura\s*(?:nº|num\.?|#)\s*:?\s*([A-Za-z0-9/.-]+)', text, re.IGNORECASE)
    return m.group(1).strip() if m else "S/N"


def _extract_date(text: str) -> str:
    m = re.search(r'Nº\s*Factura.*?\n\s*[A-Za-z0-9/.-]+\s+([0-9]{2}/[0-9]{2}/[0-9]{4})', text)
    if not m:
        m = re.search(r'Fecha\s+Valor.*?\n\s*[A-Za-z0-9/.-]+\s+([0-9]{2}/[0-9]{2}/[0-9]{4})', text)
    if not m:
        m = re.search(r'Fecha\s*(?:Factura)?\s*:?\s*([0-9]{2}/[0-9]{2}/[0-9]{4})', text)
    if not m:
        m = re.search(r'(?:Emisión|Emitida|Fecha)\s*:?\s*([0-9]{2}/[0-9]{2}/[0-9]{4})', text)
    if not m:
        m = re.search(r'\b([0-9]{2})/([0-9]{2})/([0-9]{4})\b', text)
    if m:
        d = m.group(1)
        if '/' in d:
            parts = d.split('/')
        else:
            parts = m.groups()
        if len(parts) == 3:
            return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return datetime.now().strftime("%Y-%m-%d")


def _extract_total(text: str) -> float:
    m = re.search(r'TOTAL\s+FACTURA.*?\n\s*([0-9.,]+)\s*€?', text)
    if not m:
        m = re.search(r'TOTAL\s+FACTURA.*?([0-9.,]+)\s*€?', text)
    if not m:
        m = re.search(r'TOTAL\b.*?([0-9.,]+)\s*€', text)
    if not m:
        m = re.search(r'(?:Total|TOTAL)\s*(?:Facturae?)?\s*:?\s*([0-9.,]+)\s*€?', text)
    if not m:
        m = re.search(r'Importe\s+Total\s*:?\s*([0-9.,]+)', text)
    if m:
        t_str = m.group(1).replace('.', '').replace(',', '.')
        try:
            return float(t_str)
        except ValueError:
            pass
    return 0.0


_KNOWN_LOCATIONS = (
    "MADRID", "BARCELONA", "VALENCIA", "SEVILLA", "ZARAGOZA", "MÁLAGA",
    "MURCIA", "PALMA", "BILBAO", "ALICANTE", "CÓRDOBA", "VALLADOLID",
    "VIGO", "GIJÓN", "GRANADA", "TENERIFE", "SANTANDER", "LA CORUÑA",
    "PAMPLONA", "SAN SEBASTIÁN", "ALMERÍA", "HUELVA", "BADAJOZ",
    "TARRAGONA", "LLEIDA", "GERONA", "JAÉN", "OURENSE", "LUGO",
    "PONTEVEDRA", "LEÓN", "SALAMANCA", "BURGOS", "HUESCA", "TERUEL",
    "CUENCA", "CIUDAD REAL", "TOLEDO", "GUADALAJARA", "ALBACETE",
    "CÁCERES", "LOGROÑO", "SORIA", "SEGOVIA", "ÁVILA", "ZAMORA",
    "PALENCIA", "CEUTA", "MELILLA",
)


def _is_postcode_line(line):
    left = line.strip().split()[0] if line.strip() else ""
    return left.isdigit() and len(left) == 5


def _extract_client(text: str) -> str:
    lines = text.split('\n')
    for line in lines:
        if any(kw in line for kw in ("Nº Factura", "Cantidad", "Código", "TOTAL",
                                     "FACTURA", "Página", "Documento")):
            continue
        if _is_postcode_line(line):
            continue
        cols = re.split(r'\s{4,}', line.rstrip())
        if len(cols) >= 2:
            right = cols[-1].strip()
            if (re.search(r'[A-ZÁÉÍÓÚÑ]', right)
                and len(right) > 5
                and sum(1 for c in right if c == ' ') >= 1
                and not any(kw in right for kw in _EXCLUDE_CLIENT)
                and right.upper() not in _KNOWN_LOCATIONS):
                return right

    m = re.search(r'(?:CLIENTE|RECEPTOR|Cliente|Receptor)\s*:\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?:\n|\s{2,})', text)
    if m:
        return m.group(1).strip()

    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    for i, p in enumerate(paragraphs):
        if "Nº Factura" in p or "Factura" in p:
            for j in range(0, i):
                block = paragraphs[j]
                plines = [l.strip() for l in block.split('\n') if l.strip()]
                for pl in plines:
                    if _is_postcode_line(pl):
                        continue
                    cols = re.split(r'\s{4,}', pl)
                    candidate = cols[-1].strip() if len(cols) > 1 else pl
                    if (len(candidate) > 4
                        and not any(kw in candidate for kw in _EXCLUDE_CLIENT)
                        and not re.search(r'\d{5,}', candidate)
                        and candidate.upper() not in _KNOWN_LOCATIONS
                        and re.search(r'[A-ZÁÉÍÓÚÑ]', candidate)):
                        return candidate
            break
    return ""


_EXCLUDE_CLIENT = (
    "@", "C.I.F", "CIF", "NIF", "Tel",
    "Referencia", "Nº Factura", "Cantidad", "Código", "Artículo",
    "Precio", "Descripción", "TOTAL", "Subtotal", "Página",
    "Documento", "Vencimientos", "Descuento", "Dto", "IVA",
    "Base", "Importe", "FACTURA", "INSTALACIONES", "IBAN",
    "ES", "SWIFT", "BIC", "Forma", "pago",
)


def _extract_client_cif(text: str) -> str:
    m = re.search(r'(?:C\.I\.F\.?|CIF|NIF|N\.I\.F\.?)\s*:?\s*([A-Za-z0-9]{7,10})', text)
    if m:
        return m.group(1).strip()
    return ""


def _extract_provider(text: str) -> str:
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    for p in paragraphs:
        if len(p) < 8:
            continue
        if "Nº Factura" in p or "TOTAL" in p or "Página" in p:
            break
        if p.strip().upper() in ("FACTURA", "FACTURA ", " FACTURA"):
            continue
        lines = [l.strip() for l in p.split('\n') if l.strip()]
        for line in lines:
            if _is_postcode_line(line):
                continue
            left = re.sub(r'\s{4,}.*', '', line).strip()
            if (re.search(r'[A-ZÁÉÍÓÚÑ]', left)
                and len(left) > 5
                and left.upper() not in _KNOWN_LOCATIONS
                and not any(kw in left for kw in ("@", "C.I.F", "CIF", "Tel", "MADRID", "BARCELONA", "E-mail"))):
                return left
    return ""


def _extract_provider_cif(text: str) -> str:
    m = re.search(r'(?:C\.I\.F\.?|CIF|NIF|N\.I\.F\.?)\s*:?\s*([A-Za-z0-9]{7,10})', text)
    return m.group(1).strip() if m else ""


def _extract_iban(text: str) -> str:
    m = re.search(r'(?:IBAN|iban)\s*:?\s*([A-Z]{2}\d{2}(?:\s*\d{4}){5,})', text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r'([A-Z]{2}\d{2}(?:\s*\d{4}){5,})', text)
    return m.group(1).strip() if m else ""


def _extract_payment_due(text: str) -> str:
    m = re.search(r'Vencimient[oó]\s*:?\s*([0-9]{2}/[0-9]{2}/[0-9]{4})', text)
    if m:
        parts = m.group(1).split('/')
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    m = re.search(r'Vencimient[oó]\s*:?\s*([0-9]{2}-[0-9]{2}-[0-9]{4})', text)
    if m:
        parts = m.group(1).split('-')
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return ""


_TABLE_HEADER_RE = re.compile(
    r'(?:Cantidad|Ctd\.?|Ud\.?|Unidades?)\s+'
    r'(?:Código|Cod\.?|Ref\.?|Referencia)\s+'
    r'(?:Artículo|Art\.?|Concepto|Descripción|Producto)'
)
_TABLE_END_RE = re.compile(r'(?:TOTAL|Total|Importe)\s+(?:FACTURA|Factura|Neto)')
_SUMMARY_RE = re.compile(
    r'(?:Subtotal|Dto\.?|Descuento|Base\s+Imponible|'
    r'Importe\s+IVA|Porcentaje|Total\s+IVA|R\.E\.?\.?)'
)
_PAGE_RE = re.compile(r'Página\s+\d+')
_CITY_RE = re.compile(r'^[A-ZÁÉÍÓÚÑ]{4,}$')
_POSTCODE_RE = re.compile(r'^\d{5}$')


def _extract_items(text: str) -> list[dict]:
    items = []
    lines = text.split('\n')
    in_table = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if _TABLE_HEADER_RE.search(stripped):
            in_table = True
            continue
        if _TABLE_END_RE.search(stripped):
            in_table = False
            continue
        if _PAGE_RE.search(stripped):
            continue
        if not in_table:
            continue
        if _SUMMARY_RE.search(stripped):
            continue

        cols = re.split(r'\s{2,}', stripped)
        if len(cols) < 4:
            continue
        if not re.match(r'^[0-9]', cols[0]):
            continue

        first = cols[0].split()
        if len(first) >= 2:
            qty = _parse_float(first[0])
            code = first[1]
        else:
            qty = _parse_float(first[0])
            code = ""

        qty_int_part = first[0].replace(',', '.').split('.')[0]
        if qty_int_part.isdigit() and len(qty_int_part) == 5:
            continue

        desc = cols[1] if len(cols) > 1 else ""

        if not desc or _CITY_RE.match(desc):
            continue

        unit_price = _parse_float(cols[-3]) if len(cols) >= 4 else 0.0
        subtotal = _parse_float(cols[-1]) if len(cols) >= 2 else 0.0

        numeric_count = sum(1 for v in (qty, unit_price, subtotal) if v > 0)
        if numeric_count < 2:
            continue

        items.append({
            "quantity": qty,
            "code": code,
            "description": desc,
            "unit_price": unit_price,
            "subtotal": subtotal,
        })

    return items


def _parse_float(s: str) -> float:
    s = s.strip().replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return 0.0
