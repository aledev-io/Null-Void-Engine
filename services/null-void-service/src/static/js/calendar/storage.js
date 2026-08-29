import { Events } from './events.js';

const THEME_KEY = 'theme';
const API_BASE = '/api/events';
const eventsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nv_events_channel') : null;

if (eventsChannel) {
  eventsChannel.onmessage = (msg) => {
    if (msg && msg.data && msg.data.type === 'EVENT_CHANGED') {
      Storage.syncFromAPI();
    }
  };
}

function _getToken() {
  const value = `; ${document.cookie}`;
  const parts = value.split('; token=');
  if (parts.length === 2) return parts.pop().split(';').shift();
  return (typeof window !== 'undefined' && window.TOKEN) || '';
}

function _getUser() {
  const value = `; ${document.cookie}`;
  const parts = value.split('; user=');
  if (parts.length === 2) return parts.pop().split(';').shift();
  return 'guest';
}

function _getStorageKey() {
  return `calendar_events_v1_${_getUser()}`;
}

function _getPendingKey() {
  return `calendar_events_pending_v1_${_getUser()}`;
}

function _getDeletedKey() {
  return `calendar_events_deleted_pending_v1_${_getUser()}`;
}

function _apiHeaders(extra = {}) {
  const token = _getToken();
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers['X-Token'] = token;
  return headers;
}

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

function _getSet(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key));
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}

function _setSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

let _errorNotifiedAt = 0;

function _notifyError() {
  const now = Date.now();
  if (now - _errorNotifiedAt < 15000) return;
  _errorNotifiedAt = now;
  window.dispatchEvent(new CustomEvent('calendar:sync-error', { detail: { key: 'sync_error' } }));
}

function _isRecent(ev) {
  const t = Date.parse(ev.createdAt || ev.created_at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 30 * 24 * 3600 * 1000;
}

async function _syncPending() {
  const pending = _getSet(_getPendingKey());
  const toDelete = _getSet(_getDeletedKey());
  if (!pending.size && !toDelete.size) return true;

  let dbIds = new Set();
  try {
    const res = await fetch(`${API_BASE}`, { headers: _apiHeaders() });
    if (!res.ok) { _notifyError(); return false; }
    dbIds = new Set((await res.json()).map(e => e.id));
  } catch {
    _notifyError();
    return false;
  }

  const local = Storage.getAll();
  const ok = new Set();
  const failed = new Set();
  const okDel = new Set();
  const failedDel = new Set();

  await Promise.all([...pending].map(async (id) => {
    const ev = local.find(e => e.id === id);
    if (!ev) { ok.add(id); return; }
    try {
      const res = await fetch(`${API_BASE}${dbIds.has(id) ? `/${id}` : ''}`, {
        method: dbIds.has(id) ? 'PUT' : 'POST',
        headers: _apiHeaders(),
        body: JSON.stringify(ev),
      });
      if (res.ok) ok.add(id);
      else failed.add(id);
    } catch { failed.add(id); }
  }));

  await Promise.all([...toDelete].map(async (id) => {
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE', headers: _apiHeaders() });
      if (res.ok) okDel.add(id);
      else failedDel.add(id);
    } catch { failedDel.add(id); }
  }));

  if (ok.size) {
    const p = _getSet(_getPendingKey());
    ok.forEach(id => p.delete(id));
    _setSet(_getPendingKey(), p);
  }
  if (okDel.size) {
    const d = _getSet(_getDeletedKey());
    okDel.forEach(id => d.delete(id));
    _setSet(_getDeletedKey(), d);
  }

  if (failed.size || failedDel.size) {
    const p = _getSet(_getPendingKey());
    failed.forEach(id => p.add(id));
    _setSet(_getPendingKey(), p);
    const d = _getSet(_getDeletedKey());
    failedDel.forEach(id => d.add(id));
    _setSet(_getDeletedKey(), d);
    _notifyError();
    return false;
  }

  window.dispatchEvent(new CustomEvent('calendar:synced'));
  if (eventsChannel) eventsChannel.postMessage({ type: 'EVENT_CHANGED' });
  return true;
}

export const Storage = {
  getAll() {
    try { return JSON.parse(localStorage.getItem(_getStorageKey())) || []; }
    catch { return []; }
  },

  save(events) {
    const previous = this.getAll();
    const { added, updated, deleted } = _diffEvents(previous, events);
    localStorage.setItem(_getStorageKey(), JSON.stringify(events));
    window.dispatchEvent(new CustomEvent('calendar:changed'));
    if (eventsChannel) eventsChannel.postMessage({ type: 'EVENT_CHANGED' });

    if (added.length || updated.length) {
      const p = _getSet(_getPendingKey());
      added.concat(updated).forEach(e => p.add(e.id));
      _setSet(_getPendingKey(), p);
    }
    if (deleted.length) {
      const d = _getSet(_getDeletedKey());
      deleted.forEach(e => d.add(e.id));
      _setSet(_getDeletedKey(), d);
    }

    _syncPending();
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
      this.save(merged);
      return merged.length - existing.length;
    } catch { return false; }
  },

  async syncFromAPI() {
    try {
      const token = _getToken();
      const res = await fetch(`${API_BASE}`, { headers: _apiHeaders() });
      if (!res.ok) return;
      let events = await res.json();
      const pending = _getSet(_getPendingKey());
      const dbIds = new Set(events.map(e => e.id));
      const local = this.getAll();
      const keep = local.filter(e => !dbIds.has(e.id) && (pending.has(e.id) || _isRecent(e)));
      if (keep.length) {
        keep.forEach(e => pending.add(e.id));
        _setSet(_getPendingKey(), pending);
        events = events.concat(keep).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      }
      const incoming = JSON.stringify(events);
      if (incoming === localStorage.getItem(_getStorageKey())) {
        _syncPending();
        return;
      }
      localStorage.setItem(_getStorageKey(), incoming);
      window.dispatchEvent(new CustomEvent('calendar:synced'));
      _syncPending();
    } catch (err) {
      console.info('[Storage] Modo offline: usando localStorage.', err.message);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => {
  // Delay sync to avoid double render competing with initial paint
  setTimeout(() => Storage.syncFromAPI(), 1500);
});

window.addEventListener('online', () => Storage.syncFromAPI());
