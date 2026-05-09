/**
 * app.js — Main application: state, init, event wiring
 */
const App = {
  state: {
    view:         'month',       // 'month' | 'week' | 'day'
    refDate:      new Date(),    // reference date for current view
    selectedDate: dateToStr(new Date()),
  },

  /* ── Init ── */
  init() {
    UI.applyTheme(Storage.getTheme());
    Notifications.init();

    window.addEventListener('storage', (e) => {
      if (e.key === 'theme' && e.newValue) {
        UI.applyTheme(e.newValue);
      }
    });

    // Comprobar si hay una fecha o evento específico en la URL
    const urlParams = new URLSearchParams(window.location.search);
    const dateParam = urlParams.get('date');
    const eventParam = urlParams.get('event');

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      this.state.selectedDate = dateParam;
      this.state.refDate = parseDate(dateParam);
      this.state.view = 'month';
    }

    this.bindControls();
    this.render();

    // Si venimos de un recordatorio con un ID de evento específico, abrirlo
    if (eventParam) {
      setTimeout(() => {
        const ev = Events.getById(eventParam);
        if (ev) UI.openModal({ event: ev });
      }, 200);
    }

    // Limpiar la URL para que no se vean los parámetros
    if (dateParam || eventParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  },

  /* ── Render ── */
  render() {
    const { view, refDate, selectedDate } = this.state;
    const calBody = document.getElementById('cal-body');
    const calTitle= document.getElementById('cal-title');

    // Update view toggle buttons
    document.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    // Render calendar
    if (view === 'month') {
      calTitle.textContent = Calendar.titleForMonth(refDate).replace(/^./, c => c.toUpperCase());
      Calendar.renderMonth(
        calBody, refDate, selectedDate,
        date => this.onDayClick(date),
        id   => this.onEventClick(id)
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

    // Sidebar
    UI.renderMiniCal(refDate, selectedDate);
    UI.renderTodayPanel();
  },

  refresh() { this.render(); },

  /* ── Navigation ── */
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
    this.state.refDate      = new Date();
    this.state.selectedDate = dateToStr(new Date());
    this.render();
  },

  goToDay(dateStr) {
    this.state.view         = 'day';
    this.state.refDate      = parseDate(dateStr);
    this.state.selectedDate = dateStr;
    this.render();
  },

  setView(view) {
    this.state.view = view;
    this.render();
  },

  /* ── Interactions ── */
  onDayClick(dateStr) {
    this.state.selectedDate = dateStr;
    UI.openModal({ date: dateStr });
  },

  onSlotClick(dateStr, startTime, endTime) {
    UI.openModal({ date: dateStr, startTime, endTime });
  },

  onEventClick(id) {
    const ev = Events.getById(id);
    if (ev) UI.openModal({ event: ev });
  },

  onMiniDayClick(dateStr) {
    this.state.selectedDate = dateStr;
    this.state.refDate      = parseDate(dateStr);
    if (this.state.view !== 'week' && this.state.view !== 'day') {
      this.state.view = 'day';
    }
    this.render();
  },

  /* ── Save / Delete ── */
  saveEvent() {
    const data   = UI.getFormData();
    if (!data) return;
    const form   = document.getElementById('event-form');
    const editId = form.dataset.editId;

    if (editId) {
      Events.update(editId, data);
      UI.toast('✏️ Evento actualizado');
    } else {
      Events.create(data);
      UI.toast('✅ Evento creado');
    }
    UI.closeModal();
    this.render();
  },

  deleteEvent(id) {
    if (!id) return;
    if (confirm('¿Eliminar este evento?')) {
      Events.delete(id);
      UI.toast('🗑️ Evento eliminado');
      UI.closeModal();
      this.render();
    }
  },

  /* ── Control Binding ── */
  bindControls() {
    // Nav
    document.getElementById('btn-prev').addEventListener('click', () => this.navigate(-1));
    document.getElementById('btn-next').addEventListener('click', () => this.navigate(+1));
    document.getElementById('btn-today').addEventListener('click', () => this.goToToday());

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setView(btn.dataset.view));
    });

    // Add event
    document.getElementById('btn-add-event').addEventListener('click', () => {
      UI.openModal({ date: this.state.selectedDate });
    });

    // Modal: type toggle
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => UI.setType(btn.dataset.type));
    });

    // Modal: close
    document.getElementById('modal-close').addEventListener('click', () => UI.closeModal());
    document.getElementById('btn-cancel').addEventListener('click', () => UI.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) UI.closeModal();
    });

    // Modal: save
    document.getElementById('event-form').addEventListener('submit', e => {
      e.preventDefault();
      this.saveEvent();
    });

    // Modal: delete
    document.getElementById('btn-delete-event').addEventListener('click', function() {
      App.deleteEvent(this.dataset.id);
    });

    // Modal: all-day toggle
    document.getElementById('event-allday').addEventListener('change', function() {
      document.getElementById('time-row').style.display = this.checked ? 'none' : '';
    });

    // Category buttons
    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Mini calendar nav
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

    // Theme toggle
    document.getElementById('btn-toggle-theme').addEventListener('click', () => UI.toggleTheme());

    // Shutdown
    const btnShutdown = document.getElementById('btn-shutdown');
    if (btnShutdown) btnShutdown.addEventListener('click', () => UI.shutdown());

    // Notifications
    document.getElementById('btn-notifications').addEventListener('click', async () => {
      const granted = await Notifications.requestPermission();
      if (granted) {
        const bellSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; vertical-align: middle;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';
        UI.toast(`${bellSVG} Notificaciones activadas`);
        Notifications.checkUpcomingEvents();
      }
    });

    document.getElementById('reminder-select').addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      if (!isNaN(val)) {
        UI.addReminder(val);
        e.target.value = ""; // Reset selector
      }
    });

    // ── HISTORIAL DE NOTIFICACIONES ──
    const notifBtn = document.getElementById('btn-notifications-history');
    if (notifBtn) {
      const notifModal = document.getElementById('notif-modal');
      const notifClose = document.getElementById('close-notif-modal');
      const notifList = document.getElementById('notif-history-list');

      notifBtn.addEventListener('click', async () => {
        notifModal.style.display = 'flex';
        notifList.innerHTML = '<p style="text-align: center; color: var(--text-sub); padding: 40px;">Cargando historial...</p>';
        
        try {
          const res = await fetch('/api/system/notifications/history');
          const data = await res.json();
          
          if (!data || data.length === 0) {
            notifList.innerHTML = '<p style="text-align: center; color: var(--text-sub); padding: 40px;">No hay notificaciones recientes.</p>';
            return;
          }
          
          notifList.innerHTML = data.map(n => `
            <div class="notif-item" style="display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1;">
                <div class="notif-title">${n.title}</div>
                <div class="notif-time">
                  <span>${n.date} a las ${n.time}</span>
                  <span class="notif-badge" style="background: rgba(99,102,241,0.1); color: var(--primary);">${n.category}</span>
                </div>
              </div>
              <button class="btn-delete-notif" data-id="${n.id}" style="background: none; border: none; color: var(--text-sub); cursor: pointer; font-size: 1.2rem; padding: 4px 8px;">&times;</button>
            </div>
          `).join('');

          // Bind delete buttons
          notifList.querySelectorAll('.btn-delete-notif').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const id = e.target.dataset.id;
              await fetch('/api/system/notifications/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
              });
              notifBtn.click(); // Reload
            });
          });
        } catch (e) {
          notifList.innerHTML = '<p style="text-align: center; color: #f87171; padding: 40px;">Error al cargar el historial.</p>';
        }
      });

      if (notifClose) {
        notifClose.addEventListener('click', () => {
          notifModal.style.display = 'none';
        });
      }

      document.getElementById('clear-all-notifs').addEventListener('click', async () => {
        if (confirm('¿Borrar todo el historial de notificaciones?')) {
          await fetch('/api/system/notifications/clear', { method: 'POST' });
          notifBtn.click(); // Reload
        }
      });

      window.addEventListener('click', (e) => {
        if (e.target === notifModal) notifModal.style.display = 'none';
      });
    }

    // Export / Import
    document.getElementById('btn-export').addEventListener('click', () => {
      Storage.exportJSON();
      UI.toast('📥 Calendario exportado');
    });
    document.getElementById('import-input').addEventListener('change', function() {
      if (!this.files[0]) return;
      const reader = new FileReader();
      reader.onload = e => {
        const added = Storage.importJSON(e.target.result);
        if (added === false) { UI.toast('❌ Archivo no válido'); }
        else { UI.toast(`📤 ${added} evento(s) importados`); App.render(); }
      };
      reader.readAsText(this.files[0]);
      this.value = '';
    });

    // Keyboard: Esc closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('modal-overlay').hidden) UI.closeModal();
      if (e.key === 'ArrowLeft'  && document.getElementById('modal-overlay').hidden) this.navigate(-1);
      if (e.key === 'ArrowRight' && document.getElementById('modal-overlay').hidden) this.navigate(+1);
    });
  },
};

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  // Refrescar cuando los datos se sincronicen desde el servidor
  window.addEventListener('calendar:synced', () => App.refresh());
});
