import { initSlashCommands, isModelPickerOpen } from './slash_commands.js';

export function updateChatGenStatus(position) {
    // El indicador superior de estado se eliminó por petición del usuario.
}

export function clearChatGenStatus() {
    // El indicador superior de estado se eliminó por petición del usuario.
}

export function modelDisplayName(m) {
    const name = (m && m.name) || '';
    return name.startsWith('API: openrouter:')
        ? name.replace(/^API:\s*openrouter\s*:\s*/, '')
        : name;
}

export function isFreeModel(m) {
    return !!(m && m.pricing && parseFloat(m.pricing.prompt) === 0);
}

export function modelBadgeHtml(m) {
    return isFreeModel(m) ? '<span style="font-size:0.62rem;font-weight:700;color:#34d399;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.3);border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:1px;">gratis</span>' : '';
}

function createTypingDots(wrapper) {
    const el = document.createElement('div');
    el.className = 'msg-typing';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'msg-typing-dot';
        el.appendChild(dot);
    }
    if (wrapper && wrapper.appendChild) wrapper.appendChild(el);
    return el;
}

export function showChat(pushHistory = true) {
    document.getElementById('chat-view').style.display = 'flex';
    document.getElementById('notes-view').classList.remove('active');
    document.getElementById('notes-view').style.display = 'none';
    const workspacesView = document.getElementById('workspaces-view');
    if (workspacesView) workspacesView.style.display = 'none';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (pushHistory) history.pushState({ view: 'chat' }, '', '/ai');
}

export function handleRouting() {
    const path = window.location.pathname;
    if (path.includes('/notes')) {
        window.showNotes(false);
        const hash = window.location.hash;
        if (hash && hash.startsWith('#nota-')) {
            const noteId = hash.replace('#nota-', '');
            // Poll for note load, as notes might be loading from localStorage or sockets
            let attempts = 0;
            const checkAndOpen = setInterval(() => {
                if (window.openNoteEditor && window.getNoteById) {
                    const n = window.getNoteById(noteId);
                    if (n) {
                        clearInterval(checkAndOpen);
                        window.openNoteEditor(noteId);
                    }
                }
                attempts++;
                if (attempts > 20) clearInterval(checkAndOpen); // Give up after 2 seconds
            }, 100);
        }
    } else if (path.includes('/projects')) {
        window.showWorkspaces();
    } else {
        showChat(false);
    }
}

export function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

export async function init() {
    const models = await window.fetchModels();
    window.aiModelList = models;
    
    // Fetch user preference for default model
    let defaultModel = null;
    try {
        const prefRes = await fetch('/api/ai/preferences');
        if(prefRes.ok) {
            const pData = await prefRes.json();
            defaultModel = pData.default_model;
        }
    } catch(e) {}
    
    // Verify defaultModel exists, otherwise fallback
    if (models.length > 0) {
        const exists = models.find(m => m.name === defaultModel);
        if (!exists) defaultModel = models[0].name;
    }

    const selects = document.querySelectorAll('.model-selector');
    
    selects.forEach(select => {
        select.innerHTML = '';
        if (models.length > 0) {
            const localGroup = document.createElement('optgroup');
            localGroup.label = "Modelos Locales";
            const apiGroup = document.createElement('optgroup');
            apiGroup.label = "APIs Externas";

            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name; opt.textContent = modelDisplayName(m) + (isFreeModel(m) ? ' (gratis)' : '');
                if (m.is_external) {
                    apiGroup.appendChild(opt);
                } else {
                    localGroup.appendChild(opt);
                }
            });

            if (localGroup.children.length > 0) select.appendChild(localGroup);
            if (apiGroup.children.length > 0) select.appendChild(apiGroup);
            
            if (defaultModel) select.value = defaultModel;
        } else {
            const noModelsText = (window.t && window.t('wg_no_models')) || 'Sin modelos';
            select.innerHTML = `<option value="" selected>${noModelsText}</option>`;
        }
    });
    
    const noModelsText = (window.t && window.t('wg_no_models')) || 'Sin modelos';

    // Populate workspace overlay model
    const wsBtnLabel = document.getElementById('ws-model-label');
    const wsInput = document.getElementById('ws-model-select');
    if (wsBtnLabel && wsInput) {
        if (models.length > 0) {
            const wsMenu = document.getElementById('ws-model-menu');
            if (wsMenu) {
                Array.from(wsMenu.querySelectorAll('.ws-model-item')).forEach(el => el.remove());
                models.forEach((m, index) => {
                    const isActive = m.name === defaultModel;
                    const item = document.createElement('div');
                    item.className = 'menu-item ws-model-item' + (isActive ? ' active' : '');
                    item.dataset.val = m.name;
                    item.style.padding = '10px 16px';
                    item.style.cursor = 'pointer';
                    item.onclick = () => window.selectWorkspaceModel(m.name, m.name);
                    item.title = m.name;
                    
                    const checkDisplay = isActive ? 'block' : 'none';
                    const checkColor = isActive ? 'var(--text-main)' : '';
                    const dispName = modelDisplayName(m);
                    
                    item.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
                            <div style="font-size:0.9rem;font-weight:500;color:var(--text-main);min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dispName}${modelBadgeHtml(m)}</div>
                            <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:${checkDisplay};color:${checkColor};flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                    `;
                    wsMenu.appendChild(item);
                });
            }
            
            wsBtnLabel.textContent = modelDisplayName({ name: defaultModel });
            wsBtnLabel.title = defaultModel;
            wsInput.value = defaultModel;
        } else {
            wsBtnLabel.textContent = noModelsText;
            wsInput.value = '';
            const wsMenu = document.getElementById('ws-model-menu');
            if (wsMenu) {
                Array.from(wsMenu.querySelectorAll('.ws-model-item')).forEach(el => el.remove());
                const emptyItem = document.createElement('div');
                emptyItem.className = 'menu-item ws-model-item';
                emptyItem.style.padding = '10px 16px';
                emptyItem.style.color = 'var(--text-dim)';
                emptyItem.style.cursor = 'default';
                emptyItem.textContent = noModelsText;
                wsMenu.appendChild(emptyItem);
            }
        }
    }
    
    // Populate workspace DETAIL model menu
    const detailBtnLabel = document.getElementById('workspace-model-label');
    const detailInput = document.getElementById('workspace-model-select');
    if (detailBtnLabel && detailInput) {
        if (models.length > 0) {
            const detailMenu = document.getElementById('workspace-model-menu');
            if (detailMenu) {
                Array.from(detailMenu.querySelectorAll('.ws-model-item')).forEach(el => el.remove());
                models.forEach((m, index) => {
                    const isActive = m.name === defaultModel;
                    const item = document.createElement('div');
                    item.className = 'menu-item ws-model-item' + (isActive ? ' active' : '');
                    item.dataset.val = m.name;
                    item.style.padding = '10px 16px';
                    item.style.cursor = 'pointer';
                    item.onclick = () => window.selectWorkspaceModel(m.name, m.name);
                    item.title = m.name;
                    
                    const checkDisplay = isActive ? 'block' : 'none';
                    const checkColor = isActive ? 'var(--text-main)' : '';
                    const dispName = modelDisplayName(m);
                    
                    item.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
                            <div style="font-size:0.9rem;font-weight:500;color:var(--text-main);min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dispName}${modelBadgeHtml(m)}</div>
                            <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:${checkDisplay};color:${checkColor};flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                    `;
                    detailMenu.appendChild(item);
                });
            }
            
            detailBtnLabel.textContent = modelDisplayName({ name: defaultModel });
            detailBtnLabel.title = defaultModel;
            detailInput.value = defaultModel;
        } else {
            detailBtnLabel.textContent = noModelsText;
            detailInput.value = '';
            const detailMenu = document.getElementById('workspace-model-menu');
            if (detailMenu) {
                Array.from(detailMenu.querySelectorAll('.ws-model-item')).forEach(el => el.remove());
                const emptyItem = document.createElement('div');
                emptyItem.className = 'menu-item ws-model-item';
                emptyItem.style.padding = '10px 16px';
                emptyItem.style.color = 'var(--text-dim)';
                emptyItem.style.cursor = 'default';
                emptyItem.textContent = noModelsText;
                detailMenu.appendChild(emptyItem);
            }
        }
    }
    
    // Etiqueta del modelo actual en la cabecera: el selector es el comando
    // /models escrito en el input de chat.
    const mainBtnLabel = document.getElementById('main-model-label');
    const mainInput = document.getElementById('model-select');
    if (mainBtnLabel && mainInput) {
        if (models.length > 0) {
            mainBtnLabel.textContent = modelDisplayName({ name: defaultModel });
            mainBtnLabel.title = defaultModel;
            mainInput.value = defaultModel;
        } else {
            mainBtnLabel.textContent = noModelsText;
            mainInput.value = '';
        }
    }

    const slashCommands = [
        { name: '/models', description: 'Cambiar de modelo — /models gratis - tools - nombre', run: () => {} },
        { name: '/nuevo', description: 'Nueva conversación', run: () => { if (window.newChat) window.newChat(); } },
        { name: '/agenda', description: 'Activar / desactivar modo agenda', run: () => { window.toggleAIMode(); } },
        { name: '/normal', description: 'Activar modo normal', run: () => { window.toggleAIMode('normal'); } },
        { name: '/web', description: 'Activar / desactivar búsqueda web', run: () => { window.toggleWebSearch(); } },
    ];

    initSlashCommands({
        input: document.getElementById('chat-input'),
        models: () => window.aiModelList || [],
        current: () => {
            const sel = document.getElementById('model-select');
            return (sel && sel.value) || '';
        },
        onSelectModel: (name) => {
            window.selectMainModel(name, name);
            if (name.startsWith('API:')) {
                window.showToast('Modelo externo (API): tus mensajes y datos se envían a un proveedor de terceros. Evita datos sensibles.', 'warning');
            } else if (window.showToast) {
                window.showToast('Modelo: ' + name, 'info');
            }
        },
        commands: slashCommands,
    });

    // Ocultar el botón de enviar mientras se escribe/busca un comando
    const chatInputEl = document.getElementById('chat-input');
    if (chatInputEl) {
        chatInputEl.addEventListener('input', () => {
            const sendBtn = document.getElementById('send-btn');
            if (!sendBtn) return;
            const isCmd = chatInputEl.value.trim().startsWith('/') && !window.isGenerating;
            sendBtn.style.display = isCmd ? 'none' : '';
        });
    }

    // Chat del detalle de workspace: mismo comando /models
    initSlashCommands({
        input: document.getElementById('workspace-chat-input'),
        models: () => window.aiModelList || [],
        current: () => {
            const sel = document.getElementById('workspace-model-select');
            return (sel && sel.value) || '';
        },
        onSelectModel: (name) => {
            window.selectWorkspaceModel(name, name);
            if (name.startsWith('API:')) {
                window.showToast('Modelo externo (API): tus mensajes y datos se envían a un proveedor de terceros. Evita datos sensibles.', 'warning');
            } else if (window.showToast) {
                window.showToast('Modelo: ' + name, 'info');
            }
        },
        commands: slashCommands,
    });

    loadHistory();
    syncHistoryFromDB();
    checkActiveGenerations();
    _restoreLastChat();
}

