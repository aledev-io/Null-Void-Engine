let currentWorkspaceId = null;

export async function showWorkspaces() {
    if (window.isGenerating) {
        window.showToast('Espera a que termine la respuesta antes de cambiar de sección.', 'info');
        return;
    }
    document.getElementById('chat-view').style.display = 'none';
    document.getElementById('notes-view').style.display = 'none';
    document.getElementById('workspaces-view').style.display = 'flex';
    document.getElementById('workspaces-list-view').style.display = 'flex';
    document.getElementById('workspace-detail-view').style.display = 'none';

    // update active nav item
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-workspaces').classList.add('active');

    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('show');
        document.querySelector('.sidebar-overlay').classList.remove('show');
    }

    history.pushState({ view: 'workspaces' }, '', '/ai/projects');

    await loadWorkspaces();
}

export async function loadWorkspaces() {
    try {
        const res = await fetch('/api/ai/workspaces');
        if (res.ok) {
            let spaces = await res.json();
            
            // Render in sidebar
            renderStarredWorkspaces(spaces);
            
            // Filter logic
            const filterSelect = document.getElementById('workspace-filter-select');
            const filterVal = filterSelect ? filterSelect.value : 'active';
            
            let visibleSpaces = spaces.filter(s => filterVal === 'archived' ? s.is_archived : !s.is_archived);
            
            // Sort logic
            const sortSelect = document.getElementById('workspace-sort-select');
            const sortVal = sortSelect ? sortSelect.value : 'updated';
            if (sortVal === 'updated') {
                visibleSpaces.sort((a, b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at));
            } else {
                visibleSpaces.sort((a, b) => b.created_at - a.created_at);
            }

            const grid = document.getElementById('workspaces-grid');
            grid.innerHTML = '';
            if (visibleSpaces.length === 0) {
                grid.innerHTML = `<div style="color:var(--text-dim);grid-column:1/-1;text-align:center;padding:40px;">No tienes ningún proyecto ${filterVal === 'archived' ? 'archivado' : ''} aún.</div>`;
                return;
            }
            visibleSpaces.forEach(s => {
                const div = document.createElement('div');
                div.className = 'note-card';
                div.onclick = (e) => {
                    if (e.target.closest('.btn-icon') || e.target.closest('.chat-context-menu')) return;
                    window.currentWorkspaceObj = s;
                    openWorkspaceDetail(s.id, s.name, s.description, s.is_starred);
                };
                
                const dateStr = sortVal === 'updated' 
                    ? `Actualizado: hace ${Math.floor((Date.now() / 1000 - (s.updated_at || s.created_at)) / 60) || 1} minutos` // Mock string just to fit visual or use the original
                    : `Creado: ${new Date(s.created_at * 1000).toLocaleDateString()}`;

                const formatRelativeTime = (timestamp) => {
                    const diffMins = Math.floor((Date.now() - timestamp * 1000) / 60000);
                    if (diffMins < 60) return `hace ${Math.max(1, diffMins)} minuto${diffMins === 1 ? '' : 's'}`;
                    const diffHours = Math.floor(diffMins / 60);
                    if (diffHours < 24) return `hace ${diffHours} hora${diffHours === 1 ? '' : 's'}`;
                    const diffDays = Math.floor(diffHours / 24);
                    return `hace ${diffDays} día${diffDays === 1 ? '' : 's'}`;
                };

                const actualDateStr = sortVal === 'updated' 
                    ? `Actualizado ${formatRelativeTime(s.updated_at || s.created_at)}` 
                    : `Creado ${formatRelativeTime(s.created_at)}`;

                const descHtml = s.description ? `<p style="font-size:0.85rem;color:var(--text-dim);margin-top:5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${s.description}</p>` : '';

                div.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <h3 style="margin:0;font-size:1rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:85%;color:var(--text-main);">${s.name}</h3>
                        <button class="note-dots" id="dots-${s.id}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                        </button>
                    </div>
                    ${descHtml}
                    <div style="font-size:0.75rem;color:var(--text-dim);margin-top:auto;padding-top:15px;">${actualDateStr}</div>
                    
                    <div class="chat-context-menu" id="workspace-menu-${s.id}" style="display:none; position:absolute; top:45px; right:15px; z-index:100; min-width:160px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.3); padding:4px 0;">
                        <div class="menu-item" id="star-${s.id}" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:var(--text-main);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="${s.is_starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                            ${s.is_starred ? 'Quitar de destacados' : 'Destacar'}
                        </div>
                        <div class="menu-item" id="edit-${s.id}" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:var(--text-main);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            Editar detalles
                        </div>
                        <div class="menu-item" onclick="window.showConfirmDialog('Eliminar proyecto', '¿Estás seguro de que deseas eliminar el proyecto &quot;${s.name}&quot;?', 'Eliminar', () => { deleteWorkspace('${s.id}'); })" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:#ef4444;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            Eliminar
                        </div>
                        <div class="menu-item" onclick="archiveWorkspace('${s.id}', ${!s.is_archived})" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:var(--text-main);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                            ${s.is_archived ? 'Desarchivar' : 'Archivar'}
                        </div>
                    </div>
                `;
                
                grid.appendChild(div);

                const dotsBtn = div.querySelector(`#dots-${s.id}`);
                const menu = div.querySelector(`#workspace-menu-${s.id}`);
                
                dotsBtn.onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.chat-context-menu').forEach(m => {
                        if (m.id !== `workspace-menu-${s.id}`) m.style.display = 'none';
                    });
                    if (menu.style.display === 'none' || menu.style.display === '') {
                        menu.style.display = 'block';
                        menu.style.top = '45px';
                        menu.style.bottom = 'auto';
                        const rect = menu.getBoundingClientRect();
                        if (rect.bottom > window.innerHeight) {
                            menu.style.top = 'auto';
                            menu.style.bottom = 'calc(100% - 40px)';
                        }
                    } else {
                        menu.style.display = 'none';
                    }
                };

                div.querySelector(`#star-${s.id}`).onclick = (e) => { e.stopPropagation(); starWorkspace(s.id, !s.is_starred); menu.style.display='none'; };
                div.querySelector(`#edit-${s.id}`).onclick = (e) => { e.stopPropagation(); window.openEditWorkspaceDialog(s); menu.style.display='none'; };
            });

            // Global click listener to close context menus
            if (!window._workspaceMenuListenerAdded) {
                document.addEventListener('click', () => {
                    document.querySelectorAll('.chat-context-menu').forEach(m => m.style.display = 'none');
                });
                window._workspaceMenuListenerAdded = true;
            }
        }
    } catch (e) {
        console.error("Error loading workspaces", e);
    }
}

