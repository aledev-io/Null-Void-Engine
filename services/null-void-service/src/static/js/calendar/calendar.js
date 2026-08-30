import { Events } from './events.js';
import { App } from './app.js';

function _escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const VIEW_START_HOUR = 0;
const VIEW_END_HOUR = 24;
const HOUR_PX = 60;

const SVG_TASK_COMPLETED = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align:-2px; flex-shrink:0;"><path d="M20 6L9 17l-5-5"></path></svg>';
const SVG_TASK_PENDING = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align:-2px; flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle></svg>';
const SVG_EVENT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align:-2px; flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';

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

    // Build a map: dateStr -> [events that appear on that day]
    const evByDate = {};
    for (const ev of monthEvents) {
      const evStart = ev.date;
      const evEnd = ev.endDate && ev.endDate !== ev.date ? ev.endDate : ev.date;
      // Iterate all days this event spans (capped to the visible month)
      let cur = new Date(Math.max(window.parseDate(evStart), new Date(year, month, 1)));
      const cap = new Date(Math.min(window.parseDate(evEnd), new Date(year, month + 1, 0)));
      while (cur <= cap) {
        const ds = window.dateToStr(cur);
        if (!evByDate[ds]) evByDate[ds] = [];
        evByDate[ds].push({ ev, isStart: ds === evStart, isEnd: ds === window.dateToStr(cap) || ds === evEnd });
        cur.setDate(cur.getDate() + 1);
      }
    }

    const s = window.DAYS_SHORT;
    const DAYS_HEADER = [s[1], s[2], s[3], s[4], s[5], s[6], s[0]];

    let html = `<div class="month-view">
      <div class="month-weekdays">
        ${DAYS_HEADER.map((d, i) => `<div class="month-weekday">${d}</div>`).join('')}
      </div>
      <div class="month-grid">`;

    for (let i = startDow - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevDateStr = window.dateToStr(new Date(year, month - 1, d));
      html += `<div class="month-cell other-month" data-date="${prevDateStr}"><span class="cell-day-num">${d}</span></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === today;
      const isSel = dateStr === selectedDate;
      const dayEntries = evByDate[dateStr] || [];

      let cls = 'month-cell';
      if (isSel) cls += ' selected';

      // MAX_SHOW dinámico: en pantallas muy pequeñas (landscape), 1 chip máximo
      const screenH = window.innerHeight;
      const MAX_SHOW = screenH <= 420 ? 1 : screenH <= 600 ? 2 : 3;

      const chipsHtml = dayEntries.slice(0, MAX_SHOW).map(({ ev, isStart, isEnd }) => {
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const isMultiDay = ev.endDate && ev.endDate !== ev.date;
        const icon = ev.type === 'task' ? (ev.completed ? '' : SVG_TASK_PENDING) : (ev.allDay ? SVG_EVENT : '');
        const timeHtml = ev.inProgress ? `<span class="event-time" style="color:#38bdf8;font-weight:bold;">${window.t('indefinido')} </span>` : (ev.allDay || !ev.startTime || isMultiDay ? '' : `<span class="event-time">${ev.startTime} </span>`);
        const label = `${icon ? icon + ' ' : ''}${timeHtml}${ev.title}`.trim();
        const contStart = isMultiDay && !isStart ? '▶ ' : '';
        const contEnd = isMultiDay && !isEnd ? ' ▶' : '';
        return `<div class="event-chip${ev.completed ? ' completed' : ''}${isMultiDay ? ' multi-day-chip' : ''}" 
                     data-id="${ev.id}" 
                     style="background:${bg};color:${color};${isMultiDay && !isStart ? 'border-top-left-radius:0;border-bottom-left-radius:0;' : ''}${isMultiDay && !isEnd ? 'border-top-right-radius:0;border-bottom-right-radius:0;' : ''}"
                     title="${_escHtml(ev.title)}">
                  <span class="event-chip-dot" style="background:${color}"></span>
                  <span class="event-chip-label">${contStart}${_escHtml(label)}${contEnd}</span>
                </div>`;
      }).join('');

      const remaining = dayEntries.length - MAX_SHOW;
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
        const nextDateStr = window.dateToStr(new Date(year, month + 1, i));
        html += `<div class="month-cell other-month" data-date="${nextDateStr}"><span class="cell-day-num">${i}</span></div>`;
      }
    }

    html += `</div></div>`;
    container.style.visibility = 'hidden';
    container.innerHTML = html;
    container.offsetHeight; // force layout before GPU paint
    container.style.visibility = '';

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
      const cls = 'week-day-header';
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

      const evHtml = (() => {
        const nonAllDay = evs.filter(e => !e.allDay).map(ev => {
          const start = window.timeToMinutes(ev.startTime || '09:00');
          let end = window.timeToMinutes(ev.endTime || '10:00');
          if (ev.inProgress) {
            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            end = Math.max(start + 30, currentMins);
          }
          return { ev, start, end };
        }).sort((a, b) => a.start - b.start || b.end - a.end);

        const cols = [];
        for (const item of nonAllDay) {
          let col = 0;
          while (col < cols.length && cols[col].some(o => item.start < o.end && o.start < item.end)) col++;
          if (col >= cols.length) cols.push([]);
          cols[col].push(item);
          item.col = col;
          item.totalCols = 0;
        }
        nonAllDay.forEach(item => { item.totalCols = cols.length; });

        return nonAllDay.map(({ ev, start, end, col, totalCols }) => {
          const top = Math.max(0, (start - VIEW_START_HOUR * 60)) * (HOUR_PX / 60);
          const height = Math.max(22, (end - start) * (HOUR_PX / 60));
          const color = Events.color(ev);
          const bg = Events.bgColor(ev);
          const icon = ev.type === 'task' ? (ev.completed ? SVG_TASK_COMPLETED : SVG_TASK_PENDING) : SVG_EVENT;
          const timeDisplay = ev.startTime && ev.endTime ? (ev.inProgress ? `${ev.startTime}–${window.t('indefinido')}` : `${ev.startTime}–${ev.endTime}`) : '';
          const w = 100 / totalCols;
          const l = col * w;
          return `<div class="time-event${ev.completed ? ' completed' : ''}${ev.inProgress ? ' in-progress' : ''}" 
                       data-id="${ev.id}"
                       style="top:${top}px;height:${height}px;width:calc(${w}% - 6px);left:calc(${l}% + 3px);background:${bg};color:${color};border-left-color:${color};${ev.inProgress ? 'box-shadow: 0 0 8px rgba(56,189,248,0.5);' : ''}"
                       title="${_escHtml(ev.title)}">
                    <div class="time-event-title">${icon} ${_escHtml(ev.title)}</div>
                    ${height > 36 && timeDisplay ? `<div class="time-event-time">${timeDisplay}</div>` : ''}
                  </div>`;
        }).join('');
      })();
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
    let allDayRowHtml = `<div class="week-time-gutter-top" style="font-size:9px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;">${window.t('all_day') || 'Todo el día'}</div>`;
    days.forEach(d => {
      const ds = window.dateToStr(d);
      const allDayEvs = (weekEvs[ds] || []).filter(e => e.allDay);
      const chips = allDayEvs.map(ev => {
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const icon = ev.type === 'task' ? (ev.completed ? SVG_TASK_COMPLETED : SVG_TASK_PENDING) : SVG_EVENT;
        return `<div class="event-chip${ev.completed ? ' completed' : ''}" data-id="${ev.id}"
          style="background:${bg};color:${color};font-size:10px;margin-bottom:2px;cursor:pointer;padding:2px 6px;">
          ${icon} ${_escHtml(ev.title)}
        </div>`;
      }).join('');
      allDayRowHtml += `<div style="border-right:1px solid var(--border);padding:3px 4px;min-height:26px;">${chips}</div>`;
    });

    container.innerHTML = `<div class="week-view">
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

    const evHtml = (() => {
      const nonAllDay = evs.filter(e => !e.allDay).map(ev => {
        const start = window.timeToMinutes(ev.startTime || '09:00');
        let end = window.timeToMinutes(ev.endTime || '10:00');
        if (ev.inProgress) {
          const now = new Date();
          const currentMins = now.getHours() * 60 + now.getMinutes();
          end = Math.max(start + 30, currentMins);
        }
        return { ev, start, end };
      }).sort((a, b) => a.start - b.start || b.end - a.end);

      const cols = [];
      for (const item of nonAllDay) {
        let col = 0;
        while (col < cols.length && cols[col].some(o => item.start < o.end && o.start < item.end)) col++;
        if (col >= cols.length) cols.push([]);
        cols[col].push(item);
        item.col = col;
        item.totalCols = 0;
      }
      nonAllDay.forEach(item => { item.totalCols = cols.length; });

      return nonAllDay.map(({ ev, start, end, col, totalCols }) => {
        const top = Math.max(0, (start - VIEW_START_HOUR * 60)) * (HOUR_PX / 60);
        const height = Math.max(22, (end - start) * (HOUR_PX / 60));
        const color = Events.color(ev);
        const bg = Events.bgColor(ev);
        const icon = ev.type === 'task' ? (ev.completed ? SVG_TASK_COMPLETED : SVG_TASK_PENDING) : SVG_EVENT;
        let details = [];
        if (ev.startTime && ev.endTime) {
          details.push(ev.inProgress ? `${ev.startTime} – ${window.t('indefinido')}` : `${ev.startTime} – ${ev.endTime}`);
        }
        if (ev.description) details.push(ev.description.replace(/\s+/g, ' ').slice(0, 40));
        const timeDisplay = details.join(' · ');
        const w = 100 / totalCols;
        const l = col * w;
        return `<div class="time-event${ev.completed ? ' completed' : ''}${ev.inProgress ? ' in-progress' : ''}" 
                     data-id="${ev.id}" 
                     style="top:${top}px;height:${height}px;width:calc(${w}% - 12px);left:calc(${l}% + 6px);background:${bg};color:${color};border-left-color:${color};${ev.inProgress ? 'box-shadow: 0 0 8px rgba(56,189,248,0.5);' : ''}"
                     title="${_escHtml(ev.title)}">
                  <div class="time-event-title" style="font-size:13px;">${icon} ${_escHtml(ev.title)}</div>
                  ${height > 36 && timeDisplay ? `<div class="time-event-time">${timeDisplay}</div>` : ''}
                </div>`;
      }).join('');
    })();

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
        const icon = ev.type === 'task' ? (ev.completed ? SVG_TASK_COMPLETED : SVG_TASK_PENDING) : SVG_EVENT;
        return `<div class="event-chip${ev.completed ? ' completed' : ''}" data-id="${ev.id}" 
                         style="background:${bg};color:${color};cursor:pointer;padding:4px 10px;font-size:12px;">
                      ${icon} ${_escHtml(ev.title)}
                    </div>`;
      }).join('')}
        </div>`
      : '';

    const notesForDay = (window.calendarNotes || []).filter(n => n.linkedDates && n.linkedDates.includes(ds));
    const notesBanner = notesForDay.length
      ? `<div style="padding:8px 16px;background:var(--bg-elevated);border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <span style="font-size: 12px; color: var(--text-dim); font-weight: bold;">Notas vinculadas:</span>
          ${notesForDay.map(note => {
        const noteSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
        return `<div class="note-chip" data-note-id="${note.id}" title="Ver nota en Dashboard"
                         style="background:var(--bg-hover);color:var(--text-main);cursor:pointer;padding:4px 10px;font-size:12px;border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;gap:4px;">
                      ${noteSvg} ${_escHtml(note.title) || 'Sin título'}
                    </div>`;
      }).join('')}
        </div>`
      : '';

    container.innerHTML = `<div class="day-view">
      <div class="day-view-header">
        <div class="day-view-label">${dayName.charAt(0).toUpperCase() + dayName.slice(1)}</div>
        <div class="day-view-sub">${dateLabel}</div>
      </div>
      ${allDayBanner}
      ${notesBanner}
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
    container.querySelectorAll('.note-chip').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        // Redirect to dashboard where the note can be viewed
        window.location.href = '/app?view=dashboard#nota-' + el.dataset.noteId;
      });
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