window.selectMainModel = function(val, label) {
    const input = document.getElementById('model-select');
    const btnLabel = document.getElementById('main-model-label');
    if(input) input.value = val;
    if(btnLabel) { btnLabel.textContent = modelDisplayName({ name: label }); btnLabel.title = label; }

    // Save preference to backend
    fetch('/api/ai/preferences', {
        method: 'POST',
        body: JSON.stringify({ default_model: val })
    }).catch(e=>{});
};

export async function checkActiveGenerations() {
    if (window.isGenerating) return;
    try {
        const res = await fetch('/api/ai/generating');
        if (!res.ok) return;
        const data = await res.json();
        const active = data.active || {};
        
        const activeIds = Object.keys(active);
        if (activeIds.length > 0) {
            // Check if current chat is generating, otherwise pick the first one
            const generatingId = (window.currentChatId && active[window.currentChatId]) ? window.currentChatId : activeIds[0];
            window.generatingChatId = generatingId;
            enterGeneratingState();
            pollGenerationStatus(generatingId);
        } else {
            window.generatingChatId = null;
        }
    } catch (e) { }
}

function enterGeneratingState() {
    window.isGenerating = true;
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.innerHTML = '<div style="width:12px;height:12px;background:white;border-radius:2px;"></div>';
        sendBtn.style.background = '#ef4444';
    }
    const input = document.getElementById('chat-input');
    if (input) {
        input.placeholder = 'Enviar un Mensaje';
    }
    const searchBtn = document.getElementById('search-mode-btn');
    if (searchBtn) searchBtn.disabled = true;
}

function exitGeneratingState() {
    window.isGenerating = false;
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.93l-.11 4.53c.57 0 .82-.25 1.13-.56l2.7-2.59 5.61 4.13c1.03.57 1.77.27 2.05-.96l3.71-17.48c.38-1.7-.64-2.63-1.78-2.19L1.02 10.08c-1.69.66-1.67 1.62-.31 2.04l5.04 1.58 11.95-7.54c.56-.37 1.08-.17.66.21L9.04 15.93z"/></svg>';
        sendBtn.style.background = 'transparent';
    }
    const input = document.getElementById('chat-input');
    if (input) {
        input.placeholder = 'Enviar un Mensaje';
    }
    const searchBtn = document.getElementById('search-mode-btn');
    if (searchBtn) searchBtn.disabled = false;
}

function pollGenerationStatus(sessionId) {
    if (window.pollInterval) clearInterval(window.pollInterval);
    window.pollInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/ai/generating');
            if (!res.ok) { clearInterval(window.pollInterval); window.pollInterval = null; return; }
            const data = await res.json();
            const active = data.active || {};
            
            if (!active[sessionId] && Object.keys(active).length === 0) {
                clearInterval(window.pollInterval);
                window.pollInterval = null;
                exitGeneratingState();
                window.generatingChatId = null;
                // Only refresh from DB if the stream didn't complete in this tab
                // (i.e. we're resuming after a page reload / login)
                if (window.currentChatId && !window._streamingCompleted) {
                    refreshCurrentChatFromDB();
                    syncHistoryFromDB();
                }
                window._streamingCompleted = false;
            }
        } catch (e) {
            clearInterval(window.pollInterval);
            window.pollInterval = null;
            exitGeneratingState();
            window.generatingChatId = null;
        }
    }, 3000); // Check every 3 seconds
}

export async function refreshCurrentChatFromDB() {
    if (!window.currentChatId) return;
    try {
        const msgRes = await fetch(`/api/ai/sessions/${window.currentChatId}/messages`);
        if (msgRes.ok) {
            const messages = await msgRes.json();
            // Si la BD no tiene mensajes (sesión antigua solo local o borrada),
            // no pisar el chat restaurado: eso dejaba el contenedor vacío.
            if (!Array.isArray(messages) || messages.length === 0) return;
            window.chatMessages = messages.map(m => ({
                role: m.role,
                content: m.content || ''
            }));
            renderChat();
            
            // Update in local history too
            let history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
            const idx = history.findIndex(c => String(c.id) === String(window.currentChatId));
            if (idx !== -1) {
                history[idx].messages = window.chatMessages;
                localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history));
            }
        }
    } catch (e) {
        console.error("Failed to refresh current chat:", e);
    }
}

export async function syncHistoryFromDB() {
    try {
        const res = await fetch('/api/ai/sessions');
        if (!res.ok) return;
        const dbSessions = await res.json();
        
        let history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
        let modified = false;

        for (const session of dbSessions) {
            // Check if we already have it
            if (!history.find(s => String(s.id) === String(session.id))) {
                // Fetch messages for this session
                const msgRes = await fetch(`/api/ai/sessions/${session.id}/messages`);
                if (msgRes.ok) {
                    const messages = await msgRes.json();
                    // Saltar sesiones sin mensajes: no ensucian el historial
                    if (!Array.isArray(messages) || messages.length === 0) continue;
                    history.push({
                        id: session.id,
                        title: session.title,
                        shared_by: session.shared_by || null,
                        workspace_id: session.workspace_id || null,
                        messages: messages.map(m => ({
                            role: m.role,
                            content: m.content
                        }))
                    });
                    modified = true;
                }
            }
        }

        if (modified) {
            // Sort by descending id (which is timestamp if local, but UUID if from DB... wait!)
            // If from DB, we might want to sort by updated_at or created_at
            history.sort((a, b) => {
                const idA = String(a.id).length > 15 ? 0 : Number(a.id); 
                const idB = String(b.id).length > 15 ? 0 : Number(b.id);
                return idB - idA;
            });
            try {
                localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history));
            } catch (e) {
                console.error("Quota exceeded, truncating history...");
                localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history.slice(0, 5)));
            }
            loadHistory();
        }
        
            if (window.currentChatId) {
            refreshCurrentChatFromDB();
        }
    } catch (e) {
        console.error("Error sincronizando historial", e);
    }
}

