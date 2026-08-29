// Lógica migrada directamente desde los bloques <script> de dashboard.html

window.addEventListener('DOMContentLoaded', () => {
    const _originalShowView = window.showView;
    window.showView = function(viewId, push) {
        if (_originalShowView) _originalShowView(viewId, push);
        if (viewId === 'server_admin') {
            fetchDashboardAdminQuotaRequests();
            fetchDashboardAdminUsers();
        }
    };
});

async function fetchDashboardAdminQuotaRequests() {
    try {
        const res = await fetch('/api/cloud/admin/quota_requests', { headers: window.HEADERS });
        if (res.ok) {
            const data = await res.json();
            renderDashboardAdminQuotaRequests(data.requests || []);
        }
    } catch (err) { console.error(err); }
}

window.resolveDashboardQuotaRequest = async function(id, action) {
    try {
        const res = await fetch('/api/cloud/admin/quota_requests', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ id, action })
        });
        if (res.ok) {
            fetchDashboardAdminQuotaRequests();
        }
    } catch (err) { }
}

function renderDashboardAdminQuotaRequests(requests) {
    const container = document.getElementById('dashboard-admin-quota-list');
    if (!container) return;
    if (requests.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 20px; opacity: 0.5;">${window.t_dash ? window.t_dash('admin_no_quotas', 'No hay peticiones pendientes.') : 'No hay peticiones pendientes.'}</div>`;
        return;
    }
    
    let html = '';
    requests.forEach(r => {
        html += `
            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600;">${r.username}</div>
                    <div style="font-size: 0.8rem; opacity: 0.7;">+${r.requested_gb}GB - ${new Date(r.created_at * 1000).toLocaleString()}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="resolveDashboardQuotaRequest(${r.id}, 'rejected')" style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Rechazar</button>
                    <button onclick="resolveDashboardQuotaRequest(${r.id}, 'approved')" style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">Aprobar</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

window.fetchDashboardAdminUsers = async function() {
    try {
        const res = await fetch('/api/system/admin/users', { headers: window.HEADERS });
        if (res.ok) {
            const data = await res.json();
            renderDashboardAdminUsers(data || []);
        }
    } catch (err) { console.error(err); }
}

let _currentEditUserId = null;

window.openAdminUserEdit = function(uid, currentQuota, username) {
    _currentEditUserId = uid;
    document.getElementById('admin-edit-username').textContent = username;
    document.getElementById('admin-edit-quota-input').value = currentQuota;
    window.showView('admin_user_edit');
}

window.saveDashboardUserQuota = async function() {
    if (!_currentEditUserId) return;
    const newQuota = parseInt(document.getElementById('admin-edit-quota-input').value);
    if (isNaN(newQuota) || newQuota < 0) return;
    
    try {
        const res = await fetch('/api/system/admin/user_quota', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ user_id: _currentEditUserId, quota: newQuota })
        });
        if (res.ok) {
            window.showView('server_admin');
        }
    } catch(e) {}
}

function renderDashboardAdminUsers(users) {
    const container = document.getElementById('dashboard-admin-users-list');
    if (!container) return;
    
    let html = '';
    users.forEach(u => {
        const isOnline = u.is_online;
        const statusColor = isOnline ? '#10b981' : '#6b7280';
        const statusText = isOnline ? 'Online' : 'Desconectado';
        html += `
            <div style="background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${statusColor};">
                <div>
                    <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 4px;">${u.username} <span style="font-size: 0.8rem; font-weight: 400; opacity: 0.7;">(${u.user_id})</span></div>
                    <div style="font-size: 0.85rem; opacity: 0.8;">Email: ${u.email}</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: bold; margin-bottom: 4px; color: var(--accent); display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                        ${u.quota_gb} GB
                        <button onclick="openAdminUserEdit('${u.user_id}', ${u.quota_gb}, '${u.username}')" style="background: transparent; border: none; cursor: pointer; color: var(--text-main); opacity: 0.6; padding: 4px;" title="Editar cuota">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                            </svg>
                        </button>
                    </div>
                    <div style="font-size: 0.8rem; display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"></span>
                        <span>${statusText}</span>
                    </div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// Translations wrapper
window.t_dash = function(key, defaultVal) {
    if (window.t) return window.t(key) || defaultVal || key;
    return defaultVal || key;
}

window.applyDashTranslations = function() {
    if (window.I18n) window.I18n.applyTranslations();
    const t = window.I18n ? window.I18n.translations[window.currentLang] : null;
    if (!t) return;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.innerHTML = t[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (t[key]) el.title = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) el.placeholder = t[key];
    });
}

// Interruptor visual nativo para el Tema e Icono SVG
window.toggleTheme = function() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* noop */ }
    window.updateThemeIcon(next);
};

window.updateThemeIcon = function(theme) {
    const icon = document.getElementById('theme-icon-svg');
    if (!icon) return;
    icon.innerHTML = theme === 'light'
        ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>'
        : '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
}

window.togglePassword = function(id) {
    const el = document.getElementById(id);
    if (el) el.type = el.type === 'password' ? 'text' : 'password';
};

