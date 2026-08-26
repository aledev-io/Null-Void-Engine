
export let notes = [];
export let currentNoteId = null;
export let notesViewMode = 'lista';
export let ownerFilter = 'Todos';
export let permFilter = 'Escribir';
export let noteHistory = [];
export let noteHistoryIdx = -1;
export let currentUserId = 'default';

export async function initNotes(userId) {
    currentUserId = userId;
    try {
        const res = await fetch('/api/ai/notes');
        const data = await res.json();
        notes = (data.notes || []).map(n => {
            let u = Number(n.updatedAt ?? n.updated);
            let c = Number(n.createdAt ?? n.created);
            if ((!u || isNaN(u) || u <= 0) && (!c || isNaN(c) || c <= 0)) {
                const nid = Number(n.id);
                if (!isNaN(nid) && nid > 1e9) {
                    c = nid > 1e11 ? nid : nid * 1000;
                    u = c;
                }
            }
            if (!u || isNaN(u) || u <= 0) u = c || 0;
            if (!c || isNaN(c) || c <= 0) c = u || 0;
            return {
                ...n,
                createdAt: c,
                created: c,
                updatedAt: u,
                updated: u
            };
        });
        if (document.getElementById('notes-view').classList.contains('active')) {
            renderNotesList();
        }
    } catch (e) {
        console.error("Error loading notes", e);
        notes = [];
    }
}

let syncTimeouts = {};
export function syncNote(noteId) {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    if (syncTimeouts[noteId]) clearTimeout(syncTimeouts[noteId]);
    syncTimeouts[noteId] = setTimeout(() => {
        fetch('/api/ai/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
        }).catch(e => console.error("Error syncing note:", e));
    }, 1000); // 1-second debounce per note
}

export function deleteNoteOnServer(noteId) {
    fetch(`/api/ai/notes/${noteId}`, { method: 'DELETE' })
        .catch(e => console.error("Error deleting note:", e));
}

export function saveToNoteHistory() {
    const content = document.getElementById('note-content-input').value;
    const title = document.getElementById('note-title-input').value;
    const state = JSON.stringify({ title, content });

    if (noteHistoryIdx >= 0 && noteHistory[noteHistoryIdx] === state) return;

    noteHistory = noteHistory.slice(0, noteHistoryIdx + 1);
    noteHistory.push(state);
    if (noteHistory.length > 50) noteHistory.shift();
    noteHistoryIdx = noteHistory.length - 1;
}

export function undoNote() {
    if (noteHistoryIdx > 0) {
        noteHistoryIdx--;
        const state = JSON.parse(noteHistory[noteHistoryIdx]);
        document.getElementById('note-title-input').value = state.title;
        document.getElementById('note-content-input').value = state.content;
        window.updateEditorMeta(false);
    }
}

export function redoNote() {
    if (noteHistoryIdx < noteHistory.length - 1) {
        noteHistoryIdx++;
        const state = JSON.parse(noteHistory[noteHistoryIdx]);
        document.getElementById('note-title-input').value = state.title;
        document.getElementById('note-content-input').value = state.content;
        window.updateEditorMeta(false);
    }
}

