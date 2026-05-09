async function toggleEventImportance(eventId, currentStatus, event) {
    if (event) event.stopPropagation();
    try {
        // Obtenemos los datos actuales del evento antes de actualizar
        const res = await fetch('/api/events?token=' + TOKEN);
        const events = await res.json();
        const ev = events.find(e => e.id === eventId);
        
        if (!ev) return;

        const updatedEv = {
            ...ev,
            isImportant: !currentStatus
        };

        const updateRes = await fetch(`/api/events/${eventId}?token=${TOKEN}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEv)
        });

        if (updateRes.ok) {
            // Animación de feedback
            const star = document.querySelector(`[data-event-id="${eventId}"] .admin-event-star`);
            if (star) {
                star.style.transform = 'scale(1.3)';
                setTimeout(() => {
                    star.style.transform = '';
                    fetchAdminAlerts(); // Recargar la lista
                }, 200);
            } else {
                fetchAdminAlerts();
            }
        }
    } catch (e) {
        console.error("Error toggling importance:", e);
    }
}

async function fetchAdminAlerts() {
    try {
        const res = await fetch('/api/events?token=' + TOKEN);
        const events = await res.json();

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const alerts = events.filter(ev => {
            const isTodayOrTomorrow = (ev.date === todayStr || ev.date === tomorrowStr);
            return !ev.completed && (isTodayOrTomorrow || ev.isImportant);
        });

        // Ordenar: hoy primero, luego mañana, luego por fecha
        alerts.sort((a, b) => {
            const aToday = a.date === todayStr ? 0 : a.date === tomorrowStr ? 1 : 2;
            const bToday = b.date === todayStr ? 0 : b.date === tomorrowStr ? 1 : 2;
            if (aToday !== bToday) return aToday - bToday;
            return a.date.localeCompare(b.date);
        });

        const list = document.getElementById('admin-alerts-list');
        const badge = document.getElementById('admin-badge');
        const countBadge = document.getElementById('admin-count-badge');
        if (!list) return;

        // Actualizar contador
        if (countBadge) countBadge.textContent = alerts.length;

        if (alerts.length > 0) {
            if (badge) badge.style.display = 'block';
            list.innerHTML = alerts.map(ev => {
                const isToday = ev.date === todayStr;
                const isTomorrow = ev.date === tomorrowStr;
                const isImportant = ev.isImportant || ev.is_important;

                let label = isImportant ? 'Importante' : 'Recordatorio';
                let indicatorColor = 'var(--indigo)';
                let badgeBg = 'rgba(99, 102, 241, 0.1)';
                let badgeColor = 'var(--indigo)';

                if (isToday) {
                    label = isImportant ? 'Importante · Hoy' : 'Para hoy';
                    indicatorColor = '#f87171';
                    badgeBg = 'rgba(248, 113, 113, 0.12)';
                    badgeColor = '#f87171';
                } else if (isImportant) {
                    indicatorColor = '#fbbf24';
                    badgeBg = 'rgba(251, 191, 36, 0.12)';
                    badgeColor = '#f59e0b';
                } else if (isTomorrow) {
                    label = 'Para mañana';
                    indicatorColor = '#38bdf8';
                    badgeBg = 'rgba(56, 189, 248, 0.12)';
                    badgeColor = '#0ea5e9';
                }

                // Formatear fecha legible
                const dateParts = ev.date.split('-');
                const dateFormatted = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

                return `
                    <div class="admin-event-row" data-event-id="${ev.id}" onclick="window.location.href='/calendar?event=${ev.id}'">
                        <div class="admin-event-indicator" style="background: ${indicatorColor};"></div>
                        <div class="admin-event-body">
                            <div class="admin-event-meta">
                                <span class="admin-event-badge" style="background: ${badgeBg}; color: ${badgeColor};">${label}</span>
                                <span class="admin-event-date">${dateFormatted}</span>
                            </div>
                            <div class="admin-event-title">${ev.title}</div>
                            <div class="admin-event-desc">${ev.desc || ev.description || 'Sin descripción adicional.'}</div>
                        </div>
                        <div class="admin-event-star" 
                             style="color: ${isImportant ? '#fbbf24' : 'var(--text-muted)'};"
                             onclick="toggleEventImportance('${ev.id}', ${isImportant}, event)">
                            ${isImportant ? '★' : '☆'}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            if (badge) badge.style.display = 'none';
            list.innerHTML = `
                <div class="admin-empty-state">
                    <div class="admin-empty-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <div class="admin-empty-title">Todo bajo control</div>
                    <div class="admin-empty-sub">No hay alertas críticas para hoy o mañana.</div>
                </div>
            `;
        }
    } catch (e) {
        console.error("Error fetching admin alerts:", e);
    }
}
