import { getProviderInfo } from './slash_commands.js';
import { modelDisplayName } from './chat.js';

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

export function isMobileDevice() {
    return window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
}
window.isMobileDevice = isMobileDevice;

export function showInputDialog(title, label, defaultVal, confirmText, callback) {
    document.getElementById('input-dialog-title').textContent = title;
    document.getElementById('input-dialog-label').textContent = label;
    const field = document.getElementById('input-dialog-field');
    field.value = defaultVal;
    document.getElementById('input-dialog-confirm-btn').textContent = confirmText;
    window._inputDialogCallback = callback;
    document.getElementById('input-dialog-overlay').classList.add('show');
    if (!isMobileDevice()) {
        setTimeout(() => { field.focus(); field.select(); }, 80);
    }
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
        const esc = val.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        row.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:white;flex-shrink:0;">${esc[0].toUpperCase()}</div><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc}</span><span style="font-size:0.78rem;color:var(--text-dim);">Puede ver</span><button onclick="this.closest('div').remove(); if(!document.getElementById('perm-list-body').children.length) document.getElementById('perm-list-body').innerHTML='<div class=\\'perm-empty\\'>Sin acceso concedido. Privado para ti.</div>';" style="background:none;border:none;color:var(--text-dim);cursor:pointer;padding:2px 6px;border-radius:4px;font-size:0.78rem;">✕</button>`;
        body.appendChild(row);
    });
}

export function renderOllamaCatalog() {
    const container = document.getElementById('ollama-catalog-grid');
    if (!container) return;
    container.innerHTML = '';

    const installedModels = (window.aiModelList || []).map(m => (typeof m === 'string' ? m : (m.name || m.model || '')).toLowerCase());

    OLLAMA_CATALOG.forEach(model => {
        const isInstalled = installedModels.some(installed => {
            const cleanInstalled = installed.replace(/^(local:|api:\w+:|cloud:)/i, '').trim();
            const cleanId = model.id.toLowerCase();
            return cleanInstalled === cleanId || cleanInstalled.startsWith(cleanId + ':') || cleanId.startsWith(cleanInstalled + ':');
        });

        const card = document.createElement('div');
        card.style.cssText = 'background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:10px 12px; cursor:pointer; transition:all 0.2s ease; position:relative;';
        card.onmouseover = () => { card.style.borderColor = 'rgba(99,102,241,0.3)'; card.style.background = 'rgba(99,102,241,0.05)'; };
        card.onmouseout = () => { card.style.borderColor = 'rgba(255,255,255,0.06)'; card.style.background = 'rgba(255,255,255,0.03)'; };
        card.onclick = () => {
            document.getElementById('command-dialog-field').value = model.id;
            executeCommand();
        };

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-weight:600; color:var(--text-main); font-size:0.85rem;">${model.name}</span>
                    ${isInstalled ? `<span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:rgba(34,197,94,0.15); color:#22c55e; font-size:0.65rem; font-weight:bold;" title="Ya instalado">✓</span>` : ''}
                </div>
                <span style="font-size:0.65rem; background:rgba(255,255,255,0.06); color:var(--text-dim); padding:2px 6px; border-radius:6px; font-weight:500;">${model.size}</span>
            </div>
            <div style="font-size:0.72rem; color:var(--text-dim); line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${model.desc}</div>
        `;
        container.appendChild(card);
    });
}

export async function openCommandDialog() {
    if (window.ensureModelsLoaded) await window.ensureModelsLoaded();
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
    if (!isDownloadingModel && !isMobileDevice()) {
        setTimeout(() => { document.getElementById('command-dialog-field')?.focus(); }, 80);
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

    const isOllamaTag = /^[a-zA-Z0-9_\-\.\:\/]+$/.test(modelName) && !modelName.includes('..');
    const isSafeHF = modelName.startsWith('hf.co/') || modelName.startsWith('https://huggingface.co/');

    if (!isOllamaTag && !isSafeHF) {
        alert("Seguridad: El nombre o tag del modelo contiene caracteres o formatos no permitidos.");
        return;
    }

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

        // Add Generar Enlace button only for chats
        if (type !== 'note') {
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
        }

        data.friends.forEach((f, idx) => {
            const d = document.createElement('div');
            const isLast = idx === data.friends.length - 1;
            d.style.cssText = `display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:8px; transition:background 0.15s; ${isLast ? '' : 'margin-bottom:4px;'}`;
            d.onmouseenter = () => d.style.background = 'var(--bg-hover)';
            d.onmouseleave = () => d.style.background = 'transparent';

            let isShared = false;
            if (note && note.collaborators && note.collaborators.includes(f.friend_id)) {
                isShared = true;
            }

            const btnText = isShared ? 'Quitar' : 'Compartir';
            const btnClass = isShared ? 'btn-danger' : 'btn-primary';
            const btnStyle = isShared
                ? "padding:6px 14px; font-size:0.8rem; font-weight:500; border-radius:6px; background:#dc2626; color:#fff; border:none; cursor:pointer;"
                : "padding:6px 14px; font-size:0.8rem; font-weight:500; border-radius:6px; background:var(--primary); color:#fff; border:none; cursor:pointer;";

            const nameStr = f.friend_name || f.friend_id || 'U';
            const hash = Array.from(nameStr).reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const hue = hash % 360;
            const avatarBg = `hsl(${hue}, 65%, 45%)`;
            const initial = nameStr.charAt(0).toUpperCase();

            d.innerHTML = `
                        <div style="display:flex; align-items:center; gap: 10px;">
                            <div style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; background: ${avatarBg}; position: relative; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; font-weight: 700; font-size: 0.85rem;">
                                <img src="/api/system/user/avatar/${encodeURIComponent(f.friend_id)}" style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0;" onerror="this.style.display='none';" />
                                <span>${initial}</span>
                            </div>
                            <span style="font-size:0.9rem; font-weight:500; color:var(--text-main);">${f.friend_name}</span>
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
    if (type === 'note') return;
    window.closeShareDialog();
    let url = window.location.href.split('#')[0] + '#chat-' + id;
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
    const note = window.notes ? window.notes.find(n => n.id === window.currentNoteId) : null;
    const updatedTs = (note && (note.updatedAt || note.updated)) ? (note.updatedAt || note.updated) : Date.now();
    let num = Number(updatedTs);
    if (num < 1e11) num *= 1000;
    const d = new Date(num);
    const now = new Date();
    const isToday = !isNaN(d.getTime()) && d.toDateString() === now.toDateString();
    const dateStr = !isNaN(d.getTime()) ? (isToday ? 'Hoy' : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })) : 'Hoy';
    const timeStr = !isNaN(d.getTime()) ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
    document.getElementById('note-meta-bar').textContent = `${dateStr}${timeStr ? ' a las ' + timeStr : ''}  ${words} palabras  ${chars} caracteres`;
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
    openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
    openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-3.5-turbo' },
    groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: '' },
    anthropic: { name: 'Anthropic', url: 'https://api.anthropic.com/v1', model: '' },
    mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1', model: '' },
    together: { name: 'Together', url: 'https://api.together.xyz/v1', model: '' },
    xai: { name: 'xAI (Grok)', url: 'https://api.x.ai/v1', model: '' },
    perplexity: { name: 'Perplexity', url: 'https://api.perplexity.ai', model: '' },
    nvidia: { name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', model: '' },
    google: { name: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-flash-latest' },
};

window.toggleAdvancedApiFields = function (show = null) {
    const container = document.getElementById('advanced-api-fields-container');
    const text = document.getElementById('toggle-advanced-api-text');
    if (!container) return;

    const isVisible = show !== null ? show : container.style.display !== 'flex';
    container.style.display = isVisible ? 'flex' : 'none';
    if (text) {
        text.textContent = isVisible ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas (URL Base, Identificador)';
    }
};

async function refreshProviderModelSuggestions(provider) {
    const dl = document.getElementById('api-model-suggestions');
    if (!dl) return;
    dl.innerHTML = '';
    if (!provider) return;
    try {
        const res = await fetch(`/api/ai/keys/models?provider=${encodeURIComponent(provider)}`);
        if (!res.ok) return;
        const data = await res.json();
        (data.models || []).slice(0, 5).forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            dl.appendChild(opt);
        });
    } catch (e) { /* autocomplete opcional */ }
}