export function formatNoteDate(ts) {
    if (!ts) return 'Fecha desconocida';
    let num = Number(ts);
    if (isNaN(num) || num <= 0) return 'Fecha desconocida';
    if (num < 1e11) num *= 1000;
    const d = new Date(num);
    if (isNaN(d.getTime())) return 'Fecha desconocida';
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return window.t ? window.t('note_just_now') : 'hace un momento';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return window.t ? window.t('note_just_now') : 'hace un momento';
    if (diffMin < 60) return `${window.t ? window.t('note_ago') : 'hace'} ${diffMin} ${window.t ? window.t('note_mins') : 'minutos'}`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${window.t ? window.t('note_ago') : 'hace'} ${diffH} ${window.t ? window.t('note_hours') : 'horas'}`;
    const diffDays = Math.floor(diffH / 24);
    if (diffDays === 1) return 'ayer';
    if (diffDays < 7) return `${window.t ? window.t('note_ago') : 'hace'} ${diffDays} días`;
    if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${window.t ? window.t('note_ago') : 'hace'} ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
    }
    const lang = document.documentElement.lang || 'es';
    return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function renderNotesList(filterQuery = '') {
    const container = document.getElementById('notes-list-container');
    if(!container) return;
    let filtered = notes.filter(n => {
        if (filterQuery && !n.title.toLowerCase().includes(filterQuery) && !n.content.toLowerCase().includes(filterQuery)) return false;
        return true;
    });

    if (!filtered.length) {
        container.innerHTML = `<div style="text-align:center;margin-top:60px;color:var(--text-dim);font-size:0.9rem;">${window.t('note_empty_state')}</div>`;
        return;
    }

    filtered.sort((a, b) => {
        const timeA = Number(a.updatedAt || a.updated || a.createdAt || a.created || 0);
        const timeB = Number(b.updatedAt || b.updated || b.createdAt || b.created || 0);
        return timeB - timeA;
    });

    if (notesViewMode === 'lista') {
        container.innerHTML = '';
        const groupLabel = document.createElement('div');
        groupLabel.className = 'notes-group-label'; groupLabel.textContent = window.t('note_all');
        const list = document.createElement('div');

        filtered.forEach(note => {
            const row = document.createElement('div');
            row.className = 'note-row';
            const noteTs = note.updatedAt || note.updated || note.createdAt || note.created;
            // Also show if it has linked dates
            let linkedDatesHtml = '';
            if (note.linkedDates && note.linkedDates.length > 0) {
                linkedDatesHtml = `<div style="font-size: 0.7rem; color: var(--accent); margin-top: 2px;">${note.linkedDates.length} fechas vinculadas</div>`;
            }

            row.innerHTML = `
        <svg class="note-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
            <span class="note-row-title" style="margin-bottom: 2px;">${note.title || window.t('note_untitled')}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span class="note-row-meta">${formatNoteDate(noteTs)}</span>
            </div>
            ${linkedDatesHtml}
        </div>
        <div class="note-row-actions" style="display: flex; gap: 4px; padding-left: 8px;">
            <button class="btn-icon" onclick="event.stopPropagation(); openNoteEditor('${note.id}')" title="${window.t('note_edit')}" style="padding: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon" onclick="event.stopPropagation(); renameNoteFromList('${note.id}')" title="${window.t('note_rename')}" style="padding: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path></svg>
            </button>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteNoteFromList('${note.id}')" title="${window.t('note_delete')}" style="padding: 6px; color: #ef4444;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
            </button>
        </div>
        <div class="note-row-meta mobile-only-date" style="display: none; margin-top: 6px; padding-left: 2px;">${formatNoteDate(noteTs)}</div>
    </div>`;
            row.onclick = () => openNoteEditor(note.id);
            list.appendChild(row);
        });

        container.appendChild(groupLabel); container.appendChild(list);
    } else {
        container.innerHTML = '';
        const groupLabel = document.createElement('div');
        groupLabel.className = 'notes-group-label'; groupLabel.textContent = window.t('note_all');
        const grid = document.createElement('div'); grid.className = 'notes-grid';

        filtered.forEach(note => {
            const card = document.createElement('div'); card.className = 'note-card';
            const noteTs = note.updatedAt || note.updated || note.createdAt || note.created;
            let linkedDatesHtml = '';
            if (note.linkedDates && note.linkedDates.length > 0) {
                linkedDatesHtml = `<div style="font-size: 0.7rem; color: var(--accent); margin-top: 4px;">${note.linkedDates.length} fechas vinculadas</div>`;
            }
            card.innerHTML = `
                <div class="note-card-actions" style="position: absolute; top: 8px; right: 8px; display: flex; gap: 2px; background: rgba(0,0,0,0.5); border-radius: 6px; padding: 2px;">
                    <button class="btn-icon" onclick="event.stopPropagation(); openNoteEditor('${note.id}')" title="${window.t('note_edit')}" style="padding: 4px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon" onclick="event.stopPropagation(); renameNoteFromList('${note.id}')" title="${window.t('note_rename')}" style="padding: 4px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path></svg>
                    </button>
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteNoteFromList('${note.id}')" title="${window.t('note_delete')}" style="padding: 4px; color: #ef4444;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
                    </button>
                </div>
                <div class="note-card-title" style="padding-right: 70px;">${note.title || window.t('note_untitled')}</div><div class="note-card-preview">${note.content || 'Sin contenido'}</div><div class="note-card-meta">${formatNoteDate(noteTs)}</div>${linkedDatesHtml}
            `;
            card.style.position = 'relative';
            card.onclick = () => openNoteEditor(note.id);
            grid.appendChild(card);
        });

        container.appendChild(groupLabel); container.appendChild(grid);
    }
}

export function createNewNote() {
    const note = {
        id: Date.now(), title: '', content: '',
        createdAt: Date.now(), created: Date.now(), updatedAt: Date.now(), updated: Date.now(), linkedDates: []
    };
    notes.unshift(note); 
    syncNote(note.id);
    openNoteEditor(note.id);
}

export function openNoteEditor(noteId) {
    currentNoteId = noteId;
    const note = notes.find(n => n.id == noteId);
    if (!note) return;

    document.getElementById('notes-list-view').style.display = 'none';
    document.getElementById('note-editor').classList.add('active');
    
    const calMenu = document.getElementById('calendar-link-menu');
    if (calMenu) calMenu.classList.add('hidden');
    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-content-input').value = note.content || '';

    noteHistory = [];
    noteHistoryIdx = -1;
    saveToNoteHistory();

    window.updateEditorMeta(false);
    document.getElementById('note-content-input').focus();
    renderLinkedDates();
}

export function saveCurrentNote() {
    if (!currentNoteId) return;
    const note = notes.find(n => n.id == currentNoteId);
    if (!note) return;

    const newTitle = document.getElementById('note-title-input').value;
    const newContent = document.getElementById('note-content-input').value;
    const oldTitle = note.title || '';
    const oldContent = note.content || '';

    if (oldTitle !== newTitle || oldContent !== newContent) {
        note.title = newTitle;
        note.content = newContent;
        note.updatedAt = Date.now();
        note.updated = note.updatedAt;
        syncNote(currentNoteId);
    }
}

export function filterNotes(query) { renderNotesList(query.toLowerCase()); }

export function setViewMode(mode, e) {
    if(e) e.stopPropagation();
    notesViewMode = mode;
    document.getElementById('view-label-text').textContent = mode === 'lista' ? 'Lista' : 'Cuadrícula';
    document.querySelectorAll('#view-dropdown .filter-option').forEach(o => o.classList.toggle('selected', o.textContent.trim().toLowerCase().includes(mode === 'lista' ? 'lista' : 'cuadr')));
    document.getElementById('view-dropdown').classList.add('hidden');
    renderNotesList();
}

export function deleteCurrentNote() {
    window.showAppConfirm(window.t('note_delete_title'), window.t('note_delete_confirm'), window.t('note_delete'), () => {
        notes = notes.filter(n => String(n.id) !== String(currentNoteId)); 
        deleteNoteOnServer(currentNoteId);
        closeEditor(); 
        renderNotesList();
    });
}

export function closeEditor() {
    saveCurrentNote();
    document.getElementById('note-editor').style.display = 'none';
    document.getElementById('notes-list-view').style.display = 'flex';
    currentNoteId = null;
    renderNotesList();
}

export function renameNoteFromList(noteId) {
    const note = notes.find(n => String(n.id) === String(noteId));
    if (!note) return;
    window.showAppPrompt(window.t('note_rename_title'), window.t('note_rename_prompt'), note.title || window.t('note_untitled'), (newTitle) => {
        if (newTitle !== null && newTitle.trim() !== '') {
            note.title = newTitle.trim();
            note.updatedAt = Date.now();
            syncNote(noteId);
            renderNotesList();
        }
    });
}

export function deleteNoteFromList(noteId) {
    window.showAppConfirm(window.t('note_delete_title'), window.t('note_delete_confirm'), window.t('note_delete'), () => {
        notes = notes.filter(n => String(n.id) !== String(noteId));
        deleteNoteOnServer(noteId);
        renderNotesList();
    });
}

// App Modal implementations
window.showAppConfirm = function(title, msg, confirmText, callback) {
    document.getElementById('confirm-dialog-title').textContent = title;
    document.getElementById('confirm-dialog-msg').textContent = msg;
    document.getElementById('confirm-dialog-ok-btn').textContent = confirmText;
    
    // Cleanup old listener
    const okBtn = document.getElementById('confirm-dialog-ok-btn');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    newOkBtn.addEventListener('click', () => {
        cancelConfirmDialog();
        if (callback) callback();
    });
    
    document.getElementById('confirm-dialog-overlay').classList.add('show');
};

window.cancelConfirmDialog = function(e) {
    if (e && e.target !== document.getElementById('confirm-dialog-overlay')) return;
    document.getElementById('confirm-dialog-overlay').classList.remove('show');
};

window.showAppPrompt = function(title, label, defaultValue, callback) {
    document.getElementById('input-dialog-title').textContent = title;
    document.getElementById('input-dialog-label').textContent = label;
    const inputField = document.getElementById('input-dialog-field');
    inputField.value = defaultValue;
    
    const okBtn = document.getElementById('input-dialog-confirm-btn');
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    
    newOkBtn.addEventListener('click', () => {
        const val = document.getElementById('input-dialog-field').value;
        cancelInputDialog();
        if (callback) callback(val);
    });
    
    document.getElementById('input-dialog-overlay').classList.add('show');
    inputField.focus();
};

window.cancelInputDialog = function(e) {
    if (e && e.target !== document.getElementById('input-dialog-overlay')) return;
    document.getElementById('input-dialog-overlay').classList.remove('show');
};

// Global exposure
window.createNewNote = createNewNote;
window.closeEditor = closeEditor;
window.undoNote = undoNote;
window.redoNote = redoNote;
window.deleteCurrentNote = deleteCurrentNote;
window.renameNoteFromList = renameNoteFromList;
window.deleteNoteFromList = deleteNoteFromList;
window.openNoteEditor = openNoteEditor;
window.filterNotes = filterNotes;
window.setViewMode = setViewMode;
window.updateEditorMeta = function (save = true) {
    if (save) saveToNoteHistory();
    const text = document.getElementById('note-content-input').value || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const note = notes ? notes.find(n => n.id == currentNoteId) : null;
    const updatedTs = (note && (note.updatedAt || note.updated)) ? (note.updatedAt || note.updated) : Date.now();
    let num = Number(updatedTs);
    if (num < 1e11) num *= 1000;
    const d = new Date(num);
    const now = new Date();
    const lang = document.documentElement.lang || 'es';
    const isToday = !isNaN(d.getTime()) && d.toDateString() === now.toDateString();
    const dateStr = !isNaN(d.getTime()) ? (isToday ? (window.t ? window.t('note_today_at') : 'Hoy a las') : d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short' }) + ' ' + (window.t ? window.t('note_at') : 'a las')) : (window.t ? window.t('note_today_at') : 'Hoy a las');
    const timeStr = !isNaN(d.getTime()) ? d.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';

    document.getElementById('note-meta-bar').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; line-height: 1.2;">
            <span>${dateStr} ${timeStr}</span>
            <span>${words} ${window.t ? window.t('note_words') : 'palabras'}</span>
            <span>${chars} ${window.t ? window.t('note_chars') : 'caracteres'}</span>
        </div>
    `;
    saveCurrentNote();
};