export function filterWorkspaces(event) {
    const query = event.target.value.toLowerCase();
    const grid = document.getElementById('workspaces-grid');
    const cards = grid.querySelectorAll('.note-card');
    cards.forEach(card => {
        const title = card.querySelector('h3').textContent.toLowerCase();
        const pTag = card.querySelector('p');
        const desc = pTag ? pTag.textContent.toLowerCase() : '';
        if (title.includes(query) || desc.includes(query)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

export async function createNewWorkspace() {
    const overlay = document.getElementById('new-workspace-modal');
    overlay.classList.add('show'); // Asegúrate que CSS ponga display: flex con esta clase

    // Reset error state
    const errorEl = document.getElementById('ws-name-error');
    const inputEl = document.getElementById('ws-input-name');
    if (errorEl) errorEl.style.display = 'none';
    if (inputEl) inputEl.style.borderColor = '#525252';

    const saveBtn = document.getElementById('btn-save-workspace');

    // Usamos una función definida fuera o reiniciamos el onclick
    saveBtn.onclick = async () => {
        const name = inputEl ? inputEl.value : '';
        const desc = document.getElementById('ws-input-desc').value;

        if (!name.trim()) {
            if (errorEl) errorEl.style.display = 'flex';
            if (inputEl) inputEl.style.borderColor = '#ef4444';
            return;
        }

        try {
            const res = await fetch('/api/ai/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: desc })
            });

            if (res.ok) {
                document.getElementById('ws-input-name').value = '';
                document.getElementById('ws-input-desc').value = '';

                closeWorkspaceModal();

                await loadWorkspaces();
            }
        } catch (e) {
            console.error("Error al crear espacio", e);
            window.showToast("Error al crear el espacio", "error");
        }
    };
}

// Función para cerrar (asegúrate de que sea global si la llamas desde el HTML directamente)
window.closeWorkspaceModal = function () {
    const overlay = document.getElementById('new-workspace-modal');
    overlay.classList.remove('show');
}

export function closeWorkspaceModal() {
    document.getElementById('new-workspace-modal').classList.remove('show');
    // Limpiar campos
    document.getElementById('ws-input-name').value = '';
    document.getElementById('ws-input-desc').value = '';
}

export async function openWorkspaceDetail(id, name, desc, is_starred) {
    currentWorkspaceId = id;
    window.currentWorkspaceId = id; // global for chat.js
    
    // Hide other views and show workspace view container
    document.getElementById('workspaces-view').style.display = 'flex';
    document.getElementById('chat-view').style.display = 'none';
    document.getElementById('notes-view').style.display = 'none';

    // Update active nav state
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navWs = document.getElementById('nav-workspaces');
    if (navWs) navWs.classList.add('active');

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('show');
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) overlay.classList.remove('show');
    }

    history.pushState({ view: 'workspaces' }, '', '/ai/projects');

    document.getElementById('workspaces-list-view').style.display = 'none';
    document.getElementById('workspace-detail-view').style.display = 'flex';
    document.getElementById('workspace-detail-title').textContent = name;
    
    // Configurar estrella
    const starBtn = document.getElementById('workspace-detail-star-btn');
    if (starBtn) {
        starBtn.innerHTML = is_starred 
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="var(--primary)" stroke="var(--primary)" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
        starBtn.onclick = async () => {
            await starWorkspace(id, !is_starred);
            // Refresh local state by recalling this with updated star
            openWorkspaceDetail(id, name, desc, !is_starred);
        };
    }

    const descEl = document.getElementById('workspace-detail-desc');
    if (descEl) descEl.textContent = desc || 'Sin descripción';
    
    // Configurar menú de 3 puntos
    const dotsBtn = document.getElementById('workspace-detail-dots-btn');
    const dotsMenu = document.getElementById('workspace-detail-menu');
    if (dotsBtn && dotsMenu) {
        const isArch = window.currentWorkspaceObj ? window.currentWorkspaceObj.is_archived : false;
        dotsMenu.innerHTML = `
            <div class="menu-item" id="ws-detail-edit" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:var(--text-main);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Editar detalles
            </div>
            <div class="menu-item" id="ws-detail-archive" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:var(--text-main);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                ${isArch ? 'Desarchivar' : 'Archivar'}
            </div>
            <div class="menu-item" id="ws-detail-delete" style="padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;color:#ef4444;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                Eliminar
            </div>
        `;

        dotsBtn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.chat-context-menu').forEach(m => {
                if (m.id !== 'workspace-detail-menu') m.style.display = 'none';
            });
            dotsMenu.style.display = dotsMenu.style.display === 'none' ? 'block' : 'none';
        };

        dotsMenu.querySelector('#ws-detail-edit').onclick = (e) => {
            e.stopPropagation();
            dotsMenu.style.display = 'none';
            if (window.currentWorkspaceObj) window.openEditWorkspaceDialog(window.currentWorkspaceObj);
        };
        
        dotsMenu.querySelector('#ws-detail-archive').onclick = (e) => {
            e.stopPropagation();
            dotsMenu.style.display = 'none';
            archiveWorkspace(id, !isArch);
            if (window.currentWorkspaceObj) window.currentWorkspaceObj.is_archived = !isArch;
            openWorkspaceDetail(id, name, desc, is_starred); // Refresh UI
        };

        dotsMenu.querySelector('#ws-detail-delete').onclick = (e) => {
            e.stopPropagation();
            dotsMenu.style.display = 'none';
            window.showConfirmDialog('Eliminar proyecto', '¿Estás seguro de que deseas eliminar este proyecto?', 'Eliminar', () => { deleteWorkspace(id); });
        };
    }

    // Configurar modal de instrucciones (mapeado a description por ahora)
    const instName = document.getElementById('instructions-project-name');
    if(instName) instName.textContent = name;
    const instInput = document.getElementById('ws-input-instructions');
    if(instInput) instInput.value = desc || '';

    await loadWorkspaceFiles();
    renderWorkspaceChats();
}