window.selectProviderChip = function (providerKey) {
    document.querySelectorAll('#api-provider-chips .provider-chip').forEach(c => c.classList.remove('active'));

    const chips = document.querySelectorAll('#api-provider-chips .provider-chip');
    chips.forEach(c => {
        if (c.getAttribute('onclick')?.includes(`'${providerKey}'`)) {
            c.classList.add('active');
        }
    });

    const known = KNOWN_PROVIDERS[providerKey.toLowerCase()];
    const providerInput = document.getElementById('api-keys-provider');
    const urlInput = document.getElementById('api-keys-url');
    const modelInput = document.getElementById('api-keys-model');
    const keyInput = document.getElementById('api-keys-key');

    if (known) {
        if (providerInput) providerInput.value = providerKey;
        if (urlInput) urlInput.value = known.url;
        if (modelInput) modelInput.value = known.model;
        window.toggleAdvancedApiFields(false);
        if (keyInput) keyInput.focus();
    } else {
        // Proveedor manual (sin chip): rellenar para edición manual
        if (providerInput) providerInput.value = providerKey || '';
        if (urlInput) urlInput.value = 'https://api.openai.com/v1';
        if (modelInput) modelInput.value = '';
        window.toggleAdvancedApiFields(true);
        if (providerInput) providerInput.focus();
    }
    refreshProviderModelSuggestions(providerKey);
};

window.showApiKeysForm = function (isEdit = false, providerData = null) {
    const container = document.getElementById('api-keys-form-container');
    const formTitle = document.getElementById('api-form-title');
    if (!container) return;

    container.style.display = 'flex';

    if (isEdit && providerData) {
        if (formTitle) formTitle.textContent = `Editar Proveedor: ${providerData.provider}`;
        _fillApiKeysForm(providerData.provider, providerData.api_url, providerData.model, true);
        window._editingApiProvider = providerData.provider;
        const isKnown = Boolean(KNOWN_PROVIDERS[providerData.provider.toLowerCase()]);
        if (isKnown) {
            window.selectProviderChip(providerData.provider);
        } else {
            // Proveedor manual guardado (sin chip): cargar el nombre en el campo
            const providerInput = document.getElementById('api-keys-provider');
            if (providerInput) providerInput.value = providerData.provider;
            window.toggleAdvancedApiFields(true);
            refreshProviderModelSuggestions(providerData.provider);
        }
    } else {
        if (formTitle) formTitle.textContent = 'Añadir Nuevo Proveedor';
        window._editingApiProvider = null;
        resetApiKeysForm();
        window.selectProviderChip('openrouter');
    }
};

window.hideApiKeysForm = function () {
    const container = document.getElementById('api-keys-form-container');
    if (container) container.style.display = 'none';
};

function _fillApiKeysForm(provider, url, model, isEdit = false) {
    const providerInput = document.getElementById('api-keys-provider');
    const urlInput = document.getElementById('api-keys-url');
    const keyInput = document.getElementById('api-keys-key');
    const modelInput = document.getElementById('api-keys-model');
    const keyContainer = document.getElementById('api-key-field-container');

    if (providerInput) providerInput.value = provider || 'openrouter';
    if (urlInput) urlInput.value = url || (KNOWN_PROVIDERS[(provider || 'openrouter').toLowerCase()]?.url || '');
    if (modelInput) modelInput.value = model || (KNOWN_PROVIDERS[(provider || 'openrouter').toLowerCase()]?.model || '');
    if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = 'sk-...';
    }
    // Seguridad: al EDITAR una clave existente, el campo de la API key no se
    // muestra ni se permite modificarla (se conserva la almacenada).
    if (keyContainer) keyContainer.style.display = isEdit ? 'none' : '';
}

export function resetApiKeysForm() {
    _fillApiKeysForm('openrouter', 'https://openrouter.ai/api/v1', 'openrouter/auto');
}

export async function deleteApiKeyUI(provider) {
    showConfirmDialog(
        'Eliminar API key',
        `¿Eliminar la API key de "${provider}"?`,
        'Eliminar',
        async () => {
            const ok = await window.deleteAPIKey(provider);
            if (ok) {
                showToast(`Proveedor "${provider}" eliminado`);
                _renderApiKeysList(await window.fetchAPIKeys());
                window.hideApiKeysForm();
            } else {
                showToast('Error al eliminar');
            }
        }
    );
};

window._currentSharingProvider = null;

