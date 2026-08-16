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
    window.App = this;
    UI.applyTheme(Storage.getTheme());
    const todayNumEl = document.getElementById('mobile-today-num');
    if (todayNumEl) todayNumEl.textContent = new Date().getDate();



    window.addEventListener('storage', (e) => {
      if (e.key === 'theme' && e.newValue) {
        UI.applyTheme(e.newValue);
      }
    });

    window.addEventListener('calendar:sync-error', (e) => {
      UI.toast(window.t((e.detail && e.detail.key) || 'sync_error'), 5000);
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
    UI.openQuickPopup({ date: dateStr });
  },

  onSlotClick(dateStr, startTime, endTime) {
    UI.openQuickPopup({ date: dateStr, startTime, endTime });
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
      UI.toast(window.t('event_updated'));
    } else {
      Events.create(data);
      UI.toast(window.t('event_created'));
    }
    UI.closeModal();
    this.render();
  },

  deleteEvent(id) {
    if (!id) return;
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;

    document.getElementById('confirm-title').textContent = window.t('confirm_delete_event');
    document.getElementById('confirm-msg').textContent = window.t('confirm_cannot_undo');
    document.getElementById('confirm-btn-cancel').textContent = window.t('btn_cancel');
    document.getElementById('confirm-btn-ok').textContent = window.t('btn_del');

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

    document.getElementById('btn-prev')?.addEventListener('click', () => this.navigate(-1));
    document.getElementById('btn-next')?.addEventListener('click', () => this.navigate(+1));
    document.getElementById('btn-today')?.addEventListener('click', () => this.goToToday());

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

    document.getElementById('btn-add-event')?.addEventListener('click', () => {
      UI.openQuickPopup({ date: this.state.selectedDate });
    });

    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => UI.setType(btn.dataset.type));
    });

    document.getElementById('modal-close')?.addEventListener('click', () => UI.closeModal());
    document.getElementById('btn-cancel')?.addEventListener('click', () => UI.closeModal());
    document.getElementById('modal-overlay')?.addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) UI.closeModal();
    });

    document.getElementById('event-form')?.addEventListener('submit', e => {
      e.preventDefault();
      this.saveEvent();
    });

    document.getElementById('btn-delete-event')?.addEventListener('click', function () {
      App.deleteEvent(this.dataset.id);
    });

    const modalNoteSelect = document.getElementById('modal-note-select');
    if (modalNoteSelect) {
      modalNoteSelect.addEventListener('change', (e) => {
        const noteId = e.target.value;
        if (!noteId) return;
        e.target.value = '';
        if (!UI.modalLinkedNotes) UI.modalLinkedNotes = [];
        if (!UI.modalLinkedNotes.includes(noteId)) {
          UI.modalLinkedNotes.push(noteId);
        }
        UI.renderModalNotes();

        const note = (window.calendarNotes || []).find(n => n.id === noteId);
        if (note) {
          const descInput = document.getElementById('event-desc');
          if (descInput) {
            const noteText = note.content || note.title || '';
            if (noteText) {
              if (descInput.value.trim()) {
                descInput.value = descInput.value.trim() + '\n\n' + noteText;
              } else {
                descInput.value = noteText;
              }
            }
          }
        }
      });
    }

    document.getElementById('event-allday')?.addEventListener('change', function () {
      const timeRow = document.getElementById('time-row');
      if (timeRow) timeRow.style.display = this.checked ? 'none' : '';
    });

    const eventInProgress = document.getElementById('event-in-progress');
    if (eventInProgress) {
      eventInProgress.addEventListener('change', function () {
        UI.updateModalInProgressUI(this.checked);
      });
    }

    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('mini-prev')?.addEventListener('click', () => {
      const d = new Date(this.state.refDate);
      d.setMonth(d.getMonth() - 1);
      this.state.refDate = d;
      UI.renderMiniCal(d, this.state.selectedDate);
    });
    document.getElementById('mini-next')?.addEventListener('click', () => {
      const d = new Date(this.state.refDate);
      d.setMonth(d.getMonth() + 1);
      this.state.refDate = d;
      UI.renderMiniCal(d, this.state.selectedDate);
    });

    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => UI.toggleTheme());

    document.getElementById('reminder-select')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        e.target.selectedIndex = 0;
        UI.addReminder(val);
      }
    });

    const qpClose = document.getElementById('qp-close');
    const qpBackdrop = document.getElementById('qp-backdrop');
    const qpSave = document.getElementById('qp-save');
    const qpMore = document.getElementById('qp-more-opts');
    const qpAllday = document.getElementById('qp-allday');

    if (qpClose) {
      qpClose.addEventListener('click', () => UI.closeQuickPopup());
      qpBackdrop.addEventListener('click', () => UI.closeQuickPopup());

      // Drag and drop for quick popup window
      const qpCard = document.querySelector('.qp-card');
      const qpTopbar = document.querySelector('.qp-topbar');
      let isDragging = false;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

      if (qpTopbar && qpCard) {
        qpTopbar.addEventListener('mousedown', (e) => {
          if (e.target.closest('#qp-close')) return;
          isDragging = true;
          const rect = qpCard.getBoundingClientRect();
          startX = e.clientX;
          startY = e.clientY;
          initialLeft = rect.left;
          initialTop = rect.top;
          qpCard.style.position = 'fixed';
          qpCard.style.margin = '0';
          qpCard.style.left = `${initialLeft}px`;
          qpCard.style.top = `${initialTop}px`;
          document.body.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          qpCard.style.left = `${initialLeft + dx}px`;
          qpCard.style.top = `${initialTop + dy}px`;
        });

        window.addEventListener('mouseup', () => {
          if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
          }
        });
      }

      // Type tabs
      document.querySelectorAll('[data-qptype]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-qptype]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          UI.updateQpTypeUI(btn.dataset.qptype);
        });
      });

      // Category pills
      document.querySelectorAll('[data-qpcat]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-qpcat]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      const dateStartInput = document.getElementById('qp-date-start-input');
      const dateEndInput = document.getElementById('qp-date-end-input');
      if (dateStartInput) {
        dateStartInput.addEventListener('click', () => {
          if (dateStartInput.showPicker) dateStartInput.showPicker();
        });
      }
      if (dateEndInput) {
        dateEndInput.addEventListener('click', () => {
          if (dateEndInput.showPicker) dateEndInput.showPicker();
        });
        const qpAllday = document.getElementById('qp-allday');
        if (qpAllday) {
          qpAllday.addEventListener('change', (e) => {
            UI.updateQpAllDayUI(e.target.checked);
          });
        }

        const qpInProgress = document.getElementById('qp-in-progress');
        if (qpInProgress) {
          qpInProgress.addEventListener('change', (e) => {
            UI.updateQpInProgressUI(e.target.checked);
          });
        }

        // Location row: click icon/row → toggle address form
        const qpLocRow = document.getElementById('qp-location-row');
        const qpLocPh = document.getElementById('qp-location-ph');
        const qpLocForm = document.getElementById('qp-location-form');
        if (qpLocRow && qpLocForm) {
          qpLocRow.addEventListener('click', (e) => {
            // Prevent closing when typing inside form inputs
            if (e.target.closest('#qp-location-form')) return;

            const isExpanded = qpLocForm.style.display === 'flex';
            if (isExpanded) {
              qpLocForm.style.display = 'none';
              if (qpLocPh) qpLocPh.style.display = '';
              qpLocRow.classList.add('clickable');
              ['street', 'city', 'zip', 'state', 'country'].forEach(k => {
                const el = document.getElementById(`qp-loc-${k}`);
                if (el) el.value = '';
              });
            } else {
              if (qpLocPh) qpLocPh.style.display = 'none';
              qpLocForm.style.display = 'flex';
              qpLocRow.classList.remove('clickable');
              const streetInput = document.getElementById('qp-loc-street');
              if (streetInput) streetInput.focus();
            }
          });
        }

        // Description row: click icon/row → toggle description field
        const qpDescRow = document.getElementById('qp-desc-row');
        const qpDescPh = document.getElementById('qp-desc-ph');
        const qpDescTa = document.getElementById('qp-desc');
        const qpDescEd = document.getElementById('qp-desc-editor');
        if (qpDescRow) {
          qpDescRow.addEventListener('click', (e) => {
            if (e.target.closest('#btn-ia-analyze') || e.target.closest('#qp-desc-editor') || e.target.closest('#qp-desc')) return;

            const isExpanded = qpDescEd ? qpDescEd.classList.contains('visible') : (qpDescTa && qpDescTa.classList.contains('visible'));
            if (isExpanded) {
              if (qpDescEd) qpDescEd.classList.remove('visible');
              if (qpDescTa) qpDescTa.classList.remove('visible');
              if (qpDescPh) qpDescPh.style.display = '';
              qpDescRow.classList.add('clickable');
            } else {
              if (qpDescPh) qpDescPh.style.display = 'none';
              if (qpDescEd) { qpDescEd.classList.add('visible'); qpDescEd.focus(); }
              if (qpDescTa) qpDescTa.classList.add('visible');
              qpDescRow.classList.remove('clickable');
            }
          });
        }

        // Quick popup reminder selector
        const qpRemSelect = document.getElementById('qp-reminder-select');
        const qpRemList = document.getElementById('qp-reminders-list');
        if (qpRemSelect && qpRemList) {
          qpRemSelect.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (isNaN(val)) return;
            if (!UI.qpReminders) UI.qpReminders = [];
            if (!UI.qpReminders.includes(val)) {
              UI.qpReminders.push(val);
            }
            UI.renderQpReminders();
          });
        }

        // Quick popup note selector
        const qpNoteSelect = document.getElementById('qp-note-select');
        if (qpNoteSelect) {
          qpNoteSelect.addEventListener('change', (e) => {
            const noteId = e.target.value;
            if (!noteId) return;
            e.target.value = '';
            if (!UI.qpLinkedNotes) UI.qpLinkedNotes = [];
            if (!UI.qpLinkedNotes.includes(noteId)) {
              UI.qpLinkedNotes.push(noteId);
            }
            UI.renderQpNotes();

            const note = (window.calendarNotes || []).find(n => n.id === noteId);
            if (note) {
              const descInput = document.getElementById('qp-desc');
              if (descInput) {
                const noteText = note.content || note.title || '';
                if (noteText) {
                  if (descInput.value.trim()) {
                    descInput.value = descInput.value.trim() + '\n\n' + noteText;
                  } else {
                    descInput.value = noteText;
                  }
                  UI.expandQpDesc();
                }
              }
            }
          });
        }

        // Keyboard shortcuts on title
        document.getElementById('qp-title').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); qpSave.click(); }
          if (e.key === 'Escape') UI.closeQuickPopup();
        });

        // Guardar rápido / Edición
        qpSave.addEventListener('click', () => {
          const data = UI.getQuickPopupData();
          if (!data.title) {
            UI.highlightError(document.getElementById('qp-title'));
            UI.toast(window.t('title_required'));
            return;
          }
          if (!data.date) {
            UI.highlightError(document.getElementById('qp-date-start-input'));
            UI.toast(window.t('date_required'));
            return;
          }
          const popup = document.getElementById('quick-popup');
          const editId = popup ? popup.dataset.editId : null;
          if (editId) {
            Events.update(editId, {
              title: data.title,
              date: data.date,
              endDate: data.endDate || data.date,
              type: data.type,
              allDay: data.allDay,
              inProgress: data.inProgress,
              startTime: data.allDay ? null : data.startTime,
              endTime: (data.allDay || data.inProgress) ? null : data.endTime,
              category: data.category,
              isImportant: data.important,
              reminders: data.reminders || [],
              description: data.description,
              location: data.location || '',
              guests: data.guests || [],
              noteId: data.noteId || null,
            });
            UI.closeQuickPopup();
            UI.toast(window.t('event_updated'));
          } else {
            Events.create({
              title: data.title,
              date: data.date,
              endDate: data.endDate || data.date,
              type: data.type,
              allDay: data.allDay,
              inProgress: data.inProgress,
              startTime: data.allDay ? null : data.startTime,
              endTime: (data.allDay || data.inProgress) ? null : data.endTime,
              category: data.category,
              isImportant: data.important,
              completed: false,
              reminders: data.reminders || [],
              description: data.description,
              location: data.location || '',
              guests: data.guests || [],
              noteId: data.noteId || null,
            });
            UI.closeQuickPopup();
            UI.toast(window.t('event_created'));
          }
          App.render();
        });

        // Más opciones → modal completo con prefill
        const qpMore = document.getElementById('qp-more-opts');
        if (qpMore) {
          qpMore.addEventListener('click', () => {
            const data = UI.getQuickPopupData();
            UI.closeQuickPopup();
            UI.openModal({
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              prefill: data,
            });
          });
        }
      }

      document.getElementById('btn-export').addEventListener('click', () => {
        Storage.exportJSON();
        UI.toast(window.t('calendar_exported'));
      });
      document.getElementById('import-input').addEventListener('change', function () {
        if (!this.files[0]) return;
        const reader = new FileReader();
        reader.onload = e => {
          const added = Storage.importJSON(e.target.result);
          if (added === false) { UI.toast(window.t('invalid_file')); }
          else { UI.toast(`${added} ${window.t('events_imported')}`); App.render(); }
        };
        reader.readAsText(this.files[0]);
        this.value = '';
      });

      document.addEventListener('keydown', e => {
        const qp = document.getElementById('quick-popup');
        const qpHidden = !qp || qp.hidden;
        if (e.key === 'Escape' && !qpHidden) UI.closeQuickPopup();
        if (e.key === 'ArrowLeft' && qpHidden) this.navigate(-1);
        if (e.key === 'ArrowRight' && qpHidden) this.navigate(+1);
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
            const noResultsText = window.t('no_events_found');
            searchResults.innerHTML = `<div class="search-empty">${noResultsText}</div>`;
            return;
          }

          searchResults.innerHTML = matches.map(ev => {
            const color = Events.color(ev);
            const loc = window.currentLang === 'en' ? 'en-US' : 'es-ES';
            const dateObj = window.parseDate(ev.date);
            const dateStr = dateObj.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = ev.allDay ? window.t('allday') : (ev.startTime || '');
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
    }
  }
}