// Puentes de ejecución global expuestos para el módulo ES6 dashboard/main.js
window.switchCfgTab = function(tab) { if (typeof window.m_switchCfgTab === 'function') window.m_switchCfgTab(tab); };
window.openAvatarPicker = function() { if (typeof window.m_openAvatarPicker === 'function') window.m_openAvatarPicker(); };
window.closeAvatarPicker = function() { if (typeof window.m_closeAvatarPicker === 'function') window.m_closeAvatarPicker(); };
window.closeAvatarEditor = function() { if (typeof window.m_closeAvatarEditor === 'function') window.m_closeAvatarEditor(); };
window.closePasswordModal = function() { if (typeof window.m_closePasswordModal === 'function') window.m_closePasswordModal(); };

document.addEventListener('DOMContentLoaded', () => {
    window.applyDashTranslations();
    window.updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');
});

window.addEventListener('storage', function(e) {
    if (e.key === 'lang') {
        window.currentLang = e.newValue || 'es';
        window.applyDashTranslations();
        if (window.renderAppLauncher) window.renderAppLauncher();
    }
    if (e.key === 'theme' && e.newValue) {
        document.documentElement.setAttribute('data-theme', e.newValue);
        window.updateThemeIcon(e.newValue);
    }
});

// Revoke session pattern
(function () {
    const revokeKey = Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    window.addEventListener('pagehide', () => {
        sessionStorage.setItem('nv_revoke', revokeKey);
        navigator.sendBeacon('/api/logout?revoke_key=' + encodeURIComponent(revokeKey));
    });
    window.addEventListener('pageshow', () => {
        const rk = sessionStorage.getItem('nv_revoke');
        if (rk) {
            sessionStorage.removeItem('nv_revoke');
            fetch('/api/logout/revoke', {
                method: 'POST',
                headers: window.HEADERS,
                body: JSON.stringify({ revoke_key: rk })
            }).catch(() => { });
        }
    });
})();

// Notification Badge Polling & Socket
(function () {
    let lastNotifCount = -1;

    function playNotifSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
        } catch (e) {}
    }

    function showCachedBadge() {
        const badge = document.getElementById('notif-badge-count');
        if (!badge) return;
        try {
            const cached = localStorage.getItem('nv_notif_unread_cache');
            if (cached && parseInt(cached) > 0) {
                const count = parseInt(cached);
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'flex';
            }
        } catch(e){}
    }

    async function updateNotificationBadge() {
        try {
            const res = await fetch('/api/system/notifications/history?_t=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const badge = document.getElementById('notif-badge-count');
            if (badge) {
                if (data && data.length > 0) {
                    let seenIds = [];
                    try { seenIds = JSON.parse(localStorage.getItem('nv_notif_seen_ids') || '[]'); } catch(e){}
                    const unreadCount = data.filter(n => !seenIds.includes(n.id || n.timestamp)).length;
                    
                    try { localStorage.setItem('nv_notif_unread_cache', unreadCount.toString()); } catch(e){}

                    if (unreadCount > 0) {
                        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                        badge.style.display = 'flex';
                    } else {
                        badge.style.display = 'none';
                    }

                    if (lastNotifCount !== -1 && data.length > lastNotifCount) {
                        playNotifSound();
                    }
                    lastNotifCount = data.length;
                } else {
                    try { localStorage.setItem('nv_notif_unread_cache', '0'); } catch(e){}
                    badge.style.display = 'none';
                    lastNotifCount = 0;
                }
            }
        } catch (e) { }
    }
    window.updateNotificationBadge = updateNotificationBadge;
    showCachedBadge();
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);

    if (typeof io !== 'undefined') {
        const dashSocket = io({ auth: { token: window.TOKEN }, reconnection: true });
        window.dashSocket = dashSocket;
        dashSocket.on('new_message', () => {
            updateNotificationBadge();
            const modal = document.getElementById('notif-modal');
            if (modal && modal.style.display !== 'none' && typeof window.fetchNotificationHistory === 'function') {
                window.fetchNotificationHistory();
            }
        });
        dashSocket.on('friends_updated', () => { if (typeof window.loadFriendsData === 'function') window.loadFriendsData(); });
        dashSocket.on('friend_removed', () => { if (typeof window.loadFriendsData === 'function') window.loadFriendsData(); });
        dashSocket.on('mail_updated', () => {
            if (typeof window.loadFolders === 'function') window.loadFolders();
            if (typeof window.loadCurrentFolder === 'function') window.loadCurrentFolder(true);
        });
        dashSocket.on('force_logout', () => { window.location.href = '/'; });
        dashSocket.on('quota_updated', () => {
            if (typeof window.updateCloudQuotaInfo === 'function') window.updateCloudQuotaInfo();
        });
        dashSocket.on('events_changed', () => {
            if (typeof window.dashRefreshEvents === 'function') window.dashRefreshEvents();
        });
        dashSocket.on('admin_quota_refresh', () => {
            if (typeof window.fetchDashboardAdminQuotaRequests === 'function') window.fetchDashboardAdminQuotaRequests();
        });
    }
})();

