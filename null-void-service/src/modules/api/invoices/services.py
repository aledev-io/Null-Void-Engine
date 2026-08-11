import os
import shutil
import uuid
from datetime import datetime
from core.database import get_db
from modules.api.cloud import get_view_root
from .parsers import parse_pdf, parse_pdf_date

MONTHS_ES = (
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
)


def get_invoice_folder(business_root: str, date_str: str | None) -> str | None:
    """Devuelve la carpeta destino 'YYYY/MM-MES' para una factura según su
    fecha (DD-MM-YYYY normalizada a YYYY-MM-DD). None si no hay fecha válida."""
    if not date_str:
        return None
    parts = date_str.split('-')
    if len(parts) < 2 or not (parts[0].isdigit() and parts[1].isdigit()):
        return None
    year, month = parts[0], int(parts[1])
    if not (1 <= month <= 12):
        return None
    return os.path.join(business_root, year, f"{month:02d}-{MONTHS_ES[month - 1]}")


def _unique_dest(dest: str) -> str:
    if not os.path.exists(dest):
        return dest
    parent = os.path.dirname(dest)
    stem, ext = os.path.splitext(os.path.basename(dest))
    n = 1
    while True:
        candidate = os.path.join(parent, f"{stem}({n}){ext}")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def organize_invoice_file(business_root: str, file_path: str, date_str: str | None) -> str:
    """Mueve el PDF a su carpeta 'YYYY/MM-MES' bajo la raíz de facturación.
    Devuelve la ruta relativa final (o el nombre si no hay carpeta que asignar)."""
    folder = get_invoice_folder(business_root, date_str)
    if not folder or os.path.normpath(os.path.dirname(file_path)) == os.path.normpath(folder):
        return os.path.basename(file_path)

    os.makedirs(folder, exist_ok=True)
    dest = _unique_dest(os.path.join(folder, os.path.basename(file_path)))
    shutil.move(file_path, dest)
    return os.path.relpath(dest, business_root)


def organize_uploaded_pdf(file_path: str, business_root: str) -> str | None:
    """Hook para subidas del cloud: clasifica el PDF recién subido según su
    fecha y lo mueve a 'YYYY/MM-MES'. Devuelve la ruta relativa final o None."""
    try:
        date_str = parse_pdf_date(file_path)
    except Exception as e:
        print(f"Error parseando fecha de factura: {e}")
        return None
    return organize_invoice_file(business_root, file_path, date_str)


def get_invoices(uid: str, token: str = None) -> list[dict]:
    if token:
        try:
            business_root = get_view_root('business', token)
            if business_root and os.path.exists(business_root):
                cloud_files = []
                for dirpath, _, filenames in os.walk(business_root):
                    for fn in filenames:
                        if fn.lower().endswith('.pdf'):
                            cloud_files.append(os.path.relpath(os.path.join(dirpath, fn), business_root))
                cloud_files_set = set(cloud_files)

                with get_db() as conn:
                    # 1. Añadir nuevas facturas (Cloud -> DB). Una única consulta
                    # para conocer las ya registradas y un INSERT OR IGNORE
                    # respaldado por uq_invoices_ref(user_id, reference): ni
                    # N+1 por PDF ni duplicados.
                    existing_refs = {
                        r['reference']
                        for r in conn.execute(
                            "SELECT reference FROM invoices WHERE user_id = ? AND reference IS NOT NULL AND reference != ''",
                            (uid,)
                        ).fetchall()
                    }
                    new_rows = []
                    for rel in cloud_files:
                        if rel in existing_refs:
                            continue
                        file_path = os.path.join(business_root, rel)
                        filename = os.path.basename(rel)
                        parsed = parse_pdf(file_path)
                        fallback_client = os.path.splitext(filename)[0].replace('_', ' ').title()
                        client = parsed["client"] or fallback_client
                        new_rows.append((
                            uid, parsed["invoice_number"], parsed["date"], client,
                            rel, parsed["total"], 'no_pagada', parsed["raw_text"],
                            datetime.now().isoformat()
                        ))

                    conn.executemany("""
                        INSERT OR IGNORE INTO invoices (user_id, invoice_number, date, client, reference, total, status, raw_text, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, new_rows)

                    # 2. Eliminar facturas huérfanas (Cloud Eliminado -> DB Eliminado)
                    db_refs = conn.execute("SELECT id, reference FROM invoices WHERE user_id = ?", (uid,)).fetchall()
                    for row in db_refs:
                        ref = row['reference']
                        if ref and ref not in cloud_files_set:
                            conn.execute("DELETE FROM invoices WHERE id = ?", (row['id'],))

                    conn.commit()
        except Exception as e:
            print(f"Error sincronizando facturas: {e}")

    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM invoices WHERE user_id = ? ORDER BY date DESC",
            (uid,)
        ).fetchall()
        return [dict(r) for r in rows]


def create_invoice(uid: str, data: dict) -> None:
    with get_db() as conn:
        conn.execute("""
            INSERT INTO invoices (user_id, invoice_number, date, client, total, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            uid,
            data.get('invoice_number'),
            data.get('date'),
            data.get('client'),
            data.get('total'),
            data.get('status', 'no_pagada'),
            datetime.now().isoformat()
        ))
        conn.commit()


def process_upload(uid: str, file_storage, token: str) -> None:
    filename = file_storage.filename

    if not filename.lower().endswith('.pdf'):
        raise ValueError("Solo se permiten archivos PDF")

    business_root = get_view_root('business', token)
    if not business_root:
        raise ValueError("No se pudo acceder al almacenamiento cloud")

    safe_name = f"{uuid.uuid4().hex[:12]}_{filename}"
    file_path = os.path.join(business_root, safe_name)
    file_storage.save(file_path)

    parsed = parse_pdf(file_path)
    fallback_client = os.path.splitext(filename)[0].replace('_', ' ').title()
    client = parsed["client"] or fallback_client
    inv_num = parsed["invoice_number"]
    date = parsed["date"]
    total = parsed["total"]
    raw_text = parsed["raw_text"]

    reference = organize_invoice_file(business_root, file_path, date)

    with get_db() as conn:
        conn.execute("""
            INSERT INTO invoices (user_id, invoice_number, date, client, reference, total, status, raw_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            uid, inv_num, date, client, reference, total, 'no_pagada', raw_text,
            datetime.now().isoformat()
        ))
        conn.commit()


def delete_invoices(uid: str, ids: list[int], token: str = None) -> None:
    if not ids:
        return
    with get_db() as conn:
        placeholders = ', '.join(['?'] * len(ids))
        
        # Obtener nombres de archivo antes de borrarlos
        rows = conn.execute(
            f"SELECT reference FROM invoices WHERE user_id = ? AND id IN ({placeholders})",
            [uid] + ids
        ).fetchall()
        
        conn.execute(
            f"DELETE FROM invoices WHERE user_id = ? AND id IN ({placeholders})",
            [uid] + ids
        )
        conn.commit()
        
        # Borrar del cloud
        if token:
            try:
                business_root = get_view_root('business', token)
                if business_root:
                    for row in rows:
                        ref = row['reference']
                        if ref:
                            file_path = os.path.join(business_root, ref)
                            if os.path.exists(file_path):
                                os.remove(file_path)
            except Exception as e:
                print(f"Error borrando archivo de factura del cloud: {e}")


def update_status(uid: str, inv_id: int, new_status: str) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE invoices SET status = ? WHERE id = ? AND user_id = ?",
            (new_status, inv_id, uid)
        )
        conn.commit()
