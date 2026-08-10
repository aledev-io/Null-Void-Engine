import { initCommonUI } from './ui.js';
import { initSettings } from './settings.js';
import { fetchApps } from './system.js';
import { initCalendarWidget } from './calendar_widget.js';

const _originalFetch = window.fetch;
let _sessionCheckTimestamp = 0;
let _sessionCheckResult = null;

async function _isSessionReallyInvalid() {
    // Verifica rápido (cacheando 3s) si la sesión sigue viva consultando /api/user/me.
    // Evita echar al login por 401 transitorios (reinicio del servidor, permisos puntuales).
    const now = Date.now();
    if (now - _sessionCheckTimestamp < 3000 && _sessionCheckResult !== null) return _sessionCheckResult;
    _sessionCheckTimestamp = now;
    try {
        const r = await _originalFetch('/api/user/me', { headers: window.HEADERS, credentials: 'include' });
        _sessionCheckResult = !r.ok;
    } catch (error) {
        _sessionCheckResult = false;
    }
    return _sessionCheckResult;
}

window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);
    if (response.status === 401 && typeof args[0] === 'string' && args[0].startsWith('/api/')) {
        if (await _isSessionReallyInvalid()) {
            console.warn(window.t ? window.t('sess_expired_redirect') : '[Session] Token expirado, redirigiendo a login...');
            window.location.href = '/';
        }
    }
    return response;
};

async function loadUserProfile() {
    try {
        const response = await fetch('/api/user/me', { headers: window.HEADERS });
        if (!response.ok) return;
        const data = await response.json();
        
        const usernameEls = [document.getElementById('nav-username'), document.getElementById('nav-username-large')];
        usernameEls.forEach(el => { if (el) el.textContent = data.username; });
        
        const emailEl = document.getElementById('nav-user-email');
        if (emailEl) {
            emailEl.textContent = `${data.username}@nullvoid`;
        }
        const cfgEmailStatic = document.getElementById('cfg-email-field-static');
        if (cfgEmailStatic) {
            cfgEmailStatic.value = `${data.username}@nullvoid`;
        }
        
        const cfgUsernameStatic = document.getElementById('cfg-username-field-static');
        if (cfgUsernameStatic) cfgUsernameStatic.value = data.username;
        const cfgUsernameEdit = document.getElementById('cfg-username-edit');
        if (cfgUsernameEdit) {
            cfgUsernameEdit.value = data.username;
            if (window.checkPendingChanges) window.checkPendingChanges();
        }
        const cfgUidStatic = document.getElementById('cfg-uid-field-static');
        if (cfgUidStatic && data.user_id) cfgUidStatic.value = data.user_id;
    } catch (e) {
        console.error("[Session] Error cargando perfil:", e);
    }
}

function bootDashboard() {
    // Cada componente se inicializa en su propio try/catch: si uno falla en la
    // carga en frío (p. ej. localStorage no disponible en un WebView, una
    // petición lenta o un módulo roto), el resto de la app sigue montándose y
    // la interfaz nunca se queda a medias ni congelada.
    try { initSettings(); } catch (e) { console.error('[Init] initSettings falló:', e); }
    try { initCommonUI(); } catch (e) { console.error('[Init] initCommonUI falló:', e); }

    loadUserProfile();
    fetchApps();
    try { initCalendarWidget(); } catch (e) { console.error('[Init] initCalendarWidget falló:', e); }

    const params = new URLSearchParams(location.search);
    let view = params.get('view');
    const hash = location.hash.substring(1);
    if (hash === 'perfil') view = 'config';
    else if (hash && !view) view = hash;

    history.replaceState({ view: view || 'menu' }, '', '/app');
    try {
        window.showView('menu', false);
    } catch (e) {
        // Fallback: si el módulo de UI no llegó a montarse, activar la vista
        // base manualmente para no dejar la aplicación congelada.
        console.error('[Init] showView falló, activando la vista base manualmente:', e);
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const menuView = document.getElementById('view-menu');
        if (menuView) menuView.classList.add('active');
        const main = document.getElementById('main');
        if (main) main.style.display = 'block';
    }
    try {
        window.updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');
    } catch (e) { /* noop */ }

    if (view) {
        setTimeout(() => {
            try {
                if (typeof window.showView === 'function') window.showView(view);
            } catch (e) {
                console.error('[Init] No se pudo abrir la vista inicial:', view, e);
            }
        }, 50);
    }
}

// Arranque robusto: si el script se evalúa después de que el DOM ya esté
// listo (carga desde caché, shell nativo, etc.), se ejecuta la inicialización
// de inmediato en lugar de esperar un evento DOMContentLoaded que ya ocurrió.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDashboard);
} else {
    bootDashboard();
}