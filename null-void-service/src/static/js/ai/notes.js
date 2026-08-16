
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
        notes = data.notes || [];
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

export function commentNote() {
            showInputDialog('Añadir comentario', 'Tu comentario', '', 'Añadir', (text) => {
                const ta = document.getElementById('note-content-input');
                const now = new Date().toLocaleString();
                ta.value += `\n\n> [!NOTE]\n> **Comentario (${now}):** ${text}`;
                window.updateEditorMeta();
            });
        }

export function showNotes(pushHistory = true) {
    if (window.isGenerating) {
        window.showToast('Espera a que termine la respuesta antes de cambiar de sección.', 'info');
        return;
    }
    document.getElementById('chat-view').style.display = 'none';
            const workspacesView = document.getElementById('workspaces-view');
            if (workspacesView) workspacesView.style.display = 'none';
            document.getElementById('notes-view').classList.add('active');
            document.getElementById('notes-view').style.display = 'flex';
            document.getElementById('note-editor').classList.remove('active');
            document.getElementById('notes-list-view').style.display = 'flex';
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.getElementById('nav-notes').classList.add('active');
            if (pushHistory) history.pushState({ view: 'notes' }, '', '/ai/notes');
            renderNotesList();
        }

export function saveNotes() { 
    // Kept for backward compatibility, but actual saving is now done per-note via syncNote()
}

export function formatNoteDate(ts) {
            const d = new Date(ts);
            const now = new Date();
            const diffMin = Math.floor((now - d) / 60000);
            if (diffMin < 1) return 'hace un momento';
            if (diffMin < 60) return `hace ${diffMin} minutos`;
            const diffH = Math.floor(diffMin / 60);
            if (diffH < 24) return `hace ${diffH} horas`;
            return d.toLocaleDateString('es-ES');
        }

export function renderNotesList(filterQuery = '') {
            const container = document.getElementById('notes-list-container');
            let filtered = notes.filter(n => {
                if (filterQuery && !n.title.toLowerCase().includes(filterQuery) && !n.content.toLowerCase().includes(filterQuery)) return false;
                
                if (ownerFilter === 'Creado por ti' && n.is_shared) return false;
                if (ownerFilter === 'Compartido contigo' && !n.is_shared) return false;
                
                if (permFilter === 'Escribir' && n.access_level === 'read') return false;
                if (permFilter === 'Solo Lectura' && n.access_level !== 'read') return false;

                return true;
            });

            if (!filtered.length) {
                container.innerHTML = `<div style="text-align:center;margin-top:60px;color:var(--text-dim);font-size:0.9rem;">No hay notas aún. Crea una nueva nota.</div>`;
                return;
            }

            if (notesViewMode === 'lista') {
                container.innerHTML = '';
                const groupLabel = document.createElement('div');
                groupLabel.className = 'notes-group-label'; groupLabel.textContent = 'Hoy';
                const list = document.createElement('div');

                filtered.forEach(note => {
                    const row = document.createElement('div');
                    row.className = 'note-row';
                    const authorName = note.author === 'Usuario' ? (document.getElementById('user-name-display')?.textContent.trim() || 'Usuario') : (note.author || 'Usuario');
                    row.innerHTML = `
                <svg class="note-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
                    <span class="note-row-title" style="margin-bottom: 2px;">${note.title || 'Nota sin título'}</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="note-row-meta">${formatNoteDate(note.updatedAt || note.updated || Date.now())}</span>
                        <span class="note-row-author" style="font-size: 0.75rem; color: var(--text-dim);">Por ${authorName}</span>
                    </div>
                </div>
                <button class="note-dots" onclick="event.stopPropagation();openNoteMenu(event,'${note.id}')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                </button>`;
                    row.onclick = (e) => { if (e.target.closest('.note-dots')) return; openNoteEditor(note.id); };
                    list.appendChild(row);
                });

                container.appendChild(groupLabel); container.appendChild(list);
            } else {
                container.innerHTML = '';
                const groupLabel = document.createElement('div');
                groupLabel.className = 'notes-group-label'; groupLabel.textContent = 'Hoy';
                const grid = document.createElement('div'); grid.className = 'notes-grid';

                filtered.forEach(note => {
                    const card = document.createElement('div'); card.className = 'note-card';
                    const authorName = note.author === 'Usuario' ? (document.getElementById('user-name-display')?.textContent.trim() || 'Usuario') : (note.author || 'Usuario');
                    card.innerHTML = `<div class="note-card-title">${note.title || 'Nota sin título'}</div><div class="note-card-preview">${note.content || 'Sin contenido'}</div><div class="note-card-meta">${formatNoteDate(note.updatedAt || note.updated || Date.now())} · Por ${authorName}</div>`;
                    card.onclick = () => openNoteEditor(note.id);
                    grid.appendChild(card);
                });

                container.appendChild(groupLabel); container.appendChild(grid);
            }
        }

export function createNewNote() {
            const userNameEl = document.getElementById('user-name-display');
            const username = userNameEl ? userNameEl.textContent.trim() : 'Usuario';
            const note = {
                id: Date.now(), title: '', content: '',
                author: username, createdAt: Date.now(), updatedAt: Date.now()
            };
            notes.unshift(note); 
            syncNote(note.id);
            openNoteEditor(note.id);
        }

