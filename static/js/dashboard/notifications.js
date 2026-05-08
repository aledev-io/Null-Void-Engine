/* Notifications Module Logic */

async function fetchNotificationHistory() {
    const notifModal = document.getElementById('notif-modal');
    const notifList = document.getElementById('notif-history-list');
    if (!notifModal || !notifList) return;

    notifModal.style.display = 'flex';
    notifList.innerHTML = '<p style="text-align: center; color: var(--text-sub); padding: 40px;">Cargando historial...</p>';

    try {
        const res = await fetch('/api/system/notifications/history?token=' + TOKEN);
        const data = await res.json();

        if (data.length === 0) {
            notifList.innerHTML = '<p style="text-align: center; color: var(--text-sub); padding: 40px;">No hay notificaciones recientes.</p>';
            return;
        }

        notifList.innerHTML = data.map(n => `
            <div class="notif-item" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div class="notif-title">${n.title}</div>
                    <div class="notif-time">
                        <span>${n.date} a las ${n.time}</span>
                        <span class="notif-badge" style="background: rgba(99,102,241,0.1); color: var(--indigo);">${n.category}</span>
                    </div>
                </div>
                <button onclick="deleteNotification('${n.id}')" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.2rem; padding: 8px; margin-left: 10px;">&times;</button>
            </div>
        `).join('');
    } catch (e) {
        notifList.innerHTML = '<p style="text-align: center; color: #f87171; padding: 40px;">Error al cargar el historial.</p>';
    }
}

async function deleteNotification(id) {
    try {
        await fetch('/api/system/notifications/delete?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ id: id })
        });
        fetchNotificationHistory();
    } catch (e) { console.error("Error deleting notification:", e); }
}

async function clearAllNotifications() {
    if (await NV_Confirm('¿Borrar todo el historial de notificaciones?')) {
        try {
            await fetch('/api/system/notifications/clear?token=' + TOKEN, { method: 'POST', headers: HEADERS });
            fetchNotificationHistory();
        } catch (e) { console.error("Error clearing notifications:", e); }
    }
}