window.openShareKeyFriendsModal = async function (provider, isShared, sharedWith) {
    window._currentSharingProvider = provider;
    const sub = document.getElementById('share-friends-subtitle');
    if (sub) sub.textContent = `Configurar permisos para "${provider}"`;

    const allCheck = document.getElementById('share-all-friends-checkbox');
    // Default seguro: solo "Todos mis amigos" si el proveedor YA estaba
    // compartido explícitamente con '*'. Abrir el diálogo no implica compartir
    // con todo el sistema.
    const isAll = sharedWith === '*';
    if (allCheck) allCheck.checked = isAll;

    const list = document.getElementById('share-friends-checkbox-list');
    if (list) {
        list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-dim);padding:8px;">Cargando lista de amigos...</div>';
    }

    const overlay = document.getElementById('share-key-friends-dialog-overlay');
    if (overlay) overlay.classList.add('show');

    try {
        const res = await fetch('/api/friends/list');
        const data = res.ok ? await res.json() : {};
        const friends = data.friends || [];

        if (!list) return;
        list.innerHTML = '';

        if (friends.length === 0) {
            list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-dim);padding:8px;">No tienes amigos agregados en el módulo Friends todavía.</div>';
            return;
        }

        const selectedUsers = (sharedWith || '').split(',').map(s => s.trim().toLowerCase());

        friends.forEach(f => {
            // La comparación del backend usa user_id (friend_id): el value del
            // checkbox y el estado marcado deben basarse en friend_id, no en el nombre.
            const friendId = (f.friend_id || f.id || '').toString();
            const fName = f.friend_name || f.username || friendId;
            const isChecked = isAll || selectedUsers.includes(friendId.toLowerCase());

            const item = document.createElement('label');
            item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.8rem;';
            item.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                    <div style="width:26px;height:26px;border-radius:50%;background:rgba(99,102,241,0.2);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;overflow:hidden;flex-shrink:0;position:relative;">
                        <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${fName.charAt(0).toUpperCase()}</span>
                        <img src="/api/system/user/avatar/${encodeURIComponent(friendId)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;" onload="this.style.display='block';this.previousElementSibling.style.display='none';" onerror="this.style.display='none';">
                    </div>
                    <span style="color:var(--text-main);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fName}</span>
                </div>
                <input type="checkbox" class="friend-user-checkbox" value="${friendId}" ${isChecked ? 'checked' : ''} ${isAll ? 'disabled' : ''} style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary);flex-shrink:0;">
            `;
            list.appendChild(item);
        });
    } catch (e) {
        if (list) list.innerHTML = '<div style="font-size:0.78rem;color:#ef4444;padding:8px;">Error al obtener la lista de amigos.</div>';
    }
};

window.closeShareKeyFriendsModal = function (e) {
    if (e && e.target !== document.getElementById('share-key-friends-dialog-overlay')) return;
    const modal = document.getElementById('share-key-friends-dialog-overlay');
    if (modal) modal.classList.remove('show');
};

window.toggleShareAllFriends = function (isAllChecked) {
    const checkboxes = document.querySelectorAll('.friend-user-checkbox');
    checkboxes.forEach(cb => {
        cb.disabled = isAllChecked;
        if (isAllChecked) cb.checked = true;
    });
};

window.confirmSaveShareKeyFriends = async function () {
    const provider = window._currentSharingProvider;
    if (!provider) return;

    const allCheck = document.getElementById('share-all-friends-checkbox');
    const isAll = allCheck ? allCheck.checked : true;

    let sharedWithStr = '*';
    let isShared = true;

    if (!isAll) {
        const checkboxes = document.querySelectorAll('.friend-user-checkbox:checked');
        const selected = Array.from(checkboxes).map(cb => cb.value);
        if (selected.length === 0) {
            isShared = false;
            sharedWithStr = '';
        } else {
            sharedWithStr = selected.join(',');
        }
    }

    try {
        const res = await fetch('/api/ai/keys/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: provider, is_shared: isShared, shared_with_users: sharedWithStr })
        });
        if (res.ok) {
            showToast(isShared ? `Permisos de "${provider}" actualizados` : `Clave de "${provider}" configurada como privada`);
            window.closeShareKeyFriendsModal();
            _renderApiKeysList(await window.fetchAPIKeys());
            const { init } = await import('./chat.js');
            init();
        } else {
            showToast('Error al actualizar permisos de la clave');
        }
    } catch (e) {
        showToast('Error de red al actualizar permisos');
    }
};

async function _renderApiKeysList(keys) {
    const list = document.getElementById('api-keys-saved-list');
    if (!list) return;
    list.innerHTML = '';

    if (!keys || keys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'api-saved-card';
        empty.style.justifyContent = 'center';
        empty.style.padding = '16px';
        empty.innerHTML = `<span style="font-size:0.8rem;color:var(--text-dim);">No tienes ninguna API Key guardada todavía.</span>`;
        list.appendChild(empty);
        return;
    }

    keys.forEach((k) => {
        const card = document.createElement('div');
        card.className = 'api-saved-card';

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;gap:6px 8px;flex-wrap:wrap;min-width:0;';

        const name = document.createElement('span');
        name.style.cssText = 'font-size:0.85rem;font-weight:700;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;min-width:0;';
        name.textContent = k.provider;

        topRow.appendChild(name);

        if (k.model) {
            const badge = document.createElement('span');
            badge.className = 'api-card-badge';
            badge.textContent = k.model;
            badge.style.cssText = 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;min-width:0;';
            topRow.appendChild(badge);
        }

        if (!k.is_own) {
            const teamBadge = document.createElement('span');
            teamBadge.style.cssText = 'font-size:0.68rem;color:#10b981;background:rgba(16,185,129,0.12);padding:2px 7px;border-radius:4px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:1;min-width:0;';
            teamBadge.textContent = `Compartido por ${k.owner_name || k.owner_id || 'Equipo'}`;
            topRow.appendChild(teamBadge);
        }

        const detail = document.createElement('div');
        detail.style.cssText = 'font-size:0.72rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;';
        detail.textContent = k.api_url || 'https://openrouter.ai/api/v1';

        info.appendChild(topRow);
        info.appendChild(detail);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;';

        if (k.is_own) {
            const shareBtn = document.createElement('button');
            shareBtn.type = 'button';
            shareBtn.title = k.is_shared ? 'Configurar amigos con acceso' : 'Privada (Clic para compartir con amigos)';
            shareBtn.style.cssText = `background:${k.is_shared ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)'};border:1px solid ${k.is_shared ? 'rgba(99,102,241,0.3)' : 'var(--border)'};color:${k.is_shared ? 'var(--primary,#818cf8)' : 'var(--text-dim)'};border-radius:6px;padding:4px 8px;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;gap:4px;font-weight:500;`;

            const sharedLabel = k.is_shared ? (k.shared_with_users === '*' ? 'Amigos' : 'Personalizado') : 'Privada';

            shareBtn.innerHTML = k.is_shared
                ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg><span>${sharedLabel}</span>`
                : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>Privada</span>`;

            shareBtn.onclick = (e) => {
                e.stopPropagation();
                window.openShareKeyFriendsModal(k.provider, Boolean(k.is_shared), k.shared_with_users);
            };
            actions.appendChild(shareBtn);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.textContent = 'Editar';
            editBtn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text-main);border-radius:6px;padding:4px 10px;font-size:0.75rem;cursor:pointer;font-weight:500;';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                window.showApiKeysForm(true, k);
            };
            actions.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.textContent = 'Eliminar';
            delBtn.style.cssText = 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:6px;padding:4px 10px;font-size:0.75rem;cursor:pointer;font-weight:500;';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteApiKeyUI(k.provider);
            };
            actions.appendChild(delBtn);
        } else {
            const usingBadge = document.createElement('span');
            usingBadge.style.cssText = 'font-size:0.75rem;color:var(--text-dim);font-style:italic;padding:4px 6px;';
            usingBadge.textContent = 'Lista para usar';
            actions.appendChild(usingBadge);
        }

        card.appendChild(info);
        card.appendChild(actions);
        list.appendChild(card);
    });
}

