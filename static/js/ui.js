/**
 * ui.js — Modal management, sidebar rendering, toast
 */
const UI = {
  // ── Modal ──────────────────────────────────────────
  openModal(opts = {}) {
    const overlay  = document.getElementById('modal-overlay');
    const title    = document.getElementById('modal-title');
    const form     = document.getElementById('event-form');
    const btnDel   = document.getElementById('btn-delete-event');

    // Reset form
    form.reset();
    document.getElementById('time-row').style.display = '';

    // Category: reset to personal
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.cat-btn[data-cat="personal"]').classList.add('active');

    if (opts.event) {
      // Edit mode
      const ev = opts.event;
      const isTask = ev.type === 'task';
      title.textContent = isTask ? 'Editar Tarea' : 'Editar Evento';
      btnDel.classList.remove('hidden');
      btnDel.dataset.id = ev.id;
      document.getElementById('event-title').value  = ev.title || '';
      document.getElementById('event-title').placeholder = isTask ? 'Título de la tarea' : 'Título del evento';
      document.getElementById('event-date').value   = ev.date  || '';
      document.getElementById('event-desc').value   = ev.description || '';
      document.getElementById('event-allday').checked = !!ev.allDay;
      document.getElementById('event-completed').checked = !!ev.completed;
      document.getElementById('event-important').checked = !!(ev.isImportant || ev.is_important);
      document.getElementById('event-start').value  = ev.startTime || '09:00';
      document.getElementById('event-end').value    = ev.endTime   || '10:00';
      
      this.setType(ev.type || 'event');
      
      if (ev.allDay || isTask) document.getElementById('time-row').style.display = 'none';
      const catBtn = document.querySelector(`.cat-btn[data-cat="${ev.category || 'personal'}"]`);
      if (catBtn) { document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active')); catBtn.classList.add('active'); }
      // Reminders
      const remList = document.getElementById('reminders-list');
      remList.innerHTML = '';
      if (ev.reminders && Array.isArray(ev.reminders)) {
        ev.reminders.forEach(m => this.addReminder(m));
      }

      form.dataset.editId = ev.id;
    } else {
      // Create mode
      this.setType('event');
      document.getElementById('reminders-list').innerHTML = '';
      title.textContent = 'Nuevo Evento';
      document.getElementById('event-title').placeholder = 'Título del evento';
      btnDel.classList.add('hidden');
      delete form.dataset.editId;
      document.getElementById('event-date').value  = opts.date      || dateToStr(new Date());
      document.getElementById('event-start').value = opts.startTime || '09:00';
      document.getElementById('event-end').value   = opts.endTime   || '10:00';
    }

    overlay.hidden = false;
    setTimeout(() => document.getElementById('event-title').focus(), 80);
  },

  closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  },

  setType(type) {
    const isTask = type === 'task';
    const title  = document.getElementById('modal-title');
    const isEdit = !!document.getElementById('event-form').dataset.editId;
    
    document.querySelectorAll('.type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    title.textContent = (isEdit ? 'Editar ' : 'Nuevo ') + (isTask ? 'Tarea' : 'Evento');
    document.getElementById('event-title').placeholder = isTask ? 'Título de la tarea' : 'Título del evento';
    
    // Visibilidad de campos
    document.getElementById('time-row').style.display = isTask ? 'none' : (document.getElementById('event-allday').checked ? 'none' : '');
    document.getElementById('group-completed').classList.toggle('hidden', !isTask);
  },

  getFormData() {
    const form     = document.getElementById('event-form');
    const title    = document.getElementById('event-title').value.trim();
    const date     = document.getElementById('event-date').value;
    const allDay   = document.getElementById('event-allday').checked;
    const completed = document.getElementById('event-completed').checked;
    const isImportant = document.getElementById('event-important').checked;
    const typeBtn  = document.querySelector('.type-btn.active');
    const type     = typeBtn ? typeBtn.dataset.type : 'event';
    const startT   = document.getElementById('event-start').value;
    const endT     = document.getElementById('event-end').value;
    const desc     = document.getElementById('event-desc').value.trim();
    const catBtn   = document.querySelector('.cat-btn.active');
    const category = catBtn ? catBtn.dataset.cat : 'personal';

    if (!title) { document.getElementById('event-title').focus(); return null; }
    if (!date)  { document.getElementById('event-date').focus();  return null; }

    // Validar horas si no es todo el día ni tarea
    const isTask = type === 'task';
    if (!allDay && !isTask && startT && endT && endT <= startT) {
      this.toast('❌ La hora de fin debe ser posterior a la de inicio');
      document.getElementById('event-end').focus();
      return null;
    }

    const reminders = Array.from(document.querySelectorAll('.reminder-chip')).map(c => parseInt(c.dataset.minutes));

    return { 
      title, date, type, completed, isImportant, reminders,
      allDay: type === 'task' ? true : allDay, 
      startTime: (type === 'task' || allDay) ? null : startT, 
      endTime: (type === 'task' || allDay) ? null : endT, 
      description: desc, category 
    };
  },

  // ── Sidebar ────────────────────────────────────────
  renderMiniCal(refDate, selectedDate) {
    const year  = refDate.getFullYear();
    const month = refDate.getMonth();
    const today = todayStr();

    document.getElementById('mini-cal-title').textContent =
      `${MONTHS_ES[month].slice(0,3).toUpperCase()} ${year}`;

    const firstDay  = new Date(year, month, 1);
    let   startDow  = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;
    const daysInMonth    = new Date(year, month+1, 0).getDate();
    const daysInPrevMonth= new Date(year, month, 0).getDate();

    const monthEvs = Events.forMonth(year, month);
    const evDates  = new Set(monthEvs.map(e => e.date));

    let html = '';
    for (let i = startDow - 1; i >= 0; i--) {
      html += `<div class="mini-day other-month">${daysInPrevMonth - i}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      let   cls = 'mini-day';
      if (ds === today)         cls += ' is-today';
      if (ds === selectedDate)  cls += ' selected';
      if (evDates.has(ds))      cls += ' has-events';
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }
    const total    = startDow + daysInMonth;
    const rem      = total % 7;
    if (rem > 0) for (let i = 1; i <= 7 - rem; i++) html += `<div class="mini-day other-month">${i}</div>`;

    const grid = document.getElementById('mini-cal-grid');
    grid.innerHTML = html;
    grid.querySelectorAll('.mini-day[data-date]').forEach(el => {
      el.addEventListener('click', () => App.onMiniDayClick(el.dataset.date));
    });
  },

  renderTodayPanel() {
    const ds   = todayStr();
    const evs  = Events.forDate(ds);
    const count= document.getElementById('today-count');
    const list = document.getElementById('today-tasks');

    count.textContent = evs.length === 0 ? '0 eventos'
      : evs.length === 1 ? '1 evento' : `${evs.length} eventos`;

    if (evs.length === 0) {
      list.innerHTML = `<p class="empty-today">Sin eventos hoy 🎉</p>`;
      return;
    }

    list.innerHTML = evs.map(ev => {
      const color  = Events.color(ev);
      const timeStr= ev.allDay ? 'Todo el día' : `${ev.startTime || ''}${ev.endTime ? '–'+ev.endTime : ''}`;
      return `<div class="today-item${ev.completed?' completed':''}" data-id="${ev.id}">
        <div class="today-item-bar" style="background:${color}"></div>
        <div class="today-item-info">
          <div class="today-item-title">${ev.title}</div>
          <div class="today-item-time">${timeStr}</div>
        </div>
        <div class="today-check${ev.completed?' done':''}" data-check="${ev.id}" title="Marcar completado"></div>
      </div>`;
    }).join('');

    list.querySelectorAll('.today-item[data-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.today-check')) return;
        UI.openModal({ event: Events.getById(el.dataset.id) });
      });
    });
    list.querySelectorAll('.today-check[data-check]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        Events.toggleComplete(el.dataset.check);
        App.refresh();
      });
    });
  },

  // ── Reminders ──────────────────────────────────────
  addReminder(minutes) {
    const list = document.getElementById('reminders-list');
    const chip = document.createElement('div');
    chip.className = 'reminder-chip';
    chip.dataset.minutes = minutes;
    
    let text = minutes === 0 ? 'En el momento' 
             : minutes < 60 ? `${minutes} min antes`
             : minutes < 1440 ? `${minutes/60} h antes`
             : `${minutes/1440} día(s) antes`;
             
    chip.innerHTML = `<span>${text}</span><button type="button" onclick="this.parentElement.remove()">&times;</button>`;
    list.appendChild(chip);
  },

  // ── System ──────────────────────────────────────────
  shutdown() {
    if (confirm('¿Deseas apagar el servidor?')) {
      fetch('/api/system/shutdown', { method: 'POST' })
        .then(() => {
          this.toast('🔌 Apagando servidor...');
          setTimeout(() => window.close(), 2000);
        });
    }
  },

  // ── Toast ──────────────────────────────────────────
  toast(msg, duration = 2400) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), duration);
  },

  // ── Theme ──────────────────────────────────────────
  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setTheme(theme);
  },
  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    UI.applyTheme(cur === 'dark' ? 'light' : 'dark');
  },
};