export function setInput(text) {
    const input = document.getElementById('chat-input');
    input.value = text; autoResize(input); input.focus();
}

export function addCodeCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return;
        pre.style.position = 'relative';
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.title = 'Copiar código';
        btn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                `;
        btn.style.position = 'sticky';
        btn.style.top = '8px';
        btn.style.float = 'right';
        btn.style.marginLeft = '8px';
        btn.style.zIndex = '2';
        btn.style.background = 'rgba(255, 255, 255, 0.1)';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.color = '#a0aec0';
        btn.style.cursor = 'pointer';
        btn.style.padding = '5px 8px';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.transition = 'all 0.2s';

        btn.onmouseenter = () => {
            btn.style.background = 'rgba(255, 255, 255, 0.2)';
            btn.style.color = '#fff';
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(255, 255, 255, 0.1)';
            btn.style.color = '#a0aec0';
        };

        btn.onclick = () => {
            const code = pre.querySelector('code');
            if (code) {
                navigator.clipboard.writeText(code.innerText).then(() => {
                    btn.innerHTML = `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#48bb78" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            `;
                    setTimeout(() => {
                        btn.innerHTML = `
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                `;
                    }, 2000);
                });
            }
        };
        pre.appendChild(btn);
    });
}

function _lastUserMessageIndex() {
    for (let i = window.chatMessages.length - 1; i >= 0; i--) {
        if (window.chatMessages[i] && window.chatMessages[i].role === 'user') return i;
    }
    return -1;
}

