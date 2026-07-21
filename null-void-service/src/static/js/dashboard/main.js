import { initCommonUI } from './ui.js';
import { initSettings } from './settings.js';
import { fetchApps } from './system.js';
import { initCalendarWidget } from './calendar_widget.js';

const _originalFetch = window.fetch;
window.fetch = async function (...args) {
    const response = await _originalFetch.apply(this, args);
    if (response.status === 401 && typeof args[0] === 'string' && args[0].startsWith('/api/')) {
        console.warn('[Session] Token expirado, redirigiendo a login...');
        window.location.href = '/';
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

document.addEventListener('DOMContentLoaded', () => {
    initSettings();
    initCommonUI();

    loadUserProfile();
    fetchApps();
    initCalendarWidget();

    const params = new URLSearchParams(location.search);
    let view = params.get('view');
    const hash = location.hash.substring(1);
    if (hash === 'perfil') view = 'config';
    else if (hash && !view) view = hash;

    history.replaceState({ view: view || 'menu' }, '', '/app');
    window.showView('menu', false);
    window.updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');

    if (view) {
        setTimeout(() => {
            if (typeof window.showView === 'function') window.showView(view);
        }, 50);
    }
});