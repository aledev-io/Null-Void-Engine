from flask import Flask, request, jsonify
from services import _scrape_task, _scrape_all_laptops_daily
from scraper_db import get_db_connection, update_user_task_date
import gevent
from gevent.pywsgi import WSGIServer
import datetime
import os

app = Flask(__name__)

import queue
import threading

task_queue = queue.Queue()

def scraper_worker():
    while True:
        task = task_queue.get()
        if task is None:
            break
        func, args, kwargs = task
        
        # Notify start
        try:
            import requests
            requests.post("https://127.0.0.1:5000/api/scraper/webhook/state", json={"is_scraping": True}, timeout=3, verify=False)
        except:
            pass
            
        try:
            func(*args, **kwargs)
        except Exception as e:
            print(f"[Worker] Error ejecutando tarea: {e}")
            
        # Notify finish if empty
        if task_queue.empty():
            try:
                import requests
                requests.post("https://127.0.0.1:5000/api/scraper/webhook/state", json={"is_scraping": False}, timeout=3, verify=False)
            except:
                pass
                
        task_queue.task_done()


def daily_scheduler():
    print("[Scheduler] Planificador diario asíncrono iniciado correctamente.")
    import datetime
    last_daily_routine_date = datetime.datetime.now().strftime('%Y-%m-%d')
    while True:
        now = datetime.datetime.now()
        today_str = now.strftime('%Y-%m-%d')
        target = now.replace(hour=7, minute=0, second=0, microsecond=0)
        
        # Consultar las tareas de todos los usuarios
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM user_scraping_tasks')
        tasks = [dict(r) for r in cursor.fetchall()]
        conn.close()
        
        if now >= target:
            # 1. Rutina global masiva de PcComponentes
            if last_daily_routine_date != today_str:
                print(f"[Scheduler] Lanzando rutina masiva de PcComponentes del {today_str}...")
                from services import _scrape_all_laptops_daily
                task_queue.put((_scrape_all_laptops_daily, (), {'cancellable': False}))
                last_daily_routine_date = today_str

            # Comprobar si hay tareas pendientes hoy
            pending_tasks = [t for t in tasks if t['last_run_date'] != today_str]
            if pending_tasks:
                print(f"[Scheduler] ¡Ejecución pendiente detectada! Ejecutando extracciones personalizadas del {today_str}...")
                for task in pending_tasks:
                    print(f"[Scheduler] Extrayendo para el usuario {task['user_id']} query '{task['query']}'...")
                    try:
                        task_queue.put((_scrape_task, (task['query'],), {'user_id': task['user_id'], 'cancellable': False}))
                        update_user_task_date(task['user_id'], task['query'], today_str)
                    except Exception as e:
                        print(f"[Scheduler] Error en la extracción de '{task['query']}': {e}")
                print(f"[Scheduler] Extracciones personalizadas del {today_str} completadas.")
            
            # Reprogramar para mañana
            target += datetime.timedelta(days=1)
            
        sleep_seconds = (target - now).total_seconds()
        # No inundar la consola si faltan muchas horas
        if sleep_seconds < 60:
            print(f"[Scheduler] Próxima extracción programada para el {target.strftime('%Y-%m-%d %H:%M:%S')} (en {int(sleep_seconds)} s)")
        import time
        time.sleep(min(sleep_seconds, 60))  # Dormir un máximo de 60s para poder reevaluar tareas nuevas

@app.route('/search', methods=['POST'])
def search():
    data = request.get_json(silent=True) or {}
    query = data.get('query', '').strip()
    user_id = data.get('user_id', None)
    if not query:
        return jsonify({"status": "error", "message": "Query vacía"}), 400
    task_queue.put((_scrape_task, (query,), {'user_id': user_id}))
    
    return jsonify({
        "status": "ok", 
        "message": f"Scraping para '{query}' iniciado con éxito en segundo plano."
    })

@app.route('/cancel_routine', methods=['POST'])
def cancel_routine():
    import services
    services.CANCEL_ROUTINE = True
    
    # Conservar solo las tareas no cancelables
    saved_tasks = []
    while not task_queue.empty():
        try:
            t = task_queue.get_nowait()
            kwargs = t[2] if len(t) > 2 else {}
            if not kwargs.get("cancellable", True):
                saved_tasks.append(t)
            task_queue.task_done()
        except queue.Empty:
            break
            
    for t in saved_tasks:
        task_queue.put(t)
        
    return jsonify({"status": "ok", "message": "Se han cancelado las tareas manuales y purgado la cola (las automáticas continúan)."})