export function createActionBar(role, content, index) {
    const bar = document.createElement('div');
    bar.className = 'message-action-bar';
    bar.style.display = 'flex';
    bar.style.gap = '12px';
    bar.style.marginTop = '8px';
    bar.style.opacity = '0';
    bar.style.transition = 'opacity 0.2s';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copiar mensaje';
    copyBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            `;

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(content).then(() => {
            copyBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#48bb78" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    `;
            setTimeout(() => {
                copyBtn.innerHTML = `
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        `;
            }, 2000);
        });
    };

    bar.appendChild(copyBtn);

    // Editar solo el último mensaje de usuario: editar uno antiguo trunca el
    // historial y se pierde el resto de la conversación.
    if (role === 'user' && index === _lastUserMessageIndex()) {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn';
        editBtn.title = 'Editar y reenviar';
        editBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                    </svg>
                `;

        editBtn.onclick = () => {
            if (window.isGenerating) {
                window.showToast('No puedes editar mensajes mientras la IA está generando una respuesta.', 'error');
                return;
            }
            window.editingMessageIndex = index;
            window.editingAttachments = [...(window.chatMessages[index].attachments || [])];
            renderChat();
        };

        [copyBtn, editBtn].forEach(btn => {
            btn.style.background = 'none';
            btn.style.border = 'none';
            btn.style.color = 'var(--text-dim)';
            btn.style.cursor = 'pointer';
            btn.style.padding = '4px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.borderRadius = '4px';
            btn.style.transition = 'all 0.2s';

            btn.onmouseenter = () => {
                btn.style.background = 'var(--bg-hover)';
                btn.style.color = 'var(--text-main)';
            };
            btn.onmouseleave = () => {
                btn.style.background = 'none';
                btn.style.color = 'var(--text-dim)';
            };
        });

        bar.appendChild(editBtn);
    } else {
        copyBtn.style.background = 'none';
        copyBtn.style.border = 'none';
        copyBtn.style.color = 'var(--text-dim)';
        copyBtn.style.cursor = 'pointer';
        copyBtn.style.padding = '4px';
        copyBtn.style.display = 'flex';
        copyBtn.style.alignItems = 'center';
        copyBtn.style.justifyContent = 'center';
        copyBtn.style.borderRadius = '4px';
        copyBtn.style.transition = 'all 0.2s';

        copyBtn.onmouseenter = () => {
            copyBtn.style.background = 'var(--bg-hover)';
            copyBtn.style.color = 'var(--text-main)';
        };
        copyBtn.onmouseleave = () => {
            copyBtn.style.background = 'none';
            copyBtn.style.color = 'var(--text-dim)';
        };
    }
    return bar;
}

export function addMessage(role, content, isStreaming = false, attachments = []) {
    const log = document.getElementById('chat-log');
    const welcome = document.getElementById('welcome-screen');
    if (welcome) welcome.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'message-row';
    row.oncontextmenu = (e) => {
        e.preventDefault();
        openMessageContextMenu(e, role, content, window.chatMessages.length - 1);
    };

    const avatar = document.createElement('div');
    avatar.className = 'avatar ' + (role === 'assistant' ? 'ai' : '');

    if (role === 'assistant') {
        avatar.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                    </svg>
                `;
    } else {
        avatar.innerHTML = `
                    <img src="/api/system/user/avatar/${currentUser}" alt=""
                        style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;"
                        onerror="this.style.display='none'">
                    <span>${(currentUser || 'RoamingX').charAt(0).toUpperCase()}</span>
                `;
    }

    const col = document.createElement('div');
    col.className = 'message-col';
    const textWrapper = document.createElement('div');
    textWrapper.className = 'message-content';
    if (isStreaming) textWrapper.id = 'streaming-message';
    textWrapper.innerHTML = DOMPurify.sanitize(marked.parse(String(content ?? '')));

    col.appendChild(textWrapper);

    if (attachments && attachments.length > 0) {
        const attachContainer = document.createElement('div');
        attachContainer.style.display = 'flex';
        attachContainer.style.gap = '10px';
        attachContainer.style.flexWrap = 'wrap';
        attachContainer.style.marginTop = '10px';

        attachments.forEach(att => {
            const isImage = att.isImage || att.type?.startsWith('image/');
            const isAudio = att.isAudio || att.type?.startsWith('audio/') || att.name?.endsWith('.webm');

            if (att.data && isImage) {
                const img = document.createElement('img');
                img.src = att.data;
                img.style.maxWidth = '250px';
                img.style.maxHeight = '250px';
                img.style.borderRadius = '8px';
                img.style.border = '1px solid var(--border)';
                img.style.cursor = 'pointer';
                img.onclick = () => openAttachmentPreview(att);
                attachContainer.appendChild(img);
            } else if (att.data && isAudio) {
                const audio = document.createElement('audio');
                audio.src = att.data;
                audio.controls = true;
                audio.style.display = 'block';
                audio.style.maxWidth = '300px';
                audio.style.marginTop = '6px';
                audio.style.borderRadius = '8px';
                attachContainer.appendChild(audio);
            } else if (att.name) {
                const fileChip = document.createElement('div');
                fileChip.className = 'attachment-chip';
                fileChip.style.animation = 'none';
                fileChip.style.cursor = 'pointer';
                fileChip.onclick = () => openAttachmentPreview(att);
                fileChip.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg><span>${att.name}</span>`;
                attachContainer.appendChild(fileChip);
            }
        });
        textWrapper.appendChild(attachContainer);
    }

    row.appendChild(avatar); row.appendChild(col);
    log.appendChild(row); log.scrollTop = log.scrollHeight;

    if (!isStreaming) {
        const currentModel = role === 'assistant' ? document.getElementById('model-select').value : '';
        window.chatMessages.push({ role, content, attachments, model: currentModel });
        hljs.highlightAll();
        addCodeCopyButtons(textWrapper);
        textWrapper.appendChild(createActionBar(role, content, window.chatMessages.length - 1));
    }
    return textWrapper;
}


function appendChatAlert(wrapper, text) {
    const col = wrapper && wrapper.parentNode;
    if (!col) return;
    const el = document.createElement('div');
    el.className = 'msg-alert';
    el.textContent = '⚠️ ' + text;
    col.appendChild(el);
    const log = document.getElementById('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
}

export async function sendMessage(fromButton = false) {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    const model = document.getElementById('model-select').value;

    if (isModelPickerOpen(input)) return;  // el Enter lo gestiona la paleta
    if (text.startsWith('/') && !window.isGenerating) return;  // los / son comandos
    if (window.isGenerating) {
        if (fromButton && window.abortController) {
            window.abortController.abort();
            fetch('/api/ai/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: window.currentChatId })
            }).catch(() => {});
            if (window.showToast) window.showToast('Mensaje cancelado', 'info');
            return;
        }
        window.showToast('La IA está generando una respuesta. Pulsa el botón rojo para cancelar.', 'info');
        return;
    }
    if (!text && window.attachedFiles.length === 0) return;

    if (!model || model === 'loading') {
        const msg = (window.t && window.t('wg_download_model_first')) || 'Descarga un modelo primero';
        if (window.showToast) {
            window.showToast(msg, 'warning');
        } else {
            alert(msg);
        }
        return;
    }

    window.isGenerating = true;
    window._streamingCompleted = false;
    window.abortController = new AbortController();

    // Keepalive: touch the session every 10s to prevent logout during long responses
    const keepAliveInterval = setInterval(() => {
        if (!window.isGenerating) { clearInterval(keepAliveInterval); return; }
        fetch('/api/ai/heartbeat', { method: 'POST' }).catch(() => {});
    }, 10000);
    input.value = ''; input.style.height = 'auto';

    let finalPrompt = text;
    const currentAttachments = [...attachedFiles];
    if (window.attachedFiles.length > 0) {
        const fileContext = window.attachedFiles.map(f => {
            if (!f.isImage && f.isText && f.data) {
                const safeData = f.data.replace(/```/g, '\\`\\`\\`');
                return `[Contenido del archivo: ${f.name}]\n\`\`\`\n${safeData}\n\`\`\``;
            } else if (f.isAudio || f.type?.startsWith('audio/')) {
                return `[Archivo de Audio Adjunto: ${f.name}]`;
            } else {
                return `[Archivo Adjunto: ${f.name}]`;
            }
        }).join('\n\n');
        finalPrompt = `Contexto de archivos:\n${fileContext}\n\nConsulta del usuario: ${text || '(Archivos adjuntos sin texto)'}`;

        window.attachedFiles = [];
        renderAttachedFiles();
    }

    const sendBtn = document.getElementById('send-btn');
    sendBtn.innerHTML = '<div style="width:12px;height:12px;background:white;border-radius:2px;"></div>';
    sendBtn.style.background = '#ef4444';

    addMessage('user', text || '', false, currentAttachments);
    const aiWrapper = addMessage('assistant', '', true);
    const typingDots = createTypingDots(aiWrapper);
    let fullResponse = '';
    let fullReasoning = '';

    const startTime = performance.now();

    let hadError = false;
    const _showError = (errText) => {
        hadError = true;
        fullResponse += `\n\n*Error: ${errText}*`;
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        appendChatAlert(aiWrapper, errText);
        if (window.showToast) window.showToast('Error: ' + errText, 'error');
    };

    try {
        const _numCtx = parseInt(localStorage.getItem('model_num_ctx')) || 8192;
        const _numPred = parseInt(localStorage.getItem('model_num_predict')) || 2048;
        const _temp = parseFloat(localStorage.getItem('model_temperature')) || 0.7;

        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: window.currentChatId,
                title: ((window.chatMessages && window.chatMessages[0] && window.chatMessages[0].content) || text || finalPrompt).substring(0, 30) + '...',
                model,
                search_mode: window.webSearchMode === true,
                workspace_id: window.currentWorkspaceId || null,
                mode: window.aiChatMode || 'agenda',
                reasoning_mode: window.reasoningMode === true,
                messages: [...window.chatMessages.slice(0, -1), { role: 'user', content: finalPrompt }].map(m => ({ role: m.role, content: m.content })),
                stream: true,
                options: {
                    num_ctx: _numCtx,
                    num_predict: _numPred,
                    temperature: _temp,
                    repeat_penalty: 1.1
                }
            }),
            signal: window.abortController.signal
        });

        if (!response.ok) {
            let detail = '';
            try {
                const body = await response.text();
                const m = body.match(/\{.*\}/s);
                if (m) {
                    try { detail = String((JSON.parse(m[0]).error) || ''); } catch (e) { detail = ''; }
                }
                if (!detail) {
                    detail = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 160);
                }
            } catch (e) { /* sin detalle */ }
            throw new Error(detail || `El servidor respondió HTTP ${response.status} al intentar generar la respuesta.`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.session_id && !json.message) {
                        const isNewChat = !window.currentChatId;
                        window.currentChatId = json.session_id;
                        if (isNewChat) addChatToSidebar(window.currentChatId);
                        _saveLastChatId(json.session_id);
                        continue;
                    }
                    if (json.queue) {
                        updateChatGenStatus(json.queue.position || 0);
                        continue;
                    }
                    if (json.error) {
                        _showError(json.error);
                        break;
                    }
                    if (json.message?.content) {
                        fullResponse += json.message.content;
                        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
                        document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
                    }
                    if (json.reasoning) {
                        fullReasoning += json.reasoning;
                        let rz = aiWrapper.querySelector('.msg-reasoning');
                        if (!rz) {
                            rz = document.createElement('details');
                            rz.className = 'msg-reasoning';
                            rz.innerHTML = '<summary>Razonamiento</summary><div class="msg-reasoning-body"></div>';
                            aiWrapper.insertBefore(rz, aiWrapper.firstChild);
                        }
                        rz.querySelector('.msg-reasoning-body').textContent = fullReasoning;
                        document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            fullResponse += '\n\n*Generación detenida.*';
            aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
            appendChatAlert(aiWrapper, 'Generación detenida');
        } else {
            const errText = (e && e.message && !/^Failed to fetch/.test(e.message))
                ? e.message
                : 'No se pudo conectar con el servidor de IA. Comprueba que el servicio esté activo.';
            _showError(errText);
        }
    }

    if (!hadError && !fullResponse.trim()) {
        _showError('No se recibió respuesta del modelo. Verifica que el modelo esté instalado y que el motor de IA esté activo.');
    }

    if (typingDots && typingDots.parentNode) typingDots.remove();

    const endTime = performance.now();
    const durationStr = ((endTime - startTime) / 1000).toFixed(1);

    window.isGenerating = false;
    clearInterval(keepAliveInterval);
    window._streamingCompleted = true; // Tell pollGenerationStatus not to re-fetch from DB
    clearChatGenStatus();
    sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
    sendBtn.style.background = 'var(--primary)';
    window.chatMessages.push({ role: 'assistant', content: fullResponse, model: model, duration: durationStr, reasoning: fullReasoning || undefined });
    hljs.highlightAll(); saveHistory();

    aiWrapper.removeAttribute('id');
    addCodeCopyButtons(aiWrapper);
    aiWrapper.appendChild(createActionBar('assistant', fullResponse, window.chatMessages.length - 1));

    const durationEl = document.createElement('div');
    durationEl.style.cssText = 'text-align:right; font-size:0.65rem; color:var(--text-dim); margin-top:5px; margin-right:5px;';
    durationEl.textContent = `${durationStr}s`;
    aiWrapper.appendChild(durationEl);
}

function _welcomeHtml() {
    const userNameEl = document.getElementById('user-name-display');
    const username = userNameEl ? userNameEl.textContent.trim() : 'Usuario';
    return `
        <div id="welcome-screen" class="welcome-screen">
            <div class="welcome-title">Hola, ${username}</div>
            <div class="welcome-subtitle">¿Cómo puedo ayudarte hoy?</div>
            <div style="margin:-25px 0 35px 0;display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-dim);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);padding:5px 12px;border-radius:20px;">
                <span>Escribe</span>
                <code style="color:#818cf8;background:rgba(129,140,248,0.15);padding:2px 6px;border-radius:4px;font-weight:700;">/</code>
                <span>para abrir la barra de comandos y elegir modelos</span>
            </div>
            <div class="suggestion-grid">
                <div class="suggestion-card" onclick="setInput('Dame ideas para un proyecto de Python')">
                    <div style="font-weight:600;font-size:0.9rem;margin-bottom:5px;">Dame ideas</div>
                    <div style="font-size:0.75rem;color:var(--text-dim);">para un proyecto de Python</div>
                </div>
                <div class="suggestion-card" onclick="setInput('Ayúdame a estudiar para un examen')">
                    <div style="font-weight:600;font-size:0.9rem;margin-bottom:5px;">Ayúdame a estudiar</div>
                    <div style="font-size:0.75rem;color:var(--text-dim);">vocabulario para un examen</div>
                </div>
                <div class="suggestion-card" onclick="setInput('Cuéntame un dato curioso sobre Roma')">
                    <div style="font-weight:600;font-size:0.9rem;margin-bottom:5px;">Cuéntame un dato curioso</div>
                    <div style="font-size:0.75rem;color:var(--text-dim);">sobre el Imperio Romano</div>
                </div>
            </div>
        </div>`;
}