export async function openApiKeysDialog() {
    const keys = await window.fetchAPIKeys();
    window.hideApiKeysForm();
    _renderApiKeysList(keys);
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

    const isEdit = !!window._editingApiProvider;
    if (!provider || (!isEdit && !key)) {
        showToast("Error: Proveedor y API Key son requeridos.");
        return;
    }

    const saveBtn = document.getElementById('btn-save-api-key');
    const origHtml = saveBtn ? saveBtn.innerHTML : 'Guardar Proveedor';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"/>
            </svg>
            <span>Verificando y Guardando...</span>
        `;
    }

    // En edición la clave no se envía: el backend conserva la almacenada.
    const success = await window.saveAPIKey(provider, isEdit ? '' : key, url, model);

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = origHtml;
    }

    if (success) {
        showToast("Configuración guardada correctamente");
        _renderApiKeysList(await window.fetchAPIKeys());
        window.hideApiKeysForm();
        const { init } = await import('./chat.js');
        init();
    } else {
        showToast("Error al guardar configuración");
    }
}

window.formatKTokens = function (kVal) {
    const num = parseInt(kVal) || 0;
    if (num >= 1024) {
        const m = num / 1024;
        return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + 'M';
    }
    return num + 'K';
};

window.getModelSpecs = function (modelName) {
    if (!modelName) return { maxCtx: 2048, maxPredict: 128, label: '2M (Masivo)' };
    const name = String(modelName).toLowerCase();

    // Massive Context Models (Gemini: 2M, Claude: 200K)
    if (name.includes('gemini')) {
        return { maxCtx: 2048, maxPredict: 128, label: '2M (Contexto Extremo)' };
    }
    if (name.includes('claude')) {
        return { maxCtx: 200, maxPredict: 128, label: '200K (Nube Masivo)' };
    }

    // High capacity models (DeepSeek-V3/R1/V4, Qwen 2.5/3.8, Grok, Llama3.1/3.3, APIs) -> 128K context, 128K output
    if (name.includes('qwen') || name.includes('deepseek') || name.includes('grok') || name.includes('llama3') || name.includes('27b') || name.includes('14b') || name.includes('32b') || name.includes('70b') || name.startsWith('api:')) {
        return { maxCtx: 128, maxPredict: 128, label: '128K (Alta Capacidad)' };
    }

    // Ultra-light local models (0.5B, 1.5B, agenda) -> Max 32K context
    if (name.includes('0.5b') || name.includes('1.5b') || name.includes('agenda')) {
        return { maxCtx: 32, maxPredict: 16, label: '32K (Modelo Ligero)' };
    }

    // Medium local models (2B, 3B, 7B, phi3) -> Max 64K context
    if (name.includes('2b') || name.includes('3b') || name.includes('7b') || name.includes('phi3')) {
        return { maxCtx: 64, maxPredict: 32, label: '64K (Modelo Mediano)' };
    }

    return { maxCtx: 128, maxPredict: 128, label: '128K (Estándar)' };
};

window.onModelSelectionChanged = function (modelId) {
    if (window.selectMainModel) window.selectMainModel(modelId, modelId);

    const models = window.aiModelList || [];
    const selectedModel = models.find(m => {
        if (!m) return false;
        if (typeof m === 'string') return m === modelId;
        return m.id === modelId || m.name === modelId;
    });

    // Extract real context_length and max_output_tokens from API object
    let rawContextTokens = selectedModel && selectedModel.context_length ? selectedModel.context_length : null;
    let rawOutputTokens = selectedModel && selectedModel.max_output_tokens ? selectedModel.max_output_tokens : null;

    if (!rawContextTokens) {
        const specs = window.getModelSpecs(modelId);
        rawContextTokens = specs.maxCtx * 1024;
        rawOutputTokens = specs.maxPredict * 1024;
    }

    const maxCtxK = Math.round(rawContextTokens / 1024);
    const maxPredictK = Math.round((rawOutputTokens || 32768) / 1024);

    const ctxSlider = document.getElementById('model-settings-ctx');
    const predictSlider = document.getElementById('model-settings-predict');
    const memoryMaxLabel = document.getElementById('memory-max-label');
    const tokensMaxLabel = document.getElementById('tokens-max-label');
    const modelBadge = document.getElementById('model-capability-badge');

    if (ctxSlider) {
        ctxSlider.max = maxCtxK;
        if (parseInt(ctxSlider.value) > maxCtxK) {
            ctxSlider.value = maxCtxK;
        }
        window.updateMemorySlider(ctxSlider);
    }

    if (predictSlider) {
        predictSlider.max = maxPredictK;
        if (parseInt(predictSlider.value) > maxPredictK) {
            predictSlider.value = maxPredictK;
        }
        window.updateTokensSlider(predictSlider);
    }

    if (memoryMaxLabel) {
        memoryMaxLabel.textContent = `${window.formatKTokens(maxCtxK)} (Máx.)`;
    }

    if (tokensMaxLabel) {
        tokensMaxLabel.textContent = `Muy Larga (${window.formatKTokens(maxPredictK)})`;
    }

    if (modelBadge) {
        const isCloud = String(modelId).startsWith('API:') || String(modelId).startsWith('Cloud:');
        modelBadge.textContent = `${window.formatKTokens(maxCtxK)} (${isCloud ? 'Cloud API' : 'Nativo'})`;
    }
};

window.selectModelPresetPro = function (element, preset) {
    document.querySelectorAll('.preset-card-pro').forEach(card => card.classList.remove('active'));
    if (element) element.classList.add('active');

    const ctxSlider = document.getElementById('model-settings-ctx');
    const predictSlider = document.getElementById('model-settings-predict');
    const tempSlider = document.getElementById('model-settings-temp');

    const maxCtx = parseInt(ctxSlider?.max) || 2048;
    const maxPredict = parseInt(predictSlider?.max) || 128;

    if (preset === 'fast') {
        if (ctxSlider) ctxSlider.value = Math.max(4, Math.round(maxCtx * 0.25));
        if (predictSlider) predictSlider.value = Math.max(2, Math.round(maxPredict * 0.25));
        if (tempSlider) tempSlider.value = 0.7;
    } else if (preset === 'coding') {
        if (ctxSlider) ctxSlider.value = maxCtx;
        if (predictSlider) predictSlider.value = maxPredict;
        if (tempSlider) tempSlider.value = 0.7;
    } else { // balanced
        if (ctxSlider) ctxSlider.value = Math.max(8, Math.round(maxCtx * 0.50));
        if (predictSlider) predictSlider.value = Math.max(4, Math.round(maxPredict * 0.50));
        if (tempSlider) tempSlider.value = 0.7;
    }

    if (ctxSlider) window.updateMemorySlider(ctxSlider);
    if (predictSlider) window.updateTokensSlider(predictSlider);
    if (tempSlider) window.updateCreativitySlider(tempSlider);
};

window.toggleAdvancedModelSettings = function (element) {
    element.classList.toggle('open');
    const panel = document.getElementById('advanced-model-panel');
    if (panel) panel.classList.toggle('open');
};

window.updateMemorySlider = function (input) {
    const valEl = document.getElementById('memoryValue');
    if (valEl) valEl.textContent = window.formatKTokens(input.value);
    window.checkPresetMatch();
};

window.updateTokensSlider = function (input) {
    const valEl = document.getElementById('tokensValue');
    if (valEl) valEl.textContent = window.formatKTokens(input.value);
    window.checkPresetMatch();
};

window.updateCreativitySlider = function (input) {
    const valEl = document.getElementById('creativityValue');
    if (valEl) valEl.textContent = parseFloat(input.value).toFixed(2);
    window.checkPresetMatch();
};

window.checkPresetMatch = function () {
    const ctxSlider = document.getElementById('model-settings-ctx');
    const predictSlider = document.getElementById('model-settings-predict');

    const ctx = parseInt(ctxSlider?.value || '0');
    const predict = parseInt(predictSlider?.value || '0');

    const maxCtx = parseInt(ctxSlider?.max) || 2048;
    const maxPredict = parseInt(predictSlider?.max) || 128;

    const fastCtx = Math.max(4, Math.round(maxCtx * 0.25));
    const fastPredict = Math.max(2, Math.round(maxPredict * 0.25));

    const balancedCtx = Math.max(8, Math.round(maxCtx * 0.50));
    const balancedPredict = Math.max(4, Math.round(maxPredict * 0.50));

    const codingCtx = maxCtx;
    const codingPredict = maxPredict;

    document.querySelectorAll('.preset-card-pro').forEach(c => c.classList.remove('active'));

    if (ctx === fastCtx && predict === fastPredict) {
        document.getElementById('preset-fast')?.classList.add('active');
    } else if (ctx === balancedCtx && predict === balancedPredict) {
        document.getElementById('preset-balanced')?.classList.add('active');
    } else if (ctx === codingCtx && predict === codingPredict) {
        document.getElementById('preset-coding')?.classList.add('active');
    }
};

let _selectedProvider = null;

function _escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _escapeQuotes(str) {
    return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const _KNOWN_PROVIDERS_META = {
    ollama: {
        name: 'Local (Ollama)',
        desc: 'Modelos ejecutados en tu servidor local de forma privada',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`
    },
    openrouter: {
        name: 'OpenRouter',
        desc: 'Catálogo unificado multi-proveedor (Claude, Llama, Mistral, GPT)',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 8.5 2 15.5 12 22 22 15.5 22 8.5 12 2"></polygon><line x1="12" y1="22" x2="12" y2="15.5"></line><polyline points="22 8.5 12 15.5 2 8.5"></polyline><polyline points="2 15.5 12 8.5 22 15.5"></polyline><line x1="12" y1="2" x2="12" y2="8.5"></line></svg>`
    },
    google: {
        name: 'Google AI (Gemini)',
        desc: 'Gemini 2.5 Flash, 2.5 Pro, Flash Lite, Pro y multimodales',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C11.99 7.52 7.52 11.99 2 11.99C7.52 11.99 11.99 16.46 11.99 22C11.99 16.46 16.46 11.99 22 11.99C16.46 11.99 11.99 7.52 11.99 2Z"/></svg>`
    },
    openai: {
        name: 'OpenAI',
        desc: 'Modelos GPT-4o, GPT-4 Turbo, GPT-3.5 y o1',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.37a5.98 5.98 0 0 0-.52-4.94A6.08 6.08 0 0 0 16.5 1.5a6.05 6.05 0 0 0-4.5 2A6.07 6.07 0 0 0 4.3 5.3a6.04 6.04 0 0 0-2.58 4.26 6.08 6.08 0 0 0 1.08 5.38 6.08 6.08 0 0 0 .52 4.94 6.08 6.08 0 0 0 5.26 2.93c.36 0 .72-.03 1.07-.1a6.05 6.05 0 0 0 4.5 2 6.07 6.07 0 0 0 4.5-2.06 6.04 6.04 0 0 0 2.58-4.26 6.08 6.08 0 0 0-1.08-5.38zM12 13.78a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z"/></svg>`
    },
    anthropic: {
        name: 'Anthropic (Claude)',
        desc: 'Claude 3.5 Sonnet, Claude 3 Opus, Haiku',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2h-3l-.5 6.5-5-4.2-2 2.3 5.7 3.3L2 11v3l6.7 1.1-5.7 3.3 2 2.3 5-4.2.5 6.5h3l.5-6.5 5 4.2 2-2.3-5.7-3.3L22 14v-3l-6.7-1.1 5.7-3.3-2-2.3-5 4.2-.5-6.5z"/></svg>`
    },
    deepseek: {
        name: 'DeepSeek',
        desc: 'DeepSeek V3, DeepSeek R1 de razonamiento avanzado',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 12a4 4 0 0 1 8 0c0 2.5-2 4.5-4 6"></path><circle cx="12" cy="9" r="1" fill="currentColor"></circle></svg>`
    },
    mistral: {
        name: 'Mistral AI',
        desc: 'Mistral Large, Codestral, Pixtral y Mixtral',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`
    },
    groq: {
        name: 'Groq (LPU)',
        desc: 'Inferencia ultra-rápida de modelos de alta velocidad',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`
    },
    cohere: {
        name: 'Cohere',
        desc: 'Command R+, Command R y modelos enterprise',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M10 9a3 3 0 0 1 4 0v6a3 3 0 0 1-4 0"></path></svg>`
    },
    perplexity: {
        name: 'Perplexity AI',
        desc: 'Modelos de búsqueda y conocimiento en tiempo real',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><path d="M11 8v6M8 11h6"></path></svg>`
    },
    xai: {
        name: 'xAI (Grok)',
        desc: 'Grok 2 y Grok 2 Vision',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l16 16M4 20L20 4"></path></svg>`
    },
    together: {
        name: 'Together AI',
        desc: 'Inferencia cloud de código abierto',
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`
    }
};

function _getModelProviderKey(m) {
    if (!m) return 'ollama';
    const prov = ((m.provider) || '').toLowerCase().trim();
    if (prov && prov !== 'api') return prov;
    const name = (typeof m === 'string' ? m : m.name || '').toLowerCase().trim();
    if (name.startsWith('api:')) {
        const afterApi = name.slice(4).trim();
        const colonIdx = afterApi.indexOf(':');
        if (colonIdx !== -1) {
            return afterApi.slice(0, colonIdx).trim().toLowerCase();
        }
        return afterApi.split('/')[0].trim().toLowerCase() || 'custom';
    }
    return 'ollama';
}

function _getProviderMeta(key, count) {
    const k = (key || '').toLowerCase();
    if (_KNOWN_PROVIDERS_META[k]) {
        return { id: k, ..._KNOWN_PROVIDERS_META[k] };
    }
    const formattedName = k.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
        id: k,
        name: formattedName,
        desc: `Modelos configurados vía API (${formattedName})`,
        iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>`
    };
}

