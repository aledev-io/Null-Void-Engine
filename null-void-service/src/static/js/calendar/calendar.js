import { Events } from './events.js';
import { App } from './app.js';

const VIEW_START_HOUR = 0;
const VIEW_END_HOUR = 24;
const HOUR_PX = 60;

export const Calendar = {

  renderMonth(container, refDate, selectedDate, onDayClick, onEventClick) {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const today = window.todayStr();

    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const monthEvents = Events.forMonth(year, month);
    const evByDate = {};
    for (const ev of monthEvents) {
      if (!evByDate[ev.date]) evByDate[ev.date] = [];
      evByDate[ev.date].push(ev);
    }

    const s = window.DAYS_SHORT;
    const DAYS_HEADER = [s[1], s[2], s[3], s[4], s[5], s[6], s[0]];
    const todayIndex = (new Date().getDay() + 6) % 7;

    let html = `<div class="month-view anim-fade">
      <div class="month-weekdays">
        ${DAYS_HEADER.map((d, i) => `<div class="month-weekday${i === todayIndex ? ' is-today-col' : ''}">${d}</div>`).join('')}
      </div>
      <div class="month-grid">`;

    for (let i = startDow - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      html += `<div class="month-cell other-month"><span class="cell-day-num">${d}</span></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === today;
      const isSel = dateStr === selectedDate;
      const dayEvs = evByDate[dateStr] || [];

      let cls = 'month-cell';
      if (isToday) cls += ' is-today';
      if (isSel) cls += ' selected';

      // MAX_SHOW dinámico: en pantallas muy pequeñas (landscape), 1 chip máximo
      const screenH = window.innerHeight;
      const MAX_SHOW = screenH <= 420 ? 1 : screenH <= 600 ? 2 : 3;

      const chipsHtml = dayEvs.slice(0, MAX_SHOW).map(ev => {
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const icon = ev.type === 'task' ? (ev.completed ? '' : '🔘') : (ev.allDay ? '📅' : '');
        const timeHtml = ev.allDay || !ev.startTime ? '' : `<span class="event-time">${ev.startTime} </span>`;
        const label = `${icon ? icon + ' ' : ''}${timeHtml}${ev.title}`.trim();
        return `<div class="event-chip${ev.completed ? ' completed' : ''}" 
                     data-id="${ev.id}" 
                     style="background:${bg};color:${color};"
                     title="${ev.title.replace(/"/g, '&quot;')}">
                  <span class="event-chip-dot" style="background:${color}"></span>
                  <span class="event-chip-label">${label}</span>
                </div>`;
      }).join('');

      const remaining = dayEvs.length - MAX_SHOW;
      const more = remaining > 0
        ? `<div class="more-events" data-date="${dateStr}">+${remaining} más</div>`
        : '';

      html += `<div class="${cls}" data-date="${dateStr}">
        <span class="cell-day-num">${day}</span>
        ${chipsHtml}${more}
      </div>`;
    }

    const totalCells = startDow + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
      for (let i = 1; i <= 7 - remainder; i++) {
        html += `<div class="month-cell other-month"><span class="cell-day-num">${i}</span></div>`;
      }
    }

    html += `</div></div>`;
    container.innerHTML = html;

    container.querySelectorAll('.month-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', e => {
        if (e.target.closest('.event-chip')) return;
        onDayClick(cell.dataset.date);
      });
    });
    container.querySelectorAll('.event-chip[data-id]').forEach(chip => {
      chip.addEventListener('click', e => { e.stopPropagation(); onEventClick(chip.dataset.id); });
    });
    container.querySelectorAll('.more-events[data-date]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); onDayClick(el.dataset.date); });
    });
  },

  renderWeek(container, refDate, onSlotClick, onEventClick) {
    const monday = window.getMondayOf(refDate);
    const today = window.todayStr();
    const weekEvs = Events.forWeek(monday);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }

    let headerHtml = `<div class="week-time-gutter-top"></div>`;
    days.forEach(d => {
      const ds = window.dateToStr(d);
      const cls = ds === today ? 'week-day-header is-today' : 'week-day-header';
      headerHtml += `<div class="${cls}" data-date="${ds}">
        <div class="week-day-name">${window.DAYS_SHORT[d.getDay()]}</div>
        <div class="week-day-num">${d.getDate()}</div>
      </div>`;
    });

    let gutterHtml = '';
    for (let h = VIEW_START_HOUR; h < VIEW_END_HOUR; h++) {
      const label = h === 0 ? '' : `${String(h).padStart(2, '0')}:00`;
      gutterHtml += `<div class="time-slot-label">${label}</div>`;
    }

    let colsHtml = '';
    days.forEach(d => {
      const ds = window.dateToStr(d);
      const evs = weekEvs[ds] || [];
      const isTod = ds === today;

      const evHtml = evs.filter(e => !e.allDay).map(ev => {
        const start = window.timeToMinutes(ev.startTime || '09:00');
        const end = window.timeToMinutes(ev.endTime || '10:00');
        const top = Math.max(0, (start - VIEW_START_HOUR * 60)) * (HOUR_PX / 60);
        const height = Math.max(22, (end - start) * (HOUR_PX / 60));
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const icon = ev.type === 'task' ? (ev.completed ? '✅' : '🔘') : '📅';
        return `<div class="time-event${ev.completed ? ' completed' : ''}" 
                     data-id="${ev.id}"
                     style="top:${top}px;height:${height}px;background:${bg};color:${color};border-left-color:${color};"
                     title="${ev.title}">
                  <div class="time-event-title">${icon} ${ev.title}</div>
                  ${height > 36 ? `<div class="time-event-time">${ev.startTime}–${ev.endTime}</div>` : ''}
                </div>`;
      }).join('');
      let nowHtml = '';
      if (isTod) {
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes();
        const nowTop = (mins - VIEW_START_HOUR * 60) * (HOUR_PX / 60);
        if (nowTop >= 0 && nowTop < (VIEW_END_HOUR - VIEW_START_HOUR) * HOUR_PX) {
          nowHtml = `<div class="now-line" style="top:${nowTop}px"></div>`;
        }
      }

      colsHtml += `<div class="week-col" data-date="${ds}">${evHtml}${nowHtml}</div>`;
    });

    let gridLinesHtml = '';
    for (let h = VIEW_START_HOUR; h < VIEW_END_HOUR; h++) {
      const top = (h - VIEW_START_HOUR) * HOUR_PX;
      const topH = (h - VIEW_START_HOUR + 0.5) * HOUR_PX;
      gridLinesHtml += `<div class="week-hour-line" style="top:${top}px"></div>`;
      gridLinesHtml += `<div class="week-half-line" style="top:${topH}px"></div>`;
    }
    let allDayRowHtml = `<div class="week-time-gutter-top" style="font-size:9px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;">Todo día</div>`;
    days.forEach(d => {
      const ds = window.dateToStr(d);
      const allDayEvs = (weekEvs[ds] || []).filter(e => e.allDay);
      const chips = allDayEvs.map(ev => {
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const icon = ev.type === 'task' ? (ev.completed ? '✅' : '🔘') : '📅';
        return `<div class="event-chip${ev.completed ? ' completed' : ''}" data-id="${ev.id}"
          style="background:${bg};color:${color};font-size:10px;margin-bottom:2px;cursor:pointer;padding:2px 6px;">
          ${icon} ${ev.title}
        </div>`;
      }).join('');
      allDayRowHtml += `<div style="border-right:1px solid var(--border);padding:3px 4px;min-height:26px;">${chips}</div>`;
    });

    container.innerHTML = `<div class="week-view anim-fade">
      <div class="week-header-row">${headerHtml}</div>
      <div class="week-header-row" style="background:var(--bg-elevated);border-bottom:1px solid var(--border);">
        ${allDayRowHtml}
      </div>
      <div class="week-body">
        <div class="week-grid-lines">${gridLinesHtml}</div>
        <div class="time-gutter">${gutterHtml}</div>
        ${colsHtml}
      </div>
    </div>`;

    container.querySelectorAll('.week-col').forEach(col => {
      col.addEventListener('click', e => {
        if (e.target.closest('.time-event')) return;
        const rect = col.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const mins = Math.floor(relY / HOUR_PX * 60) + VIEW_START_HOUR * 60;
        const hh = Math.floor(mins / 60);
        const mm = Math.floor((mins % 60) / 15) * 15;
        const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        const endH = hh + 1 < 24 ? hh + 1 : hh;
        const endT = `${String(endH).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        onSlotClick(col.dataset.date, time, endT);
      });
    });
    container.querySelectorAll('.time-event[data-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); onEventClick(el.dataset.id); });
    });
    container.querySelectorAll('.event-chip[data-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); onEventClick(el.dataset.id); });
    });
    container.querySelectorAll('.week-day-header[data-date]').forEach(el => {
      el.addEventListener('click', () => App.goToDay(el.dataset.date));
    });
  },

  renderDay(container, refDate, onSlotClick, onEventClick) {
    const ds = window.dateToStr(refDate);
    const today = window.todayStr();
    const evs = Events.forDate(ds);

    const dayName = window.DAYS_ES[refDate.getDay()];
    const dateLabel = (window.currentLang === "en") ? `${window.MONTHS_ES[refDate.getMonth()]} ${refDate.getDate()}, ${refDate.getFullYear()}` : `${refDate.getDate()} de ${window.MONTHS_ES[refDate.getMonth()]} ${refDate.getFullYear()}`;

    let gutterHtml = '';
    for (let h = VIEW_START_HOUR; h < VIEW_END_HOUR; h++) {
      gutterHtml += `<div class="time-slot-label">${String(h).padStart(2, '0')}:00</div>`;
    }

    let gridLinesHtml = '';
    for (let h = VIEW_START_HOUR; h < VIEW_END_HOUR; h++) {
      const top = (h - VIEW_START_HOUR) * HOUR_PX;
      const topH = (h - VIEW_START_HOUR + 0.5) * HOUR_PX;
      gridLinesHtml += `<div class="week-hour-line" style="top:${top}px"></div>`;
      gridLinesHtml += `<div class="week-half-line" style="top:${topH}px"></div>`;
    }

    const evHtml = evs.filter(e => !e.allDay).map(ev => {
      const start = window.timeToMinutes(ev.startTime || '09:00');
      const end = window.timeToMinutes(ev.endTime || '10:00');
      const top = Math.max(0, (start - VIEW_START_HOUR * 60)) * (HOUR_PX / 60);
      const height = Math.max(22, (end - start) * (HOUR_PX / 60));
      const color = Events.color(ev);
      const bg = Events.bgColor(ev);
      const icon = ev.type === 'task' ? (ev.completed ? '✅' : '🔘') : '📅';
      return `<div class="time-event${ev.completed ? ' completed' : ''}" 
                   data-id="${ev.id}"
                   style="top:${top}px;height:${height}px;background:${bg};color:${color};border-left-color:${color};left:6px;right:6px;"
                   title="${ev.title}">
                <div class="time-event-title" style="font-size:13px;">${icon} ${ev.title}</div>
                ${height > 36 ? `<div class="time-event-time">${ev.startTime} – ${ev.endTime}${ev.description ? ' · ' + ev.description.slice(0, 40) : ''}</div>` : ''}
              </div>`;
    }).join('');

    let nowHtml = '';
    if (ds === today) {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const nowTop = (mins - VIEW_START_HOUR * 60) * (HOUR_PX / 60);
      if (nowTop >= 0) nowHtml = `<div class="now-line" style="top:${nowTop}px"></div>`;
    }

    const allDayEvs = evs.filter(e => e.allDay);
    const allDayBanner = allDayEvs.length
      ? `<div style="padding:8px 16px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
          ${allDayEvs.map(ev => {
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const icon = ev.type === 'task' ? (ev.completed ? '✅' : '🔘') : '📅';
        return `<div class="event-chip${ev.completed ? ' completed' : ''}" data-id="${ev.id}" 
                         style="background:${bg};color:${color};cursor:pointer;padding:4px 10px;font-size:12px;">
                      ${icon} ${ev.title}
                    </div>`;
      }).join('')}
        </div>`
      : '';

    container.innerHTML = `<div class="day-view anim-fade">
      <div class="day-view-header">
        <div class="day-view-label">${dayName.charAt(0).toUpperCase() + dayName.slice(1)}</div>
        <div class="day-view-sub">${dateLabel}</div>
      </div>
      ${allDayBanner}
      <div class="day-body">
        <div class="week-grid-lines" style="left:52px;">${gridLinesHtml}</div>
        <div class="time-gutter">${gutterHtml}</div>
        <div class="day-col" id="day-col">${evHtml}${nowHtml}</div>
      </div>
    </div>`;

    const dayCol = container.querySelector('#day-col');
    dayCol.addEventListener('click', e => {
      if (e.target.closest('.time-event')) return;
      const rect = dayCol.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const mins = Math.floor(relY / HOUR_PX * 60) + VIEW_START_HOUR * 60;
      const hh = Math.floor(mins / 60);
      const mm = Math.floor((mins % 60) / 15) * 15;
      const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      const endH = hh + 1 < 24 ? hh + 1 : hh;
      const endT = `${String(endH).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      onSlotClick(ds, time, endT);
    });
    container.querySelectorAll('.time-event[data-id], .event-chip[data-id]').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); onEventClick(el.dataset.id); });
    });
  },

  titleForMonth(d) {
    return `${window.MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  },
  titleForWeek(refDate) {
    const mon = window.getMondayOf(refDate);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    if (mon.getMonth() === sun.getMonth())
      return (window.currentLang === "en") ? `${window.MONTHS_ES[mon.getMonth()]} ${mon.getDate()} – ${sun.getDate()}, ${mon.getFullYear()}` : `${mon.getDate()} – ${sun.getDate()} ${window.MONTHS_ES[mon.getMonth()]} ${mon.getFullYear()}`;
    return (window.currentLang === "en") ? `${window.MONTHS_ES[mon.getMonth()]} ${mon.getDate()} – ${window.MONTHS_ES[sun.getMonth()]} ${sun.getDate()}, ${sun.getFullYear()}` : `${mon.getDate()} ${window.MONTHS_ES[mon.getMonth()]} – ${sun.getDate()} ${window.MONTHS_ES[sun.getMonth()]} ${sun.getFullYear()}`;
  },
  titleForDay(d) {
    return (window.currentLang === "en") ? `${window.DAYS_ES[d.getDay()]}, ${window.MONTHS_ES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : `${window.DAYS_ES[d.getDay()]}, ${d.getDate()} de ${window.MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
  },
};
