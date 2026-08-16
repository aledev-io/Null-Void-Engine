export let isDownloadingModel = false;
export let downloadingModelName = '';
export let downloadAbortController = null;

export const OLLAMA_CATALOG = [
    { id: "llama3.1", name: "Llama 3.1", size: "8B", desc: "El modelo abierto más avanzado de Meta" },
    { id: "qwen2.5:4b", name: "Qwen 2.5", size: "4B", desc: "Rendimiento altísimo en español y código" },
    { id: "mistral", name: "Mistral", size: "7B", desc: "Clásico y altamente eficiente" },
    { id: "gemma2:9b", name: "Gemma 2", size: "9B", desc: "Hecho por Google, basado en Gemini" },
    { id: "phi3", name: "Phi-3", size: "3.8B", desc: "Muy ligero e inteligente, por Microsoft" },
    { id: "deepseek-coder-v2", name: "DeepSeek Coder", size: "16B", desc: "Excelente para programación y matemáticas" },
    { id: "llava", name: "LLaVA", size: "7B", desc: "Multimodal: Puede ver y analizar imágenes" },
    { id: "nomic-embed-text", name: "Nomic Embed", size: "137M", desc: "Modelo ultraligero para incrustaciones (RAG)" }
];

export function showInputDialog(title, label, defaultVal, confirmText, callback) {
            document.getElementById('input-dialog-title').textContent = title;
            document.getElementById('input-dialog-label').textContent = label;
            const field = document.getElementById('input-dialog-field');
            field.value = defaultVal;
            document.getElementById('input-dialog-confirm-btn').textContent = confirmText;
            window._inputDialogCallback = callback;
            document.getElementById('input-dialog-overlay').classList.add('show');
            setTimeout(() => { field.focus(); field.select(); }, 80);
        }

export function cancelInputDialog(e) {
            if (e && e.target !== document.getElementById('input-dialog-overlay')) return;
            document.getElementById('input-dialog-overlay').classList.remove('show');
            window._inputDialogCallback = null;
        }

export function showConfirmDialog(title, msg, confirmText, callback) {
            document.getElementById('confirm-dialog-title').textContent = title;
            document.getElementById('confirm-dialog-msg').textContent = msg;
            document.getElementById('confirm-dialog-ok-btn').textContent = confirmText;
            window._confirmDialogCallback = callback;
            document.getElementById('confirm-dialog-overlay').classList.add('show');
        }

export function cancelConfirmDialog(e) {
            if (e && e.target !== document.getElementById('confirm-dialog-overlay')) return;
            document.getElementById('confirm-dialog-overlay').classList.remove('show');
            window._confirmDialogCallback = null;
        }

export function openPermissionsModal() {
            document.getElementById('perm-modal-overlay').classList.add('show');
        }

export function closePermissionsModal(e) {
            if (e && e.target !== document.getElementById('perm-modal-overlay')) return;
            document.getElementById('perm-modal-overlay').classList.remove('show');
            document.getElementById('perm-level-dropdown').style.display = 'none';
        }

export function togglePermLevel() {
            const dd = document.getElementById('perm-level-dropdown');
            dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        }

export function setPermLevel(label, desc) {
            document.getElementById('perm-level-label').textContent = label;
            document.getElementById('perm-level-desc').textContent = desc;
            document.getElementById('perm-level-dropdown').style.display = 'none';
        }

export function addPermission() {
            showInputDialog('Añadir Permiso', 'Usuario o correo electrónico', '', 'Añadir', (val) => {
                if (!val.trim()) return;
                const body = document.getElementById('perm-list-body');
                const empty = body.querySelector('.perm-empty');
                if (empty) empty.remove();
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);font-size:0.84rem;';
                row.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:white;flex-shrink:0;">${val[0].toUpperCase()}</div><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${val}</span><span style="font-size:0.78rem;color:var(--text-dim);">Puede ver</span><button onclick="this.closest('div').remove(); if(!document.getElementById('perm-list-body').children.length) document.getElementById('perm-list-body').innerHTML='<div class=\\'perm-empty\\'>Sin acceso concedido. Privado para ti.</div>';" style="background:none;border:none;color:var(--text-dim);cursor:pointer;padding:2px 6px;border-radius:4px;font-size:0.78rem;">✕</button>`;
                body.appendChild(row);
            });
        }