export function newChat(workspaceId = null) {
    if (window.isGenerating) {
        window.showToast('Espera a que termine la respuesta antes de iniciar un nuevo chat.', 'info');
        return;
    }
    window.chatMessages = [];
    window.currentChatId = null;
    try { localStorage.removeItem('nv_ai_last_chat'); } catch (e) { /* sin almacenamiento */ }
    window.currentWorkspaceId = workspaceId;
    
    document.getElementById('chat-log').innerHTML = _welcomeHtml();
    loadHistory();
}

function addChatToSidebar(id) {
    // Inserta el chat en el historial lateral en cuanto el servidor asigna
    // el session_id, para que el chat nuevo aparezca ya al enviar el primer
    // mensaje (sin esperar a que termine la generación).
    const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
    if (history.some(c => String(c.id) === String(id))) return;
    const firstUser = window.chatMessages.find(m => m.role === 'user');
    history.unshift({
        id,
        title: firstUser ? firstUser.content.substring(0, 30) + '...' : 'New Chat',
        messages: [...window.chatMessages],
        workspace_id: window.currentWorkspaceId || null
    });
    localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history.slice(0, 20)));
    loadHistory();
}

export function saveHistory() {
    if (window.chatMessages.length < 2) return;
    const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
    const chatTitle = window.chatMessages[0].content.substring(0, 30) + '...';

    if (window.currentChatId) {
        const idx = history.findIndex(c => String(c.id) === String(window.currentChatId));
        if (idx !== -1) {
            history[idx].messages = window.chatMessages;
            // Only set title if it's empty, otherwise keep the existing title
            if (!history[idx].title || history[idx].title === 'New Chat') {
                history[idx].title = chatTitle;
            }
            const [item] = history.splice(idx, 1);
            history.unshift(item);
        } else {
            history.unshift({ id: window.currentChatId, title: chatTitle, messages: window.chatMessages, workspace_id: window.currentWorkspaceId || null });
        }
    } else {
        window.currentChatId = Date.now();
        history.unshift({ id: window.currentChatId, title: chatTitle, messages: window.chatMessages, workspace_id: window.currentWorkspaceId || null });
    }

    try {
        localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history.slice(0, 20)));
    } catch (e) {
        console.error("Quota exceeded, truncating history to save last chat...");
        localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history.slice(0, 2)));
    }
    loadHistory();
}

function _saveLastChatId(id) {
    try { localStorage.setItem('nv_ai_last_chat', String(id)); } catch (e) { /* sin almacenamiento */ }
}

function _restoreLastChat() {
    try {
        let lastId = null;
        try { lastId = localStorage.getItem('nv_ai_last_chat'); } catch (e) { /* sin almacenamiento */ }
        if (!lastId) return;
        const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
        const chat = history.find(c => String(c.id) === String(lastId));
        if (!chat || !chat.messages || !chat.messages.length) {
            try { localStorage.removeItem('nv_ai_last_chat'); } catch (e) { /* sin almacenamiento */ }
            return;
        }
        showChat();
        window.chatMessages = chat.messages;
        window.currentChatId = chat.id;
        window.currentChatSharedBy = chat.shared_by || null;
        window.currentWorkspaceId = chat.workspace_id || null;
        renderChat();
        checkActiveGenerations();
        loadHistory();
        refreshCurrentChatFromDB();
    } catch (e) {
        console.error('Error restaurando el último chat:', e);
        // Nunca dejar el contenedor en negro: se muestra la pantalla de bienvenida.
        const log = document.getElementById('chat-log');
        if (log) log.innerHTML = _welcomeHtml();
    }
}

export function loadHistory() {
    const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
    const container = document.getElementById('chat-history');
    container.innerHTML = '';
    history.forEach(chat => {
        const div = document.createElement('div');
        const isActive = window.currentChatId && String(chat.id) === String(window.currentChatId);
        div.className = 'history-item' + (isActive ? ' active' : '');
        div.dataset.id = chat.id;

        const label = document.createElement('span');
        label.className = 'history-item-text';
        if (chat.shared_by) {
            label.innerHTML = `<span style="color:var(--primary); margin-right:4px;display:inline-flex;vertical-align:-1px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.3 6.8L12 17.3l-6 3.3 1.3-6.8L2.2 9.1l6.9-.8z"/></svg></span>`;
            label.appendChild(document.createTextNode(chat.title));
        } else {
            label.textContent = chat.title;
        }

        const dotsBtn = document.createElement('button');
        dotsBtn.className = 'history-item-dots';
        dotsBtn.title = 'Opciones';
        dotsBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

        div.onclick = () => { 
            if (window.isGenerating) {
                window.showToast('Espera a que termine la respuesta antes de cambiar de chat.', 'info');
                return;
            }
            showChat(); 
            window.chatMessages = chat.messages; 
            window.currentChatId = chat.id; 
            _saveLastChatId(chat.id);
            window.currentChatSharedBy = chat.shared_by || null; 
            window.currentWorkspaceId = chat.workspace_id || null;
            renderChat(); 
            checkActiveGenerations();
            loadHistory();
            
            // Close sidebar on mobile
            if (window.innerWidth <= 800) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('collapsed')) {
                    sidebar.classList.add('collapsed');
                    localStorage.setItem('sidebar_collapsed', true);
                }
            }
        };
        dotsBtn.onclick = (e) => { e.stopPropagation(); openChatContextMenu(e, chat, div); };

        div.appendChild(label); div.appendChild(dotsBtn);
        container.appendChild(div);
    });
}

