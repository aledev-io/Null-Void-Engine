import { APPS, renderAppLauncher } from './system.js';

export function showView(name, pushToHistory = true) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    
    // Update sidebar active state
    document.querySelectorAll('.nav-item, .nav-btn').forEach(el => el.classList.remove('active'));
    const navItem = document.getElementById('nav-btn-' + name);
    if (navItem) navItem.classList.add('active');
    
    const target = document.getElementById('view-' + name);
    if (target) {
        target.classList.add('active');
        if (pushToHistory) {
            history.pushState({ view: name }, '', '/app');
        }
    }
    const main = document.getElementById('main');
    const topbar = document.getElementById('topbar');

    if (name === 'chat' || name === 'ai') {
        main.classList.add('cloud-active');
        if (topbar) topbar.style.display = 'none';
        main.style.display = 'none';
        main.style.maxWidth = '100%';
        main.style.padding = '0';
    } else {
        main.classList.remove('cloud-active');
        if (topbar) topbar.style.display = 'flex';
        main.style.display = 'block';
        main.style.maxWidth = '1200px';
        main.style.padding = '40px 20px 20px 20px';
    }

    const chatFab = document.querySelector('.floating-chat-container');
    const chatWindow = document.getElementById('chat-window');
    if (chatFab) chatFab.style.display = (name === 'menu') ? '' : 'none';
    if (chatWindow && name !== 'menu') chatWindow.classList.remove('open');
}

window.addEventListener('popstate', (event) => {
    if (event.state && event.state.view) {
        showView(event.state.view, false);
    } else {
        showView('menu', false);
    }
});

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';

    if (typeof saveUISettings === 'function') {
        saveUISettings('theme', next);
    } else {
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcon(next);
    }
}

export function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon-svg');
    if (!icon) return;
    if (theme === 'light') {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    }
}

export function updateNetStatus() {
    const badge = document.getElementById('net-badge');
    const text = document.getElementById('net-text');
    const dot = document.getElementById('net-dot');
    if (!badge || !text || !dot) return;

    if (navigator.onLine) {
        text.textContent = 'Online';
        text.style.color = 'var(--text-dim)';
        badge.style.borderColor = 'rgba(99,102,241,0.38)';
        badge.style.background = 'var(--indigo-dim)';
        dot.style.background = 'var(--indigo)';
        dot.style.boxShadow = '0 0 8px rgba(99,102,241,1)';
        dot.style.animation = 'pulse 2s infinite';
    } else {
        text.textContent = 'Offline';
        text.style.color = '#f87171';
        badge.style.borderColor = 'rgba(248,113,113,0.38)';
        badge.style.background = 'rgba(248,113,113,0.1)';
        dot.style.background = '#f87171';
        dot.style.boxShadow = '0 0 8px rgba(248,113,113,0.8)';
        dot.style.animation = 'none';
    }
}


export async function handleLogout() {
    const fcmToken = localStorage.getItem('nv_fcm_token');
    const body = fcmToken ? JSON.stringify({ fcm_token: fcmToken }) : null;
    await fetch('/api/logout', { 
        method: 'POST', 
        headers: window.HEADERS,
        body: body
    }).catch(() => { });
    localStorage.removeItem('theme');
    localStorage.removeItem('nv_chat_contact');
    localStorage.removeItem('nv_fcm_token');
    location.href = '/';
}

let _nvDialogResolve = null;
let _nvDialogKeyHandler = null;

function _nvShowDialog() {
    const overlay = document.getElementById('nv-dialog-overlay');
    if (overlay) overlay.style.display = 'flex';
}

export function NV_CloseDialog() {
    const overlay = document.getElementById('nv-dialog-overlay');
    if (overlay) overlay.style.display = 'none';
    if (_nvDialogKeyHandler) {
        document.removeEventListener('keydown', _nvDialogKeyHandler);
        _nvDialogKeyHandler = null;
    }
    if (_nvDialogResolve) {
        _nvDialogResolve(null);
        _nvDialogResolve = null;
    }
}

export function NV_Alert(text, title = "Null-Void") {
    return new Promise(resolve => {
        NV_CloseDialog();
        _nvDialogResolve = null;

        document.getElementById('nv-dialog-title').textContent = title;
        document.getElementById('nv-dialog-text').textContent = text;
        document.getElementById('nv-dialog-text').style.display = text ? 'block' : 'none';
        document.getElementById('nv-dialog-input').style.display = 'none';
        document.getElementById('nv-dialog-cancel').style.display = 'none';
        document.getElementById('nv-dialog-confirm').textContent = 'Aceptar';

        const confirmBtn = document.getElementById('nv-dialog-confirm');
        confirmBtn.onclick = () => {
            _nvDialogResolve = null;
            NV_CloseDialog();
            resolve(true);
        };

        _nvDialogKeyHandler = (e) => {
            if (e.key === 'Enter') { confirmBtn.click(); }
            if (e.key === 'Escape') { confirmBtn.click(); }
        };
        document.addEventListener('keydown', _nvDialogKeyHandler);

        _nvDialogResolve = resolve;
        _nvShowDialog();
    });
}

