// El STORAGE_KEY ahora es dinámico según el usuario
const THEME_KEY = 'theme';
const API_BASE = '/api/events';

/** Lee el token de sesión desde las cookies */
function _getToken() {
  const value = `; ${document.cookie}`;
  const parts = value.split('; token=');
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

/** Lee el nombre de usuario desde las cookies */
function _getUser() {
  const value = `; ${document.cookie}`;
  const parts = value.split('; user=');
  if (parts.length === 2) return parts.pop().split(';').shift();
  return 'guest';
}

function _getStorageKey() {
  return `calendar_events_v1_${_getUser()}`;
}

/** Headers comunes para todas las peticiones a la API */
function _apiHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'X-Token': _getToken(), ...extra };
}

/* ── Helpers internos ─────────────────────────────────────── */

/** Diff entre dos arrays de eventos → { added, updated, deleted } */
function _diffEvents(previous, current) {
  const prevMap = new Map(previous.map(e => [e.id, e]));
  const currMap = new Map(current.map(e => [e.id, e]));

  const added = current.filter(e => !prevMap.has(e.id));
  const updated = current.filter(e => {
    if (!prevMap.has(e.id)) return false;
    return JSON.stringify(prevMap.get(e.id)) !== JSON.stringify(e);
  });
  const deleted = previous.filter(e => !currMap.has(e.id));

  return { added, updated, deleted };
}

/** Sincroniza cambios al servidor en background (fire-and-forget) */
async function _syncToAPI(previous, current) {
  const { added, updated, deleted } = _diffEvents(previous, current);

  const requests = [
    ...added.map(ev =>
      fetch(API_BASE, {
        method: 'POST',
        headers: _apiHeaders(),
        body: JSON.stringify(ev),
      })
    ),
    ...updated.map(ev =>
      fetch(`${API_BASE}/${ev.id}`, {
        method: 'PUT',
        headers: _apiHeaders(),
        body: JSON.stringify(ev),
      })
    ),
    ...deleted.map(ev =>
      fetch(`${API_BASE}/${ev.id}`, { method: 'DELETE', headers: _apiHeaders() })
    ),
  ];

  try {
    await Promise.all(requests);
  } catch (err) {
    console.warn('[Storage] Sync to API failed (offline?):', err.message);
  }
}

/* ── Interfaz pública ─────────────────────────────────────── */

const Storage = {
  /** Devuelve eventos desde localStorage (síncrono) */
  getAll() {
    try { return JSON.parse(localStorage.getItem(_getStorageKey())) || []; }
    catch { return []; }
  },

  /**
   * Guarda el array completo en localStorage y lanza sync a API en background.
   * Mantiene la misma firma síncrona que la versión original.
   */
  save(events) {
    const previous = this.getAll();
    localStorage.setItem(_getStorageKey(), JSON.stringify(events));
    _syncToAPI(previous, events);   // background, no await
  },

  getTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  },

  setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  },

  exportJSON() {
    const data = { version: 1, exported: new Date().toISOString(), events: this.getAll() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calendar_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  importJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const list = Array.isArray(parsed) ? parsed : (parsed.events || []);
      if (!Array.isArray(list)) return false;
      const existing = this.getAll();
      const ids = new Set(existing.map(e => e.id));
      const merged = [...existing, ...list.filter(e => !ids.has(e.id))];
      this.save(merged);   // persiste en localStorage + sync API
      return merged.length - existing.length;
    } catch { return false; }
  },

  /**
   * Carga todos los eventos desde la API y actualiza localStorage.
   * Dispara 'calendar:synced' cuando termina para que la UI se refresque.
   * Se llama automáticamente al cargar el script (segundo plano).
   */
  async syncFromAPI() {
    try {
      const res = await fetch(API_BASE, { headers: _apiHeaders() });
      if (!res.ok) return;
      const events = await res.json();
      localStorage.setItem(_getStorageKey(), JSON.stringify(events));
      window.dispatchEvent(new CustomEvent('calendar:synced'));
    } catch (err) {
      console.info('[Storage] Modo offline: usando localStorage.', err.message);
    }
  },
};

/* ── Auto-sync al cargar ──────────────────────────────────── */
// Espera a que el DOM esté listo para no competir con App.init()
document.addEventListener('DOMContentLoaded', () => {
  Storage.syncFromAPI();
});