export function renderChat() {
    const log = document.getElementById('chat-log');
    log.innerHTML = '';
    if (!Array.isArray(window.chatMessages) || window.chatMessages.length === 0) {
        log.innerHTML = _welcomeHtml();
        return;
    }
    window.chatMessages.forEach((msg, index) => {
        try {
        const row = document.createElement('div'); row.className = 'message-row';
        row.oncontextmenu = (e) => {
            e.preventDefault();
            openMessageContextMenu(e, msg.role, msg.content, index);
        };
        const avatar = document.createElement('div');
        avatar.className = 'avatar ' + (msg.role === 'assistant' ? 'ai' : '');
        if (msg.role === 'assistant') {
            avatar.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
                        </svg>
                    `;
        } else {
            const msgAuthor = msg.author || currentUser;
            avatar.innerHTML = `
                        <img src="/api/system/user/avatar/${msgAuthor}" alt=""
                            style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;"
                            onerror="this.style.display='none'">
                        <span>${(msgAuthor || 'RoamingX').charAt(0).toUpperCase()}</span>
                    `;
        }
        const text = document.createElement('div');
        text.className = 'message-content';

        if (index === window.editingMessageIndex) {
            const editContainer = document.createElement('div');
            editContainer.style.display = 'flex';
            editContainer.style.flexDirection = 'column';
            editContainer.style.gap = '12px';
            editContainer.style.width = '100%';
            editContainer.style.marginTop = '5px';

            const textarea = document.createElement('textarea');
            textarea.className = 'edit-message-textarea';
            textarea.value = msg.content;
            textarea.style.width = '100%';
            textarea.style.minWidth = '300px';
            textarea.style.background = '#1c2128';
            textarea.style.color = 'var(--text-main)';
            textarea.style.border = '1px solid var(--border)';
            textarea.style.borderRadius = '10px';
            textarea.style.padding = '12px';
            textarea.style.fontFamily = 'inherit';
            textarea.style.fontSize = '0.9rem';
            textarea.style.lineHeight = '1.5';
            textarea.style.resize = 'vertical';
            textarea.style.outline = 'none';
            textarea.style.minHeight = '100px';
            textarea.style.boxShadow = 'inset 0 1px 3px rgba(0,0,0,0.2)';

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.gap = '10px';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn-modal-cancel';
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.style.padding = '6px 16px';
            cancelBtn.style.fontSize = '0.8rem';
            cancelBtn.style.borderRadius = '6px';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.onclick = (e) => {
                e.stopPropagation();
                window.editingMessageIndex = null;
                renderChat();
            };

            const updateBtn = document.createElement('button');
            updateBtn.className = 'btn-modal-confirm';
            updateBtn.textContent = 'Actualizar';
            updateBtn.style.padding = '6px 16px';
            updateBtn.style.fontSize = '0.8rem';
            updateBtn.style.borderRadius = '6px';
            updateBtn.style.cursor = 'pointer';
            updateBtn.onclick = (e) => {
                e.stopPropagation();
                const newText = textarea.value.trim();
                if (newText) {
                    submitEditedMessage(index, newText);
                }
            };

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(updateBtn);

            const attachPreviewContainer = document.createElement('div');
            attachPreviewContainer.style.display = 'flex';
            attachPreviewContainer.style.gap = '8px';
            attachPreviewContainer.style.flexWrap = 'wrap';
            attachPreviewContainer.style.marginBottom = '10px';

            window.renderEditAttachments = () => {
                attachPreviewContainer.innerHTML = '';
                window.editingAttachments.forEach((f, i) => {
                    const fDiv = document.createElement('div');
                    fDiv.style.background = '#1c2128';
                    fDiv.style.border = '1px solid var(--border)';
                    fDiv.style.borderRadius = '6px';
                    fDiv.style.padding = '4px 8px';
                    fDiv.style.display = 'flex';
                    fDiv.style.alignItems = 'center';
                    fDiv.style.gap = '6px';
                    fDiv.style.fontSize = '0.75rem';

                    const fName = document.createElement('span');
                    fName.textContent = f.name.length > 25 ? f.name.substring(0, 25) + '...' : f.name;

                    const fDel = document.createElement('button');
                    fDel.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
                    fDel.style.background = 'transparent';
                    fDel.style.border = 'none';
                    fDel.style.color = '#ef4444';
                    fDel.style.cursor = 'pointer';
                    fDel.style.padding = '0';
                    fDel.onclick = () => {
                        window.editingAttachments.splice(i, 1);
                        window.renderEditAttachments();
                    };

                    fDiv.appendChild(fName);
                    fDiv.appendChild(fDel);
                    attachPreviewContainer.appendChild(fDiv);
                });
            };
            window.renderEditAttachments();

            const attachBtn = document.createElement('button');
            attachBtn.className = 'btn-modal-cancel';
            attachBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>Archivo';
            attachBtn.style.padding = '6px 16px';
            attachBtn.style.fontSize = '0.8rem';
            attachBtn.style.borderRadius = '6px';
            attachBtn.style.cursor = 'pointer';
            attachBtn.onclick = (e) => {
                e.stopPropagation();
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.onchange = (ev) => {
                    const files = Array.from(ev.target.files);
                    if (files.length === 0) return;
                    processFiles(files, window.editingAttachments, window.renderEditAttachments);
                };
                fileInput.click();
            };
            btnRow.insertBefore(attachBtn, btnRow.firstChild);

            editContainer.appendChild(textarea);
            editContainer.appendChild(attachPreviewContainer);
            editContainer.appendChild(btnRow);
            text.appendChild(editContainer);

            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }, 50);
        } else {
            const contentStr = String(msg.content ?? '');
            text.innerHTML = DOMPurify.sanitize(marked.parse(contentStr));

            if (msg.attachments && msg.attachments.length > 0) {
                const attachContainer = document.createElement('div');
                attachContainer.style.display = 'flex';
                attachContainer.style.gap = '10px';
                attachContainer.style.flexWrap = 'wrap';
                attachContainer.style.marginTop = '10px';

                msg.attachments.forEach(att => {
                    const isImage = att.isImage || att.type?.startsWith('image/');
                    const isAudio = att.isAudio || att.type?.startsWith('audio/') || att.name?.endsWith('.webm');

                    if (att.data && isImage) {
                        const img = document.createElement('img');
                        img.src = att.data;
                        img.style.maxWidth = '250px';
                        img.style.maxHeight = '250px';
                        img.style.borderRadius = '8px';
                        img.style.border = '1px solid var(--border)';
                        img.style.cursor = 'pointer';
                        img.onclick = () => openAttachmentPreview(att);
                        attachContainer.appendChild(img);
                    } else if (att.data && isAudio) {
                        const audio = document.createElement('audio');
                        audio.src = att.data;
                        audio.controls = true;
                        audio.style.display = 'block';
                        audio.style.maxWidth = '300px';
                        audio.style.marginTop = '6px';
                        audio.style.borderRadius = '8px';
                        attachContainer.appendChild(audio);
                    } else if (att.name) {
                        const fileChip = document.createElement('div');
                        fileChip.className = 'attachment-chip';
                        fileChip.style.animation = 'none';
                        fileChip.style.cursor = 'pointer';
                        fileChip.onclick = () => openAttachmentPreview(att);
                        fileChip.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg><span>${att.name}</span>`;
                        attachContainer.appendChild(fileChip);
                    }
                });
                text.appendChild(attachContainer);
            }

            addCodeCopyButtons(text);
            
            const isLastMessage = index === window.chatMessages.length - 1;
            const isCurrentlyGenerating = window.isGenerating && isLastMessage && msg.role === 'assistant';

            if (!isCurrentlyGenerating) {
                text.appendChild(createActionBar(msg.role, msg.content, index));
            }

            if (msg.role === 'assistant' && msg.duration && !isCurrentlyGenerating) {
                const durationEl = document.createElement('div');
                durationEl.style.cssText = 'text-align:right; font-size:0.65rem; color:var(--text-dim); margin-top:5px; margin-right:5px;';
                durationEl.textContent = `${msg.duration}s`;
                text.appendChild(durationEl);
            }
        }

        row.appendChild(avatar); row.appendChild(text); log.appendChild(row);
        } catch (e) {
            console.error('Error renderizando el mensaje', index, e);
        }
    });
    hljs.highlightAll(); 
    log.scrollTop = log.scrollHeight;
    // Ensure scroll after DOM update and potential image loads
    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 50);
}

