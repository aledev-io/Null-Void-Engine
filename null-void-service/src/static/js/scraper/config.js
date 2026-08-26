/* ────────────────────────────────────────────────────────────
   SCRAPER MODULE · Config
   Integración con window.SCRAPER_CONFIG (token, user, user_avatar_url)
   ──────────────────────────────────────────────────────────── */

const tabId = (() => {
  let t = sessionStorage.getItem('nv_tab_id');
  if (!t) {
    t = 'tab_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('nv_tab_id', t);
  }
  return t;
})();

export const SCRAPER_CONFIG = window.SCRAPER_CONFIG || { token: '', user: '', user_avatar_url: '' };
export const TOKEN = SCRAPER_CONFIG.token;
export const HEADERS = { 'X-Token': TOKEN, 'X-Tab-Id': tabId, 'Content-Type': 'application/json' };