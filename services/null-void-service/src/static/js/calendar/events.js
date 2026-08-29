import { Storage } from './storage.js';

const CATEGORY_COLORS = {
  personal: '#7c6af7',
  trabajo: '#4bc8c8',
  salud: '#6bd46b',
  estudio: '#f5a623',
  ocio: '#f97066',
  otros: '#94a3b8',
};

const CATEGORY_BG = {
  personal: 'rgba(124,106,247,.22)',
  trabajo: 'rgba(75,200,200,.22)',
  salud: 'rgba(107,212,107,.22)',
  estudio: 'rgba(245,166,35,.22)',
  ocio: 'rgba(249,112,102,.22)',
  otros: 'rgba(148,163,184,.22)',
};

export const Events = {
  getAll() { return Storage.getAll(); },
  getById(id) { return this.getAll().find(e => e.id === id) || null; },

  create(data) {
    const events = this.getAll();
    const ev = { id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString(), completed: false, ...data };
    events.push(ev);
    Storage.save(events);
    return ev;
  },

  update(id, data) {
    const events = this.getAll();
    const idx = events.findIndex(e => e.id === id);
    if (idx < 0) return null;
    let patch = { ...data };
    if (patch.completed && (events[idx].inProgress || patch.inProgress)) {
      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      patch.inProgress = false;
      if (!patch.endDate) patch.endDate = window.dateToStr(now);
      if (!patch.endTime) patch.endTime = currentHHMM;
    }
    events[idx] = { ...events[idx], ...patch, updatedAt: new Date().toISOString() };
    Storage.save(events);
    return events[idx];
  },

  delete(id) {
    Storage.save(this.getAll().filter(e => e.id !== id));
  },

  toggleComplete(id) {
    const ev = this.getById(id);
    if (!ev) return;
    const isCompleted = !ev.completed;
    this.update(id, { completed: isCompleted });
  },

  finishEvent(id) {
    const ev = this.getById(id);
    if (!ev) return null;
    const now = new Date();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const endDate = window.dateToStr(now);
    return this.update(id, {
      inProgress: false,
      endTime: currentHHMM,
      endDate: endDate
    });
  },

  forDate(dateStr) {
    const today = window.todayStr();
    return this.getAll()
      .filter(e => {
        if (!e.date) return false;
        if (e.inProgress) {
          const effectiveEnd = e.endDate || today;
          const maxDate = effectiveEnd < today ? today : effectiveEnd;
          return e.date <= dateStr && dateStr <= maxDate;
        }
        if (!e.endDate || e.endDate === e.date) return e.date === dateStr;
        // Multi-day: include if dateStr falls within [date, endDate]
        return e.date <= dateStr && e.endDate >= dateStr;
      })
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
  },

  forMonth(year, month) {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const today = window.todayStr();
    return this.getAll().filter(e => {
      if (!e.date) return false;
      if (e.inProgress) {
        const effectiveEnd = e.endDate || today;
        const maxDate = effectiveEnd < today ? today : effectiveEnd;
        return e.date <= monthEnd && maxDate >= monthStart;
      }
      if (!e.endDate || e.endDate === e.date) return e.date.startsWith(prefix);
      // Multi-day: include if the event overlaps this month at all
      return e.date <= monthEnd && e.endDate >= monthStart;
    });
  },

  forWeek(mondayDate) {
    const result = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(d.getDate() + i);
      const key = window.dateToStr(d);
      result[key] = this.forDate(key);
    }
    return result;
  },

  color(ev) { return CATEGORY_COLORS[ev.category] || '#7c6af7'; },
  bgColor(ev) { return CATEGORY_BG[ev.category] || 'rgba(124,106,247,.22)'; },
};

window.dateToStr = function(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
window.todayStr = function() { return window.dateToStr(new Date()); };
window.parseDate = function(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
};
window.getMondayOf = function(date) {
  const d = new Date(date);
  const day = d.getDay();           // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
};
window.timeToMinutes = function(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const CAL_LANG = {
  es: {
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    daysShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  },
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  }
};

Object.defineProperty(window, 'MONTHS_ES', { get: () => CAL_LANG[window.currentLang || 'es'].months });
Object.defineProperty(window, 'DAYS_ES', { get: () => CAL_LANG[window.currentLang || 'es'].days });
Object.defineProperty(window, 'DAYS_SHORT', { get: () => CAL_LANG[window.currentLang || 'es'].daysShort });
