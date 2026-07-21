import os
import uuid
from datetime import datetime
from core.database import get_db
from modules.api.cloud import get_view_root
from .parsers import parse_pdf


def get_invoices(uid: str, token: str = None) -> list[dict]:
    if token:
        try:
            business_root = get_view_root('business', token)
            if business_root and os.path.exists(business_root):
                cloud_files = [f for f in os.listdir(business_root) if f.lower().endswith('.pdf')]
                cloud_files_set = set(cloud_files)

                with get_db() as conn:
                    # 1. Añadir nuevas facturas (Cloud -> DB)
                    for filename in cloud_files:
                        file_path = os.path.join(business_root, filename)
                        existing = conn.execute(
                            "SELECT id FROM invoices WHERE user_id = ? AND reference = ?",
                            (uid, filename)
                        ).fetchone()
                        
                        if not existing:
                            parsed = parse_pdf(file_path)
                            fallback_client = os.path.splitext(filename)[0].replace('_', ' ').title()
                            client = parsed["client"] or fallback_client
                            inv_num = parsed["invoice_number"]
                            date = parsed["date"]
                            total = parsed["total"]
                            raw_text = parsed["raw_text"]
                            
                            conn.execute("""
                                INSERT INTO invoices (user_id, invoice_number, date, client, reference, total, status, raw_text, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (
                                uid, inv_num, date, client, filename, total, 'no_pagada', raw_text,
                                datetime.now().isoformat()
                            ))
                    
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

    with get_db() as conn:
        conn.execute("""
            INSERT INTO invoices (user_id, invoice_number, date, client, reference, total, status, raw_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            uid, inv_num, date, client, safe_name, total, 'no_pagada', raw_text,
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
