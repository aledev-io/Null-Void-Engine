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
        
        let seenIds = [];
        try { seenIds = JSON.parse(localStorage.getItem('nv_notif_seen_ids') || '[]'); } catch(e){}
        if (typeof window.updateNotificationBadge === 'function') window.updateNotificationBadge();

        const pushBtn = document.getElementById('enable-web-push');
        if (pushBtn) {
            let isEnabled = localStorage.getItem('push_enabled') !== 'false' && localStorage.getItem('nv_notif_push_disabled') !== 'true';
            
            if (window.Android) {
                // En App de Android nativa siempre está soportado el puente FCM
                pushBtn.style.display = 'flex';
            } else if (!("Notification" in window) || Notification.permission === "denied") {
                pushBtn.style.display = 'none';
            } else {
                pushBtn.style.display = 'flex';
                if (Notification.permission === "granted") {
                    isEnabled = localStorage.getItem('nv_notif_push_disabled') !== 'true' && localStorage.getItem('push_enabled') !== 'false';
                }
            }

            if (pushBtn.style.display !== 'none') {
                const t = window.t_dash || (k => k);
                const textSpan = document.getElementById('enable-web-push-text') || pushBtn;
                if (!isEnabled) {
                    pushBtn.style.color = '#10b981';
                    textSpan.setAttribute('data-i18n', 'enable_push');
                    textSpan.innerText = t('enable_push') || 'Activar Notificaciones';
                } else {
                    pushBtn.style.color = '#f87171';
                    textSpan.setAttribute('data-i18n', 'push_disable');
                    textSpan.innerText = t('push_disable') || 'Desactivar Notificaciones';
                }
            }
        }

        if (data.length === 0) {
            notifList.innerHTML = `
                <div class="notif-empty">
                    <div class="notif-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    </div>
                    <div class="notif-empty-title">${t('notif_empty_title')}</div>
                    <div class="notif-empty-text">${t('notif_empty_desc')}</div>
                </div>
            `;
            return;
        }

        notifList.innerHTML = data.map(n => {
            let title = n.title || '';
            if (title.startsWith("Nuevo mensaje de ")) {
                title = title.substring("Nuevo mensaje de ".length);
            } else if (title.startsWith("New message from ")) {
                title = title.substring("New message from ".length);
            } else if (n.category !== 'chat' && title) {
                title = t(title);
            }
            
            let displayDate = n.date;
            let displayTime = n.time;
            
            if (n.timestamp) {
                let ts = n.timestamp;
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

            const isUnread = !seenIds.includes(n.id || n.timestamp);

            const typeLower = n.category ? n.category.toLowerCase() : '';
            let typeClass = 'info';
            let iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

            if (typeLower.includes('success') || typeLower.includes('éxito')) {
                typeClass = 'success';
                iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
            } else if (typeLower.includes('warn') || typeLower.includes('advertencia') || typeLower.includes('system') || typeLower.includes('sistema')) {
                typeClass = 'warning';
                iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
            } else if (typeLower.includes('error') || typeLower.includes('fail') || typeLower.includes('fallo')) {
                typeClass = 'error';
                iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
            } else if (typeLower.includes('chat') || typeLower.includes('mensaje') || typeLower.includes('message')) {
                typeClass = 'info';
                iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
            }

            let bodyText = n.body || '';
            let formattedBody = bodyText.replace(/\+ (\d+) más/g, (match, count) => {
                const template = t('notif_more_msgs') || '+ {count} más';
                return template.replace('{count}', count);
            }).replace(/\n/g, '<br/>');
            if (bodyText.length > 150) {
                formattedBody = formattedBody.substring(0, 147) + '...';
            }

            const isChatNotif = n.category === 'chat';
            const senderId = n.sender_id || title;
            const clickAttr = isChatNotif ? `onclick="window.handleNotificationClick('${senderId.replace(/'/g, "\\'")}', '${title.replace(/'/g, "\\'")}', '${n.id || n.timestamp}')" style="cursor: pointer;"` : '';

            return `
            <div id="notif-item-${n.id || n.timestamp}" class="notif-item ${typeClass} ${isUnread ? 'unread' : ''}" ${clickAttr}>
                <div class="notif-item-icon">${iconSvg}</div>
                <div class="notif-item-content">
                    <div class="notif-item-title">${title}</div>
                    ${bodyText ? `<div class="notif-item-text">${formattedBody}</div>` : ''}
                    ${n.image || n.photo ? `<div style="margin-top: 4px;"><img src="${n.image || n.photo}" alt="Previsualización" style="max-height: 80px; max-width: 100%; border-radius: 6px; object-fit: cover; border: 1px solid var(--border);" /></div>` : ''}
                    <div class="notif-item-time">
                        <span>${displayDate}${t('notif_at')}${displayTime}</span>
                        ${isUnread ? `<span id="notif-dot-${n.id || n.timestamp}" style="width:6px; height:6px; border-radius:50%; background:var(--primary); display:inline-block;" title="${t('new_notif')}"></span>` : ''}
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;" onclick="event.stopPropagation()">
                    <div class="notif-item-close" onclick="deleteNotification('${n.id || n.timestamp}')" title="${t('delete_notif')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        ${n.category ? `<span style="font-size: 11px; font-weight: 600; color: var(--text-muted); opacity: 0.8;">${n.category}</span>` : ''}
                        ${isUnread ? `
                        <div id="notif-read-btn-${n.id || n.timestamp}" class="notif-item-close" style="color: var(--indigo);" onclick="markNotificationRead('${n.id || n.timestamp}')" title="${t('mark_read')}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            `;
        }).join('');
    } catch (e) {
        notifList.innerHTML = `
            <div class="notif-empty">
                <div class="notif-empty-icon" style="color: #ef4444;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                </div>
                <div class="notif-empty-title" style="color: #ef4444;">${t('notif_error')}</div>
            </div>
        `;
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

export function markNotificationRead(id) {
    let seenIds = [];
    try { seenIds = JSON.parse(localStorage.getItem('nv_notif_seen_ids') || '[]'); } catch(e){}
    if (!seenIds.includes(id)) {
        seenIds.push(id);
        localStorage.setItem('nv_notif_seen_ids', JSON.stringify(seenIds));
        
        const itemEl = document.getElementById(`notif-item-${id}`);
        if (itemEl) {
            itemEl.style.background = 'var(--surface)';
            itemEl.style.border = '1px solid rgba(99,102,241,0.15)';
        }
        const readBtn = document.getElementById(`notif-read-btn-${id}`);
        if (readBtn) readBtn.remove();
        const dot = document.getElementById(`notif-dot-${id}`);
        if (dot) dot.remove();

        if (typeof window.updateNotificationBadge === 'function') window.updateNotificationBadge();
    }
}

export async function markAllNotificationsRead() {
    try {
        const res = await fetch('/api/system/notifications/history?token=' + window.TOKEN + '&_t=' + Date.now(), { cache: 'no-store' });
        const data = await res.json();
        
        let seenIds = [];
        try { seenIds = JSON.parse(localStorage.getItem('nv_notif_seen_ids') || '[]'); } catch(e){}
        
        data.forEach(n => {
            const id = n.id || n.timestamp;
            if (!seenIds.includes(id)) {
                seenIds.push(id);
                const itemEl = document.getElementById(`notif-item-${id}`);
                if (itemEl) {
                    itemEl.style.background = 'var(--surface)';
                    itemEl.style.border = '1px solid rgba(99,102,241,0.15)';
                }
                const readBtn = document.getElementById(`notif-read-btn-${id}`);
                if (readBtn) readBtn.remove();
                const dot = document.getElementById(`notif-dot-${id}`);
                if (dot) dot.remove();
            }
        });
        
        localStorage.setItem('nv_notif_seen_ids', JSON.stringify(seenIds));
        if (typeof window.updateNotificationBadge === 'function') window.updateNotificationBadge();
    } catch (e) {
        console.error("Error marking all read:", e);
    }
}

export function requestPushPermission() {
    const t = window.t_dash || (k => k);
    const btn = document.getElementById('enable-web-push');
    const textSpan = document.getElementById('enable-web-push-text') || btn;

    if (window.Android || window.togglePushNotifications) {
        const isCurrentlyEnabled = localStorage.getItem('push_enabled') !== 'false' && localStorage.getItem('nv_notif_push_disabled') !== 'true';
        const newState = !isCurrentlyEnabled;
        
        if (window.togglePushNotifications) {
            window.togglePushNotifications(newState);
        } else {
            localStorage.setItem('push_enabled', newState ? 'true' : 'false');
        }
        
        if (newState) {
            localStorage.removeItem('nv_notif_push_disabled');
            if (btn) btn.style.color = '#f87171';
            if (textSpan) {
                textSpan.setAttribute('data-i18n', 'push_disable');
                textSpan.innerText = t('push_disable') || 'Desactivar Notificaciones';
            }
        } else {
            localStorage.setItem('nv_notif_push_disabled', 'true');
            if (btn) btn.style.color = '#10b981';
            if (textSpan) {
                textSpan.setAttribute('data-i18n', 'enable_push');
                textSpan.innerText = t('enable_push') || 'Activar Notificaciones';
            }
        }
        return;
    }
    
    const isDisabled = localStorage.getItem('nv_notif_push_disabled') === 'true';

    if ("Notification" in window && Notification.permission === "granted") {
        if (isDisabled) {
            localStorage.removeItem('nv_notif_push_disabled');
            if (btn) btn.style.color = '#f87171';
            if (textSpan) {
                textSpan.setAttribute('data-i18n', 'push_disable');
                textSpan.innerText = t('push_disable') || 'Desactivar Notificaciones';
            }
        } else {
            localStorage.setItem('nv_notif_push_disabled', 'true');
            if (btn) btn.style.color = '#10b981';
            if (textSpan) {
                textSpan.setAttribute('data-i18n', 'enable_push');
                textSpan.innerText = t('enable_push') || 'Activar Notificaciones';
            }
        }
        return;
    }

    if ("Notification" in window) {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                localStorage.removeItem('nv_notif_push_disabled');
                if (btn) btn.style.color = '#f87171';
                if (textSpan) {
                    textSpan.setAttribute('data-i18n', 'push_disable');
                    textSpan.innerText = t('push_disable') || 'Desactivar Notificaciones';
                }
            } else if (permission === "denied") {
                if (btn) btn.style.display = 'none';
            }
        });
    }
}

export function handleNotificationClick(contactId, contactName, notifId) {
    if (notifId) {
        markNotificationRead(notifId);
    }
    const notifModal = document.getElementById('notif-modal');
    if (notifModal) notifModal.style.display = 'none';

    localStorage.setItem('nv_chat_contact', JSON.stringify({
        contact_id: contactId,
        contact_name: contactName
    }));

    if (typeof window.openChatWith === 'function') {
        const isGroup = contactId ? contactId.startsWith('group_') : false;
        window.openChatWith(contactId, contactName, '', isGroup);
    } else {
        window.location.href = '/chat';
    }
}

window.fetchNotificationHistory = fetchNotificationHistory;
window.deleteNotification = deleteNotification;
window.clearAllNotifications = clearAllNotifications;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.requestPushPermission = requestPushPermission;
window.handleNotificationClick = handleNotificationClick;

window.addEventListener('languageChanged', () => {
    const notifModal = document.getElementById('notif-modal');
    if (notifModal && notifModal.style.display !== 'none') {
        fetchNotificationHistory();
    }
});