export function renderOllamaCatalog() {
            const container = document.getElementById('ollama-catalog-grid');
            if (!container) return;
            container.innerHTML = '';

            OLLAMA_CATALOG.forEach(model => {
                const card = document.createElement('div');
                card.style.cssText = 'background:var(--bg-hover); border:1px solid var(--border); border-radius:8px; padding:10px; cursor:pointer; transition:transform 0.1s, border-color 0.2s;';
                card.onmouseover = () => { card.style.borderColor = 'var(--primary)'; card.style.transform = 'translateY(-2px)'; };
                card.onmouseout = () => { card.style.borderColor = 'var(--border)'; card.style.transform = 'translateY(0)'; };
                card.onclick = () => {
                    document.getElementById('command-dialog-field').value = model.id;
                    executeCommand();
                };

                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <span style="font-weight:700; color:var(--text-main); font-size:0.9rem;">${model.name}</span>
                        <span style="font-size:0.7rem; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:12px;">${model.size}</span>
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-dim); line-height:1.2;">${model.desc}</div>
                `;
                container.appendChild(card);
            });
        }

export async function openCommandDialog() {
            renderOllamaCatalog();
            if (!isDownloadingModel) {
                await checkActiveDownloads();
            }
            if (!isDownloadingModel) {
                document.getElementById('command-dialog-field').value = '';
                document.getElementById('command-dialog-output').style.display = 'none';
                document.getElementById('command-dialog-output').textContent = '';
                document.getElementById('command-dialog-field').disabled = false;
                document.getElementById('command-dialog-confirm-btn').disabled = false;
            } else {
                document.getElementById('command-dialog-output').style.display = 'block';
            }
            document.getElementById('command-dialog-overlay').classList.add('show');
            if (!isDownloadingModel) {
                setTimeout(() => { document.getElementById('command-dialog-field').focus(); }, 80);
            }
        }

export function closeCommandDialog(e) {
            if (e && e.target !== document.getElementById('command-dialog-overlay')) return;
            if (isDownloadingModel) {
                showToast("La descarga de " + downloadingModelName + " continúa en segundo plano.");
            }
            document.getElementById('command-dialog-overlay').classList.remove('show');
        }

export function cancelCommandDialog() {
            if (isDownloadingModel) {
                showConfirmDialog(
                    "Cancelar Descarga",
                    "Hay una descarga en curso. ¿Deseas cancelarla y eliminar lo que se ha descargado?",
                    "Sí, cancelar",
                    async () => {
                        if (downloadAbortController) {
                            downloadAbortController.abort();
                            downloadAbortController = null;
                        }

                        const modelName = document.getElementById('command-dialog-field').value.trim();
                        if (modelName) {
                            try {
                                await fetch(`/api/ai/models/${encodeURIComponent(modelName)}`, { method: 'DELETE' });
                            } catch (e) { }
                        }

                        isDownloadingModel = false;
                        downloadingModelName = '';
                        document.getElementById('command-dialog-confirm-btn').disabled = false;
                        document.getElementById('command-dialog-field').disabled = false;
                        const outputEl = document.getElementById('command-dialog-output');
                        outputEl.textContent = 'Descarga cancelada y archivos temporales eliminados.';
                        setTimeout(() => { document.getElementById('command-dialog-overlay').classList.remove('show'); }, 1500);
                    }
                );
            } else {
                document.getElementById('command-dialog-overlay').classList.remove('show');
            }
        }

        export async function executeCommand() {
            if (isDownloadingModel) {
                alert("Ya hay una descarga en progreso. Por favor, espera a que termine.");
                return;
            }

            const modelName = document.getElementById('command-dialog-field').value.trim();
            if (!modelName) return;

            isDownloadingModel = true;
            downloadingModelName = modelName;

            const outputEl = document.getElementById('command-dialog-output');
            outputEl.style.display = 'block';
            outputEl.textContent = `Iniciando descarga de ${modelName}...`;

            // Deshabilitar botones durante la descarga
            document.getElementById('command-dialog-confirm-btn').disabled = true;
            document.getElementById('command-dialog-field').disabled = true;

            try {
                const response = await fetch('/api/ai/pull_model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: modelName })
                });

                if (!response.ok) {
                    const data = await response.json();
                    outputEl.textContent = 'Error: ' + (data.error || 'Error desconocido');
                    isDownloadingModel = false;
                    downloadingModelName = '';
                    document.getElementById('command-dialog-field').disabled = false;
                    document.getElementById('command-dialog-confirm-btn').disabled = false;
                } else {
                    const data = await response.json();
                    if (data.status === "started") {
                        outputEl.textContent = data.message || `Descarga en segundo plano iniciada para ${modelName}...`;
                    } else {
                        outputEl.textContent = JSON.stringify(data);
                    }
                }
            } catch (err) {
                document.getElementById('command-dialog-output').textContent = 'Error de conexión: ' + err.message;
                isDownloadingModel = false;
                downloadingModelName = '';
                document.getElementById('command-dialog-field').disabled = false;
                document.getElementById('command-dialog-confirm-btn').disabled = false;
            }
        }

export async function deleteSelectedModel() {
            const select = document.getElementById('model-select');
            const modelName = select.value;

            if (!modelName || modelName === 'loading') return;

            showConfirmDialog(
                "Eliminar Modelo",
                `¿Estás seguro de que quieres desinstalar el modelo "${modelName}"? Esto lo borrará físicamente del disco de forma permanente.`,
                "Eliminar",
                async () => {
                    const labelEl = document.getElementById('main-model-label');
                    const btnEl = document.getElementById('main-model-btn');
                    const originalText = labelEl ? labelEl.textContent : '';
                    if (labelEl) labelEl.textContent = "Eliminando...";
                    if (btnEl) btnEl.disabled = true;

                    try {
                        const response = await fetch(`/api/ai/models/${encodeURIComponent(modelName)}`, { method: 'DELETE' });
                        const data = await response.json();

                        if (response.ok) {
                            if (window.init) window.init();
                        } else {
                            alert("Error al eliminar el modelo: " + (data.error || "Desconocido"));
                            if (labelEl) labelEl.textContent = originalText;
                        }
                    } catch (err) {
                        alert("Error de red: " + err.message);
                        if (btnEl) btnEl.disabled = false;
                    }
                }
            );
        }

export async function handleLogout() {
            try {
                await fetch('/api/logout', { method: 'POST' });
                window.location.href = '/';
            } catch (e) {
                window.location.href = '/';
            }
        }

export function isCode(text) {
            const codeKeywords = [
                'def ', 'function', 'import ', 'from ', '#include', 'const ', 'let ', 'var ',
                'class ', 'public ', 'private ', 'interface ', 'package ', 'using ', 'using namespace',
                '<html>', '<body>', 'div {', 'console.log', 'print(', 'std::', 'struct '
            ];
            return codeKeywords.some(kw => text.includes(kw));
        }

        document.getElementById('chat-input').addEventListener('paste', (e) => {
            if (e.clipboardData.items) {
                const items = e.clipboardData.items;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        const file = items[i].getAsFile();
                        if (file) {
                            e.preventDefault();
                            const name = `Captura_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.png`;
                            const renamedFile = new File([file], name, { type: file.type });
                            processFiles([renamedFile]);
                            return;
                        }
                    }
                }
            }

            const pastedText = e.clipboardData.getData('text');
            if (pastedText && pastedText.length > 1000 && (pastedText.split('\n').length > 5 || isCode(pastedText))) {
                e.preventDefault();
                const name = `Codigo_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.txt`;
                const virtualFile = new File([pastedText], name, { type: 'text/plain' });
                processFiles([virtualFile]);
            }
        });

        let activeShareId = null;
        let activeShareType = 'note';

        export function closeShareDialog(e) {
            if (e && e.target !== document.getElementById('share-dialog-overlay') && e.type === 'click' && !e.target.closest('.btn-icon')) return;
            document.getElementById('share-dialog-overlay').classList.remove('show');
            activeShareId = null;
        }

        export async function openShareDialog(id, type) {
            activeShareId = id;
            activeShareType = type;
            const overlay = document.getElementById('share-dialog-overlay');
            const titleEl = document.getElementById('share-dialog-title');
            titleEl.textContent = type === 'note' ? 'Compartir Nota' : 'Compartir Chat';

            const list = document.getElementById('share-friends-list');
            list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">Cargando amigos...</div>';
            overlay.classList.add('show');

            try {
                const res = await fetch('/api/friends/list');
                const data = await res.json();
                if (!data.friends || data.friends.length === 0) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;">No tienes amigos agregados aún.</div>';
                    return;
                }
                let note = null;
                if (type === 'note') {
                    note = window.getNoteById(id);
                }

                list.innerHTML = '';

                // Add Generar Enlace button
                const linkBtn = document.createElement('div');
                linkBtn.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border); margin-bottom: 10px; background: var(--bg-hover); border-radius: 6px;";
                linkBtn.innerHTML = `
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-main)"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                        <span style="font-size:0.9rem; font-weight:bold; color:var(--text-main);">Enlace directo</span>
                    </div>
                    <button class="btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="generateShareLink('${id}', '${type}')">Copiar</button>
                `;
                list.appendChild(linkBtn);

                data.friends.forEach(f => {
                    const d = document.createElement('div');
                    d.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border);";
                    
                    let isShared = false;
                    if (note && note.collaborators && note.collaborators.includes(f.friend_id)) {
                        isShared = true;
                    }
                    
                    const btnText = isShared ? 'Quitar' : 'Compartir';
                    const btnClass = isShared ? 'btn-danger' : 'btn-primary';
                    const btnStyle = isShared ? "padding:4px 10px; font-size:0.75rem; background:#f85149;" : "padding:4px 10px; font-size:0.75rem;";
                    
                    d.innerHTML = `
                        <div style="display:flex; align-items:center; gap: 10px;">
                            <div style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; background: var(--bg-hover); display: flex; align-items: center; justify-content: center;">
                                <img src="/api/system/user/avatar/${f.friend_name}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                                <span style="display:none; font-weight:bold; color:var(--text-main); font-size: 1rem;">${f.friend_name.charAt(0).toUpperCase()}</span>
                            </div>
                            <span style="font-size:0.9rem; font-weight:500;">${f.friend_name}</span>
                        </div>
                        <button class="${btnClass}" style="${btnStyle}" onclick="shareContentWithFriend(this, '${f.friend_id}', '${f.friend_name}')">${btnText}</button>
                    `;
                    list.appendChild(d);
                });
            } catch (err) {
                list.innerHTML = '<div style="text-align:center;color:#f85149;padding:20px;">Error al cargar amigos</div>';
            }
        }

        export function generateShareLink(id, type) {
            window.closeShareDialog();
            let prefix = type === 'note' ? '#nota-' : '#chat-';
            let url = window.location.href.split('#')[0] + prefix + id;
            window.showInputDialog('Enlace para compartir', 'Copia este enlace para enviarlo por fuera de la app', url, 'Copiar enlace', (val) => {
                navigator.clipboard.writeText(val).catch(() => { });
                showToast('¡Enlace copiado al portapapeles!');
            });
        }

        export async function shareContentWithFriend(btnEl, friendId, friendName) {
            // Handle cases where `btnEl` is a string (old calls, e.g. from chat sharing where toggle isn't implemented)
            if (typeof btnEl === 'string') {
                friendName = friendId;
                friendId = btnEl;
                btnEl = null;
            }

            const id = activeShareId;
            const type = activeShareType;
            let url = '';
            let bodyData = {};
            let isNowShared = true;

            if (type === 'note') {
                const n = window.getNoteById(id);
                if (!n) return;
                
                isNowShared = window.toggleShareNote(id, friendId, friendName);

                if (isNowShared) {
                    url = '/api/ai/notes/share';
                    bodyData = { friend_id: friendId, note: n };
                } else {
                    url = '/api/ai/notes/unshare';
                    bodyData = { friend_id: friendId, note_id: id };
                }
            } else if (type === 'chat') {
                url = '/api/ai/chat/share';
                bodyData = { friend_id: friendId, chat: id };
            }

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyData)
                });

                let data = {};
                try { data = await res.json(); } catch (err) { }

                if (res.ok) {
                    if (type === 'note') {
                        if (isNowShared) {
                            showToast('Nota compartida con ' + friendName);
                            if (btnEl) {
                                btnEl.textContent = 'Quitar';
                                btnEl.className = 'btn-danger';
                                btnEl.style.background = '#f85149';
                            }
                        } else {
                            showToast('Ya no compartes la nota con ' + friendName);
                            if (btnEl) {
                                btnEl.textContent = 'Compartir';
                                btnEl.className = 'btn-primary';
                                btnEl.style.background = '';
                            }
                        }
                    } else {
                        showToast('Enviado a ' + friendName);
                    }
                } else {
                    showToast('Error al procesar: ' + (data.error || 'Error desconocido'));
                }
            } catch (e) {
                showToast("Error de conexión");
            }
        }

        export function showToast(message) {
            let toast = document.getElementById('ai-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'ai-toast';
                toast.className = 'ai-toast';
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }



export function closeEditor() {
            if (window.socket && window.currentNoteId) {
                window.socket.emit('leave_note', { note_id: window.currentNoteId });
            }
            // Optional: clear active collaborators in UI just in case
            if (window.renderActiveCollaborators) {
                window.renderActiveCollaborators({});
            }
            saveCurrentNote();
            document.getElementById('note-editor').classList.remove('active');
            document.getElementById('notes-list-view').style.display = 'flex';
            renderNotesList();
        }

export let noteUpdateTimeout = null;

// Helper to calculate X/Y coordinates of text cursor in textarea
function getCaretCoordinates(element, position) {
    const div = document.createElement('div');
    const style = div.style;
    const computed = window.getComputedStyle(element);

    style.whiteSpace = 'pre-wrap';
    style.wordWrap = 'break-word';
    style.position = 'absolute';
    style.top = '0';
    style.left = '-9999px';
    
    const properties = [
        'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
        'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing',
        'tabSize', 'MozTabSize'
    ];
    
    properties.forEach(prop => {
        style[prop] = computed[prop];
    });

    if (window.navigator.userAgent.indexOf('Firefox') > -1) {
        if (element.scrollHeight > parseInt(computed.height)) style.overflowY = 'scroll';
    } else {
        style.overflow = 'hidden';
    }

    div.textContent = element.value.substring(0, position);
    
    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    div.appendChild(span);
    
    document.body.appendChild(div);
    const coordinates = {
        top: span.offsetTop + (parseInt(computed['borderTopWidth']) || 0),
        left: span.offsetLeft + (parseInt(computed['borderLeftWidth']) || 0),
        height: span.offsetHeight || 20
    };
    document.body.removeChild(div);
    return coordinates;
}


export let cursorUpdateTimeout = null;

export function updateCursor() {
    if (!window.socket || !window.currentNoteId) return;
    const note = window.notes.find(n => n.id === window.currentNoteId);
    if (!note || !note.is_shared) return;

    if (cursorUpdateTimeout) clearTimeout(cursorUpdateTimeout);
    
    // Debounce cursor updates slightly to not spam the server, but keep it fast
    cursorUpdateTimeout = setTimeout(() => {
        const textarea = document.getElementById('note-content-input');
        if (!textarea) return;
        
        const position = textarea.selectionEnd;
        const coords = getCaretCoordinates(textarea, position);
        
        // Scroll offset
        const scrollTop = textarea.scrollTop;
        const scrollLeft = textarea.scrollLeft;
        
        window.socket.emit('cursor_update', {
            id: note.id,
            user_id: window.currentUserId,
            user_name: window.currentUser || "Usuario",
            position: position,
            x: coords.left - scrollLeft,
            y: coords.top - scrollTop,
            height: coords.height
        });
    }, 50);
}

export function renderActiveCollaborators(usersObj) {
    const container = document.getElementById('active-collaborators');
    if (!container) return;
    container.innerHTML = '';
    
    // Only show if there's more than 1 user (or just show everyone)
    for (const [uid, uname] of Object.entries(usersObj)) {
        const div = document.createElement('div');
        div.className = 'collaborator-avatar';
        div.title = uname;
        div.textContent = uname.charAt(0).toUpperCase();
        
        // Generate a consistent color based on user_id string
        const hash = Array.from(uid).reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const hue = hash % 360;
        div.style.backgroundColor = `hsl(${hue}, 70%, 50%)`;
        
        container.appendChild(div);
    }
}

export function updateEditorMeta(saveHistory = true) {
            const title = document.getElementById('note-title-input').value;
            const content = document.getElementById('note-content-input').value;
            const words = content.trim() ? content.trim().split(/\s+/).length : 0;
            const chars = content.length;
            const now = new Date();
            const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            document.getElementById('note-meta-bar').textContent = `Hoy a las ${timeStr}  ${words} palabras  ${chars} caracteres`;
            document.getElementById('editor-wordcount').textContent = `${words} palabras`;
            saveCurrentNote();
            if (saveHistory) saveToNoteHistory();
            
            // Real-time collaborative update via websocket
            if (window.socket && window.currentNoteId) {
                const note = window.notes.find(n => n.id === window.currentNoteId);
                if (note && note.is_shared) {
                    if (noteUpdateTimeout) clearTimeout(noteUpdateTimeout);
                    noteUpdateTimeout = setTimeout(() => {
                        window.socket.emit('note_update', {
                            id: note.id,
                            title: title,
                            content: content,
                            collaborators: note.collaborators
                        });
                    }, 500); // 500ms debounce
                }
            }
        }

export function insertFormat(type) {
            const ta = document.getElementById('note-content-input');
            const start = ta.selectionStart, end = ta.selectionEnd;
            const sel = ta.value.substring(start, end);
            const map = { bold: `**${sel || 'texto'}**`, italic: `*${sel || 'texto'}*`, underline: `<u>${sel || 'texto'}</u>`, strike: `~~${sel || 'texto'}~~`, code: `\`${sel || 'código'}\``, h1: `# ${sel || 'Título'}`, h2: `## ${sel || 'Título'}`, h3: `### ${sel || 'Título'}`, ul: `\n- ${sel || 'elemento'}`, ol: `\n1. ${sel || 'elemento'}`, check: `\n- [ ] ${sel || 'tarea'}` };
            const ins = map[type] || sel;
            ta.value = ta.value.substring(0, start) + ins + ta.value.substring(end);
            ta.selectionStart = ta.selectionEnd = start + ins.length;
            ta.focus(); updateEditorMeta();
        }