export async function submitEditedMessage(index, newText) {
    if (window.isGenerating) {
        window.showToast('La IA está generando una respuesta. Espera o pulsa el botón rojo para cancelar.', 'info');
        return;
    }

    // Red de seguridad: solo se permite editar el último mensaje de usuario.
    // Editar uno anterior truncaría el historial y se perdería el resto.
    if (index !== _lastUserMessageIndex()) {
        window.editingMessageIndex = null;
        renderChat();
        window.showToast('Solo puedes editar el último mensaje.', 'warning');
        return;
    }

    window.editingMessageIndex = null;
    const attachments = [...editingAttachments];
    window.editingAttachments = []; // Limpiar para futuros usos

    window.chatMessages = window.chatMessages.slice(0, index);
    renderChat();

    const model = document.getElementById('model-select').value;
    window.isGenerating = true;
    window._streamingCompleted = false;
    window.abortController = new AbortController();

    // Keepalive: touch the session every 10s to prevent logout during long responses
    const keepAliveInterval = setInterval(() => {
        if (!window.isGenerating) { clearInterval(keepAliveInterval); return; }
        fetch('/api/ai/heartbeat', { method: 'POST' }).catch(() => {});
    }, 10000);

    let finalPrompt = newText;
    if (attachments.length > 0) {
        const fileContext = attachments.map(f => {
            if (!f.isImage && f.isText && f.data) {
                const safeData = f.data.replace(/```/g, '\\`\\`\\`');
                return `[Contenido del archivo: ${f.name}]\n\`\`\`\n${safeData}\n\`\`\``;
            } else if (f.isAudio || f.type?.startsWith('audio/')) {
                return `[Archivo de Audio Adjunto: ${f.name}]`;
            } else {
                return `[Archivo Adjunto: ${f.name}]`;
            }
        }).join('\n\n');
        finalPrompt = `Contexto de archivos:\n${fileContext}\n\nConsulta del usuario: ${newText || '(Archivos adjuntos sin texto)'}`;
    }

    const sendBtn = document.getElementById('send-btn');
    sendBtn.innerHTML = '<div style="width:12px;height:12px;background:white;border-radius:2px;"></div>';
    sendBtn.style.background = '#ef4444';

    addMessage('user', newText, false, attachments);
    const aiWrapper = addMessage('assistant', '', true);
    const typingDots = createTypingDots(aiWrapper);
    let fullResponse = '';
    let fullReasoning = '';

    const startTime = performance.now();

    let hadError = false;
    const _showError = (errText) => {
        hadError = true;
        fullResponse += `\n\n*Error: ${errText}*`;
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        appendChatAlert(aiWrapper, errText);
        if (window.showToast) window.showToast('Error: ' + errText, 'error');
    };

    try {
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: window.currentChatId,
                model,
                messages: [...window.chatMessages.slice(0, -1), { role: 'user', content: finalPrompt }].map(m => ({ role: m.role, content: m.content })),
                search_mode: window.webSearchMode === true,
                workspace_id: window.currentWorkspaceId || null,
                mode: window.aiChatMode || 'agenda',
                reasoning_mode: window.reasoningMode === true,
                stream: true,
                options: {
                    num_predict: 512,
                    temperature: 0.7
                }
            }),
            signal: window.abortController.signal
        });

        if (!response.ok) {
            let detail = '';
            try {
                const body = await response.text();
                const m = body.match(/\{.*\}/s);
                if (m) {
                    try { detail = String((JSON.parse(m[0]).error) || ''); } catch (e) { detail = ''; }
                }
                if (!detail) {
                    detail = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 160);
                }
            } catch (e) { /* sin detalle */ }
            throw new Error(detail || `El servidor respondió HTTP ${response.status} al intentar generar la respuesta.`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.session_id && !json.message) {
                        const isNewChat = !window.currentChatId;
                        window.currentChatId = json.session_id;
                        if (isNewChat) addChatToSidebar(window.currentChatId);
                        _saveLastChatId(json.session_id);
                        continue;
                    }
                    if (json.queue) {
                        updateChatGenStatus(json.queue.position || 0);
                        continue;
                    }
                    if (json.error) {
                        _showError(json.error);
                        break;
                    }
                    if (json.message?.content) {
                        fullResponse += json.message.content;
                        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
                        document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
                    }
                    if (json.reasoning) {
                        fullReasoning += json.reasoning;
                        let rz = aiWrapper.querySelector('.msg-reasoning');
                        if (!rz) {
                            rz = document.createElement('details');
                            rz.className = 'msg-reasoning';
                            rz.innerHTML = '<summary>Razonamiento</summary><div class="msg-reasoning-body"></div>';
                            aiWrapper.insertBefore(rz, aiWrapper.firstChild);
                        }
                        rz.querySelector('.msg-reasoning-body').textContent = fullReasoning;
                        document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            fullResponse += '\n\n*Generación detenida.*';
            aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
            appendChatAlert(aiWrapper, 'Generación detenida');
        } else {
            const errText = (e && e.message && !/^Failed to fetch/.test(e.message))
                ? e.message
                : 'No se pudo conectar con el servidor de IA. Comprueba que el servicio esté activo.';
            _showError(errText);
        }
    }

    if (!hadError && !fullResponse.trim()) {
        _showError('No se recibió respuesta del modelo. Verifica que el modelo esté instalado y que el motor de IA esté activo.');
    }

    if (typingDots && typingDots.parentNode) typingDots.remove();

    const endTime = performance.now();
    const durationStr = ((endTime - startTime) / 1000).toFixed(1);

    window.isGenerating = false;
    clearInterval(keepAliveInterval);
    window._streamingCompleted = true;
    clearChatGenStatus();
    sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
    sendBtn.style.background = 'var(--primary)';
    window.chatMessages.push({ role: 'assistant', content: fullResponse, model: model, duration: durationStr, reasoning: fullReasoning || undefined });
    hljs.highlightAll(); saveHistory();

    aiWrapper.removeAttribute('id');
    addCodeCopyButtons(aiWrapper);
    aiWrapper.appendChild(createActionBar('assistant', fullResponse, window.chatMessages.length - 1));

    const durationEl = document.createElement('div');
    durationEl.style.cssText = 'text-align:right; font-size:0.65rem; color:var(--text-dim); margin-top:5px; margin-right:5px;';
    durationEl.textContent = `${durationStr}s`;
    aiWrapper.appendChild(durationEl);
}

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    if (sidebar.classList.contains('collapsed')) document.getElementById('user-menu').classList.remove('show');
}

export function toggleUserMenu(event) {
    event.stopPropagation();
    document.getElementById('user-menu').classList.toggle('show');
}

export function openChatContextMenu(e, chat, itemEl) {
    closeContextMenu();
    itemEl.classList.add('menu-open'); window.activeCtxItem = itemEl;
    const menu = document.createElement('div');
    menu.className = 'chat-context-menu'; menu.id = 'chat-ctx-menu';
    menu.innerHTML = `<div class="ctx-item" id="ctx-rename"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>Renombrar</div>` +
        (chat.shared_by ? '' : `<div class="ctx-item" id="ctx-share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>Compartir</div>`) +
        `<div class="ctx-divider"></div><div class="ctx-item danger" id="ctx-delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>Eliminar</div>`;
    document.body.appendChild(menu); window.activeCtxMenu = menu;
    const rect = e.currentTarget.getBoundingClientRect();
    let top = rect.bottom + 4, left = rect.left;
    if (left + 180 > window.innerWidth) left = window.innerWidth - 190;
    if (top + 120 > window.innerHeight) top = rect.top - 120;
    menu.style.top = top + 'px'; menu.style.left = left + 'px';
    menu.querySelector('#ctx-rename').onclick = () => { closeContextMenu(); renameChat(chat); };
    if (!chat.shared_by) {
        menu.querySelector('#ctx-share').onclick = () => { closeContextMenu(); window.openShareDialog(chat, 'chat'); };
    }
    menu.querySelector('#ctx-delete').onclick = () => { closeContextMenu(); deleteChat(chat.id); };
}

export function closeContextMenu() {
    if (window.activeCtxMenu) { window.activeCtxMenu.remove(); window.activeCtxMenu = null; }
    if (window.activeCtxItem) { window.activeCtxItem.classList.remove('menu-open'); window.activeCtxItem = null; }
}

export function openMessageContextMenu(e, role, content, index) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'chat-context-menu';
    menu.id = 'chat-ctx-menu';

    let menuHTML = `
                <div class="ctx-item" id="ctx-copy">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copiar mensaje
                </div>
            `;

    if (role === 'user' && index === _lastUserMessageIndex()) {
        menuHTML += `
                    <div class="ctx-divider"></div>
                    <div class="ctx-item" id="ctx-edit-resend">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                        Editar y reenviar
                    </div>
                `;
    }

    menu.innerHTML = menuHTML;
    document.body.appendChild(menu);
    window.activeCtxMenu = menu;

    let top = e.clientY + 2, left = e.clientX + 2;
    if (left + 180 > window.innerWidth) left = window.innerWidth - 190;
    if (top + 100 > window.innerHeight) top = window.innerHeight - 110;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';

    menu.querySelector('#ctx-copy').onclick = () => {
        closeContextMenu();
        navigator.clipboard.writeText(content).catch(() => { });
    };

    if (role === 'user') {
        menu.querySelector('#ctx-edit-resend').onclick = () => {
            closeContextMenu();
            window.editingMessageIndex = index;
            window.editingAttachments = [...(window.chatMessages[index].attachments || [])];
            renderChat();
        };
    }
}

export function renameChat(chat) {
    // If title is auto-generated (truncated first message), pre-fill with full first message
    const storedTitle = chat.title || '';
    const firstMsgContent = (chat.messages && chat.messages[0] && chat.messages[0].content) || '';

    let prefill;
    const cleanStored = storedTitle.replace(/\.{3}$/, '').trim();
    // Auto-generated titles are a substring of the first message — use full message if so
    if (firstMsgContent && firstMsgContent.startsWith(cleanStored) && storedTitle.endsWith('...')) {
        prefill = firstMsgContent.substring(0, 120);
    } else {
        prefill = cleanStored;
    }

    window.showInputDialog(
        'Renombrar conversación',
        'Nombre de la conversación',
        prefill,
        'Guardar',
        (newTitle) => {
            const trimmed = newTitle.trim().substring(0, 120);
            if (!trimmed) return;
            const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
            const idx = history.findIndex(c => c.id === chat.id);
            if (idx !== -1) {
                history[idx].title = trimmed;
                localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history));
                loadHistory();
            }
        }
    );
}

