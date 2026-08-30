import cloudscraper
from bs4 import BeautifulSoup
import time
import json
import random
import threading
import sqlite3
import datetime
import os

CANCEL_ROUTINE = False
import time
from scraper_db import save_products, get_all_products, SCRAPER_DIR
from config import ENGINE_BASE_URL

IMAGES_DIR = os.path.join(SCRAPER_DIR, 'images')
LOG_PATH = os.path.join(SCRAPER_DIR, 'scraper_logs.txt')

import builtins
_original_print = builtins.print
def _log_print(*args, **kwargs):
    _original_print(*args, **kwargs)
    try:
        import datetime
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        msg = " ".join(str(a) for a in args)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except:
        pass
print = _log_print

def _telegram_enabled():
    return os.environ.get("TELEGRAM_ENABLED", "true").lower() != "false"


def get_scraped_data(user_id=None, scraper_type=None):
    return get_all_products(user_id=user_id, scraper_type=scraper_type)

def _parse_product_item(item, display_query, category="General"):
    oferta = item.get("offers", {})
    nombre = item.get("name", "")
    
    if nombre:
        nombre = nombre.encode('latin1', errors='ignore').decode('utf-8', errors='ignore') if 'Ã' in nombre else nombre
        
    precio = float(oferta.get("price", 0.0))
    url_prod = item.get("url", "")
    img_url = item.get("image", "")
    if isinstance(img_url, list) and img_url:
        img_url = img_url[0]
        
    sku = item.get("sku", "")
    if not sku and url_prod:
        sku = url_prod.split('-')[-1]
        
    brand_obj = item.get("brand", {})
    brand = brand_obj.get("name", "Unknown") if isinstance(brand_obj, dict) else str(brand_obj)
    
    rating_obj = item.get("aggregateRating", {})
    rating_value = float(rating_obj.get("ratingValue", 0.0)) if isinstance(rating_obj, dict) else 0.0
    rating_count = int(rating_obj.get("ratingCount", 0)) if isinstance(rating_obj, dict) else 0
    
    availability = oferta.get("availability", "").split("/")[-1] if oferta.get("availability") else "Unknown"
    
    if nombre and precio > 0 and sku:
        return {
            "sku": str(sku),
            "title": nombre,
            "brand": brand,
            "url": url_prod,
            "image": img_url,
            "price": precio,
            "availability": availability,
            "rating_value": rating_value,
            "rating_count": rating_count,
            "category": category,
            "query": display_query,
            "scraper_type": "pccomponentes",
            "timestamp": time.time()
        }
    return None