export function closeWorkspaceDetail() {
    currentWorkspaceId = null;
    window.currentWorkspaceId = null;
    document.getElementById('workspace-detail-view').style.display = 'none';
    document.getElementById('workspaces-list-view').style.display = 'flex';
}

export async function deleteCurrentWorkspace() {
    if (!currentWorkspaceId) return;
    window.showConfirmDialog('Eliminar Espacio de Trabajo', "¿Seguro que quieres eliminar este Espacio de Trabajo? Todos sus archivos se perderán.", 'Eliminar', async () => {
        try {
            const res = await fetch(`/api/ai/workspaces/${currentWorkspaceId}`, { method: 'DELETE' });
            if (res.ok) {
                closeWorkspaceDetail();
                loadWorkspaces();
            }
        } catch (e) {
            window.showToast("Error eliminando", "error");
        }
    });
}

export async function deleteWorkspace(id) {
    if (!id) return;
    try {
        const res = await fetch(`/api/ai/workspaces/${id}`, { method: 'DELETE' });
        if (res.ok) {
            if (currentWorkspaceId === id) {
                closeWorkspaceDetail();
            }
            loadWorkspaces();
            window.showToast("Proyecto eliminado", "success");
        }
    } catch (e) {
        window.showToast("Error eliminando el proyecto", "error");
    }
}