export function toggleFilterDropdown(id, e) {
            e.stopPropagation();
            const dd = document.getElementById(id);
            const wasHidden = dd.classList.contains('hidden');
            document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.add('hidden'));
            if (wasHidden) dd.classList.remove('hidden');
        }



export function toggleViewDropdown(e) { toggleFilterDropdown('view-dropdown', e); }

export function toggleMoreOpts(e) {
            e.stopPropagation();
            const dd = document.getElementById('more-opts-dropdown');
            dd.classList.toggle('hidden');
        }

export function closeMoreOpts() {
            document.getElementById('more-opts-dropdown').classList.add('hidden');
        }

const KNOWN_PROVIDERS = {
    openrouter: { url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
    deepseek:   { url: 'https://api.deepseek.com',     model: 'deepseek-chat' },
    openai:     { url: 'https://api.openai.com/v1',    model: 'gpt-3.5-turbo' },
    groq:       { url: 'https://api.groq.com/openai/v1', model: '' },
    anthropic:  { url: 'https://api.anthropic.com/v1', model: '' },
    mistral:    { url: 'https://api.mistral.ai/v1',    model: '' },
    together:   { url: 'https://api.together.xyz/v1',  model: '' },
    xai:        { url: 'https://api.x.ai/v1',          model: '' },
    perplexity: { url: 'https://api.perplexity.ai',    model: '' },
    nvidia:     { url: 'https://integrate.api.nvidia.com/v1', model: '' },
};

function _fillProviderDefaults(provider) {
    const known = KNOWN_PROVIDERS[provider.toLowerCase()];
    if (!known) return;
    const urlInput = document.getElementById('api-keys-url');
    const modelInput = document.getElementById('api-keys-model');
    if (urlInput && !urlInput.value.trim()) urlInput.value = known.url;
    if (modelInput && known.model && !modelInput.value.trim()) modelInput.value = known.model;
}

function _fillApiKeysForm(provider, url, model) {
    const providerInput = document.getElementById('api-keys-provider');
    const urlInput = document.getElementById('api-keys-url');
    const keyInput = document.getElementById('api-keys-key');
    const modelInput = document.getElementById('api-keys-model');
    providerInput.value = provider || 'openrouter';
    urlInput.value = url || (KNOWN_PROVIDERS[(provider || 'openrouter').toLowerCase()]?.url || '');
    modelInput.value = model || (KNOWN_PROVIDERS[(provider || 'openrouter').toLowerCase()]?.model || '');
    keyInput.value = '';
    keyInput.placeholder = 'sk-...';
}

export function resetApiKeysForm() {
    _fillApiKeysForm('openrouter', 'https://openrouter.ai/api/v1', 'openrouter/auto');
    document.getElementById('api-keys-key').focus();
}

export async function deleteApiKeyUI(provider) {
    if (!window.confirm(`¿Eliminar la API key de "${provider}"?`)) return;
    const ok = await window.deleteAPIKey(provider);
    if (ok) {
        showToast(`Proveedor "${provider}" eliminado`);
        _renderApiKeysList(await window.fetchAPIKeys());
        const providerInput = document.getElementById('api-keys-provider');
        if (providerInput.value.trim().toLowerCase() === provider.toLowerCase()) {
            resetApiKeysForm();
        }
    } else {
        showToast('Error al eliminar el proveedor');
    }
}

async function _renderApiKeysList(keys) {
    const list = document.getElementById('api-keys-saved-list');
    if (!list) return;
    list.innerHTML = '';
    if (!keys || keys.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Sin proveedores guardados todavía.';
        empty.style.cssText = 'font-size:0.75rem;color:var(--text-dim);padding:6px 2px;';
        list.appendChild(empty);
        return;
    }
    keys.forEach((k) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:7px 10px;cursor:pointer;';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        const name = document.createElement('div');
        name.style.cssText = 'font-size:0.8rem;font-weight:600;color:var(--text-main);';
        name.textContent = k.provider;
        const detail = document.createElement('div');
        detail.style.cssText = 'font-size:0.7rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        detail.textContent = [k.model, k.api_url].filter(Boolean).join(' · ');
        info.appendChild(name);
        info.appendChild(detail);
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '✕';
        del.title = 'Eliminar';
        del.style.cssText = 'background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.8rem;padding:2px 6px;flex-shrink:0;';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteApiKeyUI(k.provider);
        });
        row.appendChild(info);
        row.appendChild(del);
        row.addEventListener('click', () => _fillApiKeysForm(k.provider, k.api_url, k.model));
        list.appendChild(row);
    });
}

