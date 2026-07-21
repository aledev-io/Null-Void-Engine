import { Storage } from './storage.js';
import { Events } from './events.js';
import { App } from './app.js';

export const UI = {

  openModal(opts = {}) {
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('event-form');
    const btnDel = document.getElementById('btn-delete-event');

    form.reset();
    document.getElementById('time-row').style.display = '';

    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.cat-btn[data-cat="personal"]').classList.add('active');

    if (opts.event) {

      const ev = opts.event;
      const isTask = ev.type === 'task';
      title.textContent = isTask ? (window.currentLang === 'en' ? 'Edit Task' : 'Editar Tarea') : (window.currentLang === 'en' ? 'Edit Event' : 'Editar Evento');
      btnDel.classList.remove('hidden');
      btnDel.dataset.id = ev.id;
      document.getElementById('event-title').value = ev.title || '';
      document.getElementById('event-title').placeholder = isTask ? (window.currentLang === 'en' ? 'Task title' : 'Título de la tarea') : (window.currentLang === 'en' ? 'Event title' : 'Título del evento');
      document.getElementById('event-date').value = ev.date || '';
      document.getElementById('event-desc').value = ev.description || '';
      document.getElementById('event-allday').checked = !!ev.allDay;
      document.getElementById('event-completed').checked = !!ev.completed;
      document.getElementById('event-important').checked = !!(ev.isImportant || ev.is_important);
      document.getElementById('event-start').value = ev.startTime || '09:00';
      document.getElementById('event-end').value = ev.endTime || '10:00';

      this.setType(ev.type || 'event');

      // time-row handled by setType
      const catBtn = document.querySelector(`.cat-btn[data-cat="${ev.category || 'personal'}"]`);
      if (catBtn) { document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active')); catBtn.classList.add('active'); }

      const remList = document.getElementById('reminders-list');
      remList.innerHTML = '';
      if (ev.reminders && Array.isArray(ev.reminders)) {
        ev.reminders.forEach(m => this.addReminder(m));
      }

      form.dataset.editId = ev.id;
    } else {

      this.setType('event');
      document.getElementById('reminders-list').innerHTML = '';
      title.textContent = window.currentLang === 'en' ? 'New Event' : 'Nuevo Evento';
      document.getElementById('event-title').placeholder = window.currentLang === 'en' ? 'Event title' : 'Título del evento';
      btnDel.classList.add('hidden');
      delete form.dataset.editId;
      document.getElementById('event-date').value = opts.date || window.dateToStr(new Date());
      document.getElementById('event-start').value = opts.startTime || '09:00';
      document.getElementById('event-end').value = opts.endTime || '10:00';
    }

    overlay.hidden = false;
    setTimeout(() => document.getElementById('event-title').focus(), 80);
  },

  closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  },

  setType(type) {
    const isTask = type === 'task';
    const title = document.getElementById('modal-title');
    const isEdit = !!document.getElementById('event-form').dataset.editId;

    document.querySelectorAll('.type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    if (window.currentLang === 'en') {
      title.textContent = (isEdit ? 'Edit ' : 'New ') + (isTask ? 'Task' : 'Event');
      document.getElementById('event-title').placeholder = isTask ? 'Task title' : 'Event title';
    } else {
      title.textContent = isTask ? (isEdit ? 'Editar Tarea' : 'Nueva Tarea') : (isEdit ? 'Editar Evento' : 'Nuevo Evento');
      document.getElementById('event-title').placeholder = isTask ? 'Título de la tarea' : 'Título del evento';
    }

    document.getElementById('time-row').style.display = document.getElementById('event-allday').checked ? 'none' : '';
    document.getElementById('group-completed').classList.toggle('hidden', !isTask);
  },

  getFormData() {
    const form = document.getElementById('event-form');
    const title = document.getElementById('event-title').value.trim();
    const date = document.getElementById('event-date').value;
    const allDay = document.getElementById('event-allday').checked;
    const completed = document.getElementById('event-completed').checked;
    const isImportant = document.getElementById('event-important').checked;
    const typeBtn = document.querySelector('.type-btn.active');
    const type = typeBtn ? typeBtn.dataset.type : 'event';
    const startT = document.getElementById('event-start').value;
    const endT = document.getElementById('event-end').value;
    const desc = document.getElementById('event-desc').value.trim();
    const catBtn = document.querySelector('.cat-btn.active');
    const category = catBtn ? catBtn.dataset.cat : 'personal';

    if (!title) { document.getElementById('event-title').focus(); return null; }
    if (!date) { document.getElementById('event-date').focus(); return null; }

    const isTask = type === 'task';
    if (!allDay && !isTask && startT && endT && endT <= startT) {
      this.toast(window.currentLang === 'en' ? '❌ End time must be after start time' : '❌ La hora de fin debe ser posterior a la de inicio');
      document.getElementById('event-end').focus();
      return null;
    }

    const reminders = Array.from(document.querySelectorAll('.reminder-chip')).map(c => parseInt(c.dataset.minutes));

    return {
      title, date, type, completed, isImportant, reminders,
      allDay: allDay,
      startTime: allDay ? null : startT,
      endTime: allDay ? null : endT,
      description: desc, category
    };
  },

  renderMiniCal(refDate, selectedDate) {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const today = window.todayStr();

    document.getElementById('mini-cal-title').textContent =
      `${window.MONTHS_ES[month].slice(0, 3).toUpperCase()} ${year}`;

    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const monthEvs = Events.forMonth(year, month);
    const evDates = new Set(monthEvs.map(e => e.date));

    let html = '';
    for (let i = startDow - 1; i >= 0; i--) {
      html += `<div class="mini-day other-month">${daysInPrevMonth - i}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      let cls = 'mini-day';
      if (ds === today) cls += ' is-today';
      if (ds === selectedDate) cls += ' selected';
      if (evDates.has(ds)) cls += ' has-events';
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }
    const total = startDow + daysInMonth;
    const rem = total % 7;
    if (rem > 0) for (let i = 1; i <= 7 - rem; i++) html += `<div class="mini-day other-month">${i}</div>`;

    const grid = document.getElementById('mini-cal-grid');
    grid.innerHTML = html;
    grid.querySelectorAll('.mini-day[data-date]').forEach(el => {
      el.addEventListener('click', () => App.onMiniDayClick(el.dataset.date));
    });
  },

  renderTodayPanel() {
    const ds = window.todayStr();
    const evs = Events.forDate(ds);
    const count = document.getElementById('today-count');
    const list = document.getElementById('today-tasks');

    count.textContent = evs.length === 0 ? (window.currentLang === 'en' ? '0 events' : '0 eventos')
      : evs.length === 1 ? (window.currentLang === 'en' ? '1 event' : '1 evento') : `${evs.length} ${window.currentLang === 'en' ? 'events' : 'eventos'}`;

    if (evs.length === 0) {
      list.innerHTML = `<p class="empty-today">${window.currentLang === 'en' ? 'No events today' : 'Sin eventos hoy'}</p>`;
      return;
    }

    list.innerHTML = evs.map(ev => {
      const color = Events.color(ev);
      const timeStr = ev.allDay ? (window.currentLang === 'en' ? 'All day' : 'Todo el día') : `${ev.startTime || ''}${ev.endTime ? '–' + ev.endTime : ''}`;
      return `<div class="today-item${ev.completed ? ' completed' : ''}" data-id="${ev.id}">
        <div class="today-item-bar" style="background:${color}"></div>
        <div class="today-item-info">
          <div class="today-item-title">${ev.title}</div>
          <div class="today-item-time">${timeStr}</div>
        </div>
        <div class="today-check${ev.completed ? ' done' : ''}" data-check="${ev.id}" title="${window.currentLang === 'en' ? 'Mark complete' : 'Marcar completado'}"></div>
      </div>`;
    }).join('');

    list.querySelectorAll('.today-item[data-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.today-check')) return;
        const ev = Events.getById(el.dataset.id);
        if (ev) UI.openDetailView(ev);
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

  addReminder(minutes) {
    const list = document.getElementById('reminders-list');
    const chip = document.createElement('div');
    chip.className = 'reminder-chip';
    chip.dataset.minutes = minutes;

    let text = minutes === 0 ? (window.currentLang === 'en' ? 'At time of event' : 'En el momento')
      : minutes < 60 ? (window.currentLang === 'en' ? `${minutes} min before` : `${minutes} min antes`)
        : minutes < 1440 ? (window.currentLang === 'en' ? `${minutes / 60} h before` : `${minutes / 60} h antes`)
          : (window.currentLang === 'en' ? `${minutes / 1440} day(s) before` : `${minutes / 1440} día(s) antes`);

    chip.innerHTML = `<span>${text}</span><button type="button" onclick="this.parentElement.remove()">&times;</button>`;
    list.appendChild(chip);
  },


  toast(msg, duration = 2400) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), duration);
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Storage.setTheme(theme);
  },
  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    UI.applyTheme(cur === 'dark' ? 'light' : 'dark');
  },

  /* ─── Event Detail View ─── */

  openDetailView(ev) {
    if (!ev) return;
    const modal = document.getElementById('event-detail-modal');
    if (!modal) return;

    const isEn = window.currentLang === 'en';
    const isTask = ev.type === 'task';
    const color = Events.color(ev);

    // Header background gradient
    const bg = document.getElementById('detail-header-bg');
    bg.style.background = `linear-gradient(135deg, ${color}, ${color}88)`;

    // Type badge
    const typeText = document.getElementById('detail-type-text');
    typeText.textContent = isTask ? (isEn ? 'Task' : 'Tarea') : (isEn ? 'Event' : 'Evento');
    document.getElementById('detail-type-icon-event').style.display = isTask ? 'none' : '';
    document.getElementById('detail-type-icon-task').style.display = isTask ? '' : 'none';

    // Title
    document.getElementById('detail-title').textContent = ev.title || '';

    // Date
    const dateObj = window.parseDate(ev.date);
    const lang = window.currentLang || 'es';
    const dayName = window.DAYS_ES[dateObj.getDay()];
    const monthName = window.MONTHS_ES[dateObj.getMonth()];
    const dayNum = dateObj.getDate();
    const year = dateObj.getFullYear();
    document.getElementById('detail-date').textContent =
      `${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${dayNum} ${isEn ? 'of ' : 'de '}${monthName} ${year}`;

    // Time
    const timeRow = document.getElementById('detail-time-row');
    if (ev.allDay) {
      document.getElementById('detail-time').textContent = isEn ? 'All day' : 'Todo el día';
      timeRow.style.display = '';
    } else if (ev.startTime) {
      document.getElementById('detail-time').textContent = ev.endTime
        ? `${ev.startTime} – ${ev.endTime}` : ev.startTime;
      timeRow.style.display = '';
    } else {
      timeRow.style.display = 'none';
    }

    // Category
    const catNames = {
      personal: isEn ? 'Personal' : 'Personal',
      trabajo: isEn ? 'Work' : 'Trabajo',
      salud: isEn ? 'Health' : 'Salud',
      estudio: isEn ? 'Study' : 'Estudio',
      ocio: isEn ? 'Leisure' : 'Ocio'
    };
    document.getElementById('detail-cat-dot').style.background = color;
    document.getElementById('detail-category').textContent = catNames[ev.category] || ev.category || 'Personal';

    // Important
    const impRow = document.getElementById('detail-important-row');
    if (ev.isImportant || ev.is_important) {
      impRow.style.display = '';
      document.getElementById('detail-important-text').textContent = isEn ? 'Important' : 'Importante';
    } else {
      impRow.style.display = 'none';
    }

    // Status (tasks only)
    const statusRow = document.getElementById('detail-status-row');
    if (isTask) {
      statusRow.style.display = '';
      const statusEl = document.getElementById('detail-status');
      if (ev.completed) {
        statusEl.textContent = isEn ? 'Completed' : 'Completada';
        statusEl.style.color = 'var(--cat-salud)';
      } else {
        statusEl.textContent = isEn ? 'Pending' : 'Pendiente';
        statusEl.style.color = 'var(--text-secondary)';
      }
    } else {
      statusRow.style.display = 'none';
    }

    // Description
    const descSection = document.getElementById('detail-description-section');
    if (ev.description) {
      descSection.style.display = '';
      document.getElementById('detail-desc-label').textContent = isEn ? 'Notes' : 'Notas';
      document.getElementById('detail-desc-text').textContent = ev.description;
    } else {
      descSection.style.display = 'none';
    }

    // Reminders
    const remSection = document.getElementById('detail-reminders-section');
    if (ev.reminders && ev.reminders.length > 0) {
      remSection.style.display = '';
      document.getElementById('detail-rem-label').textContent = isEn ? 'Reminders' : 'Recordatorios';
      const list = document.getElementById('detail-reminders-list');
      list.innerHTML = ev.reminders.map(m => {
        const bellSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
        return `<span class="detail-reminder-tag">${bellSvg} ${this._formatReminderText(m)}</span>`;
      }).join('');
    } else {
      remSection.style.display = 'none';
    }

    // Wire up buttons
    const editBtn = document.getElementById('detail-btn-edit');
    const delBtn = document.getElementById('detail-btn-delete');
    editBtn.onclick = () => {
      this.closeDetailView();
      this.openModal({ event: ev });
    };
    delBtn.onclick = () => {
      this.closeDetailView();
      App.deleteEvent(ev.id);
    };

    // Close button
    document.getElementById('detail-close').onclick = () => this.closeDetailView();

    modal.hidden = false;

    // Close on overlay click
    modal.onclick = (e) => {
      if (e.target === modal) this.closeDetailView();
    };
  },

  closeDetailView() {
    const modal = document.getElementById('event-detail-modal');
    if (modal) modal.hidden = true;
  },

  _formatReminderText(minutes) {
    const isEn = window.currentLang === 'en';
    if (minutes === 0) return isEn ? 'At time of event' : 'En el momento';
    if (minutes < 60) return isEn ? `${minutes} min before` : `${minutes} min antes`;
    if (minutes < 1440) return isEn ? `${minutes / 60} h before` : `${minutes / 60} h antes`;
    const days = minutes / 1440;
    return isEn ? `${days} day(s) before` : `${days} día(s) antes`;
  },
};