export function deleteChat(chatId) {
    if (window.isGenerating) {
        window.showToast('No puedes eliminar chats mientras la IA está generando una respuesta.', 'error');
        return;
    }
    window.showConfirmDialog(
        'Eliminar conversación',
        '¿Seguro que quieres eliminar esta conversación? Esta acción no se puede deshacer.',
        'Eliminar',
        async () => {
            try {
                await fetch('/api/ai/sessions/' + chatId, { method: 'DELETE' });
            } catch (e) {
                console.error('Error al borrar de BD', e);
            }
            const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]').filter(c => c.id !== chatId);
            localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history));
            if (chatId === window.currentChatId) newChat();
            loadHistory();
        }
    );
}

export function deleteAllChats() {
    document.getElementById('user-menu').classList.remove('show');
    if (window.isGenerating) {
        window.showToast('No puedes eliminar el historial mientras la IA está generando una respuesta.', 'error');
        return;
    }
    window.showConfirmDialog(
        'Borrar historial completo',
        '¿Seguro que quieres borrar TODOS los chats? Esta acción no se puede deshacer y borrará permanentemente todo tu historial.',
        'Borrar todo',
        async () => {
            try {
                await fetch('/api/ai/sessions/all', { method: 'DELETE' });
            } catch (e) {
                console.error('Error al borrar de BD', e);
            }
            localStorage.setItem(`nv_ai_history_${currentUserId}`, '[]');
            newChat();
            loadHistory();
        }
    );
}

export function openSearch() {
    document.getElementById('search-overlay').classList.add('show');
    setTimeout(() => document.getElementById('search-input').focus(), 50);
    renderSearchHistory('');
}

export function closeSearch() {
    document.getElementById('search-overlay').classList.remove('show');
    document.getElementById('search-input').value = '';
    searchKbIndex = -1;
}

export function closeSearchOnBackdrop(e) {
    if (e.target === document.getElementById('search-overlay')) closeSearch();
}

export function onSearchInput(query) { renderSearchHistory(query.toLowerCase()); }

export function renderSearchHistory(query) {
    const history = JSON.parse(localStorage.getItem(`nv_ai_history_${currentUserId}`) || '[]');
    const section = document.getElementById('search-history-section');
    const empty = document.getElementById('search-empty');
    const actionsLabel = document.getElementById('search-actions-label');

    const staticItems = document.querySelectorAll('#search-body > .search-result-item');
    const filtered = query ? history.filter(c => c.title.toLowerCase().includes(query)) : history;

    staticItems.forEach(el => el.style.display = query ? 'none' : 'flex');
    actionsLabel.style.display = query ? 'none' : '';

    section.innerHTML = '';

    if (filtered.length > 0) {
        const label = document.createElement('div');
        label.className = 'search-section-label';
        label.textContent = query ? 'Resultados' : 'Conversaciones recientes';
        section.appendChild(label);

        filtered.slice(0, 20).forEach(chat => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.dataset.action = 'open-chat';
            item.dataset.chatId = chat.id;
            item.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><span class="item-label">${chat.title}</span>`;
            item.onclick = () => {
                const target = history.find(c => c.id === chat.id);
                if (target) { window.chatMessages = target.messages; window.currentChatId = target.id; showChat(); renderChat(); }
                closeSearch();
            };
            section.appendChild(item);
        });
        empty.style.display = 'none';
    } else if (query) {
        empty.style.display = 'block';
    } else {
        empty.style.display = 'none';
    }

    rebuildSearchItems();
}

export function rebuildSearchItems() {
    searchKbIndex = -1;
    searchItems = Array.from(document.querySelectorAll('.search-result-item')).filter(el => el.offsetParent !== null);
}

export function getVisibleSearchItems() {
    return Array.from(document.querySelectorAll('.search-result-item')).filter(el => el.style.display !== 'none' && el.offsetParent !== null);
}

export function moveSearchSelection(dir) {
    const items = getVisibleSearchItems();
    if (!items.length) return;
    items.forEach(i => i.classList.remove('kb-active'));
    searchKbIndex += dir;
    if (searchKbIndex < 0) searchKbIndex = items.length - 1;
    if (searchKbIndex >= items.length) searchKbIndex = 0;
    items[searchKbIndex].classList.add('kb-active');
    items[searchKbIndex].scrollIntoView({ block: 'nearest' });
}

export function activateSearchSelection() {
    const items = getVisibleSearchItems();
    if (searchKbIndex >= 0 && searchKbIndex < items.length) {
        items[searchKbIndex].click();
    }
}

window.webSearchMode = false;
export function toggleWebSearch() {
    if (window.isGenerating) {
        window.showToast('No puedes cambiar el modo de búsqueda mientras se genera una respuesta');
        return;
    }
    const enabling = !window.webSearchMode;
    // Modos exclusivos: activar la búsqueda web desactiva el modo agenda
    if (enabling && window.aiChatMode === 'agenda') {
        window.aiChatMode = 'normal';
        localStorage.setItem('ai_chat_mode', 'normal');
        updateAIModeBtn();
    }
    window.webSearchMode = !window.webSearchMode;
    const btn = document.getElementById('web-search-btn');
    const wsBtn = document.getElementById('workspace-web-search-btn');
    
    if (window.webSearchMode) {
        if(btn) btn.classList.add('active');
        if(wsBtn) wsBtn.classList.add('active');
        window.showToast('Búsqueda web activada');
    } else {
        if(btn) btn.classList.remove('active');
        if(wsBtn) wsBtn.classList.remove('active');
        window.showToast('Búsqueda web desactivada');
    }
}
window.toggleWebSearch = toggleWebSearch;

const AI_MODE_AGENDA_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"></rect><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="13" y2="14"></line></svg>';
const AI_MODE_CHAT_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"></path></svg>';

window.aiChatMode = (localStorage.getItem('ai_chat_mode') || 'agenda');
export function updateAIModeBtn() {
    const btn = document.getElementById('ai-mode-btn');
    if (!btn) return;
    const isAgenda = window.aiChatMode === 'agenda';
    btn.classList.toggle('active', isAgenda);
    btn.title = isAgenda
        ? 'Modo Agenda: responde con tus datos reales del calendario. Pulsa para modo Normal (sin agenda ni búsqueda web).'
        : 'Modo Normal: sin agenda ni búsqueda web. Pulsa para modo Agenda.';
    btn.innerHTML = isAgenda ? AI_MODE_AGENDA_ICON : AI_MODE_CHAT_ICON;
}
export function toggleAIMode(target) {
    if (window.isGenerating) {
        window.showToast('No puedes cambiar el modo mientras se genera una respuesta');
        return;
    }
    if (target) {
        if (window.aiChatMode === target) {
            window.showToast(window.aiChatMode === 'agenda'
                ? 'Modo Agenda ya activo'
                : 'Modo Normal ya activo');
            return;
        }
        window.aiChatMode = target;
    } else {
        window.aiChatMode = window.aiChatMode === 'agenda' ? 'normal' : 'agenda';
    }
    // En modo Agenda la búsqueda web no está disponible: se desactiva sola
    if (window.aiChatMode === 'agenda' && window.webSearchMode) {
        window.webSearchMode = false;
        const btn = document.getElementById('web-search-btn');
        if (btn) btn.classList.remove('active');
        const wsBtn = document.getElementById('workspace-web-search-btn');
        if (wsBtn) wsBtn.classList.remove('active');
    }
    localStorage.setItem('ai_chat_mode', window.aiChatMode);
    updateAIModeBtn();
    window.showToast(window.aiChatMode === 'agenda'
        ? 'Modo Agenda activado'
        : 'Modo Agenda desactivado');
}
window.toggleAIMode = toggleAIMode;
document.addEventListener('DOMContentLoaded', updateAIModeBtn);

export function toggleReasoningMode() {
    if (window.isGenerating) {
        window.showToast('No puedes cambiar el modo mientras se genera una respuesta');
        return;
    }
    window.reasoningMode = !window.reasoningMode;
    localStorage.setItem('ai_reasoning_mode', window.reasoningMode);
    updateReasoningModeBtn();
    window.showToast(window.reasoningMode ? 'Modo Razonamiento activado' : 'Modo Razonamiento desactivado');
}

function updateReasoningModeBtn() {
    const btn = document.getElementById('reasoning-mode-btn');
    if (!btn) return;
    btn.classList.toggle('active', window.reasoningMode);
}

window.toggleReasoningMode = toggleReasoningMode;
window.reasoningMode = localStorage.getItem('ai_reasoning_mode') === 'true';
document.addEventListener('DOMContentLoaded', updateReasoningModeBtn);
