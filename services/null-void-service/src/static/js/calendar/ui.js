import { Storage } from './storage.js';
import { Events } from './events.js';
import { App } from './app.js';

export const UI = {

  openModal(opts = {}) {
    this.openQuickPopup(opts);
  },

  closeModal() {
    this.closeQuickPopup();
  },

  openQuickPopup(opts = {}) {
    const popup = document.getElementById('quick-popup');
    if (!popup) return;

    const ev = opts.event;
    if (ev) {
      popup.dataset.editId = ev.id;
    } else {
      delete popup.dataset.editId;
    }

    const now = new Date();
    const nowH = now.getHours();
    const defaultStart = `${String(nowH).padStart(2, '0')}:00`;
    const endH = (nowH + 1) % 24;
    const defaultEnd = `${String(endH).padStart(2, '0')}:00`;

    const dateStr = (ev && ev.date) || opts.date || window.dateToStr(new Date());
    const endDateStr = (ev && (ev.endDate || ev.date)) || dateStr;

    const qpStartEl = document.getElementById('qp-start');
    const qpEndEl = document.getElementById('qp-end');
    if (qpStartEl) qpStartEl.value = (ev && ev.startTime) || opts.startTime || defaultStart;
    if (qpEndEl) qpEndEl.value = (ev && ev.endTime) || opts.endTime || defaultEnd;

    const startDateInput = document.getElementById('qp-date-start-input');
    const endDateInput = document.getElementById('qp-date-end-input');
    if (startDateInput) startDateInput.value = dateStr;
    if (endDateInput) {
      endDateInput.value = endDateStr;
      endDateInput.min = dateStr;
    }

    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    const titleEl = document.getElementById('qp-title');
    if (titleEl) titleEl.value = (ev && ev.title) || '';

    // Description
    const descPh = document.getElementById('qp-desc-ph');
    const descTa = document.getElementById('qp-desc');
    const descEd = document.getElementById('qp-desc-editor');
    const descRow = document.getElementById('qp-desc-row');
    const descVal = (ev && ev.description) || (opts.prefill && opts.prefill.description) || '';
    if (descTa) descTa.value = descVal;
    if (descEd) descEd.innerHTML = descVal;
    if (descVal) {
      if (descPh) descPh.style.display = 'none';
      if (descEd) descEd.classList.add('visible');
      if (descTa) descTa.classList.add('visible');
      if (descRow) descRow.classList.remove('clickable');
    } else {
      if (descPh) descPh.style.display = '';
      if (descEd) descEd.classList.remove('visible');
      if (descTa) descTa.classList.remove('visible');
      if (descRow) descRow.classList.add('clickable');
    }

    // Location
    const locPh = document.getElementById('qp-location-ph');
    const locForm = document.getElementById('qp-location-form');
    const locRow = document.getElementById('qp-location-row');
    const locVal = (ev && ev.location) || (opts.prefill && opts.prefill.location) || '';
    
    ['street', 'city', 'zip', 'state', 'country'].forEach(k => {
      const el = document.getElementById(`qp-loc-${k}`);
      if (el) el.value = '';
    });

    if (locVal) {
      if (locPh) locPh.style.display = 'none';
      if (locForm) locForm.style.display = 'flex';
      if (locRow) locRow.classList.remove('clickable');
      const streetEl = document.getElementById('qp-loc-street');
      if (streetEl) streetEl.value = locVal;
    } else {
      if (locPh) locPh.style.display = '';
      if (locForm) locForm.style.display = 'none';
      if (locRow) locRow.classList.add('clickable');
    }

    // Checkboxes
    const alldayCheck = document.getElementById('qp-allday');
    if (alldayCheck) {
      alldayCheck.checked = !!(ev ? ev.allDay : (opts.prefill && opts.prefill.allDay));
      this.updateQpAllDayUI(alldayCheck.checked);
    }
    const inpCheck = document.getElementById('qp-in-progress');
    if (inpCheck) {
      inpCheck.checked = !!(ev ? ev.inProgress : (opts.prefill && opts.prefill.inProgress));
      this.updateQpInProgressUI(inpCheck.checked);
    }
    const impCheck = document.getElementById('qp-important');
    if (impCheck) impCheck.checked = !!(ev ? (ev.isImportant || ev.is_important) : (opts.prefill && opts.prefill.important));

    // Category
    const catName = (ev && ev.category) || (opts.prefill && opts.prefill.category) || 'trabajo';
    document.querySelectorAll('[data-qpcat]').forEach(b => b.classList.remove('active'));
    const targetCatBtn = document.querySelector(`[data-qpcat="${catName}"]`);
    if (targetCatBtn) targetCatBtn.classList.add('active');

    // Type
    const targetType = (ev && ev.type) || (opts.prefill && opts.prefill.type) || 'event';
    document.querySelectorAll('[data-qptype]').forEach(b => {
      b.classList.toggle('active', b.dataset.qptype === targetType);
    });
    this.updateQpTypeUI(targetType);

    // Reminders
    this.qpReminders = ev && ev.reminders ? [...ev.reminders] : [];
    this.renderQpReminders();

    // Linked notes
    this.qpLinkedNotes = [];
    if (ev && (ev.noteId || ev.note_id)) {
      const nidStr = String(ev.noteId || ev.note_id);
      this.qpLinkedNotes = nidStr.split(',').filter(Boolean);
    }
    this.populateNotesDropdowns();
    this.renderQpNotes();

    // Guests / Contacts
    this.qpGuests = ev && ev.guests ? [...ev.guests] : [];
    this.populateGuestsDropdown();
    this.renderQpGuests();

    popup.dataset.date = dateStr;
    popup.hidden = false;

    const card = popup.querySelector('.qp-card');
    if (card) {
      if (window.innerWidth <= 768) {
        card.style.top = '';
        card.style.left = '';
      } else {
        card.style.top = '4vh';
        card.style.maxHeight = '92vh';
        card.style.left = 'calc(50% - 230px)';
      }
      card.style.animation = 'none';
      card.offsetHeight;
      card.style.animation = '';
    }

    setTimeout(() => { if (titleEl) titleEl.focus(); }, 60);
  },

  updateQpTypeUI(type) {
    const isTask = type === 'task';
    const guestsRow = document.getElementById('qp-guests-row');
    const locRow = document.getElementById('qp-location-row');
    if (guestsRow) guestsRow.style.display = isTask ? 'none' : 'flex';
    if (locRow) locRow.style.display = isTask ? 'none' : 'flex';
  },

  updateQpAllDayUI(isChecked) {
    const startTimeWrap = document.getElementById('qp-time-start-wrap');
    const endTimeWrap = document.getElementById('qp-time-end-wrap');
    const inpCheck = document.getElementById('qp-in-progress');
    const isIndefinite = inpCheck ? inpCheck.checked : false;

    if (startTimeWrap) startTimeWrap.style.display = isChecked ? 'none' : 'flex';
    if (endTimeWrap) endTimeWrap.style.display = (isChecked || isIndefinite) ? 'none' : 'flex';
  },

  updateQpInProgressUI(isChecked) {
    const endSep = document.querySelector('.qp-tsep');
    const endDateInput = document.getElementById('qp-date-end-input');
    const endTimeWrap = document.getElementById('qp-time-end-wrap');
    const alldayCheck = document.getElementById('qp-allday');
    const isAllDay = alldayCheck ? alldayCheck.checked : false;

    if (endSep) endSep.style.display = isChecked ? 'none' : '';
    if (endDateInput) endDateInput.style.display = isChecked ? 'none' : '';
    if (endTimeWrap) endTimeWrap.style.display = (isChecked || isAllDay) ? 'none' : 'flex';
  },

  updateModalInProgressUI(isChecked) {
    const endDateGroup = document.getElementById('event-end-date')?.closest('.form-group');
    const endTimeGroup = document.getElementById('event-end')?.closest('.form-group');
    if (endDateGroup) endDateGroup.style.display = isChecked ? 'none' : '';
    if (endTimeGroup) endTimeGroup.style.display = isChecked ? 'none' : '';
  },

  highlightError(el) {
    if (!el) return;
    el.classList.add('input-error');
    el.focus();
    const clearErr = () => {
      el.classList.remove('input-error');
      el.removeEventListener('input', clearErr);
      el.removeEventListener('change', clearErr);
    };
    el.addEventListener('input', clearErr);
    el.addEventListener('change', clearErr);
  },

  expandQpDesc() {
    const descPh = document.getElementById('qp-desc-ph');
    const descTa = document.getElementById('qp-desc');
    const descRow = document.getElementById('qp-desc-row');
    if (descPh) descPh.style.display = 'none';
    if (descTa) descTa.classList.add('visible');
    if (descRow) descRow.classList.remove('clickable');
  },

  closeQuickPopup() {
    const popup = document.getElementById('quick-popup');
    if (popup) popup.hidden = true;
  },

  renderQpReminders() {
    const container = document.getElementById('qp-reminders-list');
    if (!container) return;
    const labels = {
      0: 'En el momento', 5: '5 min antes', 10: '10 min antes', 15: '15 min antes',
      30: '30 min antes', 60: '1 hora antes', 120: '2 horas antes', 1440: '1 día antes',
      2880: '2 días antes', 10080: '1 sem antes', 20160: '2 sem antes'
    };
    const bellSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

    const selectEl = document.getElementById('qp-reminder-select');
    if (selectEl) selectEl.value = "";

    container.innerHTML = (this.qpReminders || []).map(val => `
      <div class="reminder-tag" style="display: inline-flex; align-items: center; gap: 5px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: var(--primary, #818cf8); font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-right: 4px; margin-bottom: 4px;">
        ${bellSvg}
        <span>${labels[val] !== undefined ? labels[val] : val + ' min'}</span>
        <button type="button" class="btn-remove-qp-rem" data-val="${val}" style="background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 0.85rem; line-height: 1; margin-left: 2px;">&times;</button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-remove-qp-rem').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.dataset.val, 10);
        this.qpReminders = (this.qpReminders || []).filter(x => x !== v);
        this.renderQpReminders();
      });
    });

    if (selectEl) {
      const allValues = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080, 20160];
      const isAllSelected = allValues.every(v => (this.qpReminders || []).includes(v));

      Array.from(selectEl.options).forEach((opt, idx) => {
        if (idx === 0) return;
        const v = parseInt(opt.value, 10);
        opt.disabled = (this.qpReminders || []).includes(v);
        opt.hidden = (this.qpReminders || []).includes(v);
      });
      selectEl.disabled = isAllSelected;
    }
  },

  populateNotesDropdowns() {
    const qpSelect = document.getElementById('qp-note-select');
    const modalSelect = document.getElementById('modal-note-select');
    const notes = window.calendarNotes || [];

    const defaultHtml = `<option value="" disabled selected>${(window.t || (k => k))('link_note')}</option>`;
    const optionsHtml = defaultHtml + notes.map(n => `<option value="${n.id}">${n.title || 'Nota sin título'}</option>`).join('');

    [qpSelect, modalSelect].forEach(el => {
      if (el) el.style.visibility = 'hidden';
    });
    if (qpSelect) qpSelect.innerHTML = optionsHtml;
    if (modalSelect) modalSelect.innerHTML = optionsHtml;
    [qpSelect, modalSelect].forEach(el => {
      if (el) { void el.offsetHeight; el.style.visibility = ''; }
    });
  },

  renderQpNotes() {
    const container = document.getElementById('qp-notes-list');
    if (!container) return;
    if (!this.qpLinkedNotes || this.qpLinkedNotes.length === 0) {
      container.innerHTML = '';
      return;
    }
    const noteSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    container.innerHTML = (this.qpLinkedNotes || []).map(id => {
      const note = (window.calendarNotes || []).find(n => n.id === id);
      const title = note ? (note.title || 'Nota sin título') : 'Nota vinculada';
      return `
        <div class="reminder-tag" style="display: inline-flex; align-items: center; gap: 5px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-right: 4px; margin-bottom: 4px;">
          ${noteSvg}
          <span>${title}</span>
          <button type="button" class="btn-remove-qp-note" data-id="${id}" style="background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 0.85rem; line-height: 1; margin-left: 2px;">&times;</button>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.btn-remove-qp-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        this.qpLinkedNotes = (this.qpLinkedNotes || []).filter(nId => String(nId) !== String(id));
        this.renderQpNotes();
      });
    });
  },

  populateGuestsDropdown() {
    const qpSelect = document.getElementById('qp-guests-select');
    if (!qpSelect) return;

    const friends = window.appContacts || [];
    const defaultHtml = `<option value="" disabled selected data-i18n="add_guests">${(window.t || (k => k))('add_guests') || 'Agregar invitados'}</option>`;
    qpSelect.innerHTML = defaultHtml + friends.map(f => {
      const id = f.friend_id || f.user_id;
      const name = f.friend_name || f.username;
      return `<option value="${id}">${name}</option>`;
    }).join('');

    qpSelect.onchange = (e) => {
      const val = e.target.value;
      if (val && !(this.qpGuests || []).includes(val)) {
        this.qpGuests = [...(this.qpGuests || []), val];
        this.renderQpGuests();
      }
      qpSelect.value = '';
    };
  },

  renderQpGuests() {
    const container = document.getElementById('qp-guests-list');
    if (!container) return;
    if (!this.qpGuests || this.qpGuests.length === 0) {
      container.innerHTML = '';
      return;
    }
    const userSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const contacts = window.appContacts || [];

    container.innerHTML = (this.qpGuests || []).map(id => {
      const contact = contacts.find(c => String(c.friend_id || c.user_id) === String(id));
      const name = contact ? (contact.friend_name || contact.username) : id;
      return `
        <div class="reminder-tag" style="display: inline-flex; align-items: center; gap: 5px; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); color: #c084fc; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-right: 4px; margin-bottom: 4px;">
          ${userSvg}
          <span>${name}</span>
          <button type="button" class="btn-remove-qp-guest" data-id="${id}" style="background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 0.85rem; line-height: 1; margin-left: 2px;">&times;</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-remove-qp-guest').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        this.qpGuests = (this.qpGuests || []).filter(gId => String(gId) !== String(id));
        this.renderQpGuests();
      });
    });
  },

  renderModalNotes() {
    const container = document.getElementById('modal-notes-list');
    if (!container) return;
    if (!this.modalLinkedNotes || this.modalLinkedNotes.length === 0) {
      container.innerHTML = '';
      return;
    }
    const noteSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    container.innerHTML = (this.modalLinkedNotes || []).map(id => {
      const note = (window.calendarNotes || []).find(n => n.id === id);
      const title = note ? (note.title || 'Nota sin título') : 'Nota vinculada';
      return `
        <div class="reminder-tag" style="display: inline-flex; align-items: center; gap: 5px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-right: 4px; margin-bottom: 4px;">
          ${noteSvg}
          <span>${title}</span>
          <button type="button" class="btn-remove-modal-note" data-id="${id}" style="background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 0.85rem; line-height: 1; margin-left: 2px;">&times;</button>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.btn-remove-modal-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        this.modalLinkedNotes = (this.modalLinkedNotes || []).filter(nId => String(nId) !== String(id));
        this.renderModalNotes();
      });
    });
  },

  getQuickPopupData() {
    const popup = document.getElementById('quick-popup');
    const typeBtn = document.querySelector('[data-qptype].active');
    const catBtn = document.querySelector('[data-qpcat].active');
    const startDateVal = document.getElementById('qp-date-start-input')?.value;
    const endDateVal = document.getElementById('qp-date-end-input')?.value;
    const allDayVal = document.getElementById('qp-allday')?.checked || false;
    const inProgressVal = document.getElementById('qp-in-progress')?.checked || false;
    const startTimeVal = document.getElementById('qp-start')?.value || '09:00';
    const endTimeVal = document.getElementById('qp-end')?.value || '10:00';
    const typeVal = typeBtn ? typeBtn.dataset.qptype : 'event';
    const isTask = typeVal === 'task';
    return {
      date: startDateVal || popup?.dataset.date || window.dateToStr(new Date()),
      endDate: inProgressVal ? null : (endDateVal || startDateVal || popup?.dataset.date || window.dateToStr(new Date())),
      title: document.getElementById('qp-title').value.trim(),
      type: typeVal,
      category: catBtn ? catBtn.dataset.qpcat : 'trabajo',
      startTime: allDayVal ? null : startTimeVal,
      endTime: (allDayVal || inProgressVal) ? null : endTimeVal,
      allDay: allDayVal,
      inProgress: inProgressVal,
      description: ((document.getElementById('qp-desc-editor')?.innerText || document.getElementById('qp-desc')?.value) || '').trim(),
      location: isTask ? '' : [
        document.getElementById('qp-loc-street')?.value?.trim(),
        document.getElementById('qp-loc-city')?.value?.trim(),
        document.getElementById('qp-loc-zip')?.value?.trim(),
        document.getElementById('qp-loc-state')?.value?.trim(),
        document.getElementById('qp-loc-country')?.value?.trim()
      ].filter(Boolean).join(', '),
      important: document.getElementById('qp-important')?.checked || false,
      reminders: this.qpReminders || [],
      noteId: (this.qpLinkedNotes && this.qpLinkedNotes.length) ? this.qpLinkedNotes.join(',') : null,
      guests: isTask ? [] : (this.qpGuests || []),
    };
  },

  setType(type) {
    const isTask = type === 'task';
    const title = document.getElementById('modal-title');
    const form = document.getElementById('event-form');
    const isEdit = !!(form && form.dataset.editId);

    document.querySelectorAll('.type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    if (title) title.textContent = isEdit ? window.t(isTask ? 'edit_task' : 'edit_event') : (isTask ? window.t('new_task') : window.t('modal_new'));
    const eventTitle = document.getElementById('event-title');
    if (eventTitle) eventTitle.placeholder = isTask ? window.t('task_title_ph') : window.t('event_title_ph');

    const timeRow = document.getElementById('time-row');
    const alldayCheck = document.getElementById('event-allday');
    if (timeRow) timeRow.style.display = alldayCheck && alldayCheck.checked ? 'none' : '';
    const groupCompleted = document.getElementById('group-completed');
    if (groupCompleted) groupCompleted.classList.toggle('hidden', !isTask);

    // "Fecha fin" solo disponible para eventos, no tareas
    const endDateGroup = document.getElementById('event-end-date')?.closest('.form-group');
    if (endDateGroup) {
      endDateGroup.style.display = isTask ? 'none' : '';
      if (isTask) {
        const endDateInput = document.getElementById('event-end-date');
        if (endDateInput) endDateInput.value = '';
      }
    }
  },

  getFormData() {
    const form = document.getElementById('event-form');
    const titleEl = document.getElementById('event-title');
    const dateEl = document.getElementById('event-date');
    const title = titleEl ? titleEl.value.trim() : '';
    const date = dateEl ? dateEl.value : '';
    const inProgress = document.getElementById('event-in-progress')?.checked || false;
    const endDate = inProgress ? null : (document.getElementById('event-end-date')?.value || null);
    const allDay = document.getElementById('event-allday')?.checked || false;
    const completed = document.getElementById('event-completed')?.checked || false;
    const isImportant = document.getElementById('event-important')?.checked || false;
    const typeBtn = document.querySelector('.type-btn.active');
    const type = typeBtn ? typeBtn.dataset.type : 'event';
    const startT = document.getElementById('event-start')?.value || '';
    const endT = document.getElementById('event-end')?.value || '';
    const desc = (document.getElementById('event-desc')?.value || '').trim();
    const catBtn = document.querySelector('.cat-btn.active');
    const category = catBtn ? catBtn.dataset.cat : 'trabajo';

    if (!title) {
      this.highlightError(titleEl);
      this.toast(window.t('title_required'));
      return null;
    }
    if (!date) {
      this.highlightError(dateEl);
      this.toast(window.t('date_required'));
      return null;
    }

    // Validate end date >= start date
    if (!inProgress && endDate && endDate < date) {
      this.highlightError(document.getElementById('event-end-date'));
      this.toast(window.t('end_date_after_start'));
      return null;
    }

    const isTask = type === 'task';
    if (!allDay && !inProgress && !isTask && startT && endT && endT <= startT && (!endDate || endDate === date)) {
      this.highlightError(document.getElementById('event-end'));
      this.toast(window.t('end_time_after_start'));
      return null;
    }

    const reminders = Array.from(document.querySelectorAll('.reminder-chip')).map(c => parseInt(c.dataset.minutes));

    return {
      title, date, endDate, type, completed, isImportant, inProgress, reminders,
      allDay: allDay,
      startTime: allDay ? null : startT,
      endTime: (allDay || inProgress) ? null : endT,
      description: desc, category,
      noteId: (this.modalLinkedNotes && this.modalLinkedNotes.length) ? this.modalLinkedNotes.join(',') : null
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
      const d = daysInPrevMonth - i;
      const ds = window.dateToStr(new Date(year, month - 1, d));
      html += `<div class="mini-day other-month" data-date="${ds}">${d}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      let cls = 'mini-day';
      if (ds === selectedDate) cls += ' selected';
      if (evDates.has(ds)) cls += ' has-events';
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }
    const total = startDow + daysInMonth;
    const rem = total % 7;
    if (rem > 0) {
      for (let i = 1; i <= 7 - rem; i++) {
        const ds = window.dateToStr(new Date(year, month + 1, i));
        html += `<div class="mini-day other-month" data-date="${ds}">${i}</div>`;
      }
    }

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

    const t = window.t;
    count.textContent = evs.length === 0 ? t('events_0') : evs.length === 1 ? t('events_1') : `${evs.length} ${t('events_n')}`;

    if (evs.length === 0) {
      list.innerHTML = `<p class="empty-today">${window.t('no_events_today')}</p>`;
      return;
    }

    list.innerHTML = evs.map(ev => {
      const color = Events.color(ev);
      const timeStr = ev.allDay ? window.t('allday') : `${ev.startTime || ''}${ev.endTime ? '–' + ev.endTime : ''}`;
      return `<div class="today-item${ev.completed ? ' completed' : ''}" data-id="${ev.id}">
        <div class="today-item-bar" style="background:${color}"></div>
        <div class="today-item-info">
          <div class="today-item-title">${String(ev.title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          <div class="today-item-time">${timeStr}</div>
        </div>
        <div class="today-check${ev.completed ? ' done' : ''}" data-check="${ev.id}" title="${window.t('mark_complete')}"></div>
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

    const bellSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
    chip.innerHTML = `${bellSvg}<span>${text}</span><button type="button" onclick="this.parentElement.remove()">&times;</button>`;
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
    typeText.textContent = isTask ? window.t('type_task') : window.t('type_event');
    document.getElementById('detail-type-icon-event').style.display = isTask ? 'none' : '';
    document.getElementById('detail-type-icon-task').style.display = isTask ? '' : 'none';

    // Title
    document.getElementById('detail-title').textContent = ev.title || '';

    // Date (with multi-day range support)
    const dateObj = window.parseDate(ev.date);
    const lang = window.currentLang || 'es';
    const dayName = window.DAYS_ES[dateObj.getDay()];
    const monthName = window.MONTHS_ES[dateObj.getMonth()];
    const dayNum = dateObj.getDate();
    const year = dateObj.getFullYear();

    if (ev.inProgress) {
      const startStr = `${dayNum} ${isEn ? 'of ' : 'de '}${monthName} ${year}`;
      document.getElementById('detail-date').textContent = `${startStr} → ${window.t('indefinido')}`;
    } else if (ev.endDate && ev.endDate !== ev.date) {
      const endDateObj = window.parseDate(ev.endDate);
      const endDayName = window.DAYS_ES[endDateObj.getDay()];
      const endMonthName = window.MONTHS_ES[endDateObj.getMonth()];
      const endDayNum = endDateObj.getDate();
      const endYear = endDateObj.getFullYear();
      const startStr = `${dayNum} ${isEn ? 'of ' : 'de '}${monthName} ${year}`;
      const endStr = `${endDayNum} ${isEn ? 'of ' : 'de '}${endMonthName} ${endYear}`;
      document.getElementById('detail-date').textContent = `${startStr} → ${endStr}`;
    } else {
      document.getElementById('detail-date').textContent =
        `${dayName.charAt(0).toUpperCase() + dayName.slice(1)}, ${dayNum} ${isEn ? 'of ' : 'de '}${monthName} ${year}`;
    }

    // Time
    const timeRow = document.getElementById('detail-time-row');
    if (ev.inProgress) {
      const now = new Date();
      let elapsedText = '';
      if (ev.startTime) {
        const [sh, sm] = ev.startTime.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const diff = Math.max(0, currentMins - startMins);
        const hrs = Math.floor(diff / 60);
        const mins = diff % 60;
        elapsedText = ` (${hrs > 0 ? hrs + 'h ' : ''}${mins}m transcurridos)`;
      }
      document.getElementById('detail-time').textContent = `${ev.startTime || ''} – ${window.t('indefinido')}${elapsedText}`;
      timeRow.style.display = '';
    } else if (ev.allDay) {
      document.getElementById('detail-time').textContent = window.t('allday');
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

    // Location
    const locRow = document.getElementById('detail-location-row');
    if (ev.location) {
      if (locRow) {
        locRow.style.display = '';
        document.getElementById('detail-location').textContent = ev.location;
      }
    } else if (locRow) {
      locRow.style.display = 'none';
    }

    // Guests
    const guestsRow = document.getElementById('detail-guests-row');
    const guestsList = document.getElementById('detail-guests-list');
    if (ev.guests && ev.guests.length > 0) {
      if (guestsRow && guestsList) {
        guestsRow.style.display = 'flex';
        const contacts = window.appContacts || [];
        const userSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        guestsList.innerHTML = ev.guests.map(id => {
          const contact = contacts.find(c => String(c.friend_id || c.user_id) === String(id));
          const name = contact ? (contact.friend_name || contact.username) : id;
          return `<span class="detail-reminder-tag" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border-color: rgba(168, 85, 247, 0.3); display: inline-flex; align-items: center; gap: 4px;">${userSvg} ${name}</span>`;
        }).join('');
      }
    } else if (guestsRow) {
      guestsRow.style.display = 'none';
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
    const finishBtn = document.getElementById('detail-btn-finish');
    if (finishBtn) {
      if (ev.inProgress) {
        finishBtn.style.display = 'inline-flex';
        finishBtn.onclick = () => {
          this.closeDetailView();
          Events.finishEvent(ev.id);
          App.render();
        };
      } else {
        finishBtn.style.display = 'none';
      }
    }
    const editBtn = document.getElementById('detail-btn-edit');
    const delBtn = document.getElementById('detail-btn-delete');
    editBtn.onclick = () => {
      this.closeDetailView();
      this.openQuickPopup({ event: ev });
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
