/* ────────────────────────────────────────────────────────────
   SCRAPER MODULE · API client
   fetchAPI: wrapper central de fetch con HEADERS unificados y
   manejo centralizado de sesión expirada (401/403 → redirect "/").
   Devuelve null tras redirigir; los callers deben abortar con
   `if (!res) return;`.
   ──────────────────────────────────────────────────────────── */
import { HEADERS } from './config.js';

export async function fetchAPI(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) }
  });
  if (res.status === 401 || res.status === 403) {
    window.location.href = "/";
    return null;
  }
  return res;
}