window.insertFormat = function(type) {
    const ta = document.getElementById('note-content-input');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.substring(start, end);
    const map = { bold: `**${sel || 'texto'}**`, italic: `*${sel || 'texto'}*`, underline: `<u>${sel || 'texto'}</u>`, strike: `~~${sel || 'texto'}~~`, code: `\`${sel || 'código'}\``, h1: `# ${sel || 'Título'}`, h2: `## ${sel || 'Título'}`, h3: `### ${sel || 'Título'}`, ul: `\n- ${sel || 'elemento'}`, ol: `\n1. ${sel || 'elemento'}`, check: `\n- [ ] ${sel || 'tarea'}` };
    const ins = map[type] || sel;
    ta.value = ta.value.substring(0, start) + ins + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + ins.length;
    ta.focus(); 
    window.updateEditorMeta();
};

window.toggleViewDropdown = function(e) {
    if(e) e.stopPropagation();
    document.getElementById('view-dropdown').classList.toggle('hidden');
}

// Click outside dropdowns
document.addEventListener('click', () => {
    const vd = document.getElementById('view-dropdown');
    if(vd && !vd.classList.contains('hidden')) vd.classList.add('hidden');

    const cd = document.getElementById('calendar-link-menu');
    if(cd && !cd.classList.contains('hidden')) cd.classList.add('hidden');
});

