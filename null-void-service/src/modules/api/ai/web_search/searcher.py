"""Búsqueda web en tiempo real utilizando DuckDuckGo y extracción de precios."""
from typing import List
from .scraper import _scrape_page_prices

_PRICE_KEYWORDS = [
    "precio", "precios", "cuánto cuesta", "cuanto cuesta", "cuánto vale", "cuanto vale",
    "comprar", "barato", "oferta", "ofertas", "descuento", "comparar precios",
    "price", "cost", "cheap", "buy", "deal", "discount",
    "mejor precio", "dónde comprar", "donde comprar", "tienda",
    "amazon", "pccomponentes", "mediamarkt", "el corte inglés", "fnac",
    "€", "euros", "dolares", "$", "usd"
]


def _is_price_query(query: str) -> bool:
    """Detecta si la consulta del usuario trata sobre precios o compras."""
    q_lower = (query or "").lower()
    return any(kw in q_lower for kw in _PRICE_KEYWORDS)


def perform_web_search(query: str) -> str:
    """Ejecuta una búsqueda web en DuckDuckGo con soporte para precios y fuentes."""
    if not query or not query.strip():
        return "Consulta vacía."

    try:
        from ddgs import DDGS

        is_price = _is_price_query(query)
        results: List[str] = []

        with DDGS() as ddgs:
            if is_price:
                stores = ["amazon.es", "pccomponentes.com", "mediamarkt.es", "el corte inglés", "fnac.es"]

                general_results = list(ddgs.text(f"{query} precio", max_results=4))
                for res in general_results:
                    title = res.get('title', '')
                    snippet = res.get('body', '')
                    url = res.get('href', '')
                    if title and snippet:
                        results.append(f"Fuente: {title}\nURL: {url}\nInformación: {snippet}")

                for store in stores[:3]:
                    try:
                        store_results = list(ddgs.text(f"{query} {store} precio", max_results=2))
                        for res in store_results:
                            title = res.get('title', '')
                            snippet = res.get('body', '')
                            url = res.get('href', '')
                            if title and snippet:
                                results.append(f"Fuente [{store}]: {title}\nURL: {url}\nInformación: {snippet}")
                    except Exception:
                        continue

                seen_urls = []
                for res in general_results[:3]:
                    url = res.get('href', '')
                    if url and url not in seen_urls:
                        seen_urls.append(url)
                        scraped = _scrape_page_prices(url)
                        if scraped:
                            results.append(f"[PRECIO EXTRAÍDO DE PÁGINA]\nURL: {url}\n{scraped}")
            else:
                search_results = list(ddgs.text(query, max_results=6))
                for res in search_results:
                    title = res.get('title', '')
                    snippet = res.get('body', '')
                    url = res.get('href', '')
                    if title and snippet:
                        results.append(f"Fuente: {title}\nURL: {url}\nInformación: {snippet}")

        if not results:
            return "No se encontraron resultados relevantes en la web o el buscador bloqueó la consulta."

        return "\n\n".join(results)
    except Exception as e:
        return f"Error durante la búsqueda: {str(e)}"