@app.route('/scrape_routine', methods=['POST'])
def scrape_routine():
    data = request.get_json(silent=True) or {}
    terms = data.get('terms', [])
    from services import _scrape_pccomp_routine
    task_queue.put((_scrape_pccomp_routine, (terms,), {'cancellable': True}))
    
    return jsonify({
        "status": "ok", 
        "message": "Rutina de PcComponentes iniciada en segundo plano."
    })

@app.route('/scrape_manual', methods=['POST'])
def scrape_manual():
    data = request.get_json(silent=True) or {}
    terms = data.get('terms', [])
    user_id = data.get('user_id', None)
    if not terms:
        return jsonify({"status": "error", "message": "No se proporcionaron términos."}), 400
    from services import _scrape_pccomp_manual
    task_queue.put((_scrape_pccomp_manual, (terms,), {'user_id': user_id, 'cancellable': True}))
    return jsonify({"status": "ok", "message": f"Scrape manual de {len(terms)} término(s) iniciado."})

@app.route('/search_athome', methods=['POST'])
def search_athome_route():
    data = request.get_json(silent=True) or {}
    location = data.get('location', 'Howald').strip()
    min_surface = int(data.get('min_surface', 45))
    user_id = data.get('user_id', None)
    
    from services import _scrape_athome_task
    task_queue.put((_scrape_athome_task, (location, min_surface), {'user_id': user_id}))
    
    return jsonify({
        "status": "ok", 
        "message": f"Scraping de atHome para '{location}' (min {min_surface}m2) iniciado con éxito en segundo plano."
    })

@app.route('/scrape_athome_routine', methods=['POST'])
def scrape_athome_routine():
    from services import _scrape_athome_routine
    task_queue.put((_scrape_athome_routine, (), {'cancellable': True}))
    
    return jsonify({
        "status": "ok", 
        "message": "Rutina de atHome iniciada en segundo plano."
    })
@app.route('/detail', methods=['POST'])
def scrape_detail_route():
    data = request.get_json(silent=True) or {}
    url = data.get('url', '').strip()
    sku = data.get('sku', '').strip()
    if not url:
        return jsonify({"status": "error", "message": "URL vacía"}), 400
        
    from services import _scrape_detail
    from concurrent.futures import ThreadPoolExecutor
    
    # Run sync Playwright in a native OS thread to avoid the gevent asyncio conflict
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_scrape_detail, url, sku)
        result = future.result(timeout=180)
    return jsonify(result)

@app.route('/bot_rules', methods=['GET', 'POST'])
def bot_rules_route():
    import scraper_db
    if request.method == 'GET':
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({"status": "error", "message": "user_id required"}), 400
        rules = scraper_db.get_bot_rules(user_id)
        return jsonify({"status": "ok", "rules": rules})
    
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        user_id = data.get('user_id')
        name = data.get('name')
        if not user_id or not name:
            return jsonify({"status": "error", "message": "user_id and name required"}), 400
        
        max_price = data.get('max_price')
        min_surface = data.get('min_surface')
        max_distance = data.get('max_distance')
        keywords = data.get('keywords', '')
        parking = data.get('parking', '')
        pets = data.get('pets', '')
        availability_date = data.get('availability_date', '')
        
        scraper_db.add_bot_rule(user_id, name, max_price, min_surface, max_distance, keywords, parking, pets, availability_date)
        return jsonify({"status": "ok", "message": "Regla añadida correctamente"})

@app.route('/bot_rules/<int:rule_id>', methods=['DELETE'])
def delete_bot_rule_route(rule_id):
    import scraper_db
    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id')
    if not user_id:
        return jsonify({"status": "error", "message": "user_id required"}), 400
    
    scraper_db.delete_bot_rule(rule_id, user_id)
    return jsonify({"status": "ok", "message": "Regla eliminada"})

@app.route('/bot_rules/<int:rule_id>/toggle', methods=['POST'])
def toggle_bot_rule_route(rule_id):
    import scraper_db
    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id')
    is_active = data.get('is_active', True)
    if not user_id:
        return jsonify({"status": "error", "message": "user_id required"}), 400
    
    scraper_db.toggle_bot_rule(rule_id, user_id, is_active)
    return jsonify({"status": "ok", "message": "Estado de la regla actualizado"})

