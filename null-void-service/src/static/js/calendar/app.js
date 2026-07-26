import { Storage } from './storage.js';
import { Events } from './events.js';
import { Calendar } from './calendar.js';
import { UI } from './ui.js';

export const App = {
  state: {
    view: 'month',
    refDate: new Date(),
    selectedDate: window.dateToStr(new Date()),
  },

  init() {
    UI.applyTheme(Storage.getTheme());
    const todayNumEl = document.getElementById('mobile-today-num');
    if (todayNumEl) todayNumEl.textContent = new Date().getDate();



    window.addEventListener('storage', (e) => {
      if (e.key === 'theme' && e.newValue) {
        UI.applyTheme(e.newValue);
      }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const dateParam = urlParams.get('date');
    const eventParam = urlParams.get('event');

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      this.state.selectedDate = dateParam;
      this.state.refDate = window.parseDate(dateParam);
      this.state.view = 'month';
    }

    this.bindControls();
    this.render();

    if (eventParam) {
      setTimeout(() => {
        const ev = Events.getById(eventParam);
        if (ev) UI.openDetailView(ev);
      }, 200);
    }

    if (dateParam || eventParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  },

  render() {
    const { view, refDate, selectedDate } = this.state;
    const calBody = document.getElementById('cal-body');
    const calTitle = document.getElementById('cal-title');
    if (!calTitle.dataset.hasListener) {
      calTitle.dataset.hasListener = "true";
      calTitle.style.cursor = "pointer";
      calTitle.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'month';
        const year = this.state.refDate.getFullYear();
        const month = String(this.state.refDate.getMonth() + 1).padStart(2, '0');
        input.value = `${year}-${month}`;
        input.style.position = 'absolute';
        input.style.opacity = '0';
        input.style.width = '0';
        input.style.height = '0';
        document.body.appendChild(input);

        input.addEventListener('change', (e) => {
          if (e.target.value) {
            const [y, m] = e.target.value.split('-');
            const newDate = new Date(parseInt(y), parseInt(m) - 1, 1);
            this.setRefDate(newDate);
          }
          document.body.removeChild(input);
        });

        input.addEventListener('blur', () => {
          if (document.body.contains(input)) document.body.removeChild(input);
        });

        try {
          input.showPicker();
        } catch (err) {
          // Fallback if showPicker is not supported
          input.style.opacity = '1';
          input.style.width = 'auto';
          input.style.height = 'auto';
          input.style.top = calTitle.getBoundingClientRect().bottom + 'px';
          input.style.left = calTitle.getBoundingClientRect().left + 'px';
          input.style.zIndex = '9999';
          input.focus();
        }
      });
    }

    document.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    if (view === 'month') {
      const monthName = Calendar.titleForMonth(refDate).replace(/^./, c => c.toUpperCase());
      const parts = monthName.split(' ');
      const month = parts.slice(0, -1).join(' ');
      const year = parts[parts.length - 1];
      calTitle.innerHTML = `${month} <span class="cal-title-year">${year}</span>`;
      Calendar.renderMonth(
        calBody, refDate, selectedDate,
        date => this.onDayClick(date),
        id => this.onEventClick(id)
      );
    } else if (view === 'week') {
      calTitle.textContent = Calendar.titleForWeek(refDate).replace(/^./, c => c.toUpperCase());
      Calendar.renderWeek(
        calBody, refDate,
        (date, start, end) => this.onSlotClick(date, start, end),
        id => this.onEventClick(id)
      );
    } else {
      calTitle.textContent = Calendar.titleForDay(refDate).replace(/^./, c => c.toUpperCase());
      Calendar.renderDay(
        calBody, refDate,
        (date, start, end) => this.onSlotClick(date, start, end),
        id => this.onEventClick(id)
      );
    }

    UI.renderMiniCal(refDate, selectedDate);
    UI.renderTodayPanel();
  },

  refresh() {
    this.render();
  },

  navigate(dir) {
    const { view, refDate } = this.state;
    const d = new Date(refDate);
    if (view === 'month') {
      d.setMonth(d.getMonth() + dir);
    } else if (view === 'week') {
      d.setDate(d.getDate() + dir * 7);
    } else {
      d.setDate(d.getDate() + dir);
    }
    this.state.refDate = d;
    this.render();
  },

  goToToday() {
    this.state.refDate = new Date();
    this.state.selectedDate = window.dateToStr(new Date());
    this.render();
  },

  goToDay(dateStr) {
    this.state.view = 'day';
    this.state.refDate = window.parseDate(dateStr);
    this.state.selectedDate = dateStr;
    this.render();
  },

  setView(view) {
    this.state.view = view;
    this.render();
  },

  onDayClick(dateStr) {
    this.state.selectedDate = dateStr;
    UI.openModal({ date: dateStr });
  },

  onSlotClick(dateStr, startTime, endTime) {
    UI.openModal({ date: dateStr, startTime, endTime });
  },

  onEventClick(id) {
    const ev = Events.getById(id);
    if (ev) UI.openDetailView(ev);
  },

  onMiniDayClick(dateStr) {
    this.state.selectedDate = dateStr;
    this.state.refDate = window.parseDate(dateStr);
    if (this.state.view !== 'week' && this.state.view !== 'day') {
      this.state.view = 'day';
    }
    this.render();
  },

  saveEvent() {
    const data = UI.getFormData();
    if (!data) return;
    const form = document.getElementById('event-form');
    const editId = form.dataset.editId;

    if (editId) {
      Events.update(editId, data);
      UI.toast(window.currentLang === 'en' ? 'Event updated' : 'Evento actualizado');
    } else {
      Events.create(data);
      UI.toast(window.currentLang === 'en' ? 'Event created' : 'Evento creado');
    }
    UI.closeModal();
    this.render();
  },

  deleteEvent(id) {
    if (!id) return;
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;

    const isEn = window.currentLang === 'en';
    document.getElementById('confirm-title').textContent = isEn ? 'Delete this event?' : '¿Eliminar este evento?';
    document.getElementById('confirm-msg').textContent = isEn ? 'This action cannot be undone.' : 'Esta acción no se puede deshacer.';
    document.getElementById('confirm-btn-cancel').textContent = isEn ? 'Cancel' : 'Cancelar';
    document.getElementById('confirm-btn-ok').textContent = isEn ? 'Delete' : 'Eliminar';

    const okBtn = document.getElementById('confirm-btn-ok');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);

    newOkBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      Events.delete(id);
      UI.toast(isEn ? 'Event deleted' : 'Evento eliminado');
      UI.closeModal();
      this.render();
    });

    modal.style.display = 'flex';
  },

  bindControls() {

    document.getElementById('btn-prev').addEventListener('click', () => this.navigate(-1));
    document.getElementById('btn-next').addEventListener('click', () => this.navigate(+1));
    document.getElementById('btn-today').addEventListener('click', () => this.goToToday());

    let touchstartX = 0;
    const calBody = document.getElementById('cal-body');
    if (calBody) {
      calBody.addEventListener('touchstart', e => {
        touchstartX = e.changedTouches[0].screenX;
      }, { passive: true });
      calBody.addEventListener('touchend', e => {
        const touchendX = e.changedTouches[0].screenX;
        if (touchendX < touchstartX - 50) this.navigate(+1);
        if (touchendX > touchstartX + 50) this.navigate(-1);
      }, { passive: true });
    }

    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setView(btn.dataset.view));
    });

    document.getElementById('btn-add-event').addEventListener('click', () => {
      UI.openModal({ date: this.state.selectedDate });
    });

    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => UI.setType(btn.dataset.type));
    });

    document.getElementById('modal-close').addEventListener('click', () => UI.closeModal());
    document.getElementById('btn-cancel').addEventListener('click', () => UI.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) UI.closeModal();
    });

    document.getElementById('event-form').addEventListener('submit', e => {
      e.preventDefault();
      this.saveEvent();
    });

    document.getElementById('btn-delete-event').addEventListener('click', function () {
      App.deleteEvent(this.dataset.id);
    });

    document.getElementById('event-allday').addEventListener('change', function () {
      document.getElementById('time-row').style.display = this.checked ? 'none' : '';
    });

    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('mini-prev').addEventListener('click', () => {
      const d = new Date(this.state.refDate);
      d.setMonth(d.getMonth() - 1);
      this.state.refDate = d;
      UI.renderMiniCal(d, this.state.selectedDate);
    });
    document.getElementById('mini-next').addEventListener('click', () => {
      const d = new Date(this.state.refDate);
      d.setMonth(d.getMonth() + 1);
      this.state.refDate = d;
      UI.renderMiniCal(d, this.state.selectedDate);
    });

    document.getElementById('btn-toggle-theme').addEventListener('click', () => UI.toggleTheme());

    document.getElementById('reminder-select').addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      if (!isNaN(val)) {
        UI.addReminder(val);
        e.target.value = "";
      }
    });

    document.getElementById('btn-export').addEventListener('click', () => {
      Storage.exportJSON();
      UI.toast(window.currentLang === 'en' ? 'Calendar exported' : 'Calendario exportado');
    });
    document.getElementById('import-input').addEventListener('change', function () {
      if (!this.files[0]) return;
      const reader = new FileReader();
      reader.onload = e => {
        const added = Storage.importJSON(e.target.result);
        if (added === false) { UI.toast(window.currentLang === 'en' ? '❌ Invalid file' : '❌ Archivo no válido'); }
        else { UI.toast(window.currentLang === 'en' ? `${added} event(s) imported` : `${added} evento(s) importados`); App.render(); }
      };
      reader.readAsText(this.files[0]);
      this.value = '';
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('modal-overlay').hidden) UI.closeModal();
      if (e.key === 'ArrowLeft' && document.getElementById('modal-overlay').hidden) this.navigate(-1);
      if (e.key === 'ArrowRight' && document.getElementById('modal-overlay').hidden) this.navigate(+1);
    });

    // Mobile search overlay
    const searchBtn = document.getElementById('btn-mobile-search');
    const searchOverlay = document.getElementById('search-overlay');
    const searchInput = document.getElementById('search-input');
    const searchBack = document.getElementById('btn-search-back');
    const searchResults = document.getElementById('search-results');

    if (searchBtn && searchOverlay) {
      searchBtn.addEventListener('click', () => {
        searchOverlay.classList.add('active');
        searchInput.value = '';
        searchResults.innerHTML = '';
        setTimeout(() => searchInput.focus(), 100);
      });

      searchBack.addEventListener('click', () => {
        searchOverlay.classList.remove('active');
        searchInput.value = '';
        searchResults.innerHTML = '';
      });

      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {
          searchResults.innerHTML = '';
          return;
        }

        const allEvents = Events.getAll();
        const matches = allEvents
          .filter(ev => ev.title && ev.title.toLowerCase().includes(q))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 30);

        if (matches.length === 0) {
          const noResultsText = window.currentLang === 'en' ? 'No events found' : 'No se encontraron eventos';
          searchResults.innerHTML = `<div class="search-empty">${noResultsText}</div>`;
          return;
        }

        searchResults.innerHTML = matches.map(ev => {
          const color = Events.color(ev);
          const loc = window.currentLang === 'en' ? 'en-US' : 'es-ES';
          const dateObj = window.parseDate(ev.date);
          const dateStr = dateObj.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
          const timeStr = ev.allDay ? (window.currentLang === 'en' ? 'All day' : 'Todo el día') : (ev.startTime || '');
          return `<div class="search-result-item" data-event-id="${ev.id}">
            <div class="search-result-dot" style="background:${color}"></div>
            <div class="search-result-info">
              <div class="search-result-title">${ev.title}</div>
              <div class="search-result-date">${dateStr}${timeStr ? ' · ' + timeStr : ''}</div>
            </div>
          </div>`;
        }).join('');

        searchResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const evId = item.dataset.eventId;
            searchOverlay.classList.remove('active');
            searchInput.value = '';
            searchResults.innerHTML = '';
            const ev = Events.getById(evId);
            if (ev) UI.openDetailView(ev);
          });
        });
      });
    }
  },
};