export function NV_Prompt(text, defaultValue = "", title = "Cambiar nombre", confirmText = "Aceptar", cancelText = "Cancelar") {
    return new Promise(resolve => {
        NV_CloseDialog();
        _nvDialogResolve = null;

        document.getElementById('nv-dialog-title').textContent = title;
        document.getElementById('nv-dialog-text').textContent = text;
        document.getElementById('nv-dialog-text').style.display = text ? 'block' : 'none';

        const input = document.getElementById('nv-dialog-input');
        input.style.display = 'block';
        input.value = defaultValue;

        document.getElementById('nv-dialog-cancel').style.display = 'inline-block';
        document.getElementById('nv-dialog-cancel').textContent = cancelText;
        document.getElementById('nv-dialog-confirm').textContent = confirmText;

        const confirmBtn = document.getElementById('nv-dialog-confirm');
        const cancelBtn = document.getElementById('nv-dialog-cancel');

        confirmBtn.onclick = () => {
            const val = input.value;
            _nvDialogResolve = null;
            NV_CloseDialog();
            resolve(val);
        };
        cancelBtn.onclick = () => {
            _nvDialogResolve = null;
            NV_CloseDialog();
            resolve(null);
        };

        _nvDialogKeyHandler = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
            if (e.key === 'Escape') { cancelBtn.click(); }
        };
        document.addEventListener('keydown', _nvDialogKeyHandler);

        _nvDialogResolve = resolve;
        _nvShowDialog();
        setTimeout(() => { input.focus(); input.select(); }, 50);
    });
}

export function NV_Confirm(text, title = "Confirmar acción", confirmText = "Confirmar", cancelText = "Cancelar") {
    return new Promise(resolve => {
        NV_CloseDialog();
        _nvDialogResolve = null;

        document.getElementById('nv-dialog-title').textContent = title;
        document.getElementById('nv-dialog-text').textContent = text;
        document.getElementById('nv-dialog-text').style.display = 'block';
        document.getElementById('nv-dialog-input').style.display = 'none';
        document.getElementById('nv-dialog-cancel').style.display = 'inline-block';
        document.getElementById('nv-dialog-cancel').textContent = cancelText;
        document.getElementById('nv-dialog-confirm').textContent = confirmText;

        const confirmBtn = document.getElementById('nv-dialog-confirm');
        const cancelBtn = document.getElementById('nv-dialog-cancel');

        confirmBtn.onclick = () => {
            _nvDialogResolve = null;
            NV_CloseDialog();
            resolve(true);
        };
        cancelBtn.onclick = () => {
            _nvDialogResolve = null;
            NV_CloseDialog();
            resolve(false);
        };

        _nvDialogKeyHandler = (e) => {
            if (e.key === 'Enter') { confirmBtn.click(); }
            if (e.key === 'Escape') { cancelBtn.click(); }
        };
        document.addEventListener('keydown', _nvDialogKeyHandler);

        _nvDialogResolve = resolve;
        _nvShowDialog();
    });
}

export function initCommonUI() {
    updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');
    updateNetStatus();

    window.addEventListener('online', updateNetStatus);
    window.addEventListener('offline', updateNetStatus);

    window.addEventListener('storage', (e) => {
        if (e.key === 'theme' && e.newValue) {
            document.documentElement.setAttribute('data-theme', e.newValue);
            updateThemeIcon(e.newValue);
        }
    });

    window.addEventListener('click', (e) => {
        const menu = document.getElementById('context-menu');
        if (menu && !menu.contains(e.target)) menu.style.display = 'none';

        const dropdown = document.getElementById('profile-dropdown');
        if (dropdown && !dropdown.contains(e.target) && !e.target.closest('#profile-trigger')) {
            dropdown.classList.remove('show');
        }

        const sidebar = document.getElementById('main-sidebar');
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (sidebar && sidebar.classList.contains('open')) {
            if (!sidebar.contains(e.target) && mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });

    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('main-sidebar');
            if (sidebar) sidebar.classList.toggle('open');
        });
    }


    document.getElementById('btn-notifications-history')?.addEventListener('click', () => {
        import('./notifications.js').then(m => m.fetchNotificationHistory());
    });
    document.getElementById('close-notif-modal')?.addEventListener('click', () => {
        document.getElementById('notif-modal').style.display = 'none';
    });
    document.getElementById('clear-all-notifs')?.addEventListener('click', () => {
        import('./notifications.js').then(m => m.clearAllNotifications());
    });

    const mainNotes = document.getElementById('main-quick-notes');
    const notesTag = document.getElementById('notes-save-tag');
    if (mainNotes) {
        mainNotes.value = localStorage.getItem('nv_notes') || '';
        mainNotes.addEventListener('input', () => {
            localStorage.setItem('nv_notes', mainNotes.value);
            if (notesTag) {
                notesTag.style.opacity = '1';
                setTimeout(() => { notesTag.style.opacity = '0'; }, 1000);
            }
        });
    }
}

window.showView = showView;
window.toggleTheme = toggleTheme;
window.updateThemeIcon = updateThemeIcon;
window.updateNetStatus = updateNetStatus;
window.handleLogout = handleLogout;
window.NV_Alert = NV_Alert;
window.NV_Prompt = NV_Prompt;
window.NV_Confirm = NV_Confirm;
window.NV_CloseDialog = NV_CloseDialog;
window.initCommonUI = initCommonUI;