def _scrape_task(query: str, user_id=None):
    if query:
        url = f"https://www.pccomponentes.com/buscar?query={query}"
        display_query = query
        category = "Búsqueda"
    else:
        url = "https://www.pccomponentes.com/componentes"
        display_query = "componentes (categoría)"
        category = "Componentes"
    
    lista_user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
    ]
    
    headers = {
        "User-Agent": random.choice(lista_user_agents),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        "Referer": "https://www.google.com/"
    }

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
            context = browser.new_context(
                user_agent=headers["User-Agent"],
                viewport={'width': 1920, 'height': 1080}
            )
            page = context.new_page()
            
            page.goto(url, timeout=30000, wait_until="domcontentloaded")
            html_text = page.content()
            
            if "Just a moment..." in html_text or "Ray ID:" in html_text or "Cloudflare" in html_text:
                print(f"[Scraper] Detectado desafío antibot en {display_query}. Esperando 8s...")
                time.sleep(8)
                html_text = page.content()

        with open("/tmp/pccomp.html", "w", encoding="utf-8") as f:
            f.write(html_text)
        soup = BeautifulSoup(html_text, 'html.parser')
        
        script_datos = soup.find('script', attrs={"id": "microdata-product-list-script"})
        if not script_datos or not script_datos.string:
            print(f"[Scraper] No se encontró microdata para: {display_query}")
            return
            
        json_data = json.loads(script_datos.string.strip())
        elementos_tienda = json_data.get("itemListElement", [])
        
        products = []
        for elemento in elementos_tienda:
            item = elemento.get("item", {})
            parsed = _parse_product_item(item, display_query, category)
            if parsed:
                products.append(parsed)
                
        # Fix rounded prices from microdata by searching the raw HTML for exact decimal prices
        import re
        exact_prices = {}
        # Search for exact prices in Next.js state or HTML data attributes (e.g., "price":267.99)
        # Matches patterns like "sku":"123","price":267.99 or "article":"123","price":267.99
        for match in re.finditer(r'"sku"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
            exact_prices[match.group(1)] = float(match.group(2))
        for match in re.finditer(r'"article"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
            exact_prices[match.group(1)] = float(match.group(2))
        for match in re.finditer(r'"price"\s*:\s*(\d+\.\d+)[^}]*?"sku"\s*:\s*"([^"]+)"', html_text):
            exact_prices[match.group(2)] = float(match.group(1))
            
        for p in products:
            sku = p['sku']
            if sku in exact_prices and exact_prices[sku] > 0:
                p['price'] = exact_prices[sku]
                
        if products:
            save_products(products, query_origin=display_query, user_id=user_id, scraper_type="pccomponentes")
            print(f"[Scraper] Completado para '{display_query}', guardados {len(products)} productos.")
        
    except Exception as e:
        print(f"[Scraper] Error: {e}")

def _scrape_all_laptops_daily(cancellable=True):
    global CANCEL_ROUTINE
    CANCEL_ROUTINE = False
    print(f"[Scraper Diario] Iniciando extracción masiva de COMPONENTES (cancellable={cancellable})...")
    
    categorias = [
        "tarjetas-graficas",
        "procesadores",
        "placas-base",
        "memorias-ram",
        "discos-duros",
        "fuentes-alimentacion",
        "portatiles",
        "ordenadores-sobremesa"
    ]
    
    total_productos = 0
    
    for categoria in categorias:
        print(f"[Scraper Diario] Escaneando categoría: {categoria}")
        
        if cancellable and CANCEL_ROUTINE:
            print("[Scraper Diario] Cancelación solicitada. Abortando rutina de PcComponentes.")
            break

        # Pausa extra de seguridad al cambiar de categoría (entre 15 y 25 segundos)
        for _ in range(int(random.uniform(15.0, 25.0))):
            if cancellable and CANCEL_ROUTINE: break
            time.sleep(1)
        if cancellable and CANCEL_ROUTINE: break
        
        for pagina in range(1, 1001): # Hasta 1000 páginas por categoría
            if cancellable and CANCEL_ROUTINE:
                print(f"[Scraper Diario] Cancelación solicitada en categoría {categoria}. Abortando.")
                break
            
            if pagina > 1:
                # Retraso aleatorio un poco mayor (entre 8 y 16 segundos) entre páginas
                for _ in range(int(random.uniform(8.0, 16.0))):
                    if cancellable and CANCEL_ROUTINE: break
                    time.sleep(1)
                if cancellable and CANCEL_ROUTINE: break
            
            url = f"https://www.pccomponentes.com/{categoria}" if pagina == 1 else f"https://www.pccomponentes.com/{categoria}?page={pagina}"
            lista_user_agents = [
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
            ]
            headers = {
                "User-Agent": random.choice(lista_user_agents),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "es-ES,es;q=0.9",
                "Referer": "https://www.google.com/"
            }

            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
                    context = browser.new_context(
                        user_agent=headers["User-Agent"],
                        viewport={'width': 1920, 'height': 1080}
                    )
                    page = context.new_page()
                    
                    page.goto(url, timeout=30000, wait_until="domcontentloaded")
                    html_text = page.content()
                    
                    if "Just a moment..." in html_text or "Ray ID:" in html_text or "Cloudflare" in html_text:
                        print(f"[Scraper Diario] Detectado desafío antibot en {categoria} pág {pagina}. Esperando 8s...")
                        time.sleep(8)
                        html_text = page.content()

                soup = BeautifulSoup(html_text, 'html.parser')
                script_datos = soup.find('script', attrs={"id": "microdata-product-list-script"})
                if not script_datos or not script_datos.string:
                    print(f"[Scraper Diario] Fin de categoría o Captcha persistente en {categoria} pág {pagina}. Pasando a la siguiente...")
                    break
                    
                json_data = json.loads(script_datos.string.strip())
                elementos_tienda = json_data.get("itemListElement", [])
                if not elementos_tienda:
                    print(f"[Scraper Diario] No hay más artículos en {categoria} (pág {pagina}). Fin de categoría.")
                    break
                
                products = []
                for elemento in elementos_tienda:
                    item = elemento.get("item", {})
                    parsed = _parse_product_item(item, "Categoría Diario", categoria.replace("-", " ").title())
                    if parsed:
                        products.append(parsed)
                        
                import re
                exact_prices = {}
                for match in re.finditer(r'"sku"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
                    exact_prices[match.group(1)] = float(match.group(2))
                for match in re.finditer(r'"article"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
                    exact_prices[match.group(1)] = float(match.group(2))
                for match in re.finditer(r'"price"\s*:\s*(\d+\.\d+)[^}]*?"sku"\s*:\s*"([^"]+)"', html_text):
                    exact_prices[match.group(2)] = float(match.group(1))
                    
                for p in products:
                    sku = p['sku']
                    if sku in exact_prices and exact_prices[sku] > 0:
                        p['price'] = exact_prices[sku]
                
                if products:
                    save_products(products, query_origin="Categoría Diario", scraper_type="pccomponentes")
                    total_productos += len(products)
                    print(f"  -> {categoria} pág {pagina} ok: {len(products)} extraídos.")
                    
            except Exception as e:
                print(f"[Scraper Diario] Error en {categoria} pág {pagina}: {e}")
            
    print(f"[Scraper Diario] Finalizado. Total componentes extraídos: {total_productos}.")


def _scrape_pccomp_routine(terms_list, cancellable=True):
    global CANCEL_ROUTINE
    CANCEL_ROUTINE = False
    print(f"[Scraper Pccomp Routine] Iniciando rutina para {len(terms_list)} terminos (cancellable={cancellable})...")
    
    if not terms_list:
        print("[Scraper Pccomp Routine] No hay terminos configurados. Saliendo.")
        return
        
    total_productos = 0
    from playwright.sync_api import sync_playwright
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        page = context.new_page()
        
        while True:
            if cancellable and CANCEL_ROUTINE:
                print("[Scraper Pccomp Routine] Cancelado. Saliendo del bucle infinito.")
                break
                
            for query in terms_list:
                query = query.strip()
                if not query: continue
                
                print(f"[Scraper Pccomp Routine] Buscando: {query}")
                
                if cancellable and CANCEL_ROUTINE: break
                
                for pagina in range(1, 6): # Max 5 páginas por término
                    if cancellable and CANCEL_ROUTINE: break
                    
                    if pagina > 1:
                        human_delay = random.uniform(8.0, 16.0)
                        for _ in range(int(human_delay)):
                            if cancellable and CANCEL_ROUTINE: break
                            time.sleep(1)
                        if cancellable and CANCEL_ROUTINE: break
                    
                    url = f"https://www.pccomponentes.com/buscar?query={query}&page={pagina}" if pagina > 1 else f"https://www.pccomponentes.com/buscar?query={query}"
                    
                    try:
                        page.goto(url, timeout=30000, wait_until="domcontentloaded")
                        html_text = page.content()
                        
                        if "Just a moment..." in html_text or "Ray ID:" in html_text or "Cloudflare" in html_text:
                            print(f"[Scraper Pccomp Routine] Antibot detectado en {query} pág {pagina}. Pausando 10s...")
                            time.sleep(10)
                            html_text = page.content()
                            
                        from bs4 import BeautifulSoup
                        soup = BeautifulSoup(html_text, 'html.parser')
                        script_datos = soup.find('script', attrs={"id": "microdata-product-list-script"})
                        if not script_datos or not script_datos.string:
                            print(f"[Scraper Pccomp Routine] Fin de resultados para {query} en pág {pagina}.")
                            break
                            
                        json_data = json.loads(script_datos.string.strip())
                        elementos_tienda = json_data.get("itemListElement", [])
                        if not elementos_tienda:
                            break
                            
                        products = []
                        for elemento in elementos_tienda:
                            item = elemento.get("item", {})
                            parsed = _parse_product_item(item, query, "Monitoreo")
                            if parsed:
                                products.append(parsed)
                                
                        import re
                        exact_prices = {}
                        for match in re.finditer(r'"sku"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
                            exact_prices[match.group(1)] = float(match.group(2))
                        for match in re.finditer(r'"article"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
                            exact_prices[match.group(1)] = float(match.group(2))
                        for match in re.finditer(r'"price"\s*:\s*(\d+\.\d+)[^}]*?"sku"\s*:\s*"([^"]+)"', html_text):
                            exact_prices[match.group(2)] = float(match.group(1))
                            
                        for p in products:
                            sku = p['sku']
                            if sku in exact_prices and exact_prices[sku] > 0:
                                p['price'] = exact_prices[sku]
                                
                        if products:
                            from scraper_db import save_products
                            save_products(products, query_origin=query, scraper_type="pccomponentes")
                            total_productos += len(products)
                            print(f"  -> {query} pág {pagina} ok: {len(products)} extraídos.")
                            
                    except Exception as e:
                        print(f"[Scraper Pccomp Routine] Error en {query} pág {pagina}: {e}")
                        break # Skip to next term if timeout
                        
                for _ in range(int(random.uniform(15.0, 25.0))):
                    if cancellable and CANCEL_ROUTINE: break
                    time.sleep(1)
            
            if cancellable and CANCEL_ROUTINE: break
            
            print("[Scraper Pccomp Routine] Ciclo completado. Durmiendo 20 minutos antes de actualizar precios de nuevo...")
            for _ in range(1200): # 20 mins
                if cancellable and CANCEL_ROUTINE: break
                time.sleep(1)
                
        browser.close()
    print("[Scraper Pccomp Routine] Rutina terminada.")

def _notify_progress(current, total, current_term, products_found):
    try:
        import requests
        requests.post(f"{ENGINE_BASE_URL}/api/scraper/webhook/state", json={
            "is_scraping": True,
            "progress": {"current": current, "total": total, "current_term": current_term, "products_found": products_found}
        }, timeout=3, verify=False)
    except:
        pass

def _scrape_pccomp_manual(terms_list, user_id=None):
    print(f"[Scraper Manual] Iniciando scrape manual de {len(terms_list)} término(s)...")
    if not terms_list:
        return

    total_products = 0
    total_terms = len(terms_list)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        page = context.new_page()

        for idx, query in enumerate(terms_list):
            query = query.strip()
            if not query:
                continue

            if CANCEL_ROUTINE:
                print("[Scraper Manual] Cancelado.")
                break

            print(f"[Scraper Manual] ({idx+1}/{total_terms}) Buscando: {query}")
            _notify_progress(idx + 1, total_terms, query, total_products)

            for pagina in range(1, 4):
                if CANCEL_ROUTINE: break

                if pagina > 1:
                    human_delay = random.uniform(5.0, 10.0)
                    for _ in range(int(human_delay)):
                        if CANCEL_ROUTINE: break
                        time.sleep(1)
                    if CANCEL_ROUTINE: break

                url = f"https://www.pccomponentes.com/buscar?query={query}&page={pagina}" if pagina > 1 else f"https://www.pccomponentes.com/buscar?query={query}"

                try:
                    page.goto(url, timeout=30000, wait_until="domcontentloaded")
                    html_text = page.content()

                    if "Just a moment..." in html_text or "Ray ID:" in html_text or "Cloudflare" in html_text:
                        print(f"[Scraper Manual] Antibot en {query} pág {pagina}. Esperando 10s...")
                        time.sleep(10)
                        html_text = page.content()

                    from bs4 import BeautifulSoup
                    soup = BeautifulSoup(html_text, 'html.parser')
                    script_datos = soup.find('script', attrs={"id": "microdata-product-list-script"})
                    if not script_datos or not script_datos.string:
                        print(f"[Scraper Manual] Sin resultados para {query} pág {pagina}.")
                        break

                    json_data = json.loads(script_datos.string.strip())
                    elementos_tienda = json_data.get("itemListElement", [])
                    if not elementos_tienda:
                        break

                    products = []
                    for elemento in elementos_tienda:
                        item = elemento.get("item", {})
                        parsed = _parse_product_item(item, query, "Manual")
                        if parsed:
                            products.append(parsed)

                    import re
                    exact_prices = {}
                    for match in re.finditer(r'"sku"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
                        exact_prices[match.group(1)] = float(match.group(2))
                    for match in re.finditer(r'"article"\s*:\s*"([^"]+)"[^}]*?"price"\s*:\s*(\d+\.\d+)', html_text):
                        exact_prices[match.group(1)] = float(match.group(2))

                    for prod in products:
                        sku = prod['sku']
                        if sku in exact_prices and exact_prices[sku] > 0:
                            prod['price'] = exact_prices[sku]

                    if products:
                        from scraper_db import save_products
                        save_products(products, query_origin=query, user_id=user_id, scraper_type="pccomponentes")
                        total_products += len(products)
                        print(f"  -> {query} pág {pagina}: {len(products)} productos guardados.")

                except Exception as e:
                    print(f"[Scraper Manual] Error en {query} pág {pagina}: {e}")
                    break

            if CANCEL_ROUTINE: break

            if idx < total_terms - 1:
                pause = random.uniform(3.0, 6.0)
                print(f"[Scraper Manual] Pausa de {pause:.1f}s antes del siguiente término...")
                time.sleep(pause)

        browser.close()

    _notify_progress(total_terms, total_terms, "Completado", total_products)
    print(f"[Scraper Manual] Finalizado. {total_products} productos guardados de {total_terms} término(s).")

def search_pccomponentes(query: str, user_id=None):
    gevent.spawn(_scrape_task, query, user_id)
    return {"status": "ok", "message": "Scraping iniciado en segundo plano"}

from playwright.sync_api import sync_playwright
import math
import requests

_geocode_cache = {}

def get_haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def geocode_address(address):
    if not address: return None
    clean_address = address.strip()
    if clean_address in _geocode_cache:
        return _geocode_cache[clean_address]
    
    import re
    query = clean_address
    country_match = re.search(r'\(([A-Z]{2})\)\s*$', clean_address, re.IGNORECASE)
    if country_match:
        country_code = country_match.group(1).upper()
        city_part = re.sub(r'\s*\([A-Z]{2}\)\s*$', '', clean_address, flags=re.IGNORECASE).strip()
        country_names = {'FR': 'France', 'LU': 'Luxembourg', 'BE': 'Belgium', 'DE': 'Germany'}
        query = f"{city_part}, {country_names.get(country_code, country_code)}"
    else:
        has_country = re.search(r'luxembourg|france|belgium|deutschland|allemagne|\d{4,5}', clean_address, re.IGNORECASE)
        if not has_country:
            query = f"{clean_address}, Luxembourg"
            
    try:
        import time
        time.sleep(1.5)
        res = requests.get(f"https://photon.komoot.io/api/?q={requests.utils.quote(query)}", timeout=5)
        if res.status_code == 200:
            data = res.json()
            if data.get('features'):
                coords = data['features'][0]['geometry']['coordinates']
                countrycode = data['features'][0]['properties'].get('countrycode', '').upper()
                res_coords = {'lat': coords[1], 'lon': coords[0], 'countrycode': countrycode}
                _geocode_cache[clean_address] = res_coords
                return res_coords
    except Exception as e:
        pass
    
    fallback = re.sub(r'^[^,]+,\s*', '', query)
    if fallback and fallback != query and not re.match(r'^(France|Luxembourg|Belgium|Germany)$', fallback, re.IGNORECASE):
        try:
            import time
            time.sleep(1.5)
            res = requests.get(f"https://photon.komoot.io/api/?q={requests.utils.quote(fallback)}", timeout=5)
            if res.status_code == 200:
                data = res.json()
                if data.get('features'):
                    coords = data['features'][0]['geometry']['coordinates']
                    countrycode = data['features'][0]['properties'].get('countrycode', '').upper()
                    res_coords = {'lat': coords[1], 'lon': coords[0], 'countrycode': countrycode}
                    _geocode_cache[clean_address] = res_coords
                    return res_coords
        except:
            pass
            
    return None

def _process_detail_background(link, rule, price, surface, city, dist, sku, rule_user_id):
    try:
        import requests
        import re
        import os
        import time
        import scraper_db
        
        keywords_str = rule.get('keywords', '')
        parking_req = rule.get('parking', '')
        pets_req = rule.get('pets', '')
        avail_date = rule.get('availability_date', '')
        
        print(f"      [BG] -> [Regla: {rule['name']}] Evaluando detalles en segundo plano para {sku}...")
        
        try:
            res = requests.get(link, timeout=10)
            desc_text = re.sub(r'<[^>]+>', ' ', res.text).lower()
        except:
            desc_text = ""
            
        if any(phrase in desc_text for phrase in ['est loué', 'is rented', 'déjà loué', 'already rented', 'is rent', 'under offer', 'sous compromis', 'loué !']):
            print(f"      [BG] -> [Regla: {rule['name']}] Apartamento ya alquilado/reservado, saltando.")
            return

        matched_kws = []
        if keywords_str.strip():
            kws = [k.strip().lower() for k in keywords_str.split(',') if k.strip()]
            for kw in kws:
                if kw in desc_text:
                    matched_kws.append(kw)
            if not matched_kws:
                return

        found_parking_words = []
        if parking_req == 'has_parking':
            found_parking_words = [pk for pk in ['parking', 'garage', 'parking souterrain', 'parking inclus'] if pk in desc_text]
            if not found_parking_words:
                return
        if parking_req == 'no_parking' and any(pk in desc_text for pk in ['parking', 'garage']):
            return

        if pets_req == 'pets_allowed' and not any(pt in desc_text for pt in ['animaux acceptés', 'pets allowed', 'animaux admis', 'haustiere erlaubt', 'pets considered']):
            return
        if pets_req == 'no_pets' and any(pt in desc_text for pt in ['animaux acceptés', 'pets allowed', 'animaux admis', 'haustiere erlaubt']):
            return

        found_avail_str = ""
        avail_ok = True
        if avail_date:
            import datetime
            try:
                avail_dt = datetime.datetime.strptime(avail_date, '%Y-%m-%d')
                patterns = [
                    r'(?:disponible|libre|available)\s*(?:le|:)?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})',
                    r'(?:disponible|libre|available)\s+(?:à\s+partir\s+du\s+)?(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})',
                    r'available\s+(\w+)\s+(\d{4})',
                    r'(?:disponible|libre)\s+(?:le|:)?\s*(\w+)\s+(\d{4})'
                ]
                for pattern in patterns:
                    m = re.search(pattern, desc_text, re.IGNORECASE)
                    if not m:
                        continue
                    found_avail_str = m.group(0).strip()
                    try:
                        if m.lastindex == 3:
                            a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
                            if y < 100: y += 2000
                            if a > 12:
                                d, mo = a, b
                            elif b > 12:
                                d, mo = b, a
                            else:
                                continue
                            found_date = datetime.datetime(y, mo, d)
                        else:
                            month_str = m.group(1).capitalize()
                            found_date = datetime.datetime.strptime(f"1 {month_str} {m.group(2)}", '%d %B %Y')
                        if found_date > avail_dt:
                            avail_ok = False
                    except:
                        continue
                    break
            except:
                pass
        if not avail_ok:
            return

        print(f"      🚨 [BG] [Regla: {rule['name']}] ¡MATCH! Enviando a Telegram...")
        tg_token = os.environ.get("TELEGRAM_BOT_TOKEN")
        tg_chat = os.environ.get("TELEGRAM_CHAT_ID")

        if tg_token and tg_chat and _telegram_enabled():
            kws_found = ", ".join(matched_kws) if matched_kws else "N/A"
            city_clean = city.replace("-", " ").title() if city else "Luxembourg"
            dist_str = f"{dist:.1f} km" if dist is not None else "Not specified"
            pets_str = "Yes" if pets_req == 'pets_allowed' else ("No" if pets_req == 'no_pets' else "Not specified")
            if parking_req == 'has_parking':
                park_str = f"Yes ({', '.join(found_parking_words)})"
            elif parking_req == 'no_parking':
                park_str = "No"
            else:
                park_str = "Not specified"

            avail_str = found_avail_str if found_avail_str else "Not specified"

            msg = (
                f"• Total Rent: {price:,.2f} €\n"
                f"• Size: {surface} m²\n"
                f"• Pets: {pets_str}\n"
                f"• Parking: {park_str}\n"
                f"• Availability: {avail_str}\n"
                f"• Distance: {dist_str}\n"
                f"• Link: ({link})"
            )
            requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                          json={"chat_id": tg_chat, "text": msg, "parse_mode": "Markdown", "disable_web_page_preview": False},
                          timeout=5)

        if rule_user_id:
            scraper_db.add_user_product(rule_user_id, sku)
            print(f"      [BG] -> [Regla: {rule['name']}] Añadido a favoritos.")
            
    except Exception as ex:
        print(f"      [!] [BG] Error evaluando regla {rule['name']} para {sku}: {ex}")

def _scrape_athome_task(location="Howald", min_surface=45, user_id=None):
    print(f"[Scraper atHome] Iniciando búsqueda en {location} con min {min_surface}m2...")
    display_query = f"atHome {location} {min_surface}m2"
    if location.startswith("http"):
        display_query = f"atHome Custom URL {min_surface}m2"
    
    import random, time
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        
        base_url = location if location.startswith("http") else f"https://www.athome.lu/en/rent/apartment/{location.lower()}"
        
        all_products = []
        max_pages = 20
        
        for page_num in range(1, max_pages + 1):
            if page_num > 1:
                time.sleep(random.uniform(2.0, 5.0))
                if "?" in base_url:
                    url = f"{base_url}&page={page_num}"
                else:
                    url = f"{base_url}?page={page_num}"
            else:
                url = base_url
                
            print(f"[Scraper atHome] Buscando en URL: {url} (Página {page_num})")
            page = context.new_page()
            
            try:
                page.goto(url, timeout=60000, wait_until="domcontentloaded")
                try:
                    page.wait_for_selector("article", timeout=15000)
                except:
                    print(f"[Scraper atHome] No se encontraron más artículos en la página {page_num}.")
                    break
                
                try:
                    button = page.locator("text='Authorise all'").first
                    if button.is_visible():
                        button.click()
                        page.wait_for_timeout(500)
                except: pass
                
                page.add_style_tag(content="div[class*='cookie'], div[id*='cookie'], div[id*='didomi'], div[id*='trust'], div[role='dialog'] { display: none !important; }")
                
                articles = page.query_selector_all("article")
                if not articles:
                    break
                    
                products = []
                
                for article in articles:
                    title_el = article.query_selector("h3")
                    title = title_el.inner_text().strip() if title_el else "Apartamento"
                    
                    price_text = article.inner_text()
                    import re
                    price_match = re.search(r'(?:€\s*([\d.,]+))|(?:([\d.,]+)\s*€)', price_text)
                    if price_match:
                        raw_price = price_match.group(1) or price_match.group(2)
                        price = float(raw_price.replace(",", "")) if raw_price else 0.0
                    else:
                        price = 0.0
                
                surface_match = re.search(r'(\d+)\s*m²', price_text)
                surface = int(surface_match.group(1)) if surface_match else 0
                
                if surface >= min_surface:
                    link_el = article.query_selector("a")
                    link = link_el.get_attribute("href") if link_el else ""
                    if link and not link.startswith("http"):
                        link = "https://www.athome.lu" + link
                        
                    sku = link.split("/")[-1] if link else str(time.time())
                    
                    agency_el = article.query_selector("a[href*='/realestate-agency/']")
                    if agency_el:
                        href = agency_el.get_attribute("href")
                        try:
                            agency = href.split("/realestate-agency/")[1].split("/")[0].replace("-", " ").title()
                        except:
                            agency = agency_el.inner_text().strip() or "Particular"
                    else:
                        parts = [p.strip() for p in price_text.split('\n') if p.strip()]
                        agency = parts[-1] if len(parts) > 1 else "Particular"
                        if agency.isdigit() or len(agency) <= 2:
                            if len(parts) > 2 and not parts[-2].isdigit() and "m²" not in parts[-2]:
                                agency = parts[-2]
                            else:
                                agency = "Particular"
                    
                    bedrooms = 0
                    bed_match = re.search(r'(\d+)\s*bedroom', title, re.IGNORECASE)
                    if bed_match: bedrooms = int(bed_match.group(1))
                    
                    prop_type = "Apartamento"
                    t_lower = title.lower()
                    if "studio" in t_lower: prop_type = "Estudio"
                    elif "house" in t_lower: prop_type = "Casa"
                    elif "duplex" in t_lower: prop_type = "Dúplex"
                    elif "penthouse" in t_lower: prop_type = "Penthouse"
                    elif "room" in t_lower and "apartment" not in t_lower and "appartement" not in t_lower: prop_type = "Habitación"
                    
                    import os
                    image_path = os.path.join(IMAGES_DIR, f"{sku}.jpg")
                    os.makedirs(os.path.dirname(image_path), exist_ok=True)
                    try:
                        img_elem = article.query_selector("picture img, img")
                        extracted_url = img_elem.get_attribute("src") if img_elem else ""
                        if extracted_url and extracted_url.startswith("http"):
                            image_url = extracted_url
                        else:
                            article.scroll_into_view_if_needed()
                            page.wait_for_timeout(400)
                            article.screenshot(path=image_path, type="jpeg", quality=40)
                            image_url = f"/api/scraper/image/{sku}"
                    except:
                        image_url = ""
                    
                    ref_address = scraper_db.get_user_scraper_ref(user_id) if user_id else "4 Rue Peternelchen, Howald"
                    if not ref_address:
                        ref_address = "4 Rue Peternelchen, Howald"
                        
                    office_coords = geocode_address(ref_address) or {'lat': 49.5826, 'lon': 6.1423}
                    prop_coords = geocode_address(f"{location}, Luxembourg")
                    
                    dist = None
                    if prop_coords and prop_coords.get('countrycode') and prop_coords.get('countrycode') != 'LU':
                        dist = 999999.0
                    elif prop_coords and office_coords:
                        dist = get_haversine_distance(office_coords['lat'], office_coords['lon'], prop_coords['lat'], prop_coords['lon'])
                        
                    is_juicy = False
                    if dist is not None and dist <= 11.0 and surface >= 40 and price > 0 and price <= 1800:
                        try:
                            print(f"[Juicy Offer] Evaluando candidato: {title} en {location} ({surface}m2, {price}€, {dist:.1f}km)")
                            detail_page = context.new_page()
                            detail_page.goto(link, timeout=20000, wait_until="domcontentloaded")
                            detail_page.wait_for_timeout(500)
                            desc_text = detail_page.inner_text("body")
                            detail_page.close()
                            
                            desc_lower = desc_text.lower()
                            keywords = ['pets', 'animaux', 'mascota', 'chien', 'chat', 'parking', 'garage', 'emplacement']
                            
                            for kw in keywords:
                                if kw in desc_lower:
                                    is_juicy = True
                                    print(f"[Juicy Offer] ¡Encontrada joya! SKU: {sku} - {title} - {price}€. Razón: {kw}")
                                    import requests
                                    import os
                                    import re
                                    avail_match = re.search(r'(?:availability|disponibilité|disponibilidad)\s*[:|]?\s*([a-zA-Z0-9\/\s]+)', desc_text, re.IGNORECASE)
                                    availability_str = "Not specified"
                                    if avail_match:
                                        availability_str = avail_match.group(1).split('*')[0].strip().capitalize()

                                    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN")
                                    tg_chat = os.environ.get("TELEGRAM_CHAT_ID")
                                    if tg_token and tg_chat and _telegram_enabled():
                                        city_clean = location.replace("-", " ").title() if location else "Luxembourg"
                                        msg = (
                                            f"🔥 *Great Deal Alert!*\n\n"
                                            f"*Title:* {title}\n"
                                            f"*Price:* €{price:,.2f}\n"
                                            f"*Surface:* {surface} m²\n"
                                            f"*Bedrooms:* {bedrooms}\n"
                                            f"*Type:* {prop_type}\n"
                                            f"*Location:* {city_clean}\n"
                                            f"*Distance:* {dist:.1f} km\n"
                                            f"*Matched:* {kw}\n"
                                            f"*Availability:* {availability_str}\n\n"
                                            f"[View Listing]({link})"
                                        )
                                        try:
                                            requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                                                          json={"chat_id": tg_chat, "text": msg, "parse_mode": "Markdown"},
                                                          timeout=5)
                                            print("[Juicy Offer] Notificación enviada a Telegram.")
                                        except Exception as e:
                                            print(f"[Juicy Offer] Error enviando Telegram: {e}")
                                    try:
                                        requests.post(f"{ENGINE_BASE_URL}/api/scraper/webhook/state", 
                                                      json={"is_juicy": True, "title": title, "price": price, "surface": surface, "link": link, "user": user_id}, 
                                                      timeout=3)
                                    except: pass
                                    break
                        except Exception as ex:
                            print(f"[Juicy Offer] Error obteniendo detalle para {link}: {ex}")
                            try:
                                detail_page.close()
                            except: pass

                    products.append({
                        "sku": sku,
                        "title": title,
                        "brand": agency[:50],
                        "url": link,
                        "image": image_url, 
                        "price": price,
                        "availability": location.capitalize(),
                        "rating_value": float(surface),
                        "rating_count": bedrooms,
                        "category": prop_type,
                        "query": display_query,
                        "scraper_type": "athome",
                        "timestamp": time.time(),
                        "is_juicy": is_juicy,
                        "distance": dist
                    })
            
                if products:
                    all_products.extend(products)
                    save_products(products, query_origin=display_query, user_id=user_id, scraper_type="athome")
                    print(f"[Scraper atHome] Guardados {len(products)} apartamentos de la página {page_num}.")
                
            except Exception as e:
                print(f"[Scraper atHome] Error en página {page_num}: {e}")
                break
                
            finally:
                if not page.is_closed():
                    page.close()
                    
        print(f"[Scraper atHome] Completado, guardados un total de {len(all_products)} apartamentos.")
        if not all_products:
            print(f"[Scraper atHome] No se encontraron apartamentos de más de {min_surface}m² o falló la búsqueda.")
        
        browser.close()

def search_athome(location="Howald", min_surface=45, user_id=None):
    gevent.spawn(_scrape_athome_task, location, min_surface, user_id)
    return {"status": "ok", "message": "Scraping de atHome iniciado en segundo plano"}

def _scrape_athome_routine(min_surface=0, cancellable=True):
    global CANCEL_ROUTINE
    CANCEL_ROUTINE = False
    print(f"[Scraper atHome] Iniciando rutina completa (cancellable={cancellable})...")
    
    total_apartments = 0
    import scraper_db
    custom_url = scraper_db.get_athome_routine_url()
    base_url = custom_url if custom_url else "https://www.athome.lu/en/rent/apartment/luxembourg"
    
    active_bot_rules = scraper_db.get_all_active_bot_rules()
    if active_bot_rules:
        print(f"[Scraper atHome] Reglas Bot Activas cargadas: {len(active_bot_rules)}")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={'width': 1920, 'height': 1080}
        )
        
        for page_num in range(1, 1001):
            if cancellable and CANCEL_ROUTINE:
                print("[Scraper atHome] Cancelación solicitada. Abortando rutina global.")
                break
            
            if page_num > 1:
                human_delay = random.uniform(12.0, 25.0)
                print(f"[Scraper Diario] Pausa táctica de {human_delay:.1f}s simulando humano antes de la página {page_num}...")
                for _ in range(int(human_delay)):
                    if cancellable and CANCEL_ROUTINE: break
                    time.sleep(1)
                if cancellable and CANCEL_ROUTINE: break
                
            if "?" in base_url:
                url = f"{base_url}&page={page_num}" if page_num > 1 else base_url
            else:
                url = f"{base_url}?page={page_num}" if page_num > 1 else base_url
                
            print(f"\n[Scraper atHome] [Página {page_num}] Iniciando petición a la URL:")
            print(f"[Scraper atHome] -> {url}")
            page = context.new_page()
                
            try:
                max_retries = 3
                success = False
                for attempt in range(max_retries):
                    try:
                        page.goto(url, timeout=60000, wait_until="domcontentloaded")
                        page.wait_for_selector("article", timeout=10000)
                        success = True
                        break
                    except Exception as e:
                        print(f"[Scraper Diario] Intento {attempt+1}/{max_retries} falló en página {page_num}: {e}")
                        time.sleep(3)
                
                if not success:
                    print(f"[Scraper Diario] No se pudo cargar la página {page_num} tras {max_retries} intentos. Fin de la rutina o saltando.")
                    break
                
                try:
                    button = page.locator("text='Authorise all'").first
                    if button.is_visible():
                        button.click()
                        page.wait_for_timeout(500)
                except: pass
                
                page.add_style_tag(content="div[class*='cookie'], div[id*='cookie'], div[id*='didomi'], div[id*='trust'], div[role='dialog'] { display: none !important; }")
                
                articles = page.query_selector_all("article")
                print(f"[Scraper atHome] [Página {page_num}] El DOM ha devuelto {len(articles)} bloques de propiedades (<article>).")
                if not articles: 
                    print(f"[Scraper atHome] [Página {page_num}] La página está vacía de propiedades. Fin de la extracción.")
                    break
                
                products = []
                display_query = f"atHome Luxemburgo (Todos los precios)"
                
                for article in articles:
                    title_el = article.query_selector("h3")
                    title = title_el.inner_text().strip() if title_el else "Apartamento"
                    
                    t_lower = title.lower()
                    if any(x in t_lower for x in ["for sale", "à vendre", "a vendre", "zu verkaufen", "sale"]):
                        continue
                    
                    price_text = article.inner_text()
                    import re
                    price_match = re.search(r'(?:€\s*([\d.,]+))|(?:([\d.,]+)\s*€)', price_text)
                    if price_match:
                        raw_price = price_match.group(1) or price_match.group(2)
                        price = float(raw_price.replace(",", "")) if raw_price else 0.0
                    else:
                        price = 0.0
                    
                    surface_match = re.search(r'(\d+)\s*m²', price_text)
                    surface = int(surface_match.group(1)) if surface_match else 0
                    
                    if surface >= min_surface:
                        link_el = article.query_selector("a")
                        link = link_el.get_attribute("href") if link_el else ""
                        if link and not link.startswith("http"):
                            link = "https://www.athome.lu" + link
                            
                        sku = link.split("/")[-1] if link else str(time.time())
                        
                        try:
                            city = link.split("/")[-2].replace("-", " ").title()
                        except:
                            city = "Luxembourg"
                        
                        agency_el = article.query_selector("a[href*='/realestate-agency/']")
                        if agency_el:
                            href = agency_el.get_attribute("href")
                            try:
                                agency = href.split("/realestate-agency/")[1].split("/")[0].replace("-", " ").title()
                            except:
                                agency = agency_el.inner_text().strip() or "Particular"
                        else:
                            parts = [p.strip() for p in price_text.split('\n') if p.strip()]
                            agency = "Particular"
                            for part in reversed(parts):
                                if not re.search(r'(m²|€|bedroom|room|chambre)', part, re.IGNORECASE) and not any(char.isdigit() for char in part) and len(part) > 2:
                                    agency = part
                                    break
                        bedrooms = 0
                        bed_match = re.search(r'(\d+)\s*bedroom', title, re.IGNORECASE)
                        if bed_match: bedrooms = int(bed_match.group(1))
                        
                        prop_type = "Apartamento"
                        if "studio" in t_lower: prop_type = "Estudio"
                        elif "house" in t_lower: prop_type = "Casa"
                        elif "triplex" in t_lower: prop_type = "Triplex"
                        elif "duplex" in t_lower: prop_type = "Dúplex"
                        elif "penthouse" in t_lower: prop_type = "Penthouse"
                        elif any(x in t_lower for x in ["room", "chambre", "zimmer", "habitacion", "habitación"]) and not any(x in t_lower for x in ["apartment", "appartement", "penthouse", "duplex", "triplex", "flat"]): 
                            prop_type = "Habitación"
                        
                        import os
                        image_path = os.path.join(IMAGES_DIR, f"{sku}.jpg")
                        os.makedirs(os.path.dirname(image_path), exist_ok=True)
                        try:
                            img_elem = article.query_selector("picture img, img")
                            extracted_url = img_elem.get_attribute("src") if img_elem else ""
                            if extracted_url and extracted_url.startswith("http"):
                                image_url = extracted_url
                            else:
                                article.scroll_into_view_if_needed()
                                page.wait_for_timeout(400)
                                article.screenshot(path=image_path, type="jpeg", quality=40)
                                image_url = f"/api/scraper/image/{sku}"
                        except:
                            image_url = ""

                        print(f"  [+] Capturado: '{title[:40]}...' ({prop_type}) en {city} | {bedrooms} dorm, {surface}m² | {price}€ | {agency}")
                        
                        # EVALUACIÓN REGLAS TELEGRAM (BOTS)
                        import requests
                        import os
                        for rule in active_bot_rules:
                            try:
                                if rule.get('max_price') and price > rule['max_price']: continue
                                if rule.get('min_surface') and surface < rule['min_surface']: continue
                                
                                rule_user_id = rule.get('user_id')
                                
                                ref_address = scraper_db.get_user_scraper_ref(rule_user_id) if rule_user_id else "4 Rue Peternelchen, Howald"
                                if not ref_address: ref_address = "4 Rue Peternelchen, Howald"
                                office_coords = geocode_address(ref_address) or {'lat': 49.5826, 'lon': 6.1423}
                                prop_coords = geocode_address(f"{city}, Luxembourg")
                                
                                dist = None
                                if prop_coords and prop_coords.get('countrycode') and prop_coords.get('countrycode') != 'LU':
                                    dist = 999999.0
                                elif prop_coords and office_coords:
                                    dist = get_haversine_distance(office_coords['lat'], office_coords['lon'], prop_coords['lat'], prop_coords['lon'])
                                
                                if rule.get('max_distance') and dist is not None and dist > rule['max_distance']:
                                    continue
                                
                                # Saltar si el usuario ya tiene este piso en favoritos
                                if rule_user_id and scraper_db.is_user_product(rule_user_id, sku):
                                    print(f"      -> [Regla: {rule['name']}] SKU ya en favoritos, saltando.")
                                    continue
                                
                                keywords_str = rule.get('keywords', '')
                                parking_req = rule.get('parking', '')
                                pets_req = rule.get('pets', '')
                                avail_date = rule.get('availability_date', '')
                                needs_detail = keywords_str.strip() or parking_req or pets_req or avail_date
                                
                                matched_kws = []
                                parking_ok = True
                                pets_ok = True
                                avail_ok = True
                                
                                if needs_detail:
                                    import threading
                                    t = threading.Thread(target=_process_detail_background, args=(link, rule, price, surface, city, dist, sku, rule_user_id))
                                    t.start()
                                else:
                                    # If no advanced filters needed, send immediately
                                    print(f"      🚨 [Regla: {rule['name']}] ¡MATCH! Enviando a Telegram (sin filtros avanzados)...")
                                    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN")
                                    tg_chat = os.environ.get("TELEGRAM_CHAT_ID")
                                    
                                    if tg_token and tg_chat and _telegram_enabled():
                                        city_clean = city.replace("-", " ").title() if city else "Luxembourg"
                                        dist_str = f"{dist:.1f} km" if dist is not None else "Not specified"
                                        
                                        msg = (
                                            f"• Total Rent: {price:,.2f} €\n"
                                            f"• Size: {surface} m²\n"
                                            f"• Pets: Not specified\n"
                                            f"• Parking: Not specified\n"
                                            f"• Availability: Not specified\n"
                                            f"• Distance: {dist_str}\n"
                                            f"• Link: ({link})"
                                        )
                                        requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                                                      json={"chat_id": tg_chat, "text": msg, "parse_mode": "Markdown", "disable_web_page_preview": False},
                                                      timeout=5)
                                    
                                    # Marcar como favorito para evitar notificar de nuevo en futuras ejecuciones
                                    if rule_user_id:
                                        scraper_db.add_user_product(rule_user_id, sku)
                                        print(f"      -> [Regla: {rule['name']}] Añadido a favoritos.")
                            except Exception as ex:
                                print(f"      [!] Error evaluando regla {rule['name']}: {ex}")
                        products.append({
                            "sku": sku,
                            "title": title,
                            "brand": agency[:50],
                            "url": link,
                            "image": image_url,
                            "price": price,
                            "availability": city,
                            "rating_value": float(surface),
                            "rating_count": bedrooms,
                            "category": prop_type,
                            "query": display_query,
                            "scraper_type": "athome",
                            "timestamp": time.time()
                        })
                    else:
                        print(f"  [-] Descartado (No cumple min_surface={min_surface}m²): '{title[:40]}...' | Superficie detectada: {surface}m²")
                
                if products:
                    save_products(products, query_origin=display_query, scraper_type="athome")
                    total_apartments += len(products)
                    print(f"[Scraper atHome] [Página {page_num}] ✅ Guardadas {len(products)} propiedades válidas en DB.")
                    print(f"[Scraper atHome] -> Ejemplo: {products[0]['title']} | Agencia: {products[0]['brand']} | Precio: {products[0]['price']}€")
                else:
                    print(f"[Scraper atHome] [Página {page_num}] ⚠️ Advertencia: No se extrajeron propiedades válidas (quizás no cumplían criterios de superficie o precio).")
                
            except Exception as e:
                print(f"[Scraper Diario] Error en página {page_num}: {e}")
            finally:
                page.close()
                
            import random
            for _ in range(int(random.uniform(5.0, 10.0))):
                if cancellable and CANCEL_ROUTINE: break
                time.sleep(1)
            
        browser.close()
        print(f"[Scraper Diario] Finalizado. Total apartamentos extraídos: {total_apartments}.")

def _scrape_detail(url, sku):
    from url_guard import validate_public_url
    from playwright.sync_api import sync_playwright
    import os
    import requests
    
    validate_public_url(url)
    
    desc_text = "No se pudo extraer la descripción."
    contact_text = "Contacto no disponible."
    images = []
    local_images = []
    specs = {}
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        try:
            page.goto(url, timeout=30000)
            page.wait_for_timeout(3000)
            
            if "athome.lu" in url:
                try:
                    html_content = page.content().lower()
                    body_text = page.locator('body').inner_text().lower()
                    page_title = page.title().lower()
                    
                    removed_keywords = [
                        "has been removed", "n'est plus sur le marché", "taken out", 
                        "off market", "plus disponible", "no longer available"
                    ]
                    title_keywords = ['vendido', 'sold', 'taken out', 'vendu', 'loué', 'rented', 'removed', 'agotado']
                    
                    if any(k in body_text for k in removed_keywords):
                        specs["is_removed"] = True
                    elif any(k in page_title for k in title_keywords):
                        specs["is_removed"] = True
                except: pass
                try:
                    desc_text_loc = page.locator('.description, [itemprop="description"], h2:has-text("Description") + div').first.inner_text()
                    if desc_text == "No se pudo extraer la descripción.": desc_text = desc_text_loc
                    else: desc_text += "\n\n" + desc_text_loc
                except: pass
                
                try:
                    details_texts = page.locator('ul li, dl dt, dl dd, [class*="feature"], [class*="amenity"]').all_inner_texts()
                    clean_details = [d.strip() for d in details_texts if d.strip() and len(d.strip()) < 150]
                    if clean_details:
                        # Use a set to remove duplicates while preserving some order
                        seen = set()
                        unique_details = [x for x in clean_details if not (x in seen or seen.add(x))]
                        desc_text += "\n\nCaracterísticas adicionales:\n" + " | ".join(unique_details)
                except: pass
                try:
                    price_text = page.locator('.price, [class*="price"], [itemprop="price"]').first.inner_text()
                    if price_text and len(price_text.strip()) > 0:
                        import re
                        digits = re.findall(r'\d+', price_text)
                        if digits and all(int(d) == 0 for d in digits):
                            specs["is_removed"] = True
                except: pass
                try:
                    img_locators = page.locator('img').all()
                    for img in img_locators:
                        src = img.get_attribute('src')
                        if src and 'http' in src and 'avatar' not in src.lower() and 'logo' not in src.lower() and 'icon' not in src.lower():
                            if src not in images:
                                images.append(src)
                except: pass
                try:
                    contact_text = page.locator('div[class*="agency"], div[class*="contact"], div[class*="Contact"]').first.inner_text()
                except: pass

            else:
                # PcComponentes: extract technical specifications table
                # Strategy 1: structured <tr><td>key</td><td>value</td></tr> table
                try:
                    rows = page.locator('tr').all()
                    for row in rows:
                        cells = row.locator('td').all()
                        if len(cells) >= 2:
                            key = cells[0].inner_text().strip()
                            val = cells[1].inner_text().strip()
                            if key and val and len(key) < 80 and len(val) < 400:
                                specs[key] = val
                except: pass
                
                # Strategy 2: <dl><dt>key</dt><dd>value</dd></dl> pairs
                if not specs:
                    try:
                        dts = page.locator('dt').all()
                        dds = page.locator('dd').all()
                        for dt, dd in zip(dts, dds):
                            key = dt.inner_text().strip()
                            val = dd.inner_text().strip()
                            if key and val and len(key) < 80:
                                specs[key] = val
                    except: pass
                
                # Strategy 3: fallback to plain article description text
                if specs:
                    desc_text = "\n".join(f"{k}: {v}" for k, v in specs.items())
                else:
                    try:
                        desc_text = page.locator('#article-description, .article-description, [class*="description"]').first.inner_text()
                    except: pass

        except Exception as e:
            print(f"[Scrape Detail] Error: {e}")
        finally:
            browser.close()

    # Only download images for athome listings; pccomponentes returns specs only
    if "athome.lu" in url:
        os.makedirs(IMAGES_DIR, exist_ok=True)
        for i, img_url in enumerate(images[:5]):
            try:
                r = requests.get(img_url, timeout=10)
                if r.status_code == 200:
                    filename = f"{sku}_detail_{i}.jpg"
                    filepath = os.path.join(IMAGES_DIR, filename)
                    with open(filepath, 'wb') as f:
                        f.write(r.content)
                    local_images.append(f"/api/scraper/image/{sku}_detail_{i}")
            except Exception as e:
                print(f"[Scrape Detail] Image download error: {e}")

    return {"description": desc_text, "contact": contact_text, "images": local_images, "specs": specs}