def athome_scheduler():
    import time
    print("[Scheduler] Planificador de atHome (cada 2h) iniciado.")
    from services import _scrape_athome_routine
    # Dormir 2 horas (7200 segundos) antes de la primera ejecución para no saturar al inicio
    time.sleep(7200)
    while True:
        try:
            print("[Scheduler] Ejecutando rutina automática de atHome (cada 2h)...")
            task_queue.put((_scrape_athome_routine, (), {'cancellable': False}))
        except Exception as e:
            print(f"[Scheduler] Error en la rutina automática de atHome: {e}")
        # Dormir 2 horas (7200 segundos)
        time.sleep(7200)

@app.route('/export_list_pdf', methods=['POST'])
def export_list_pdf_route():
    data     = request.get_json(silent=True) or {}
    products = data.get('products', [])
    target   = data.get('target', 'pccomponentes')

    if not products:
        return jsonify({"status": "error", "message": "Lista vacía"}), 400

    import io, datetime
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import cm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                    Table, TableStyle, HRFlowable)

    buffer  = io.BytesIO()
    PAGE    = landscape(A4)
    doc     = SimpleDocTemplate(buffer, pagesize=PAGE,
                                topMargin=1.5*cm, bottomMargin=1.5*cm,
                                leftMargin=1.5*cm, rightMargin=1.5*cm)
    W, _    = PAGE
    content_w = W - 3*cm

    # ── Estilos ────────────────────────────────────────────────────────────
    s_title = ParagraphStyle('t', fontSize=16, fontName='Helvetica-Bold',
                              textColor=colors.HexColor('#1e293b'))
    s_sub   = ParagraphStyle('s', fontSize=8,  fontName='Helvetica',
                              textColor=colors.HexColor('#64748b'))
    s_cell  = ParagraphStyle('c', fontSize=7.5, fontName='Helvetica',
                              textColor=colors.HexColor('#1e293b'), leading=11)
    s_price = ParagraphStyle('p', fontSize=9,  fontName='Helvetica-Bold',
                              textColor=colors.HexColor('#059669'))
    s_link  = ParagraphStyle('l', fontSize=7,  fontName='Helvetica',
                              textColor=colors.HexColor('#6366f1'))
    s_trend_up   = ParagraphStyle('tu', fontSize=7, fontName='Helvetica-Bold',
                                   textColor=colors.HexColor('#ef4444'))
    s_trend_down = ParagraphStyle('td', fontSize=7, fontName='Helvetica-Bold',
                                   textColor=colors.HexColor('#059669'))

    story = []

    # ── Cabecera del documento ─────────────────────────────────────────────
    now_str = datetime.datetime.now().strftime('%d/%m/%Y %H:%M')
    label   = 'atHome.lu — Apartamentos' if target == 'athome' else 'PcComponentes — Componentes'
    story.append(Paragraph(f'Listado de resultados · {label}', s_title))
    story.append(Spacer(1, 3))
    story.append(Paragraph(
        f'{len(products)} resultado{"s" if len(products) != 1 else ""} exportados · Generado el {now_str}',
        s_sub))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width='100%', thickness=1,
                             color=colors.HexColor('#e2e8f0')))
    story.append(Spacer(1, 10))

    # ── Cabecera de tabla ──────────────────────────────────────────────────
    is_athome = target == 'athome'

    if is_athome:
        headers = ['#', 'Inmueble', 'Agencia', 'Tipo', 'Precio', 'Info', 'Dist.', 'Enlace', 'Mapa']
        col_w   = [
            0.5*cm,           # #
            content_w * 0.28, # título
            content_w * 0.14, # agencia
            content_w * 0.08, # tipo
            content_w * 0.09, # precio
            content_w * 0.07, # m² / habs
            content_w * 0.06, # distancia
            content_w * 0.14, # enlace anuncio
            content_w * 0.14, # enlace mapa
        ]
    else:
        headers = ['#', 'Componente', 'Marca', 'Categoría', 'Precio', 'Stock', 'Valoración', 'Enlace']
        col_w   = [
            0.5*cm,
            content_w * 0.32,
            content_w * 0.12,
            content_w * 0.12,
            content_w * 0.10,
            content_w * 0.09,
            content_w * 0.10,
            content_w * 0.15,
        ]

    header_row = [Paragraph(f'<b>{h}</b>', ParagraphStyle(
        'h', fontSize=7.5, fontName='Helvetica-Bold',
        textColor=colors.white)) for h in headers]

    rows = [header_row]

    for idx, p in enumerate(products, start=1):
        price_str = f"{p['price']:.2f}€"
        trend_par = Paragraph('', s_cell)
        if p.get('prev_price') and p['prev_price'] != p['price']:
            diff_pct = abs((p['price'] - p['prev_price']) / p['prev_price']) * 100
            if p['price'] > p['prev_price']:
                trend_par = Paragraph(f"▲ {diff_pct:.1f}%", s_trend_up)
            else:
                trend_par = Paragraph(f"▼ {diff_pct:.1f}%", s_trend_down)

        price_cell = [Paragraph(price_str, s_price), trend_par]

        url = p.get('url', '')
        link_par = Paragraph(
            f'<link href="{url}" color="#6366f1">{url[:55]}{"…" if len(url) > 55 else ""}</link>',
            s_link) if url else Paragraph('—', s_cell)

        if is_athome:
            city = p.get('availability', '')
            maps_url = (
                f"https://www.google.com/maps/dir/4+Rue+Peternelchen,"
                f"+2370+Howald,+Luxembourg/{city.replace(' ', '+')},+Luxembourg"
            ) if city else ''
            map_par = Paragraph(
                f'<link href="{maps_url}" color="#3b82f6">{city}</link>',
                s_link) if maps_url else Paragraph('—', s_cell)

            dist_str = f"{p['distance']:.1f} km" if p.get('distance') else '—'
            info_str = ''
            if p.get('rating_value') and p['rating_value'] > 0:
                info_str = f"{p['rating_value']:.0f} m²"
            if p.get('rating_count') and p['rating_count'] > 0:
                info_str += f" | {p['rating_count']} hab."

            row = [
                Paragraph(str(idx), s_cell),
                Paragraph(p.get('title', ''), s_cell),
                Paragraph(p.get('brand', ''), s_cell),
                Paragraph(p.get('category', ''), s_cell),
                price_cell,
                Paragraph(info_str, s_cell),
                Paragraph(dist_str, s_cell),
                link_par,
                map_par,
            ]
        else:
            in_stock = 'InStock' in (p.get('availability') or '')
            stock_par = Paragraph(
                '● En stock' if in_stock else '○ Sin stock',
                ParagraphStyle('st', fontSize=7.5, fontName='Helvetica',
                               textColor=colors.HexColor('#059669' if in_stock else '#ef4444')))
            rating_str = (f"★ {p['rating_value']} ({p.get('rating_count', 0)})"
                          if p.get('rating_value') and p['rating_value'] > 0 else '—')
            row = [
                Paragraph(str(idx), s_cell),
                Paragraph(p.get('title', ''), s_cell),
                Paragraph(p.get('brand', ''), s_cell),
                Paragraph(p.get('category', ''), s_cell),
                price_cell,
                stock_par,
                Paragraph(rating_str, s_cell),
                link_par,
            ]

        rows.append(row)

    # ── Construcción de la tabla ───────────────────────────────────────────
    main_table = Table(rows, colWidths=col_w, repeatRows=1)
    row_bg = [colors.HexColor('#f8fafc'), colors.white]

    main_table.setStyle(TableStyle([
        # Cabecera
        ('BACKGROUND',    (0, 0), (-1, 0),  colors.HexColor('#6366f1')),
        ('TEXTCOLOR',     (0, 0), (-1, 0),  colors.white),
        ('FONTNAME',      (0, 0), (-1, 0),  'Helvetica-Bold'),
        # Cuerpo
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), row_bg),
        ('GRID',          (0, 0), (-1, -1), 0.4, colors.HexColor('#e2e8f0')),
        ('TOPPADDING',    (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 6),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 6),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        # Columna # centrada
        ('ALIGN',         (0, 0), (0, -1),  'CENTER'),
    ]))

    story.append(main_table)

    # ── Pie ───────────────────────────────────────────────────────────────
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width='100%', thickness=1,
                             color=colors.HexColor('#e2e8f0')))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f'Scraper Engine · {now_str} · {len(products)} resultados exportados',
        s_sub))

    doc.build(story)
    buffer.seek(0)

    filename = f"listado_{target}_{datetime.date.today().isoformat()}.pdf"
    from flask import send_file
    return send_file(buffer, mimetype='application/pdf',
                     as_attachment=True,
                     download_name=filename)

if __name__ == '__main__':
    print("Iniciando Microservicio Scraper en el puerto 5001...")
    import threading
    threading.Thread(target=scraper_worker, daemon=True).start()
    if os.environ.get("AUTO_SCRAPE_ENABLED", "false").lower() == "true":
        threading.Thread(target=daily_scheduler, daemon=True).start()
        threading.Thread(target=athome_scheduler, daemon=True).start()
    else:
        print("[Scheduler] Scraping automático deshabilitado por defecto. (AUTO_SCRAPE_ENABLED=false)")
    
    http_server = WSGIServer(('0.0.0.0', 5001), app)
    http_server.serve_forever()