export async function openApiKeysDialog() {
    // Empieza con el formulario limpio (por defecto OpenRouter) y lista los
    // proveedores ya guardados: se pueden añadir varios.
    const keys = await window.fetchAPIKeys();
    resetApiKeysForm();
    _renderApiKeysList(keys);
    const providerInput = document.getElementById('api-keys-provider');
    providerInput.addEventListener('input', () => _fillProviderDefaults(providerInput.value.trim()));
    document.getElementById('api-keys-dialog-overlay').classList.add('show');
}

export function closeApiKeysDialog(e) {
    if (e && e.target !== document.getElementById('api-keys-dialog-overlay')) return;
    document.getElementById('api-keys-dialog-overlay').classList.remove('show');
}

export async function saveApiKeysConfig() {
    const provider = document.getElementById('api-keys-provider').value.trim();
    const url = document.getElementById('api-keys-url').value.trim();
    const key = document.getElementById('api-keys-key').value.trim();
    const model = document.getElementById('api-keys-model').value.trim();
    
    if (!provider || !key) {
        showToast("Error: Proveedor y API Key son requeridos.");
        return;
    }
    
    const success = await window.saveAPIKey(provider, key, url, model);
    if (success) {
        showToast("Configuración guardada correctamente");
        _renderApiKeysList(await window.fetchAPIKeys());
        // Deja el formulario listo para añadir otro proveedor
        const keyInput = document.getElementById('api-keys-key');
        keyInput.value = '';
        keyInput.placeholder = 'sk-...';
        document.getElementById('api-keys-provider').focus();
        // Refresh models list
        const { init } = await import('./chat.js');
        init();
    } else {
        showToast("Error al guardar configuración");
    }
}
export function openModelSettingsDialog() {
    const ctx     = localStorage.getItem('model_num_ctx')     || '8192';
    const predict = localStorage.getItem('model_num_predict') || '2048';
    const temp    = localStorage.getItem('model_temperature') || '0.7';

    document.getElementById('model-settings-ctx').value     = ctx;
    document.getElementById('model-settings-predict').value = predict;
    document.getElementById('model-settings-temp').value    = temp;
    document.getElementById('temp-val-display').innerText   = temp;

    document.getElementById('model-settings-dialog').classList.add('show');
}

