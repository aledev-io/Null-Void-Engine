import json
from datetime import datetime
from core.database import get_db, row_to_dict

def now_iso():
    return datetime.now().isoformat()

def _validate_event(data):
    if not data.get('title') or not data.get('date'):
        return None, "Faltan campos obligatorios (title, date)"
    return data, None

def get_user_events(uid):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE user_id = ? ORDER BY date ASC, start_time ASC", 
            (uid,)
        ).fetchall()
        return [row_to_dict(r) for r in rows]

def create_user_event(uid, data):
    data, err = _validate_event(data)
    if err:
        raise ValueError(err)

    event_id   = data.get('id') or f"ev_{int(datetime.now().timestamp()*1000)}"
    created_at = data.get('createdAt') or now_iso()
    guests_str = data.get('guests') if isinstance(data.get('guests'), str) else json.dumps(data.get('guests', []))

    with get_db() as conn:
        conn.execute("""
            INSERT INTO events 
            (id, user_id, title, date, start_time, end_time, all_day, category, description, completed, created_at, updated_at, is_important, type, location, guests)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event_id,
            uid,
            data['title'].strip(),
            data['date'],
            data.get('startTime') or data.get('start_time'),
            data.get('endTime') or data.get('end_time'),
            1 if (data.get('allDay') or data.get('all_day')) else 0,
            data.get('category', 'trabajo'),
            data.get('description'),
            1 if data.get('completed') else 0,
            created_at,
            None,
            1 if data.get('isImportant') else 0,
            data.get('type', 'event'),
            data.get('location', ''),
            guests_str
        ))
        conn.commit()
    return event_id

def update_user_event(uid, event_id, data):
    guests_str = data.get('guests') if isinstance(data.get('guests'), str) else json.dumps(data.get('guests', []))
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM events WHERE id = ? AND user_id = ?", (event_id, uid)).fetchone()
        if not existing:
            raise KeyError('Evento no encontrado')

        conn.execute("""
            UPDATE events SET
                title = ?, date = ?, start_time = ?, end_time = ?, all_day = ?, 
                category = ?, description = ?, completed = ?, updated_at = ?, is_important = ?, type = ?, location = ?, guests = ?
            WHERE id = ? AND user_id = ?
        """, (
            data.get('title', '').strip(),
            data.get('date'),
            data.get('startTime') or data.get('start_time'),
            data.get('endTime') or data.get('end_time'),
            1 if (data.get('allDay') or data.get('all_day')) else 0,
            data.get('category', 'trabajo'),
            data.get('description'),
            1 if data.get('completed') else 0,
            now_iso(),
            1 if data.get('isImportant') else 0,
            data.get('type', 'event'),
            data.get('location', ''),
            guests_str,
            event_id,
            uid
        ))
        conn.commit()

def delete_user_event(uid, event_id):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM events WHERE id = ? AND user_id = ?", (event_id, uid))
        conn.commit()
        return cur.rowcount

def link_series(uid, event_id, series):
    if series:
        series_id = series["series_id"]
    else:
        series_id = event_id
    with get_db() as conn:
        conn.execute(
            "UPDATE events SET series_id = ? WHERE id = ? AND user_id = ?",
            (series_id, event_id, uid),
        )
        conn.commit()

def series_count(uid, series_id):
    if not series_id:
        return 1
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND series_id = ?",
            (uid, series_id),
        ).fetchone()
        return int(row["n"]) if row else 1
