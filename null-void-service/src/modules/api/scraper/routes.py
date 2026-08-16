from flask import Blueprint, jsonify, request, render_template, redirect, url_for
from modules.session import session as sess
from config.config import PROJECT_ROOT
from . import services

scraper_bp = Blueprint('scraper', __name__)

def _check_auth():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    if not token:
        return None
    return sess.get_user_id(token)

@scraper_bp.route('/scraper', methods=['GET'])
def scraper_view():
    token = request.cookies.get('token')
    user = sess.get_user(token)
    user_id = sess.get_user_id(token)
    if not token or not user:
        return redirect(url_for('auth.index'))
    user_avatar_url = f"/api/system/user/avatar/{user_id}" if user_id else ""
    return render_template('modules/scraper.html', token=token, user=user, user_avatar_url=user_avatar_url)

import requests
from core.scraper_client import scraper_request

@scraper_bp.route('/api/scraper/pccomponentes/search', methods=['POST'])
def pccomponentes_search():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.get_json(silent=True) or {}
    query = data.get('query', '').strip()
    
    if not query:
        return jsonify(error="La búsqueda no puede estar vacía"), 400
    
    try:
        resp = scraper_request("POST", "/search", json={"query": query, "user_id": user_id}, timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio del scraper: " + str(e)), 500

@scraper_bp.route('/api/scraper/athome/search', methods=['POST'])
def athome_search():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.get_json(silent=True) or {}
    query = data.get('query', '').strip()
    
    if not query:
        return jsonify(error="La búsqueda no puede estar vacía"), 400
        
    try:
        resp = scraper_request("POST", "/search_athome", json={"location": query, "min_surface": 45, "user_id": user_id}, timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio del scraper: " + str(e)), 500

@scraper_bp.route('/api/scraper/athome/routine', methods=['POST'])
def athome_routine():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    try:
        resp = scraper_request("POST", "/scrape_athome_routine", timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio del scraper: " + str(e)), 500



@scraper_bp.route('/api/scraper/pccomponentes/routine', methods=['POST'])
def pccomponentes_routine():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.get_json(silent=True) or {}
    terms = data.get('terms', [])
    
    try:
        resp = scraper_request("POST", "/scrape_routine", json={"terms": terms}, timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio del scraper: " + str(e)), 500

@scraper_bp.route('/api/scraper/cancel', methods=['POST'])
def cancel_routine():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    try:
        resp = scraper_request("POST", "/cancel_routine", timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio del scraper: " + str(e)), 500

@scraper_bp.route('/api/scraper/data', methods=['GET'])
def scraper_data():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    
    scraper_type = request.args.get('type')
    data = services.get_scraped_data(user_id, scraper_type=scraper_type)
    return jsonify(data)

_geocode_cache = {}

@scraper_bp.route('/api/scraper/webhook/state', methods=['POST'])
def webhook_scraper_state():
    if request.remote_addr != '127.0.0.1':
        return jsonify(error="Forbidden"), 403
    # Autenticación interna: misma clave compartida con el microservicio scraper
    import os
    key = os.environ.get("SCRAPER_API_KEY", "").strip()
    if key and request.headers.get('X-Internal-Token', '') != key:
        return jsonify(error="Forbidden"), 403
    data = request.get_json(silent=True) or {}
    
    from .socket_events import scraper_state
    
    scraper_state['is_scraping'] = data.get('is_scraping', False)
    if 'user' in data:
        scraper_state['user'] = data['user']
    if 'type' in data:
        scraper_state['type'] = data['type']
        
    if data.get('is_juicy'):
        try:
            from core.notifications import notifier
            from datetime import datetime
            now = datetime.now()
            date_str = now.strftime("%Y-%m-%d")
            time_str = now.strftime("%H:%M")
            price = data.get('price', 0)
            surface = data.get('surface', 0)
            title = data.get('title', 'New property')
            body = f"{title}\nSurface: {surface}m²"
            header = f"Juicy Offer Found: {price}€"
            
            user_id = data.get('user', 'admin')
            if not user_id: user_id = 'admin'
            
            notifier._add_to_history(header, date_str, time_str, body, "scraper", user_id)
            notifier._send_system_notification(
                title=header,
                start_time=time_str,
                diff=0,
                description=body,
                category="scraper"
            )
            
            link = data.get('link', '')
            tg_message = f"<b>Juicy Offer Found!</b>\n\n* <b>Total Rent:</b> {price:,.2f} €\n* <b>Size:</b> {surface} m²\n* <b>Pets:</b> Not specified\n* <b>Parking:</b> Not specified\n* <b>Link:</b> (<a href='{link}'>{link}</a>)"
            notifier.send_telegram_message(tg_message)
            
        except Exception as e:
            print("Error enviando notificacion:", e)
            
    from core.socket_ext import socketio
    socketio.emit('scraper_state_update', scraper_state)
    return jsonify(status="ok")

@scraper_bp.route('/api/scraper/config/reference', methods=['POST'])
def set_reference_address():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    data = request.get_json(silent=True) or {}
    ref_address = data.get('address', '').strip()
    
    services.set_user_config(user_id, scraper_ref=ref_address)
    
    if not ref_address:
        return jsonify(status="ok", message="Referencia limpiada")
        
    def recalculate_distances():
        import math
        import requests
        import urllib.parse
        import re
        from .scraper_db import update_product_distance
        
        def geocode(addr):
            if not addr: return None
            import re
            
            query = addr
            if not re.search(r'luxembourg|france|belgium|deutschland|allemagne|\d{4,5}', addr, re.IGNORECASE):
                query = f"{addr}, Luxembourg"
            headers = {'User-Agent': 'NullVoidEngine/1.0 (contact@nullvoid.com)'}
            try:
                url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(query)}&limit=1"
                res = requests.get(url, headers=headers, timeout=10).json()
                if res.get('features'):
                    coords = res['features'][0]['geometry']['coordinates']
                    countrycode = res['features'][0]['properties'].get('countrycode', '').upper()
                    return {'lat': coords[1], 'lon': coords[0], 'countrycode': countrycode}
            except: pass
            
            fallback = re.sub(r'^[^,]+,\s*', '', query)
            if fallback and fallback != query and not re.match(r'^(France|Luxembourg|Belgium|Germany)$', fallback, re.IGNORECASE):
                try:
                    url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(fallback)}&limit=1"
                    res = requests.get(url, headers=headers, timeout=10).json()
                    if res.get('features'):
                        coords = res['features'][0]['geometry']['coordinates']
                        countrycode = res['features'][0]['properties'].get('countrycode', '').upper()
                        return {'lat': coords[1], 'lon': coords[0], 'countrycode': countrycode}
                except: pass
                
            return None
            
        def get_driving_distance(lat1, lon1, lat2, lon2):
            try:
                url = f"https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false"
                res = requests.get(url, timeout=10)
                data = res.json()
                if data.get('code') == 'Ok' and len(data.get('routes', [])) > 0:
                    dist_meters = data['routes'][0]['distance']
                    return dist_meters / 1000.0
            except: pass
            return None

        ref_coords = geocode(ref_address)
        if not ref_coords: 
            print(f"[DistanceCalc] Error: No se pudo geolocalizar la dirección de referencia '{ref_address}'", flush=True)
            return

        print(f"[DistanceCalc] Iniciando cálculo de rutas para referencia '{ref_address}' ({ref_coords['lat']}, {ref_coords['lon']})", flush=True)
        all_prods = services.get_scraped_data(user_id=None, scraper_type='athome')
        print(f"[DistanceCalc] {len(all_prods)} inmuebles encontrados para procesar.", flush=True)
        loc_cache = {}
        for p in all_prods:
            loc = p.get('availability', '').strip() or 'Luxembourg'
            if 'schema.org' in loc:
                loc = 'Luxembourg'
                
            loc_parts = re.split(r'\s+(?:in|à|a|at)\s+', p.get('title', ''), flags=re.IGNORECASE)
            if len(loc_parts) > 1:
                loc = loc_parts[-1].strip()

            country_match = re.search(r'\(([A-Z]{2})\)\s*$', p.get('title', ''), re.IGNORECASE)
            if country_match and f"({country_match.group(1).upper()})" not in loc:
                loc += f" ({country_match.group(1).upper()})"
                
            if not loc:
                continue

            dist = None
            if loc in loc_cache:
                dist = loc_cache[loc]
            else:
                print(f"[DistanceCalc] Consultando nueva localización: '{loc}'...", flush=True)
                p_coords = geocode(loc)
                import time
                time.sleep(0.5)

                if p_coords:
                    if p_coords.get('countrycode') and p_coords.get('countrycode') != 'LU':
                        print(f"[DistanceCalc] '{loc}' descartado (fuera de LU)", flush=True)
                        dist = 999999.0
                    else:
                        dist = get_driving_distance(ref_coords['lat'], ref_coords['lon'], p_coords['lat'], p_coords['lon'])
                        if dist is None:
                            print(f"[DistanceCalc] Fallo OSRM para '{loc}', usando 999999.0", flush=True)
                            dist = 999999.0
                        else:
                            print(f"[DistanceCalc] Distancia calculada: {dist:.1f} km para '{loc}'", flush=True)
                        time.sleep(0.5)
                else:
                    print(f"[DistanceCalc] Fallo Geocode para '{loc}'", flush=True)
                    dist = 999999.0  # Set to maximum distance on failure so DB stores it
                loc_cache[loc] = dist
                
            if dist is not None:
                update_product_distance(user_id, p['sku'], dist)
                from core.socket_ext import socketio
                socketio.emit('scraper_distance_update', {'sku': p['sku'], 'distance': dist}, room=f"user_{user_id}")
                
        print(f"[DistanceCalc] ¡Cálculo completado! Emitiendo evento a WebSocket...", flush=True)
        from core.socket_ext import socketio
        socketio.emit('scraper_state_update', {'is_completed': True, 'distances_updated': True}, room=f"user_{user_id}")
        
    import gevent
    gevent.spawn(recalculate_distances)
    
    return jsonify(status="ok", message="Recalculando distancias en segundo plano...")

@scraper_bp.route('/api/scraper/telegram/send', methods=['POST'])
def telegram_manual_send():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    
    data = request.get_json(silent=True) or {}
    skus = [str(s).strip() for s in data.get('skus', [])]
    if not skus:
        return jsonify(error="No se seleccionaron elementos"), 400
        
    try:
        from core.notifications import notifier
        all_prods = services.get_scraped_data(user_id=None)
        
        sent_count = 0
        errors = []
        for p in all_prods:
            if str(p['sku']).strip() in skus:
                price = float(p.get('price', 0))
                surface = p.get('rating_value', 0)
                link = p.get('url', '')
                
                title_lower = p.get('title', '').lower()
                has_pets = "Yes" if any(w in title_lower for w in ['pets', 'animaux', 'mascota', 'chien', 'chat']) else "Not specified"
                has_parking = "Yes" if any(w in title_lower for w in ['parking', 'garage', 'emplacement']) else "Not specified"
                
                tg_message = f"<b>Manually Sent Offer</b>\n\n* <b>Total Rent:</b> {price:,.2f} €\n* <b>Size:</b> {surface} m²\n* <b>Pets:</b> {has_pets}\n* <b>Parking:</b> {has_parking}\n* <b>Link:</b> (<a href='{link}'>{link}</a>)"
                
                if notifier.send_telegram_message(tg_message):
                    sent_count += 1
                else:
                    errors.append(str(p['sku']))
                    
        if len(errors) > 0 and sent_count == 0:
            return jsonify(error="Fallo al enviar a Telegram. ¿Revisaste el parse mode o el Token?"), 400
        return jsonify(status="ok", count=sent_count, errors=errors)
    except Exception as e:
        print("Error enviando telegram manual:", e)
        return jsonify(error=str(e)), 500

@scraper_bp.route('/api/scraper/bot_rules', methods=['GET', 'POST'])
def bot_rules_proxy():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    try:
        if request.method == 'GET':
            resp = scraper_request("GET", f"/bot_rules?user_id={user_id}", timeout=5)
            return jsonify(resp.json())
        data = request.get_json(silent=True) or {}
        data['user_id'] = user_id
        resp = scraper_request("POST", "/bot_rules", json=data, timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio: " + str(e)), 500

@scraper_bp.route('/api/scraper/bot_rules/<int:rule_id>', methods=['DELETE'])
def delete_bot_rule_proxy(rule_id):
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    try:
        resp = scraper_request("DELETE", f"/bot_rules/{rule_id}", json={"user_id": user_id}, timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio: " + str(e)), 500

@scraper_bp.route('/api/scraper/bot_rules/<int:rule_id>/toggle', methods=['POST'])
def toggle_bot_rule_proxy(rule_id):
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    try:
        data = request.get_json(silent=True) or {}
        data['user_id'] = user_id
        resp = scraper_request("POST", f"/bot_rules/{rule_id}/toggle", json=data, timeout=5)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify(error="Error comunicándose con el microservicio: " + str(e)), 500

import os as _os, json as _json

def _geocode_cache_path():
    return _os.path.join(
        _os.path.abspath(_os.path.join(_os.path.dirname(__file__), '../../../../data')),
        'scraper', 'geocode_cache_v2.json'
    )

@scraper_bp.route('/api/scraper/geocode/cache', methods=['GET'])
def get_geocode_cache():
    if not _check_auth():
        return jsonify(error="No autorizado"), 401
    path = _geocode_cache_path()
    if _os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return jsonify(_json.load(f))
        except Exception:
            return jsonify({})
    return jsonify({})

@scraper_bp.route('/api/scraper/geocode/cache', methods=['POST'])
def save_geocode_cache():
    if not _check_auth():
        return jsonify(error="No autorizado"), 401
    new_data = request.get_json(silent=True) or {}
    path = _geocode_cache_path()
    _os.makedirs(_os.path.dirname(path), exist_ok=True)
    current = {}
    if _os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                current = _json.load(f)
        except Exception:
            pass
    current.update(new_data)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            _json.dump(current, f, ensure_ascii=False, indent=2)
        return jsonify(success=True, total=len(current))
    except Exception as e:
        return jsonify(error=str(e)), 500

@scraper_bp.route('/api/scraper/geocode', methods=['GET'])
def geocode_proxy():
    if not _check_auth():
        return jsonify(error="No autorizado"), 401
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify(error="Dirección vacía"), 400
    if q in _geocode_cache:
        return jsonify(_geocode_cache[q])

    def _do_request(query):
        import requests
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        # Bypass Gevent DNS resolution by using photon's IP directly
        url = 'https://116.202.51.114/api/'
        params = {'q': query, 'limit': 1}
        headers = {'User-Agent': 'NullVoidEngine/1.0', 'Host': 'photon.komoot.io'}
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=5, verify=False)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            print(f'[geocode error] {e}')
        return None

    data = _do_request(q)
    if data and data.get('features') and len(data['features']) > 0:
        coords = data['features'][0]['geometry']['coordinates']
        result = {'lon': float(coords[0]), 'lat': float(coords[1]), 'found': True}
        _geocode_cache[q] = result
        return jsonify(result)
    return jsonify({'found': False})






@scraper_bp.route('/api/scraper/product/<path:sku>', methods=['GET'])
def scraper_product_history(sku):
    if not _check_auth():
        return jsonify(error="No autorizado"), 401
    
    data = services.get_product_history_data(sku)
    if not data:
        return jsonify(error="Producto no encontrado"), 404
    return jsonify(data)

from core.limiter import limiter

@scraper_bp.route('/api/scraper/image/<path:sku>', methods=['GET'])
@limiter.exempt
def scraper_image(sku):
    from flask import send_file
    import os
    path = os.path.join(PROJECT_ROOT, "data", "scraper", "images", f"{sku}.jpg")
    if os.path.exists(path):
        return send_file(path, mimetype='image/jpeg')
    fallback_path = os.path.join(PROJECT_ROOT, "src", "static", "img", "favicon.png")
    return send_file(fallback_path, mimetype='image/png')

@scraper_bp.route('/api/scraper/tasks', methods=['GET'])
def get_user_tasks():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    
    tasks = services.get_user_tasks(user_id)
    return jsonify(tasks)

@scraper_bp.route('/api/scraper/tasks', methods=['POST'])
def add_user_task():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    
    data = request.json or {}
    query = data.get('query', '').strip()
    
    if not query:
        return jsonify(error="La búsqueda no puede estar vacía"), 400
        
    success = services.add_user_task(user_id, query)
    if not success:
        return jsonify(error="Ya tienes esta búsqueda configurada"), 400
        
    return jsonify(success=True)

@scraper_bp.route('/api/scraper/tasks/<int:task_id>', methods=['DELETE'])
def delete_user_task(task_id):
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    services.delete_user_task(user_id, task_id)
    return jsonify(success=True)

@scraper_bp.route('/api/scraper/config', methods=['GET'])
def get_user_config():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    config = services.get_user_config(user_id)
    return jsonify(config)

@scraper_bp.route('/api/scraper/config', methods=['POST'])
def set_user_config():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    data = request.json or {}
    scraper_ref = data.get('scraper_ref')
    filters = data.get('filters')
    import json
    if filters is not None:
        filters = json.dumps(filters) if isinstance(filters, dict) else filters
    services.set_user_config(user_id, scraper_ref=scraper_ref, filters=filters)
    return jsonify(success=True)

@scraper_bp.route('/api/scraper/description/<path:sku>', methods=['GET'])
@limiter.exempt
def get_product_description(sku):
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
    
    data = services.get_product_history_data(sku)
    if not data or not data.get('product'):
        return jsonify(error="Producto no encontrado"), 404
        
    url = data['product']['url']
    if not url:
        return jsonify(error="URL no disponible"), 400
        
    cached = services.get_product_detail(sku)
    force_refresh = request.args.get('force') == 'true'
    
    import time
    if cached and not force_refresh:
        updated_at = cached.get('updated_at') or 0
        cache_age_days = (time.time() - updated_at) / 86400
        
        if cache_age_days < 3:
            desc = cached.get('description') or ""
            if not desc.startswith("No se pudo extraer la descripción."):
                import json
                raw_specs = cached.get('contact_extra') or '{}'
                try:
                    specs = json.loads(raw_specs)
                except Exception:
                    specs = {}
                return jsonify(description=desc, images=json.loads(cached.get('images') or '[]'), contact=cached.get('contact'), specs=specs, cached=True)
    if request.args.get('cache_only') == 'true':
        return jsonify(description=None, cached=False)
        
    try:
        import requests
        import json
        
        # Llama al scraper_service que tiene Playwright para obtener la galería y descripción real
        payload = {"url": url, "sku": sku}
        # nullvoid-scraper es el nombre del contenedor en la red Docker, puerto 5001
        scrape_res = scraper_request("POST", "/detail", json=payload, timeout=180)
        
        if scrape_res.status_code != 200:
            return jsonify(error="Error en el servicio de scraping interno"), 500
            
        data = scrape_res.json()
        desc_text = data.get("description", "Descripción no disponible.")
        contact_text = data.get("contact", "Contacto no disponible.")
        images = data.get("images", [])
        specs = data.get("specs", {})
        
        import json
        services.save_product_detail(sku, desc_text, json.dumps(images[:10]), contact_text)
        
        if specs.get("is_removed"):
            services.mark_product_sold_out(sku)
        else:
            services.mark_product_in_stock(sku)
            
        return jsonify(description=desc_text, images=images[:10], contact=contact_text, specs=specs)
    except Exception as e:
        return jsonify(error=str(e)), 500

@scraper_bp.route('/api/scraper/export', methods=['POST'])
def export_to_favourites():
    user_id = _check_auth()
    if not user_id:
        return jsonify(error="No autorizado"), 401
        
    data = request.json or {}
    sku = data.get('sku')
    if not sku:
        return jsonify(error="SKU no proporcionado"), 400
        
    prod_data = services.get_product_history_data(sku)
    if not prod_data or not prod_data.get('product'):
        return jsonify(error="Producto no encontrado"), 404
        
    detail = services.get_product_detail(sku)
    if not detail:
        return jsonify(error="Detalles (descripción/contacto) no encontrados. Obtén la descripción primero."), 400
        
    import os
    import re
    fav_dir = os.path.join(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../data')), 'favourites')
    os.makedirs(fav_dir, exist_ok=True)
    
    title = prod_data['product']['title']
    safe_title = re.sub(r'[^\w\s-]', '', title).strip().replace(' ', '_')
    filename = f"{sku}_{safe_title}.txt"
    filepath = os.path.join(fav_dir, filename)
    
    product_url = prod_data['product'].get('url', '')
    is_pccomponentes = 'pccomponentes.com' in product_url

    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(f"=== {title} ===\n")
            f.write(f"SKU: {sku}\n")
            f.write(f"Categoría: {prod_data['product'].get('category', 'N/A')}\n")
            f.write(f"Precio: {prod_data['product']['price']}€\n")
            f.write(f"Enlace: {product_url}\n")
            f.write("=" * 40 + "\n\n")

            if is_pccomponentes:
                f.write("ESPECIFICACIONES TÉCNICAS:\n")
                f.write("-" * 40 + "\n")
                desc = detail.get('description', '')
                # description is stored as "key: value\n" lines from specs
                for line in desc.splitlines():
                    if ': ' in line:
                        k, v = line.split(': ', 1)
                        f.write(f"  {k:<30} {v}\n")
                    elif line.strip():
                        f.write(f"  {line}\n")
            else:
                contact = detail.get('contact', '')
                if contact and contact not in ('Contacto no disponible.', 'N/A'):
                    f.write("AGENCIA / CONTACTO:\n")
                    f.write("-" * 40 + "\n")
                    f.write(contact + "\n\n")
                f.write("DESCRIPCIÓN:\n")
                f.write("-" * 40 + "\n")
                f.write(detail.get('description', 'N/A') + "\n")

        return jsonify(success=True, path=filepath)
    except Exception as e:
        return jsonify(error=str(e)), 500


@scraper_bp.route('/api/scraper/telegram/send_selected', methods=['POST'])
def telegram_send_selected():
    if not _check_auth():
        return jsonify(error="No autorizado"), 401
    
    data = request.json or {}
    messages = data.get('messages', [])
    if not messages:
        return jsonify(error="No hay mensajes para enviar"), 400
        
    import os
    import requests
    
    if os.environ.get('TELEGRAM_ENABLED', 'true').lower() == 'false':
        return jsonify(error="Telegram deshabilitado temporalmente (TELEGRAM_ENABLED=false en .env)"), 400
    
    tg_token = os.environ.get('TELEGRAM_BOT_TOKEN')
    tg_chat = os.environ.get('TELEGRAM_CHAT_ID')
    
    if not tg_token or not tg_chat:
        env_path = os.path.join(PROJECT_ROOT, '.env')
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    if line.startswith('TELEGRAM_BOT_TOKEN='): tg_token = line.strip().split('=', 1)[1]
                    if line.startswith('TELEGRAM_CHAT_ID='): tg_chat = line.strip().split('=', 1)[1]
                    
    if not tg_token or not tg_chat:
        return jsonify(error="Telegram no está configurado en .env"), 400
        
    msg = "\n\n".join(messages)
    try:
        r = requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                          json={"chat_id": tg_chat, "text": msg, "parse_mode": "Markdown", "disable_web_page_preview": True},
                          timeout=5)
        if not r.ok:
            return jsonify(error=r.text), 400
    except Exception as e:
        return jsonify(error=str(e)), 500
        
    return jsonify(success=True)
