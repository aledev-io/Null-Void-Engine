export async function fetchAdminAlerts() {
    try {
        const res = await fetch('/api/events?token=' + window.TOKEN);
        let events = await res.json();
        window.allEvents = events;
        window.renderReminders();
    } catch (e) {
        console.error('Error fetching reminders:', e);
    }
}

window.renderReminders = function() {
    if (!window.allEvents) return;
    
    const now = new Date();
    const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    const todayStr = localNow.toISOString().split('T')[0];
    
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const localTomorrow = new Date(tomorrow.getTime() - (tomorrow.getTimezoneOffset() * 60000));
    const tomorrowStr = localTomorrow.toISOString().split('T')[0];

    // Count badges
    let cAll = 0, cUpcoming = 0, cImp = 0;
    window.allEvents.forEach(ev => {
        if (ev.completed) return;
        cAll++;
        if (ev.date >= todayStr) cUpcoming++;
        if (ev.isImportant || ev.is_important) cImp++;
    });
    
    const elAll = document.getElementById('badge-all');
    if (elAll) elAll.textContent = cAll;
    const elUpcoming = document.getElementById('badge-upcoming');
    if (elUpcoming) elUpcoming.textContent = cUpcoming;
    const elImp = document.getElementById('badge-important');
    if (elImp) elImp.textContent = cImp;

    // Filter
    const filter = window.currentFilter || 'all';
    let alerts = window.allEvents.filter(ev => {
        if (ev.completed) return false;
        if (filter === 'all') return true;
        if (filter === 'upcoming') return ev.date >= todayStr;
        if (filter === 'important') return (ev.isImportant || ev.is_important);
        if (filter.startsWith('cat-')) {
            const reqCat = filter.split('-')[1];
            return (ev.category || 'personal') === reqCat;
        }
        return true;
    });

    const CATEGORY_COLORS = {
        personal: { color: '#7c6af7', bg: 'rgba(124,106,247,.15)' },
        trabajo: { color: '#4bc8c8', bg: 'rgba(75,200,200,.15)' },
        salud: { color: '#6bd46b', bg: 'rgba(107,212,107,.15)' },
        estudio: { color: '#f5a623', bg: 'rgba(245,166,35,.15)' },
        ocio: { color: '#f97066', bg: 'rgba(249,112,102,.15)' },
    };
    const categoryWeights = { 'trabajo': 1, 'estudio': 2, 'salud': 3, 'personal': 4, 'ocio': 5 };

    alerts.sort((a, b) => {
        const aToday = a.date === todayStr ? 0 : a.date === tomorrowStr ? 1 : 2;
        const bToday = b.date === todayStr ? 0 : b.date === tomorrowStr ? 1 : 2;
        if (aToday !== bToday) return aToday - bToday;
        
        const catA = categoryWeights[a.category || 'personal'] || 99;
        const catB = categoryWeights[b.category || 'personal'] || 99;
        if (catA !== catB) return catA - catB;

        return a.date.localeCompare(b.date);
    });

    const grid = document.getElementById('reminders-grid');
    if (!grid) return;

    if (alerts.length > 0) {
        grid.innerHTML = alerts.map(ev => {
            const isToday = ev.date === todayStr;
            const isTomorrow = ev.date === tomorrowStr;
            const isUpcoming = ev.date > tomorrowStr;
            const isImportant = ev.isImportant || ev.is_important;

            let isPassed = false;
            let timeText = ev.allDay ? window.t_rem('all_day') : `${ev.startTime || window.t_rem('all_day')}${ev.endTime ? '-' + ev.endTime : ''}`;

            if (ev.date < todayStr) {
                isPassed = true;
            } else if (isToday && !ev.allDay && ev.startTime) {
                const nowTime = now.toTimeString().substring(0, 5);
                if (ev.startTime < nowTime) isPassed = true;
            }

            let labelKey = 'label_upcoming';
            let indicatorColor = 'var(--indigo)';
            let badgeBg = 'rgba(99, 102, 241, 0.1)';
            let badgeColor = 'var(--indigo)';

            if (isPassed) {
                labelKey = 'label_passed';
                indicatorColor = '#6b7280';
                badgeBg = 'rgba(107, 114, 128, 0.15)';
                badgeColor = '#9ca3af';
            } else if (isToday) {
                labelKey = 'label_today';
                indicatorColor = '#f87171';
                badgeBg = 'rgba(248, 113, 113, 0.15)';
                badgeColor = '#f87171';
            } else if (isImportant) {
                indicatorColor = '#fbbf24';
            } else if (isTomorrow) {
                labelKey = 'label_tomorrow';
                indicatorColor = '#38bdf8';
                badgeBg = 'rgba(56, 189, 248, 0.15)';
                badgeColor = '#0ea5e9';
            }

            const dateParts = ev.date.split('-');
            const dateFormatted = `${dateParts[2]}/${dateParts[1]}/${dateParts[0].slice(2)}`;
            const displayMetaInfo = `${dateFormatted} · ${timeText}`;
            
            const descIsPlaceholder = !(ev.desc || ev.description);
            const descText = descIsPlaceholder ? window.t_rem('no_desc') : (ev.desc || ev.description);
            
            const cat = ev.category || 'personal';
            const catStyle = CATEGORY_COLORS[cat] || CATEGORY_COLORS['personal'];
            const catKey = 'cat_' + cat;

            return `
                <div class="reminder-card" style="--card-color: ${indicatorColor}; opacity: ${isPassed ? '0.7' : '1'};" onclick="window.location.href='/calendar?event=${ev.id}'">
                    <div class="reminder-header">
                        <h3 class="reminder-title">${ev.title}</h3>
                        <div class="admin-event-star" 
                             style="color: ${isImportant ? '#fbbf24' : 'var(--border-hi)'}; font-size:1.3rem; margin-top:-4px;"
                             onclick="event.stopPropagation(); window.toggleEventImportance('${ev.id}', ${isImportant})">
                            ${isImportant ? '★' : '☆'}
                        </div>
                    </div>
                    <p class="reminder-desc">${descText}</p>
                    <div class="reminder-meta">
                        <span style="display:flex; align-items:center; gap:6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            ${displayMetaInfo}
                        </span>
                        <div style="margin-left:auto; display:flex; gap:6px;">
                            <span class="tag-badge" style="background:${badgeBg}; color:${badgeColor};">${window.t_rem(labelKey)}</span>
                            <span class="tag-badge" style="background:${catStyle.bg}; color:${catStyle.color};">${window.t_rem(catKey)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 60px 20px; text-align:center; color:var(--text-muted);">
                <div style="width:64px; height:64px; border-radius:50%; background:var(--surface-hi); display:flex; align-items:center; justify-content:center; margin-bottom:16px;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <h3 style="margin:0 0 8px 0; color:var(--text-main); font-size:1.1rem;">${window.t_rem('empty_title')}</h3>
                <p style="margin:0; font-size:0.9rem;">${window.t_rem('empty_sub')}</p>
            </div>
        `;
    }
};

window.toggleEventImportance = async function(id, currentStatus) {
    try {
        const ev = window.allEvents.find(e => e.id === id);
        if (!ev) return;
        
        const updatedEv = {
            ...ev,
            isImportant: !currentStatus
        };

        await fetch('/api/events/' + id + '?token=' + window.TOKEN, {
            method: 'PUT',
            headers: window.HEADERS || { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEv)
        });
        fetchAdminAlerts();
    } catch (e) {
        console.error(e);
    }
};
