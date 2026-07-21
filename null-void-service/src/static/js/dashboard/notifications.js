import { NV_Confirm } from './ui.js';

export async function fetchNotificationHistory() {
    const notifModal = document.getElementById('notif-modal');
    const notifList = document.getElementById('notif-history-list');
    if (!notifModal || !notifList) return;

    const t = window.t_dash || (k => k);
    notifModal.style.display = 'flex';
    notifList.innerHTML = `<p style="text-align: center; color: var(--text-muted); font-weight: 500; padding: 40px;">${t('notif_loading')}</p>`;

    try {
        const res = await fetch('/api/system/notifications/history?token=' + window.TOKEN + '&_t=' + Date.now(), { cache: 'no-store' });
        const data = await res.json();
        
        // Sincronizar siempre el número de la campana
        const badge = document.getElementById('notif-badge-count');
        if (badge) {
            if (data && data.length > 0) {
                badge.textContent = data.length > 99 ? '99+' : data.length;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        if (data.length === 0) {
            notifList.innerHTML = `<p style="text-align: center; color: var(--text-muted); font-weight: 500; padding: 40px;">${t('notif_empty')}</p>`;
            return;
        }

        notifList.innerHTML = data.map(n => {
            let title = n.title;
            if (title.startsWith("Nuevo mensaje de ")) {
                title = t('notif_new_msg') + title.substring("Nuevo mensaje de ".length);
            } else {
                title = t(title);
            }
            
            let displayDate = n.date;
            let displayTime = n.time;
            
            if (n.timestamp) {
                let ts = n.timestamp;
                // Auto-detect unix timestamp in seconds vs ms
                if (typeof ts === 'number') {
                    if (ts < 10000000000) ts *= 1000;
                } else if (typeof ts === 'string' && !isNaN(Number(ts))) {
                    ts = Number(ts);
                    if (ts < 10000000000) ts *= 1000;
                }
                const d = new Date(ts);
                if (!isNaN(d.getTime())) {
                    const loc = window.currentLang === 'en' ? 'en-US' : 'es-ES';
                    displayDate = d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' });
                    displayTime = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
                }
            }

            return `
            <div class="notif-item" style="display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 14px; border: 1px solid rgba(99,102,241,0.15); border-radius: 10px; background: var(--surface);">
                <div style="flex: 1; min-width: 0;">
                    <div class="notif-title" style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">${title}</div>
                    ${n.body ? `<div class="notif-body" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-bottom: 8px; line-height: 1.3;">${n.body}</div>` : ''}
                    <div class="notif-time" style="display: flex; align-items: center; gap: 8px; font-size: 0.7rem; color: var(--text-muted);">
                        <span>${displayDate}${t('notif_at')}${displayTime}</span>
                        <span class="notif-badge" style="background: rgba(99,102,241,0.15); color: var(--indigo); padding: 2px 6px; border-radius: 4px; font-weight: 600;">${n.category}</span>
                    </div>
                </div>
                <button onclick="deleteNotification('${n.id || n.timestamp}')" style="background: rgba(248,113,113,0.1); border: none; color: #f87171; cursor: pointer; font-size: 1.1rem; padding: 0; width: 26px; height: 26px; border-radius: 6px; margin-left: 10px; display: flex; align-items: center; justify-content: center; transition: background 0.2s;">&times;</button>
            </div>
        `}).join('');
    } catch (e) {
        notifList.innerHTML = `<p style="text-align: center; color: #f87171; padding: 40px;">${t('notif_error')}</p>`;
    }
}

export async function deleteNotification(id) {
    try {
        await fetch('/api/system/notifications/delete?token=' + window.TOKEN, {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ id: id })
        });
        fetchNotificationHistory();
    } catch (e) { console.error("Error deleting notification:", e); }
}

export async function clearAllNotifications() {
    const t = window.t_dash || (k => k);
    if (await NV_Confirm(t('notif_confirm_clear'))) {
        try {
            await fetch('/api/system/notifications/clear?token=' + window.TOKEN, { method: 'POST', headers: window.HEADERS });
            fetchNotificationHistory();
        } catch (e) { console.error("Error clearing notifications:", e); }
    }
}

window.fetchNotificationHistory = fetchNotificationHistory;
window.deleteNotification = deleteNotification;
window.clearAllNotifications = clearAllNotifications;