export function closeModelSettingsDialog(e) {
    // Close only when clicking the backdrop itself, not the modal content
    if (e && e.target !== document.getElementById('model-settings-dialog')) return;
    document.getElementById('model-settings-dialog').classList.remove('show');
}

export function saveModelSettings() {
    const ctx     = parseInt(document.getElementById('model-settings-ctx').value)     || 8192;
    const predict = parseInt(document.getElementById('model-settings-predict').value) || 2048;
    const temp    = parseFloat(document.getElementById('model-settings-temp').value)  || 0.7;

    localStorage.setItem('model_num_ctx',     ctx);
    localStorage.setItem('model_num_predict', predict);
    localStorage.setItem('model_temperature', temp);

    showToast('✓ Ajustes del modelo guardados');
    document.getElementById('model-settings-dialog').classList.remove('show');
}

export function toggleApiKeyVisibility() {
    const input = document.getElementById('api-keys-key');
    const icon  = document.getElementById('eye-icon');
    const isHidden = input.style.webkitTextSecurity !== 'none';
    input.style.webkitTextSecurity = isHidden ? 'none' : 'disc';
    icon.innerHTML = isHidden
        ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
        : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

export function handleModelPullProgress(data) {
    if (!downloadingModelName) downloadingModelName = data.model;
    
    if (data.model !== downloadingModelName) return;
    
    isDownloadingModel = true;
    document.getElementById('command-dialog-field').disabled = true;
    document.getElementById('command-dialog-confirm-btn').disabled = true;
    
    const outputEl = document.getElementById('command-dialog-output');
    outputEl.style.display = 'block';
    
    if (data.status === 'error') {
        outputEl.textContent = 'Error: ' + data.message;
        isDownloadingModel = false;
        downloadingModelName = '';
        document.getElementById('command-dialog-field').disabled = false;
        document.getElementById('command-dialog-confirm-btn').disabled = false;
    } else if (data.status === 'success') {
        outputEl.textContent = '¡Descarga completada con éxito!';
        isDownloadingModel = false;
        downloadingModelName = '';
        document.getElementById('command-dialog-field').disabled = false;
        document.getElementById('command-dialog-confirm-btn').disabled = false;
        if (window.init) window.init();
        showToast(`¡El modelo ${data.model} se descargó correctamente!`);
    } else if (data.status === 'downloading') {
        outputEl.textContent = `Descargando ${data.model}...\n${data.progress}`;
    }
}

export async function checkActiveDownloads() {
    try {
        const res = await fetch('/api/ai/active_downloads');
        if (res.ok) {
            const data = await res.json();
            const activeKeys = Object.keys(data);
            if (activeKeys.length > 0) {
                const modelName = activeKeys[0];
                downloadingModelName = modelName;
                isDownloadingModel = true;
                document.getElementById('command-dialog-field').disabled = true;
                document.getElementById('command-dialog-confirm-btn').disabled = true;
                const outputEl = document.getElementById('command-dialog-output');
                outputEl.style.display = 'block';
                outputEl.textContent = `Recuperando estado de descarga para ${modelName}...\n${data[modelName].progress || ''}`;
            }
        }
    } catch(e) {}
}

window.handleModelPullProgress = handleModelPullProgress;