// Calendar Linking specific functions
window.toggleCalendarLinkMenu = function(e) {
    if(e) e.stopPropagation();
    document.getElementById('calendar-link-menu').classList.toggle('hidden');
};

function renderLinkedDates() {
    const note = notes.find(n => n.id === currentNoteId);
    const container = document.getElementById('linked-dates-container');
    if (!note || !container) return;

    if (!note.linkedDates || note.linkedDates.length === 0) {
        container.innerHTML = '<div style="color: var(--text-dim); text-align: center; font-size: 0.8rem; padding: 10px;">Ninguna fecha vinculada</div>';
        return;
    }

    container.innerHTML = '';
    note.linkedDates.forEach(dateStr => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '4px';
        row.style.borderBottom = '1px solid var(--border)';
        row.innerHTML = `
            <span style="font-size: 0.8rem; color: var(--text-main);">${dateStr}</span>
            <button class="btn-icon" style="color: var(--danger); width: 20px; height: 20px; padding: 2px;" onclick="removeNoteDateLink('${dateStr}', event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        container.appendChild(row);
    });
}

window.addNoteDateLink = function(e) {
    if(e) e.stopPropagation();
    const dateInput = document.getElementById('note-link-date-input');
    const dateStr = dateInput.value;
    if (!dateStr) return;

    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;

    if (!note.linkedDates) note.linkedDates = [];
    if (!note.linkedDates.includes(dateStr)) {
        note.linkedDates.push(dateStr);
        syncNote(note.id);
        renderLinkedDates();
        // Also fire an event so calendar can update
        window.dispatchEvent(new CustomEvent('notes-linked-updated'));
    }
    dateInput.value = '';
    document.getElementById('calendar-link-menu').classList.add('hidden');
};

window.removeNoteDateLink = function(dateStr, e) {
    if(e) e.stopPropagation();
    const note = notes.find(n => n.id === currentNoteId);
    if (!note || !note.linkedDates) return;

    note.linkedDates = note.linkedDates.filter(d => d !== dateStr);
    syncNote(note.id);
    renderLinkedDates();
    window.dispatchEvent(new CustomEvent('notes-linked-updated'));
};

export function getLinkedNotesForDate(dateStr) {
    return notes.filter(n => n.linkedDates && n.linkedDates.includes(dateStr));
}
window.getLinkedNotesForDate = getLinkedNotesForDate;

document.addEventListener('DOMContentLoaded', () => {
    initNotes('default');
});

// Re-render notes when language changes so titles and dates are translated
window.addEventListener('languageChanged', () => {
    if (typeof renderNotesList === 'function') {
        renderNotesList();
    }
    if (typeof window.updateEditorMeta === 'function') {
        window.updateEditorMeta(false);
    }
});