function getAvailableProviders(models) {
    const currentModel = (document.getElementById('model-select') || {}).value || '';
    const providerGroups = {};
    let countFree = 0;
    let activeProvId = null;

    models.forEach(m => {
        const provKey = _getModelProviderKey(m);
        const isFree = !!(m && m.is_external && m.pricing && parseFloat(m.pricing.prompt) === 0);
        if (isFree) countFree++;

        if (!providerGroups[provKey]) {
            providerGroups[provKey] = {
                id: provKey,
                count: 0
            };
        }
        providerGroups[provKey].count++;

        const isActive = String(typeof m === 'string' ? m : m.name) === String(currentModel);
        if (isActive) {
            activeProvId = provKey;
        }
    });

    const sortPriority = ['ollama', 'openrouter', 'google', 'openai', 'anthropic', 'deepseek', 'mistral', 'groq', 'cohere', 'perplexity', 'xai', 'together'];

    const sortedKeys = Object.keys(providerGroups).sort((a, b) => {
        const idxA = sortPriority.indexOf(a);
        const idxB = sortPriority.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    const list = [];
    sortedKeys.forEach(key => {
        const grp = providerGroups[key];
        const meta = _getProviderMeta(key, grp.count);
        list.push({
            ...meta,
            count: grp.count,
            category: key === 'ollama' ? 'local' : 'cloud'
        });
    });

    if (countFree > 0) {
        list.push({
            id: 'free',
            name: 'Cloud Gratuitos',
            desc: 'Modelos de API sin coste por prompt ($0.00)',
            count: countFree,
            category: 'special',
            iconSvg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"></path></svg>`
        });
    }

    return { providers: list, activeProvId };
}

export async function openModelSelectorModal() {
    _selectedProvider = null;
    const searchInput = document.getElementById('model-picker-search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = 'Buscar cualquier modelo o proveedor (ej. flash, llama)...';
    }
    const clearBtn = document.getElementById('model-picker-clear-search');
    if (clearBtn) clearBtn.style.display = 'none';

    renderModelSelectorList();

    const modal = document.getElementById('model-selector-modal');
    if (modal) {
        modal.classList.add('show');
        setTimeout(() => {
            if (searchInput && !isMobileDevice()) searchInput.focus();
            const activeCard = document.querySelector('.provider-picker-card.active-provider') || document.querySelector('.model-picker-card.active');
            if (activeCard) {
                activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                activeCard.classList.add('highlighted');
            }
        }, 80);
    }

    // Auto-refresh models from backend if list is short or empty
    if (!(window.aiModelList || []).length || (window.aiModelList || []).length < 20) {
        try {
            const fresh = await (window.fetchModels ? window.fetchModels() : []);
            if (fresh && fresh.length) {
                window.aiModelList = fresh;
                renderModelSelectorList();
            }
        } catch (e) {}
    }
}

export function closeModelSelectorModal(e) {
    if (e && e.target !== document.getElementById('model-selector-modal')) return;
    const modal = document.getElementById('model-selector-modal');
    if (modal) modal.classList.remove('show');
}

export function selectProvider(provId) {
    _selectedProvider = provId;
    const searchInput = document.getElementById('model-picker-search-input');
    if (searchInput) {
        searchInput.value = '';
        const provMeta = getAvailableProviders(window.aiModelList || []).providers.find(p => p.id === provId);
        searchInput.placeholder = `Buscar en ${provMeta ? provMeta.name : provId}...`;
        if (!isMobileDevice()) searchInput.focus();
    }
    const clearBtn = document.getElementById('model-picker-clear-search');
    if (clearBtn) clearBtn.style.display = 'none';

    renderModelSelectorList();
}

export function backToProviders() {
    _selectedProvider = null;
    const searchInput = document.getElementById('model-picker-search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = 'Buscar cualquier modelo o proveedor (ej. flash, llama)...';
        if (!isMobileDevice()) searchInput.focus();
    }
    const clearBtn = document.getElementById('model-picker-clear-search');
    if (clearBtn) clearBtn.style.display = 'none';

    renderModelSelectorList();
}

export function filterModelSelectorList() {
    const searchInput = document.getElementById('model-picker-search-input');
    const clearBtn = document.getElementById('model-picker-clear-search');
    const val = searchInput ? searchInput.value.trim() : '';
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
    renderModelSelectorList();
}

export function clearModelSelectorSearch() {
    const searchInput = document.getElementById('model-picker-search-input');
    if (searchInput) {
        searchInput.value = '';
        if (!isMobileDevice()) searchInput.focus();
    }
    const clearBtn = document.getElementById('model-picker-clear-search');
    if (clearBtn) clearBtn.style.display = 'none';
    renderModelSelectorList();
}

export function selectAndApplyModel(modelName) {
    if (!modelName) return;
    if (window.selectMainModel) {
        window.selectMainModel(modelName, modelName);
    }
    if (window.selectWorkspaceModel) {
        window.selectWorkspaceModel(modelName, modelName);
    }
    if (window.widgetSelectModel) {
        window.widgetSelectModel(modelName);
    }

    if (window.showToast) {
        const disp = modelDisplayName(modelName);
        window.showToast(`Modelo activado: ${disp}`, 'success');
    }

    closeModelSelectorModal();
}

export function navigateModelPickerHighlight(delta) {
    const cards = Array.from(document.querySelectorAll('.provider-picker-card, .model-picker-card'));
    if (!cards.length) return;

    let currentIndex = cards.findIndex(c => c.classList.contains('highlighted'));
    if (currentIndex === -1) {
        currentIndex = cards.findIndex(c => c.classList.contains('active') || c.classList.contains('active-provider'));
    }

    let nextIndex = currentIndex + delta;
    if (nextIndex < 0) nextIndex = cards.length - 1;
    if (nextIndex >= cards.length) nextIndex = 0;

    cards.forEach((c, idx) => {
        c.classList.toggle('highlighted', idx === nextIndex);
    });

    if (cards[nextIndex]) {
        cards[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

export function renderModelSelectorList() {
    const listEl = document.getElementById('model-picker-list');
    const titleEl = document.getElementById('model-picker-title');
    const countEl = document.getElementById('model-picker-count');
    const backBtn = document.getElementById('model-picker-back-btn');
    if (!listEl) return;

    const models = window.aiModelList || [];
    const currentInput = document.getElementById('model-select');
    const currentModel = currentInput ? currentInput.value : '';

    const searchInput = document.getElementById('model-picker-search-input');
    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

    const { providers, activeProvId } = getAvailableProviders(models);
    const MAX_RENDER_ITEMS = 120;

    // MODO 1: BÚSQUEDA ACTIVA (Filtra modelos o proveedores en tiempo real)
    if (query) {
        if (backBtn) backBtn.style.display = _selectedProvider ? 'inline-flex' : 'none';
        if (titleEl) titleEl.textContent = _selectedProvider ? 'Resultados' : 'Búsqueda Global';

        const filtered = models.filter(m => {
            const name = (typeof m === 'string' ? m : m.name || '').toLowerCase();
            const provInfo = getProviderInfo(m);
            const provLabel = (provInfo && provInfo.label ? provInfo.label : '').toLowerCase();
            const isFree = !!(m && m.is_external && m.pricing && parseFloat(m.pricing.prompt) === 0);

            // Si hay un proveedor seleccionado previamente, limitar la búsqueda a ese proveedor
            if (_selectedProvider) {
                const provKey = _getModelProviderKey(m);
                if (_selectedProvider === 'free') {
                    if (!isFree) return false;
                } else if (provKey !== _selectedProvider.toLowerCase()) {
                    return false;
                }
            }

            const dispName = modelDisplayName(m).toLowerCase();
            const desc = (m.description || (m.details && m.details.family) || '').toLowerCase();
            return name.includes(query) || dispName.includes(query) || provLabel.includes(query) || desc.includes(query) || (isFree && (query === 'gratis' || query === 'free'));
        });

        if (countEl) {
            countEl.textContent = `${filtered.length} coincidencias`;
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `
                <div class="model-picker-empty">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <h4>No se encontraron modelos</h4>
                    <p>No hay resultados para "<strong>${_escapeHtml(query)}</strong>"</p>
                    <div class="model-picker-empty-actions">
                        <button type="button" class="model-picker-btn" onclick="clearModelSelectorSearch()">Limpiar búsqueda</button>
                    </div>
                </div>
            `;
            return;
        }

        const renderSlice = filtered.slice(0, MAX_RENDER_ITEMS);
        let html = '';
        renderSlice.forEach((m) => {
            html += _renderModelRow(m, currentModel);
        });

        if (filtered.length > MAX_RENDER_ITEMS) {
            html += `
                <div class="model-picker-more-notice">
                    Mostrando los primeros ${MAX_RENDER_ITEMS} de ${filtered.length} modelos. Escribe para afinar.
                </div>
            `;
        }

        listEl.innerHTML = html;
        return;
    }

    // MODO 2: PASO 1 - SELECCIÓN DE PROVEEDOR
    if (!_selectedProvider) {
        if (backBtn) backBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Proveedores de IA';
        if (countEl) countEl.textContent = `${providers.length} proveedores • ${models.length} modelos`;

        if (providers.length === 0) {
            listEl.innerHTML = `
                <div class="model-picker-empty">
                    <h4>No hay modelos disponibles</h4>
                    <p>No se han encontrado modelos locales ni proveedores de API configurados.</p>
                </div>
            `;
            return;
        }

        let html = '';
        let lastCategory = '';
        const showCategories = providers.length >= 5;

        providers.forEach((p, idx) => {
            const hasActive = activeProvId === p.id;
            
            if (showCategories && p.category && p.category !== lastCategory) {
                lastCategory = p.category;
                const catTitle = p.category === 'local' ? 'Servidor Local' : (p.category === 'special' ? 'Especiales' : 'Proveedores Cloud / APIs');
                html += `<div class="provider-section-header">${catTitle}</div>`;
            }

            html += `
                <div class="provider-picker-card ${hasActive ? 'active-provider' : ''} ${idx === 0 && !hasActive ? 'highlighted' : ''}" data-provider="${p.id}" onclick="selectProvider('${p.id}')" title="${_escapeHtml(p.name)}: ${_escapeHtml(p.desc)}">
                    <div class="provider-card-icon">
                        ${p.iconSvg}
                    </div>
                    <div class="provider-card-info">
                        <div class="provider-card-title-row">
                            <span class="provider-card-name">${p.name}</span>
                            <span class="provider-card-badge">${p.count} ${p.count === 1 ? 'modelo' : 'modelos'}</span>
                            ${hasActive ? '<span class="provider-active-pill">Activo</span>' : ''}
                        </div>
                        <span class="provider-card-desc">${p.desc}</span>
                    </div>
                    <div class="provider-card-arrow">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                </div>
            `;
        });
        listEl.innerHTML = html;
        return;
    }

    // MODO 3: PASO 2 - MODELOS DEL PROVEEDOR SELECCIONADO
    const curProv = providers.find(p => p.id === _selectedProvider);
    if (backBtn) backBtn.style.display = 'inline-flex';
    if (titleEl) titleEl.textContent = curProv ? curProv.name : 'Modelos';

    const filtered = models.filter(m => {
        const isFree = !!(m && m.is_external && m.pricing && parseFloat(m.pricing.prompt) === 0);
        if (_selectedProvider === 'free') return isFree;
        const provKey = _getModelProviderKey(m);
        return provKey === _selectedProvider.toLowerCase();
    });

    if (countEl) {
        countEl.textContent = `${filtered.length} modelos`;
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="model-picker-empty">
                <h4>No hay modelos disponibles</h4>
                <p>No se encontraron modelos para este proveedor.</p>
                <div class="model-picker-empty-actions">
                    <button type="button" class="model-picker-btn secondary" onclick="backToProviders()">← Volver a proveedores</button>
                </div>
            </div>
        `;
        return;
    }

    const renderSlice = filtered.slice(0, MAX_RENDER_ITEMS);
    let html = '';
    renderSlice.forEach((m) => {
        html += _renderModelRow(m, currentModel);
    });

    if (filtered.length > MAX_RENDER_ITEMS) {
        html += `
            <div class="model-picker-more-notice">
                Mostrando los primeros ${MAX_RENDER_ITEMS} de ${filtered.length} modelos. Usa el buscador para filtrar.
            </div>
        `;
    }

    listEl.innerHTML = html;
}

function _renderModelRow(m, currentModel) {
    const mName = typeof m === 'string' ? m : m.name;
    const isActive = String(mName) === String(currentModel);
    const dispName = modelDisplayName(m);
    const provInfo = getProviderInfo(m);
    const provKey = _getModelProviderKey(m);
    const isLocal = provKey === 'ollama' && !m.is_external;
    const isFree = !isLocal && !!(m && m.pricing && parseFloat(m.pricing.prompt) === 0);

    const metaParts = [];
    const contextLen = m.context_length || (m.details && m.details.context_length);
    if (typeof contextLen === 'number' && contextLen > 0) {
        metaParts.push(contextLen >= 1000000 ? `${Math.round(contextLen / 1000000)}M ctx` : `${Math.round(contextLen / 1024)}K ctx`);
    }

    const paramSize = (m.details && m.details.parameter_size) || m.parameter_size;
    if (paramSize && typeof paramSize === 'string' && paramSize.trim() && paramSize !== 'NaN') {
        metaParts.push(paramSize.trim());
    }

    if (isLocal) {
        let sizeNum = typeof m.size === 'number' ? m.size : parseFloat(m.size);
        if (!isNaN(sizeNum) && sizeNum > 0) {
            if (sizeNum >= 1024 * 1024 * 1024) {
                metaParts.push(`${(sizeNum / 1024 / 1024 / 1024).toFixed(1)} GB`);
            } else if (sizeNum >= 1024 * 1024) {
                metaParts.push(`${Math.round(sizeNum / 1024 / 1024)} MB`);
            }
        }
    } else {
        metaParts.push('Cloud API');
    }

    // Only show provider badge in universal global search, free view, or sub-vendor for OpenRouter
    let provBadgeHtml = '';
    if (!_selectedProvider || _selectedProvider === 'free') {
        provBadgeHtml = `<span class="model-card-prov-badge">${provInfo.label}</span>`;
    } else if (_selectedProvider === 'openrouter' && provInfo.vendor) {
        provBadgeHtml = `<span class="model-card-prov-badge">${_escapeHtml(provInfo.vendor)}</span>`;
    }

    return `
        <div class="model-picker-card ${isActive ? 'active' : ''}" data-model="${_escapeQuotes(mName)}" onclick="selectAndApplyModel('${_escapeQuotes(mName)}')" title="${_escapeHtml(dispName)} (${metaParts.join(' • ')})">
            <div class="model-card-main">
                <div class="model-card-top">
                    <span class="model-card-name">${_escapeHtml(dispName)}</span>
                    ${isActive ? '<span class="model-active-pill">Activo</span>' : ''}
                    ${provBadgeHtml}
                    ${isFree ? '<span class="model-card-free-badge">Gratis</span>' : ''}
                </div>
                ${metaParts.length ? `<div class="model-card-meta">${_escapeHtml(metaParts.join(' • '))}</div>` : ''}
            </div>
            <div class="model-card-right">
                ${isActive ? '<div class="model-active-check" title="Modelo activo en uso"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' : ''}
            </div>
        </div>
    `;
}

// Global Keyboard Listener for Model Selector Usability
if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('model-selector-modal');
        const isModalOpen = modal && modal.classList.contains('show');

        // Shortcut: Alt+M to toggle model selector anywhere
        if ((e.altKey || (e.ctrlKey && e.shiftKey)) && (e.key === 'm' || e.key === 'M')) {
            e.preventDefault();
            if (isModalOpen) closeModelSelectorModal();
            else openModelSelectorModal();
            return;
        }

        if (isModalOpen) {
            const searchInput = document.getElementById('model-picker-search-input');
            if (e.key === 'Escape') {
                e.preventDefault();
                if (_selectedProvider) {
                    backToProviders();
                } else {
                    closeModelSelectorModal();
                }
                return;
            }
            if (e.key === 'Backspace' && _selectedProvider && searchInput && searchInput.value === '') {
                e.preventDefault();
                backToProviders();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                navigateModelPickerHighlight(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                navigateModelPickerHighlight(-1);
                return;
            }
            if (e.key === 'Enter') {
                const highlightedProv = document.querySelector('.provider-picker-card.highlighted') ||
                                        document.querySelector('.provider-picker-card.active-provider') ||
                                        document.querySelector('.provider-picker-card');
                if (highlightedProv && highlightedProv.getAttribute('data-provider') && !_selectedProvider) {
                    e.preventDefault();
                    selectProvider(highlightedProv.getAttribute('data-provider'));
                    return;
                }

                const highlightedModel = document.querySelector('.model-picker-card.highlighted') ||
                                         document.querySelector('.model-picker-card.active') ||
                                         document.querySelector('.model-picker-card');
                if (highlightedModel && highlightedModel.getAttribute('data-model')) {
                    e.preventDefault();
                    selectAndApplyModel(highlightedModel.getAttribute('data-model'));
                }
                return;
            }
        }
    });
}
window.clearModelSelectorSearch = clearModelSelectorSearch;
window.selectProvider = selectProvider;
window.backToProviders = backToProviders;
window.filterModelSelectorList = filterModelSelectorList;
window.selectAndApplyModel = selectAndApplyModel;
window.renderModelSelectorList = renderModelSelectorList;

export async function openModelSettingsDialog() {
    // Modelos bajo demanda: si la lista aún no se ha cargado, obtenerla
    // antes de mostrar el diálogo (una única carga por apertura).
    if (window.ensureModelsLoaded && !(window.aiModelList || []).length && !window._modelLoadQueued) {
        window._modelLoadQueued = true;
        try { await window.ensureModelsLoaded(); } finally { window._modelLoadQueued = false; }
    }
    const rawCtx = Math.round(parseInt(localStorage.getItem('model_num_ctx') || '16384') / 1024);
    const rawPredict = Math.round(parseInt(localStorage.getItem('model_num_predict') || '8192') / 1024);
    const temp = localStorage.getItem('model_temperature') || '0.7';

    const currentModelInput = document.getElementById('model-select');
    const rawVal = (currentModelInput && currentModelInput.value) || '';
    // Sin modelos cargados: el diálogo no debe inventar un modelo activo
    // (antes mostraba "Ollama / Local", que no es ningún modelo).
    const hasModel = !!(window.aiModelList && window.aiModelList.length > 0) && !!rawVal && rawVal !== 'loading';
    const currentVal = hasModel ? rawVal : '';

    const activeNameEl = document.getElementById('modal-active-model-name');
    if (activeNameEl) {
        if (!hasModel) {
            activeNameEl.textContent = 'Sin modelos instalados';
        } else {
            let clean = currentVal.replace(/^API:\s*openrouter\s*:\s*/i, 'Cloud: ');
            if (!clean.startsWith('Cloud: ') && !clean.startsWith('Local: ')) {
                clean = currentVal.startsWith('API:') ? clean : `Local: ${clean}`;
            }
            activeNameEl.textContent = clean;
        }
    }

    const helpBox = document.getElementById('no-models-help-box');
    if (helpBox) helpBox.style.display = hasModel ? 'none' : 'flex';
    const capabilityBadge = document.getElementById('model-capability-badge');
    if (capabilityBadge && !hasModel) capabilityBadge.textContent = '-';

    if (hasModel) window.onModelSelectionChanged(currentVal);

    const ctxSlider = document.getElementById('model-settings-ctx');
    if (ctxSlider) {
        ctxSlider.value = Math.max(4, Math.min(parseInt(ctxSlider.max) || 2048, rawCtx));
        const memoryValEl = document.getElementById('memoryValue');
        if (memoryValEl) memoryValEl.textContent = window.formatKTokens(ctxSlider.value);
    }

    const predictSlider = document.getElementById('model-settings-predict');
    if (predictSlider) {
        predictSlider.value = Math.max(2, Math.min(parseInt(predictSlider.max) || 128, rawPredict));
        const tokensValEl = document.getElementById('tokensValue');
        if (tokensValEl) tokensValEl.textContent = window.formatKTokens(predictSlider.value);
    }

    const tempSlider = document.getElementById('model-settings-temp');
    if (tempSlider) {
        tempSlider.value = temp;
        const creativityValEl = document.getElementById('creativityValue');
        if (creativityValEl) creativityValEl.textContent = parseFloat(tempSlider.value).toFixed(2);
    }

    window.checkPresetMatch();
    document.getElementById('model-settings-dialog').classList.add('show');
}

export function closeModelSettingsDialog(e) {
    if (e && e.target !== document.getElementById('model-settings-dialog')) return;
    document.getElementById('model-settings-dialog').classList.remove('show');
}

export function saveModelSettings() {
    const ctxK = parseInt(document.getElementById('model-settings-ctx').value) || 16;
    const predictK = parseInt(document.getElementById('model-settings-predict').value) || 8;
    const temp = parseFloat(document.getElementById('model-settings-temp').value) || 0.7;

    const ctxBytes = ctxK * 1024;
    const predictBytes = predictK * 1024;

    localStorage.setItem('model_num_ctx', ctxBytes);
    localStorage.setItem('model_num_predict', predictBytes);
    localStorage.setItem('model_temperature', temp);

    if (window.showToast) showToast(`✓ Ajustes guardados (${ctxK}K memoria, ${predictK}K respuesta)`);
    document.getElementById('model-settings-dialog').classList.remove('show');
}

export function toggleApiKeyVisibility() {
    const input = document.getElementById('api-keys-key');
    const icon = document.getElementById('eye-icon');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
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
    } catch (e) { }
}

window.handleModelPullProgress = handleModelPullProgress;
