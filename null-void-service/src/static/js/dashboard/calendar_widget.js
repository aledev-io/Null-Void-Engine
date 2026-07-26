export function initCalendarWidget() {
    const calendarContainer = document.querySelector('.mock-calendar');
    if (!calendarContainer) return;

    let currentDate = new Date();
    
    function _getUser() {
        const value = `; ${document.cookie}`;
        const parts = value.split('; user=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return 'guest';
    }

    function getEventsMap() {
        const user = _getUser();
        const key = `calendar_events_v1_${user}`;
        try {
            const events = JSON.parse(localStorage.getItem(key)) || [];
            const map = {};
            events.forEach(ev => {
                if (ev.date) {
                    map[ev.date] = true;
                }
            });
            return map;
        } catch (e) {
            return {};
        }
    }

    function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        const daysInMonth = lastDay.getDate();
        // Adjust for Monday start (0 = Mon, ..., 6 = Sun)
        let startDay = firstDay.getDay() - 1;
        if (startDay === -1) startDay = 6;
        
        const prevLastDay = new Date(year, month, 0).getDate();
        
        const lang = window.currentLang || localStorage.getItem('lang') || (navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en');
        const rawMonthName = new Date(year, month, 1).toLocaleString(lang, { month: 'long' });
        const finalMonthName = rawMonthName.charAt(0).toUpperCase() + rawMonthName.slice(1);
        
        let navTitle = calendarContainer.querySelector('.cal-nav-title');
        if (!navTitle) {
            // Fallback to the middle span if class is missing
            const spans = calendarContainer.querySelectorAll('.cal-nav span');
            if (spans.length >= 3) {
                navTitle = spans[1];
                // Make arrows easier to click
                spans[0].style.padding = '5px 15px';
                spans[0].style.fontSize = '1.2rem';
                spans[2].style.padding = '5px 15px';
                spans[2].style.fontSize = '1.2rem';
            }
        }
        if (navTitle) {
            navTitle.textContent = `${finalMonthName} ${year}`;
        }

        
        const grid = calendarContainer.querySelector('.cal-grid');
        if (!grid) return;
        
        // Remove existing days, keep the header
        const headers = Array.from(grid.querySelectorAll('.cal-day.head'));
        grid.innerHTML = '';
        headers.forEach(h => grid.appendChild(h));
        
        const eventsMap = getEventsMap();
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

        // Previous month days
        for (let i = startDay - 1; i >= 0; i--) {
            const dayNum = prevLastDay - i;
            const el = document.createElement('div');
            el.className = 'cal-day cal-day-muted';
            el.textContent = dayNum;
            grid.appendChild(el);
        }
        
        // Current month days
        for (let i = 1; i <= daysInMonth; i++) {
            const el = document.createElement('div');
            el.className = 'cal-day';
            if (isCurrentMonth && today.getDate() === i) {
                el.classList.add('today');
            }
            el.textContent = i;
            
            // Check for events
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            if (eventsMap[dateStr]) {
                const dot = document.createElement('div');
                dot.style.width = '4px';
                dot.style.height = '4px';
                dot.style.background = 'var(--accent, #8b5cf6)';
                dot.style.borderRadius = '50%';
                dot.style.margin = '2px auto 0';
                el.appendChild(dot);
            }
            
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                window.location.href = `/calendar?date=${dateStr}`;
            });
            
            grid.appendChild(el);
        }
        
        // Next month days to fill grid
        const totalCells = startDay + daysInMonth;
        const nextDays = Math.ceil(totalCells / 7) * 7 - totalCells;
        for (let i = 1; i <= nextDays; i++) {
            const el = document.createElement('div');
            el.className = 'cal-day cal-day-muted';
            el.textContent = i;
            grid.appendChild(el);
        }
    }

    function getRawEvents() {
        const user = _getUser();
        const key = `calendar_events_v1_${user}`;
        try {
            return JSON.parse(localStorage.getItem(key)) || [];
        } catch (e) {
            return [];
        }
    }

    let currentTaskFilter = 'upcoming';

    function isEventPassed(ev, todayStr, currentTimeStr) {
        if (!ev.date) return false;
        if (ev.date < todayStr) return true;
        if (ev.date === todayStr && ev.startTime && ev.startTime < currentTimeStr) return true;
        return false;
    }

    function renderPendingTasks() {
        const pendingList = document.getElementById('pending-tasks-list');
        if (!pendingList) return;

        const events = getRawEvents();
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTimeStr = `${currentHours}:${currentMinutes}`;
        
        // Base filter: only uncompleted and must have a date
        let filteredEvents = events.filter(ev => !ev.completed && ev.date);

        if (currentTaskFilter === 'upcoming') {
            filteredEvents = filteredEvents.filter(ev => !isEventPassed(ev, todayStr, currentTimeStr));
        } else if (currentTaskFilter === 'past') {
            filteredEvents = filteredEvents.filter(ev => isEventPassed(ev, todayStr, currentTimeStr));
        } else if (currentTaskFilter === 'events') {
            filteredEvents = filteredEvents.filter(ev => ev.type !== 'task' && !isEventPassed(ev, todayStr, currentTimeStr));
        } else if (currentTaskFilter === 'tasks') {
            filteredEvents = filteredEvents.filter(ev => ev.type === 'task' && !isEventPassed(ev, todayStr, currentTimeStr));
        }

        // Sort by date (closest first), then time
        filteredEvents.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return (a.startTime || '').localeCompare(b.startTime || '');
        });

        // Reverse sorting for 'past' so the most recently passed events appear first
        if (currentTaskFilter === 'past') {
            filteredEvents.reverse();
        }

        pendingList.innerHTML = '';

        if (filteredEvents.length === 0) {
            const noEventsMsg = window.t_dash ? window.t_dash('dash_no_events', 'Nada aquí') : 'Nada aquí';
            pendingList.innerHTML = `<p style="text-align:center; padding: 20px; color: var(--text-muted); font-size: 0.9rem; margin: auto;">${noEventsMsg}</p>`;
            return;
        }

        // No limit on tasks, scroll will handle overflow
        filteredEvents.forEach(ev => {
            const isToday = ev.date === todayStr;
            const isPassed = isEventPassed(ev, todayStr, currentTimeStr);
            const isTask = ev.type === 'task';

            let tagClass, tagText;
            if (isPassed) {
                tagClass = 'tag-gray';
                tagText = window.t ? window.t('label_passed') : 'Pasado';
            } else if (isToday) {
                tagClass = 'tag-red';
                tagText = window.t ? window.t('label_today') : 'Hoy';
            } else {
                tagClass = 'tag-yellow';
                tagText = window.t ? window.t('label_upcoming') : 'Próximo';
            }


            let timeText = ev.date;
            if (ev.startTime) timeText += ` ${ev.startTime}`;

            const opacityStyle = isPassed ? 'opacity: 0.5;' : '';

            // Icon: SVG for task, SVG for event
            const iconHTML = isTask 
                ? `<div style="width:16px; height:16px; display:flex; justify-content:center; align-items:center; margin-right: 8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent);"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>`
                : `<div style="width:16px; height:16px; display:flex; justify-content:center; align-items:center; margin-right: 8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--indigo);"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>`;

            const itemHTML = `
                <div class="dash-item" style="cursor: pointer; ${opacityStyle}" onclick="window.location.href='/calendar?date=${ev.date}'">
                    ${iconHTML}
                    <div class="dash-item-content" style="margin-left: 10px;">
                        <span class="dash-item-title" style="${isPassed ? 'text-decoration: line-through;' : ''}">${ev.title || 'Evento sin título'}</span>
                        <div class="dash-item-meta">
                            <span class="tag ${tagClass}">${tagText}</span>
                            <span>${timeText}</span>
                        </div>
                    </div>
                </div>
            `;
            pendingList.insertAdjacentHTML('beforeend', itemHTML);
        });
    }

    async function fetchEventsImmediately() {
        try {
            const tokenValue = `; ${document.cookie}`;
            const parts = tokenValue.split('; token=');
            let token = '';
            if (parts.length === 2) token = parts.pop().split(';').shift();

            const res = await fetch('/api/events', {
                headers: { 'Content-Type': 'application/json', 'X-Token': token }
            });
            if (res.ok) {
                const events = await res.json();
                const user = _getUser();
                const key = `calendar_events_v1_${user}`;
                localStorage.setItem(key, JSON.stringify(events));
                renderCalendar();
                renderPendingTasks();
            }
        } catch (err) {
            console.warn('[Calendar Widget] Fetch failed:', err);
        }
    }

    renderCalendar();
    renderPendingTasks();
    fetchEventsImmediately();

    // Pill Filters Logic
    const filterPills = document.querySelectorAll('.filter-pill');
    if (filterPills.length > 0) {
        filterPills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                // Reset all pills to inactive state
                filterPills.forEach(p => {
                    p.style.background = 'transparent';
                    p.style.color = 'var(--text-muted)';
                    p.style.border = '1px solid var(--border)';
                });
                
                // Set active state on clicked pill
                pill.style.background = 'var(--accent)';
                pill.style.color = 'white';
                pill.style.border = '1px solid var(--accent)';
                
                currentTaskFilter = pill.getAttribute('data-filter');
                renderPendingTasks();
            });
        });
    }

    // Navigation setup
    let navBtns = calendarContainer.querySelectorAll('.cal-nav-btn');
    if (navBtns.length === 0) {
        const spans = calendarContainer.querySelectorAll('.cal-nav span');
        if (spans.length >= 3) {
            navBtns = [spans[0], spans[2]];
            navBtns[0].style.cursor = 'pointer';
            navBtns[1].style.cursor = 'pointer';
        }
    }
    
    if (navBtns.length >= 2) {
        navBtns[0].addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
        });
        navBtns[1].addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
        });
    }

    // Optional: listen to calendar sync events to update the grid
    window.addEventListener('calendar:synced', () => {
        renderCalendar();
        renderPendingTasks();
    });
    window.addEventListener('calendar:changed', () => {
        renderCalendar();
        renderPendingTasks();
    });

    window.addEventListener('storage', function(e) {
        if (e.key === 'lang') {
            renderCalendar();
            renderPendingTasks();
        }
    });
}