window.closeEditWorkspaceDialog = (e) => {
    if (e && e.target.id !== 'edit-workspace-dialog-overlay') return;
    document.getElementById('edit-workspace-dialog-overlay').classList.remove('show');
};

window.openEditWorkspaceDialog = (s) => {
    document.getElementById('edit-workspace-name').value = s.name || '';
    document.getElementById('edit-workspace-desc').value = s.description || '';
    document.getElementById('edit-workspace-dialog-overlay').classList.add('show');
    
    document.getElementById('edit-workspace-confirm-btn').onclick = async () => {
        const newName = document.getElementById('edit-workspace-name').value.trim();
        const newDesc = document.getElementById('edit-workspace-desc').value.trim();
        
        if (!newName) {
            window.showToast('El nombre no puede estar vacío', 'warning');
            return;
        }

        try {
            const res = await fetch(`/api/ai/workspaces/${s.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, description: newDesc })
            });
            if (res.ok) {
                // Update object in memory
                s.name = newName;
                s.description = newDesc;
                if (window.currentWorkspaceObj && window.currentWorkspaceObj.id === s.id) {
                    window.currentWorkspaceObj.name = newName;
                    window.currentWorkspaceObj.description = newDesc;
                }

                window.closeEditWorkspaceDialog();
                loadWorkspaces();
                
                // If we are currently viewing this workspace, update the UI dynamically
                if (window.currentWorkspaceId === s.id) {
                    document.getElementById('workspace-detail-title').textContent = newName;
                    const descEl = document.getElementById('workspace-detail-desc');
                    if (descEl) descEl.textContent = newDesc || 'Sin descripción';
                    
                    const instName = document.getElementById('instructions-project-name');
                    if(instName) instName.textContent = newName;
                    const instInput = document.getElementById('ws-input-instructions');
                    if(instInput) instInput.value = newDesc || '';
                }

                window.showToast("Proyecto actualizado", "success");
            } else {
                window.showToast("Error al actualizar", "error");
            }
        } catch (e) {
            window.showToast("Error de conexión", "error");
        }
    };
};

export async function loadWorkspaceFiles() {
    if (!currentWorkspaceId) return;
    try {
        const res = await fetch(`/api/ai/workspaces/${currentWorkspaceId}/files`);
        if (res.ok) {
            const files = await res.json();
            const list = document.getElementById('workspace-files-list');
            const emptyState = document.getElementById('workspace-files-empty');
            list.innerHTML = '';
            
            if (files.length === 0) {
                if (emptyState) emptyState.style.display = 'flex';
                return;
            }
            if (emptyState) emptyState.style.display = 'none';
            
            files.forEach(f => {
                const div = document.createElement('div');
                div.style.cssText = "background:var(--bg-secondary);padding:10px 15px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;border:1px solid var(--border);";
                div.innerHTML = `
                    <div style="display:flex;align-items:center;gap:10px;overflow:hidden;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--primary);"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                        <span style="font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${f.filename}">${f.filename}</span>
                    </div>
                    <button class="btn-icon" style="color:#ef4444;padding:4px;" title="Eliminar archivo">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                `;
                div.querySelector('button').onclick = () => deleteWorkspaceFile(f.id);
                list.appendChild(div);
            });
        }
    } catch (e) {
        console.error("Error loading files", e);
    }
}

export async function uploadWorkspaceFiles(event) {
    if (!currentWorkspaceId) return;
    const files = event.target.files;
    if (!files || files.length === 0) return;

    window.showToast("Subiendo archivos...", "info");
    for (const file of files) {
        const content = await file.text();
        try {
            await fetch(`/api/ai/workspaces/${currentWorkspaceId}/files`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, content: content })
            });
        } catch (e) {
            console.error(e);
        }
    }
    event.target.value = '';
    loadWorkspaceFiles();
    window.showToast("Archivos subidos", "success");
}

export async function deleteWorkspaceFile(fileId) {
    if (!currentWorkspaceId) return;
    window.showConfirmDialog('Eliminar archivo', '¿Seguro que quieres eliminar este archivo?', 'Eliminar', async () => {
        try {
            await fetch(`/api/ai/workspaces/${currentWorkspaceId}/files/${fileId}`, { method: 'DELETE' });
            loadWorkspaceFiles();
        } catch (e) { }
    });
}

export function startWorkspaceChat() {
    if (!currentWorkspaceId) return;
    if (window.newChat) {
        window.newChat(currentWorkspaceId);
        document.getElementById('workspaces-view').style.display = 'none';
        document.getElementById('chat-view').style.display = 'flex';
        // highlight new chat in sidebar
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    }
}

import { isModelPickerOpen } from './slash_commands.js';

export function startWorkspaceChatFromInput() {
    if (window.isGenerating) {
        window.showToast('La IA está generando una respuesta. Espera o pulsa el botón rojo para cancelar.', 'info');
        return;
    }
    const input = document.getElementById('workspace-chat-input');
    if (isModelPickerOpen(input)) return;
    const text = input.value.trim();
    if (!text && (!window.attachedFiles || window.attachedFiles.length === 0)) return;
    
    // Sync model selection
    const wsModelSelect = document.getElementById('workspace-model-select');
    const mainModelSelect = document.getElementById('model-select');
    if (wsModelSelect && mainModelSelect) {
        mainModelSelect.value = wsModelSelect.value;
    }
    
    startWorkspaceChat();
    
    if (window.setInput && window.sendMessage) {
        window.setInput(text);
        window.sendMessage();
    }
    input.value = '';
}

export function renderWorkspaceChats() {
    if (!currentWorkspaceId) return;
    const history = JSON.parse(localStorage.getItem(`nv_ai_history_${window.currentUserId}`) || '[]');
    const workspaceChats = history.filter(chat => chat.workspace_id === currentWorkspaceId);
    
    const container = document.getElementById('workspace-chat-history');
    const emptyState = document.getElementById('workspace-chat-empty');
    if (!container) return;
    
    // Clear previous chats (but keep emptyState)
    Array.from(container.children).forEach(child => {
        if (child.id !== 'workspace-chat-empty') child.remove();
    });
    
    if (workspaceChats.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
    } else {
        if (emptyState) emptyState.style.display = 'none';
        workspaceChats.forEach(chat => {
            const div = document.createElement('div');
            div.style.cssText = "background:var(--bg-secondary);padding:15px;border-radius:12px;border:1px solid var(--border);cursor:pointer;transition:border 0.2s;";
            div.innerHTML = `
                <div style="font-weight:600;font-size:0.95rem;margin-bottom:5px;color:var(--text-main);">${chat.title}</div>
                <div style="font-size:0.8rem;color:var(--text-dim);">${chat.messages ? chat.messages.length : 0} mensajes</div>
            `;
            div.onmouseover = () => div.style.borderColor = 'var(--primary)';
            div.onmouseout = () => div.style.borderColor = 'var(--border)';
            div.onclick = () => {
                if (window.showChat && window.renderChat) {
                    window.showChat();
                    window.chatMessages = chat.messages || [];
                    window.currentChatId = chat.id;
                    window.currentWorkspaceId = chat.workspace_id;
                    window.renderChat();
                    if (window.checkActiveGenerations) window.checkActiveGenerations();
                }
            };
            container.appendChild(div);
        });
    }
}

window.toggleSortMenu = function(e) {
    e.stopPropagation();
    const menu = document.getElementById('workspace-sort-menu');
    // Hide other context menus first
    document.querySelectorAll('.chat-context-menu').forEach(m => {
        if (m.id !== 'workspace-sort-menu') m.style.display = 'none';
    });
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

window.selectSort = function(val, label) {
    document.getElementById('workspace-sort-select').value = val;
    document.getElementById('workspace-sort-label').textContent = label;
    
    document.querySelectorAll('.sort-item').forEach(item => {
        item.classList.remove('active');
        item.querySelector('.check-icon').style.display = 'none';
    });
    const selectedItem = document.querySelector(`.sort-item[data-val="${val}"]`);
    if(selectedItem) {
        selectedItem.classList.add('active');
        selectedItem.querySelector('.check-icon').style.display = 'block';
    }
    
    
    document.getElementById('workspace-sort-menu').style.display = 'none';
    loadWorkspaces();
};

export async function starWorkspace(id, is_starred) {
    try {
        const res = await fetch(`/api/ai/workspaces/${id}/star`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_starred: is_starred })
        });
        if (res.ok) {
            await loadWorkspaces();
        } else {
            window.showToast("Error al destacar el proyecto", "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Error de conexión", "error");
    }
};

export async function archiveWorkspace(id, is_archived) {
    try {
        const res = await fetch(`/api/ai/workspaces/${id}/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_archived: is_archived })
        });
        if (res.ok) {
            await loadWorkspaces();
        } else {
            window.showToast("Error al archivar el proyecto", "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Error de conexión", "error");
    }
};