export function openNoteEditor(noteId) {
            currentNoteId = noteId;
            const note = notes.find(n => n.id === noteId);
            if (!note) return;

            document.getElementById('notes-list-view').style.display = 'none';
            document.getElementById('note-editor').classList.add('active');
            document.getElementById('note-title-input').value = note.title;
            document.getElementById('note-content-input').value = note.content;

            noteHistory = [];
            noteHistoryIdx = -1;
            saveToNoteHistory();

            window.updateEditorMeta();
            document.getElementById('note-content-input').focus();
            
            // Join active collaborators room
            if (window.socket && note.is_shared) {
                window.socket.emit('join_note', { note_id: currentNoteId });
            }
        }

export function saveCurrentNote() {
            if (!currentNoteId) return;
            const note = notes.find(n => n.id === currentNoteId);
            if (!note) return;

            const newTitle = document.getElementById('note-title-input').value;
            const newContent = document.getElementById('note-content-input').value;

            if (note.title !== newTitle || note.content !== newContent) {
                note.title = newTitle;
                note.content = newContent;
                note.updatedAt = Date.now();
                syncNote(currentNoteId);
            }
        }

export function filterNotes(query) { renderNotesList(query.toLowerCase()); }

export function setOwnerFilter(val, e) {
    if(e) e.stopPropagation();
    ownerFilter = val;
    document.getElementById('filter-owner-label').textContent = val;
    document.querySelectorAll('#filter-owner-dropdown .filter-option').forEach(o => o.classList.toggle('selected', o.textContent.trim() === val));
    document.getElementById('filter-owner-dropdown').classList.add('hidden');
    renderNotesList();
}

export function setPermFilter(val, e) {
    if(e) e.stopPropagation();
    permFilter = val;
    document.getElementById('filter-perm-label').textContent = val;
    document.querySelectorAll('#filter-perm-dropdown .filter-option').forEach(o => o.classList.toggle('selected', o.textContent.trim() === val));
    document.getElementById('filter-perm-dropdown').classList.add('hidden');
    renderNotesList();
}

export function setViewMode(mode, e) {
    if(e) e.stopPropagation();
    notesViewMode = mode;
    document.getElementById('view-label-text').textContent = mode === 'lista' ? 'Lista' : 'Cuadrícula';
    document.querySelectorAll('#view-dropdown .filter-option').forEach(o => o.classList.toggle('selected', o.textContent.trim().toLowerCase().includes(mode === 'lista' ? 'lista' : 'cuadr')));
    document.getElementById('view-dropdown').classList.add('hidden');
    renderNotesList();
}

export function openNoteMenu(e, noteId) {
            window.closeContextMenu();
            const note = notes.find(n => n.id == noteId);
            if (!note) return;

            const menu = document.createElement('div');
            menu.className = 'chat-context-menu'; menu.id = 'chat-ctx-menu';
            
            let shareHtml = `<div class="ctx-item" id="nm-share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>Compartir</div>`;

            menu.innerHTML = `<div class="ctx-item" id="nm-rename"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>Renombrar</div>${shareHtml}<div class="ctx-divider"></div><div class="ctx-item danger" id="nm-delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>Eliminar</div>`;
            document.body.appendChild(menu); window.activeCtxMenu = menu;
            const rect = e.currentTarget.getBoundingClientRect();
            let top = rect.bottom + 4, left = rect.left;
            if (left + 180 > window.innerWidth) left = window.innerWidth - 190;
            if (top + 120 > window.innerHeight) top = rect.top - 120;
            menu.style.top = top + 'px'; menu.style.left = left + 'px';
            menu.querySelector('#nm-rename').onclick = () => {
                window.closeContextMenu();
                window.showInputDialog('Renombrar nota', 'Título de la nota', note.title || '', 'Guardar', (val) => {
                    note.title = val.trim(); syncNote(note.id); renderNotesList();
                });
            };
            const shareBtn = menu.querySelector('#nm-share');
            if (shareBtn) {
                shareBtn.onclick = () => {
                    window.closeContextMenu();
                    window.openShareDialog(note.id, 'note');
                };
            }
            menu.querySelector('#nm-delete').onclick = () => {
                window.closeContextMenu();
                window.showConfirmDialog('Eliminar nota', '¿Seguro que quieres eliminar esta nota? Esta acción no se puede deshacer.', 'Eliminar', () => {
                    notes = notes.filter(x => x.id != note.id); deleteNoteOnServer(note.id); renderNotesList();
                });
            };
        }

