/**
 * events.js — CRUD operations for calendar events
 */
const CATEGORY_COLORS = {
  personal: '#7c6af7',
  trabajo:  '#4bc8c8',
  salud:    '#6bd46b',
  estudio:  '#f5a623',
  ocio:     '#f97066',
};

const CATEGORY_BG = {
  personal: 'rgba(124,106,247,.22)',
  trabajo:  'rgba(75,200,200,.22)',
  salud:    'rgba(107,212,107,.22)',
  estudio:  'rgba(245,166,35,.22)',
  ocio:     'rgba(249,112,102,.22)',
};

const Events = {
  getAll()    { return Storage.getAll(); },
  getById(id) { return this.getAll().find(e => e.id === id) || null; },

  create(data) {
    const events = this.getAll();
    const ev = { id: `ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, createdAt: new Date().toISOString(), completed: false, ...data };
    events.push(ev);
    Storage.save(events);
    return ev;
  },

  update(id, data) {
    const events = this.getAll();
    const idx    = events.findIndex(e => e.id === id);
    if (idx < 0) return null;
    events[idx] = { ...events[idx], ...data, updatedAt: new Date().toISOString() };
    Storage.save(events);
    return events[idx];
  },

  delete(id) {
    Storage.save(this.getAll().filter(e => e.id !== id));
  },

  toggleComplete(id) {
    const ev = this.getById(id);
    if (ev) this.update(id, { completed: !ev.completed });
  },

  forDate(dateStr) {
    return this.getAll()
      .filter(e => e.date === dateStr)
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (a.startTime || '').localeCompare(b.startTime || '');
      });
  },

  forMonth(year, month) {
    const prefix = `${year}-${String(month+1).padStart(2,'0')}`;
    return this.getAll().filter(e => e.date && e.date.startsWith(prefix));
  },

  forWeek(mondayDate) {
    const result = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(d.getDate() + i);
      const key = dateToStr(d);
      result[key] = this.forDate(key);
    }
    return result;
  },

  color(ev)   { return CATEGORY_COLORS[ev.category] || '#7c6af7'; },
  bgColor(ev) { return CATEGORY_BG[ev.category]     || 'rgba(124,106,247,.22)'; },
};

/* ── Date helpers ── */
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr() { return dateToStr(new Date()); }
function parseDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}
function getMondayOf(date) {
  const d   = new Date(date);
  const day = d.getDay();           // 0=Sun
  const diff= (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function timeToMinutes(t) {
  if (!t) return 0;
  const [h,m] = t.split(':').map(Number);
  return h * 60 + m;
}

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DAYS_ES   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DAYS_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