export async function loadStarredWorkspacesSidebar() {
    try {
        const res = await fetch('/api/ai/workspaces');
        if (res.ok) {
            let spaces = await res.json();
            renderStarredWorkspaces(spaces);
        }
    } catch (e) {
        console.error("Error loading starred workspaces for sidebar", e);
    }
}

export function toggleFilterMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('workspace-filter-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

export function selectWorkspaceFilter(val, label) {
    document.getElementById('workspace-filter-select').value = val;
    document.getElementById('workspace-filter-label').textContent = label;
    document.getElementById('workspace-filter-menu').style.display = 'none';
    
    document.querySelectorAll('.filter-item').forEach(el => {
        el.classList.remove('active');
        if(el.dataset.val === val) el.classList.add('active');
    });
    
    loadWorkspaces();
}

function renderStarredWorkspaces(spaces) {
    const container = document.getElementById('starred-workspaces-container');
    const list = document.getElementById('starred-workspaces-list');
    if (!container || !list) return;
    
    const starred = spaces.filter(s => s.is_starred && !s.is_archived);
    
    if (starred.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    list.innerHTML = '';
    
    starred.forEach(s => {
        const item = document.createElement('div');
        item.className = 'nav-item';
        item.onclick = () => {
            window.currentWorkspaceObj = s;
            openWorkspaceDetail(s.id, s.name, s.description, s.is_starred);
        };
        item.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</span>
        `;
        list.appendChild(item);
    });
}

window.openInstructionsModal = function() {
    document.getElementById('instructions-modal').classList.add('show');
};

window.closeInstructionsModal = function(e) {
    if (e) e.stopPropagation();
    document.getElementById('instructions-modal').classList.remove('show');
};

window.saveInstructions = async function() {
    const newDesc = document.getElementById('ws-input-instructions').value;
    window.showToast("Instrucciones guardadas", "success");
    window.closeInstructionsModal();
};

window.toggleWorkspaceModelMenu = function(e) {
    e.stopPropagation();
    const menu = document.getElementById('workspace-model-menu');
    document.querySelectorAll('.chat-context-menu').forEach(m => {
        if (m.id !== 'workspace-model-menu') m.style.display = 'none';
    });
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

window.selectWorkspaceModel = function(val, label) {
    document.getElementById('workspace-model-select').value = val;
    const wsl = document.getElementById('workspace-model-label');
    if (wsl) { wsl.textContent = (label || '').startsWith('API: openrouter:') ? label.replace(/^API:\s*openrouter\s*:\s*/, '') : label; wsl.title = label; }
    
    const menu = document.getElementById('workspace-model-menu');
    menu.querySelectorAll('.ws-model-item').forEach(el => {
        el.classList.remove('active');
        const icon = el.querySelector('.check-icon');
        if(icon) {
            icon.style.display = 'none';
            icon.style.color = '';
        }
        if(el.dataset.val === val) {
            el.classList.add('active');
            if(icon) {
                icon.style.display = 'block';
                icon.style.color = 'var(--text-main)';
            }
        }
    });
    
    menu.style.display = 'none';

    // Save preference to backend
    fetch('/api/ai/preferences', {
        method: 'POST',
        body: JSON.stringify({ default_model: val })
    }).catch(e=>{});
};

window.deleteWorkspace = deleteWorkspace;
window.archiveWorkspace = archiveWorkspace;
