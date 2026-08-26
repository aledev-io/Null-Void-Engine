/* ────────────────────────────────────────────────────────────
   SCRAPER MODULE · State
   Estado centralizado del módulo + persistencia en localStorage.
   window.scraperPresets: contrato público con scraper_assistant.js
   (ese archivo lee window.scraperPresets directamente; usa los
   helpers set/getScraperPresets desde el módulo).
   ──────────────────────────────────────────────────────────── */

export const state = {
  // Colección de productos y ordenación
  allData: [],
  sortQueue: [{ field: 'last_updated', dir: -1 }],

  // Favoritos / descartados (persistidos en localStorage)
  favorites: JSON.parse(localStorage.getItem('nv_favorites') || '[]'),
  discarded: JSON.parse(localStorage.getItem('nv_discarded') || '[]'),
  filterFavsOnly: false,
  filterDiscardedOnly: false,
  fluctuationSort: 'none',
  selectedSkus: new Set(),

  // Geolocalización
  locationCoordsCache: {},

  // Ordenación por distancia
  isSortingByDistance: false,
  cancelSortCounter: 0,

  // Contexto de carga, scraping y UI
  currentTargetContext: null,
  pollingInterval: null,
  currentProductSku: null,
  isBatchScrapingDescriptions: false,
  oldPresetNameForRename: null,
  distanceUpdateTimeout: null,

  // Paginación y filtrado (antiguos window.currentPage / currentFilteredData / ...)
  page: 1,
  PAGE_SIZE: 9,
  filteredData: null,
  isFiltered: false,
  _scrapeProgressTotal: 0,
  _scrapeProgressProducts: 0,
};

export function saveFavorites() {
  localStorage.setItem('nv_favorites', JSON.stringify(state.favorites));
}

export function saveDiscarded() {
  localStorage.setItem('nv_discarded', JSON.stringify(state.discarded));
}

// Contrato público con scraper_assistant.js: ese archivo lee window.scraperPresets.
export function setScraperPresets(presets) {
  window.scraperPresets = presets;
}

export function getScraperPresets() {
  return window.scraperPresets || {};
}