export function downloadCurrentNote() {
            saveCurrentNote();
            const note = notes.find(n => n.id === currentNoteId);
            if (!note) return;
            const content = `# ${note.title || 'Sin título'}\n\n${note.content}`;
            const blob = new Blob([content], { type: 'text/markdown' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (note.title || 'nota') + '.md';
            a.click(); URL.revokeObjectURL(a.href);
        }

export function shareCurrentNote() {
            window.showInputDialog('Compartir nota', 'Enlace para compartir', window.location.href + '#nota-' + currentNoteId, 'Copiar enlace', (val) => {
                navigator.clipboard.writeText(val).catch(() => { });
            });
        }

export function pinCurrentNote() {
            const note = notes.find(n => n.id === currentNoteId);
            if (!note) return;
            note.pinned = !note.pinned; syncNote(note.id); renderNotesList();
        }

export function deleteCurrentNote() {
            window.showConfirmDialog('Eliminar nota', '¿Seguro que quieres eliminar esta nota?', 'Eliminar', () => {
                notes = notes.filter(n => n.id !== currentNoteId); deleteNoteOnServer(currentNoteId);
                closeEditor(); renderNotesList();
            });
        }

export function handleSharedNote(sharedNote) {
            const existingIdx = notes.findIndex(n => n.id == sharedNote.id);
            if (existingIdx !== -1) {
                 notes[existingIdx] = sharedNote;
            } else {
                 notes.unshift(sharedNote);
            }
            syncNote(sharedNote.id);
            if (document.getElementById('notes-view').classList.contains('active')) {
                renderNotesList();
            }
        }

export function handleNoteUpdate(data) {
            const note = notes.find(n => n.id == data.id);
            if (note) {
                if (note.content !== data.content || note.title !== data.title) {
                    note.content = data.content;
                    if (data.title) note.title = data.title;
                    note.updated = Date.now();
                    syncNote(note.id);
                    
                    if (currentNoteId == note.id) {
                        const titleInput = document.getElementById('note-title-input');
                        const contentInput = document.getElementById('note-content-input');
                        if (titleInput && data.title) titleInput.value = note.title;
                        if (contentInput) {
                            const start = contentInput.selectionStart;
                            const end = contentInput.selectionEnd;
                            contentInput.value = note.content;
                            contentInput.setSelectionRange(start, end);
                        }
                        
                        if (document.getElementById('note-preview').style.display === 'block') {
                            const noteHtml = window.marked.parse(note.content || '');
                            document.getElementById('note-preview-content').innerHTML = window.DOMPurify.sanitize(noteHtml);
                            if (window.hljs) window.hljs.highlightAll();
                        }
                    } else if (document.getElementById('notes-view').classList.contains('active')) {
                        renderNotesList();
                    }
                }
            }
        }

const cursorColors = ['#FF5722', '#4CAF50', '#2196F3', '#9C27B0', '#FFEB3B', '#E91E63', '#00BCD4'];

export function handleCursorUpdate(data) {
    if (data.id !== currentNoteId) return;

    const overlay = document.getElementById('note-cursors-overlay');
    if (!overlay) return;

    const cursorId = `cursor-${data.user_id}`;
    let cursorEl = document.getElementById(cursorId);

    if (!cursorEl) {
        cursorEl = document.createElement('div');
        cursorEl.id = cursorId;
        cursorEl.className = 'remote-cursor';
        
        // Generate a consistent color based on user_id string
        const hash = Array.from(data.user_id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const color = cursorColors[hash % cursorColors.length];
        
        cursorEl.style.borderLeftColor = color;
        
        const labelEl = document.createElement('div');
        labelEl.className = 'remote-cursor-label';
        labelEl.textContent = data.user_name || "Usuario";
        labelEl.style.backgroundColor = color;
        cursorEl.appendChild(labelEl);
        
        overlay.appendChild(cursorEl);
    }

    cursorEl.style.left = `${data.x}px`;
    cursorEl.style.top = `${data.y}px`;
    cursorEl.style.height = `${data.height}px`;

    // Make label temporarily visible to show activity
    cursorEl.classList.add('active');
    
    // Clear previous timeout for this cursor if exists
    if (cursorEl.fadeTimeout) clearTimeout(cursorEl.fadeTimeout);
    
    // Fade out label after 2 seconds of inactivity
    cursorEl.fadeTimeout = setTimeout(() => {
        cursorEl.classList.remove('active');
    }, 2000);
}

export function getNoteById(id) {
    return notes.find(n => n.id == id);
}

export function toggleShareNote(id, friendId, friendName) {
    const n = notes.find(x => x.id == id);
    if (!n) return false;
    
    if (!n.collaborators) n.collaborators = [];
    if (!n.collaborators_names) n.collaborators_names = [];
    
    const idx = n.collaborators.indexOf(friendId);
    let isNowShared = false;
    if (idx !== -1) {
        n.collaborators.splice(idx, 1);
        const nameIdx = n.collaborators_names.indexOf(friendName);
        if (nameIdx !== -1) n.collaborators_names.splice(nameIdx, 1);
        if (n.collaborators.length === 0) n.is_shared = false;
    } else {
        n.is_shared = true;
        n.collaborators.push(friendId);
        n.collaborators_names.push(friendName);
        isNowShared = true;
    }
    syncNote(id);
    return isNowShared;
}

export function deleteSharedNote(id) {
    notes = notes.filter(n => n.id != id);
    // Note is deleted locally; no syncNote needed here because backend handles deletion or unshare in routes.
    if (document.getElementById('notes-view').classList.contains('active')) {
        renderNotesList();
    }
}
