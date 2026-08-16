// Widget flotante "Nexus AI" del Dashboard: chat con el agente local (Ollama)
// vía /api/ai/chat (streaming SSE, líneas JSON). Autocontenido, sin
// dependencias: solo un botón flotante + panel + consumo del stream.

import { addCodeCopyButtons } from './chat.js';
import { initSlashCommands, isModelPickerOpen } from './slash_commands.js';

const WIDGET_T = (es, en) => (window.currentLang === 'en' ? en : es);

const WIDGET_ICONS = {
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
};
// Modo Agenda / Normal (compartido con el chat: localStorage ai_chat_mode).
// Declarado al inicio del módulo: initAIWidget y widgetUpdateModeBtn se
// ejecutan en la carga diferida y requieren estas variables ya inicializadas.
let widgetChatMode = (localStorage.getItem('ai_chat_mode') || 'agenda');
let widgetReasoningMode = (localStorage.getItem('ai_reasoning_mode') === 'true');
const WIDGET_MODE_AGENDA_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"></rect><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="13" y2="14"></line></svg>';
const WIDGET_MODE_CHAT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"></path></svg>';

function wEsc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function widgetRenderMD(text) {
    const src = String(text ?? '');
    if (typeof marked === 'undefined' || !marked.parse) {
        return wEsc(src).replace(/\n/g, '<br>');
    }
    return marked.parse(src);
}

function widgetHighlight(bubble) {
    if (window.hljs && bubble) {
        bubble.querySelectorAll('pre code').forEach((b) => {
            try { hljs.highlightElement(b); } catch (e) { /* lenguaje desconocido */ }
        });
    }
}

function widgetMaybeCollapse(bubble, text) {
    const src = String(text ?? '');
    const isLong = src.length > 500 || (src.match(/\n/g) || []).length > 10;
    if (!isLong || !bubble || !bubble.parentNode) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-read-more';
    btn.textContent = WIDGET_T('Ver más', 'See more');
    btn.addEventListener('click', () => {
        const collapsed = bubble.classList.toggle('msg-text-collapsed');
        btn.textContent = collapsed
            ? WIDGET_T('Ver más', 'See more')
            : WIDGET_T('Ver menos', 'See less');
    });
    bubble.classList.add('msg-text-collapsed');
    bubble.parentNode.appendChild(btn);
}

let widgetOpen = false;
let widgetStreaming = false;
let widgetCancelled = false;
let widgetReader = null;
let widgetMessages = [];
let widgetAlertEl = null;
let widgetSessionId = null;
let widgetModels = [];
let widgetModel = null;
let widgetModelsLoaded = false;
let widgetModelRetries = 0;
let widgetHbTimer = null;
let widgetSessions = [];

function widgetToast(message, type = 'info') {
    // En la página del panel IA existe window.showToast; en el dashboard
    // (donde vive el widget) no: usar un toast propio dentro del modal.
    if (window.showToast) { window.showToast(message, type); return; }
    const modal = widgetEl('ai-widget-modal');
    if (!modal) return;
    let toast = modal.querySelector('.widget-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'widget-toast';
        toast.style.cssText = [
            'position:absolute;top:56px;left:50%;transform:translateX(-50%);z-index:30;',
            'background:rgba(28,30,45,0.96);color:#fff;padding:8px 14px;border-radius:10px;',
            'font-size:12.5px;box-shadow:0 4px 16px rgba(0,0,0,0.4);',
            'border:1px solid rgba(255,255,255,0.09);max-width:82%;text-align:center;',
            'pointer-events:none;transition:opacity .25s ease;white-space:normal;'
        ].join('');
        modal.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

function widgetEl(id) {
    return document.getElementById(id);
}

function timeNow() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function widgetShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return sameDay ? hm : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

async function widgetLoadSessions() {
    const list = widgetEl('ai-widget-history-list');
    if (!list) return;
    try {
        const res = await fetch('/api/ai/sessions');
        widgetSessions = res.ok ? await res.json() : [];
    } catch (e) {
        widgetSessions = [];
    }
    list.innerHTML = '';
    if (!widgetSessions.length) {
        const empty = document.createElement('div');
        empty.className = 'chat-history-empty';
        empty.textContent = WIDGET_T('Aún no hay conversaciones guardadas.', 'No saved conversations yet.');
        list.appendChild(empty);
        return;
    }
    for (const s of widgetSessions) {
        const item = document.createElement('div');
        item.className = 'chat-history-item'
            + (widgetSessionId && String(s.id) === String(widgetSessionId) ? ' active' : '');
        const t = document.createElement('div');
        t.className = 'hist-title';
        t.textContent = s.title || 'New Chat';
        const d = document.createElement('div');
        d.className = 'hist-date';
        d.textContent = widgetShortDate(s.updated_at || s.created_at);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'hist-delete';
        del.title = WIDGET_T('Eliminar conversación', 'Delete conversation');
        del.setAttribute('aria-label', del.title);
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            widgetDeleteSession(s.id);
        });
        item.appendChild(t);
        item.appendChild(d);
        item.appendChild(del);
        item.addEventListener('click', () => widgetOpenSession(s.id));
        list.appendChild(item);
    }
}

async function widgetDeleteSession(sessionId) {
    if (widgetStreaming) return;
    const doDelete = await widgetConfirm({
        title: WIDGET_T('Eliminar conversación', 'Delete conversation'),
        message: WIDGET_T(
            '¿Seguro que quieres eliminar esta conversación? Esta acción no se puede deshacer.',
            'Delete this conversation? This action cannot be undone.'
        ),
        confirmLabel: WIDGET_T('Eliminar', 'Delete'),
        cancelLabel: WIDGET_T('Cancelar', 'Cancel'),
        danger: true,
    });
    if (!doDelete) return;
    try {
        await fetch('/api/ai/sessions/' + encodeURIComponent(sessionId), {
            method: 'DELETE',
            headers: { 'X-Token': window.TOKEN || '' },
        });
    } catch (e) {
        console.error('[AI Widget] Error al borrar sesión:', e);
    }
    widgetSessions = widgetSessions.filter((s) => String(s.id) !== String(sessionId));
    if (widgetSessionId && String(widgetSessionId) === String(sessionId)) {
        widgetSessionId = null;
        widgetMessages = [];
        const box = widgetEl('ai-widget-messages');
        if (box) box.innerHTML = '';
        widgetWelcome();
    }
    widgetLoadSessions();
}

function widgetConfirm(opts) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'widget-confirm-overlay';
        overlay.innerHTML = '' +
            '<div class="widget-confirm" role="alertdialog" aria-modal="true">' +
            '<div class="widget-confirm-title">' + wEsc(opts.title || '') + '</div>' +
            '<div class="widget-confirm-msg">' + wEsc(opts.message || '') + '</div>' +
            '<div class="widget-confirm-actions">' +
            '<button type="button" class="widget-confirm-btn ghost" data-act="cancel">' + wEsc(opts.cancelLabel || 'Cancelar') + '</button>' +
            '<button type="button" class="widget-confirm-btn' + (opts.danger ? ' danger' : ' primary') + '" data-act="ok">' + wEsc(opts.confirmLabel || 'Aceptar') + '</button>' +
            '</div></div>';
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        overlay.querySelector('[data-act="ok"]').addEventListener('click', (e) => { e.stopPropagation(); close(true); });
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', (e) => { e.stopPropagation(); close(false); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        const onKey = (e) => { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
        const okBtn = overlay.querySelector('[data-act="ok"]');
        if (okBtn) okBtn.focus();
    });
}

async function widgetOpenSession(sessionId) {
    const box = widgetEl('ai-widget-messages');
    widgetCloseHistory();
    // No se puede cambiar de conversación mientras se genera una respuesta:
    // la respuesta en curso se perdería visualmente (los chunks van al DOM
    // de la sesión anterior).
    if (widgetStreaming) {
        const msg = WIDGET_T(
            'Espera a que termine la respuesta antes de cambiar de conversación.',
            'Wait for the response to finish before switching conversations.'
        );
        widgetToast(msg, 'info');
        return false;
    }
    try {
        const res = await fetch('/api/ai/sessions/' + encodeURIComponent(sessionId) + '/messages');
        if (!res.ok) return false;
        const msgs = await res.json();
        widgetSessionId = sessionId;
        localStorage.setItem('ai_widget_session', sessionId);
        widgetUnreadClear(sessionId);
        widgetMessages = msgs
            .map((m) => ({ role: m.role, content: m.content, created_at: m.created_at, model: m.model }))
            .filter((m) => m.role === 'user' || m.role === 'assistant');
        const s = widgetSessions.find((x) => String(x.id) === String(sessionId));
        // El modelo real de la sesión (último usado) manda sobre el preferido:
        // si la lista de modelos aún no está cargada se confía en él; si ya
        // está cargada, solo se aplica si sigue existiendo.
        if (s && s.model && (!widgetModels.length || widgetModels.some((m) => m.name === s.model))) {
            widgetModel = s.model;
        }
        widgetUpdateModelChip();
        if (box) box.innerHTML = '';
        for (let i = 0; i < widgetMessages.length; i++) {
            appendWidgetMessage(widgetMessages[i].role, widgetMessages[i].content, i, widgetMessages[i].created_at);
        }
        if (box) box.scrollTop = box.scrollHeight;
        const input = widgetEl('ai-widget-input');
        if (input) input.focus();
        widgetLoadSessions();
        return true;
    } catch (e) {
        return false;
    }
}

async function widgetAutoResume() {
    if (widgetStreaming) return;
    try {
        const res = await fetch('/api/ai/sessions');
        if (!res.ok) return;
        const sessions = await res.json();
        if (!sessions.length) return;
        widgetSessions = sessions;
        // Restaurar la conversación que estaba abierta antes de recargar
        const saved = localStorage.getItem('ai_widget_session');
        const target = (saved && sessions.some((s) => String(s.id) === String(saved)))
            ? saved
            : (widgetSessionId || (sessions[0] && sessions[0].id));
        await widgetOpenSession(target);
    } catch (e) { /* sin red: se mantiene el mensaje de bienvenida */ }
}

/* ─── Generación en segundo plano ────────────────────────────────────────
   Si se cerró sesión o el widget con un mensaje en cola sin cancelar, el
   servidor completa la respuesta en segundo plano (respetando la cola) y la
   guarda en la sesión. Aquí se detecta y se recarga cuando termina. ─── */
let widgetPollTimer = null;
let widgetPollingSession = null;
let widgetTypingEl = null;

function widgetStopPolling() {
    if (widgetPollTimer) { clearInterval(widgetPollTimer); widgetPollTimer = null; }
    widgetPollingSession = null;
    if (widgetTypingEl) {
        if (widgetTypingEl.parentNode) widgetTypingEl.parentNode.removeChild(widgetTypingEl);
        widgetTypingEl = null;
    }
}

async function widgetCheckActiveGeneration() {
    if (widgetStreaming || widgetPollingSession) return;
    try {
        const res = await fetch('/api/ai/generating');
        if (!res.ok) return;
        const active = (await res.json()).active || {};
        const ids = Object.keys(active);
        if (!ids.length) return;
        // Priorizar la sesión abierta; si no, la primera en generación
        const target = (widgetSessionId && active[widgetSessionId]) ? widgetSessionId : ids[0];
        widgetPollingSession = target;
        // La generación reanudada es la sesión abierta: mostrar los 3 puntos
        // de escritura hasta que termine.
        if (widgetSessionId && String(widgetSessionId) === String(target)) {
            widgetTypingEl = showWidgetTyping();
        }
        widgetPollTimer = setInterval(async () => {
            try {
                const res2 = await fetch('/api/ai/generating');
                if (!res2.ok) { widgetStopPolling(); return; }
                const active2 = (await res2.json()).active || {};
                if (!active2[widgetPollingSession] && Object.keys(active2).length === 0) {
                    const doneSession = widgetPollingSession;
                    widgetStopPolling();
                    if (widgetSessionId && String(widgetSessionId) === String(doneSession)) {
                        await widgetOpenSession(doneSession);
                    } else {
                        // La generación reanudada pertenece a otra conversación:
                        // avisar y marcar como no leída (el socket lo repite si
                        // esta página no la vio, pero aquí se cubre el caso de
                        // que el widget esté abierto y el socket no estuviera).
                        widgetNotify(doneSession, null);
                        widgetUnreadAdd(doneSession);
                        widgetLoadSessions();
                    }
                }
            } catch (e) { widgetStopPolling(); }
        }, 3000);
    } catch (e) { /* sin red */ }
}

function widgetToggleHistory() {
    const panel = widgetEl('ai-widget-history-panel');
    if (!panel) return;
    if (panel.classList.toggle('open')) {
        widgetLoadSessions();
    }
}

function widgetCloseHistory() {
    const panel = widgetEl('ai-widget-history-panel');
    if (panel) panel.classList.remove('open');
}

function widgetNewChat() {
    if (widgetStreaming) widgetCancel();
    widgetSessionId = null;
    localStorage.removeItem('ai_widget_session');
    widgetMessages = [];
    const box = widgetEl('ai-widget-messages');
    if (box) box.innerHTML = '';
    widgetCloseHistory();
    widgetWelcome();
    widgetLoadSessions();
    const input = widgetEl('ai-widget-input');
    if (input) input.focus();
}

async function loadAIModels() {
    try {
        const res = await fetch('/api/ai/models');
        const data = await res.json().catch(() => ({}));
        // Incluye los modelos externos (API: proveedor y el catálogo de
        // OpenRouter: gratuitos + entrada genérica) para poder usarlos desde
        // el widget. El selector es el comando /models en el input.
        const models = (data.models || []).filter((m) => m && m.name);
        widgetModels = models;
        widgetModelRetries = 0;
        if (models.length) {
            const preferred = models.find((m) => /qwen2\.5:3b|qwen.*3b/i.test(m.name))
                || models.find((m) => /phi|qwen|llama/i.test(m.name))
                || models[0];
            // No pisar el modelo ya elegido por el usuario (p. ej. una API):
            // solo se asigna el preferido si aún no hay modelo válido.
            if (preferred && (!widgetModel || !widgetModels.some((m) => m.name === widgetModel))) {
                widgetModel = preferred.name;
            }
            // Si ya hay una sesión abierta, su modelo real manda sobre el preferido
            const s = widgetSessions.find((x) => String(x.id) === String(widgetSessionId));
            if (s && s.model && models.some((m) => m.name === s.model)) {
                widgetModel = s.model;
            }
            widgetUpdateModelChip();
        }
    } catch (e) {
        console.error('[AI Widget] No se pudieron cargar los modelos:', e);
        // El contenedor puede estar arrancando: reintenta un par de veces
        if (widgetModelRetries < 3) {
            widgetModelRetries++;
            setTimeout(loadAIModels, 2500);
        }
    }
}

function widgetUpdateModelChip() {
    const chip = widgetEl('ai-widget-model-chip');
    if (!chip) return;
    const full = widgetModel || '';
    chip.textContent = full.startsWith('API: openrouter:')
        ? full.replace(/^API:\s*openrouter\s*:\s*/, '')
        : full || '…';
    chip.title = 'Modelo actual: ' + (full || 'sin modelo') + '. Cambia de modelo escribiendo /models en el chat';
}

function widgetSelectModel(name) {
    widgetModel = name;
    widgetUpdateModelChip();
    fetch('/api/ai/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_model: name })
    }).catch(() => { });
}

function appendWidgetMessage(role, text, index, timeIso) {
    const box = widgetEl('ai-widget-messages');
    if (!box) return null;
    const row = document.createElement('div');
    row.className = role === 'user' ? 'msg-row user' : 'msg-row';
    if (Number.isInteger(index) && index >= 0) row.dataset.idx = String(index);
    const el = document.createElement('div');
    el.className = role === 'user' ? 'msg user' : 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'msg-text';
    bubble.innerHTML = widgetRenderMD(text);
    widgetHighlight(bubble);
    el.appendChild(bubble);
    widgetMaybeCollapse(bubble, text);
    row.appendChild(el);
    if (Number.isInteger(index) && index >= 0) {
        addCodeCopyButtons(bubble);
        addWidgetActions(row, role);
    }
    const t = document.createElement('span');
    t.className = 'msg-time';
    t.textContent = timeIso ? widgetShortDate(timeIso) : timeNow();
    row.appendChild(t);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return bubble;
}

function widgetActionBtn(icon, key) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'msg-action-btn';
    b.innerHTML = icon;
    b.setAttribute('data-i18n-title', key);
    b.title = (window.t && window.t(key)) || key;
    b.setAttribute('aria-label', b.title);
    return b;
}

function widgetT(key) {
    return (window.t && window.t(key)) || key;
}

function widgetApplyLang() {
    const root = widgetEl('ai-agent-widget');
    if (!root) return;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) el.innerHTML = widgetT(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
            const txt = widgetT(key);
            el.setAttribute('title', txt);
            el.setAttribute('aria-label', txt);
        }
    });
    const box = widgetEl('ai-widget-messages');
    if (box && widgetMessages.length === 0) {
        const welcomeRow = box.querySelector('.widget-welcome');
        if (welcomeRow) {
            const el = welcomeRow.querySelector('.msg');
            if (el) {
                el.innerHTML = '';
                const bubble = document.createElement('div');
                bubble.className = 'msg-text';
                bubble.innerHTML = widgetRenderMD(widgetWelcomeText());
                widgetHighlight(bubble);
                el.appendChild(bubble);
            }
        }
    }
}

function addWidgetActions(row, role) {
    const idx = Number(row.dataset.idx);
    if (!Number.isInteger(idx) || idx < 0 || !widgetMessages[idx]) return;
    const bar = document.createElement('div');
    bar.className = 'msg-actions';

    const copyBtn = widgetActionBtn(WIDGET_ICONS.copy, 'wg_copy_msg');
    copyBtn.addEventListener('click', () => {
        const m = widgetMessages[idx];
        if (!m) return;
        navigator.clipboard.writeText(m.content).then(() => {
            copyBtn.innerHTML = WIDGET_ICONS.check;
            setTimeout(() => { copyBtn.innerHTML = WIDGET_ICONS.copy; }, 2000);
        }).catch(() => { /* portapapeles no disponible */ });
    });
    bar.appendChild(copyBtn);

    // Editar solo el último mensaje de usuario (el flujo editar→regenerar
    // solo es coherente desde el final de la conversación).
    if (role === 'user' && idx === widgetLastUserIndex()) {
        const editBtn = widgetActionBtn(WIDGET_ICONS.edit, 'wg_edit_resend');
        editBtn.setAttribute('data-action', 'edit');
        editBtn.addEventListener('click', () => widgetEditMessage(idx));
        bar.appendChild(editBtn);
    }

    const time = row.querySelector('.msg-time');
    row.insertBefore(bar, time || null);
}

function widgetLastUserIndex() {
    for (let i = widgetMessages.length - 1; i >= 0; i--) {
        if (widgetMessages[i].role === 'user') return i;
    }
    return -1;
}

function widgetRefreshEditButtons() {
    // Tras completar un stream, el último mensaje de usuario cambia: se quita
    // el lápiz de mensajes antiguos y se añade al nuevo último si falta.
    const box = widgetEl('ai-widget-messages');
    if (!box) return;
    const lastUserIdx = widgetLastUserIndex();
    box.querySelectorAll('.msg-row[data-idx]').forEach((row) => {
        const idx = Number(row.dataset.idx);
        if (!Number.isInteger(idx) || idx < 0) return;
        const bar = row.querySelector('.msg-actions');
        if (!bar) return;
        const editBtn = bar.querySelector('[data-action="edit"]');
        const role = row.classList.contains('user') ? 'user' : 'assistant';
        if (role === 'user' && idx === lastUserIdx) {
            if (!editBtn) {
                const b = widgetActionBtn(WIDGET_ICONS.edit, 'wg_edit_resend');
                b.setAttribute('data-action', 'edit');
                b.addEventListener('click', () => widgetEditMessage(idx));
                bar.insertBefore(b, bar.children[1] || null);
            }
        } else if (editBtn) {
            editBtn.remove();
        }
    });
}

function widgetEditMessage(idx) {
    if (widgetStreaming) return;
    const row = widgetEl('ai-widget-messages')?.querySelector('.msg-row[data-idx="' + idx + '"]');
    const msg = widgetMessages[idx];
    if (!row || !msg) return;
    const el = row.querySelector('.msg');
    if (!el) return;

    el.classList.add('editing');
    el.style.maxWidth = '100%';
    el.style.width = '100%';
    el.innerHTML = '';

    const ta = document.createElement('textarea');
    ta.className = 'msg-edit-input';
    ta.value = msg.content;
    ta.rows = 1;
    const autoGrow = () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    };
    ta.addEventListener('input', autoGrow);
    el.appendChild(ta);

    const btns = document.createElement('div');
    btns.className = 'msg-edit-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'msg-edit-btn ghost';
    cancelBtn.setAttribute('data-i18n', 'wg_cancel');
    cancelBtn.textContent = widgetT('wg_cancel');
    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        widgetRestoreRow(idx);
    });

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'msg-edit-btn primary';
    updateBtn.setAttribute('data-i18n', 'wg_update');
    updateBtn.textContent = widgetT('wg_update');
    updateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        widgetSubmitEdit(idx, ta.value.trim());
    });

    btns.appendChild(cancelBtn);
    btns.appendChild(updateBtn);
    el.appendChild(btns);

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autoGrow();
}

function widgetRestoreRow(idx) {
    const row = widgetEl('ai-widget-messages')?.querySelector('.msg-row[data-idx="' + idx + '"]');
    const msg = widgetMessages[idx];
    if (!row || !msg) return;
    const el = row.querySelector('.msg');
    if (!el) return;
    el.classList.remove('editing');
    el.style.maxWidth = '';
    el.style.width = '';
    el.innerHTML = '';
    const bubble = document.createElement('div');
    bubble.className = 'msg-text';
    bubble.innerHTML = widgetRenderMD(msg.content);
    widgetHighlight(bubble);
    el.appendChild(bubble);
    widgetMaybeCollapse(bubble, msg.content);
    addCodeCopyButtons(bubble);
    widgetToast(WIDGET_T('Mensaje cancelado', 'Message cancelled'), 'info');
}

async function widgetSubmitEdit(idx, newText) {
    if (!newText || widgetStreaming) return;
    widgetMessages = widgetMessages.slice(0, idx);
    widgetMessages.push({ role: 'user', content: newText, created_at: new Date().toISOString(), model: widgetModel });
    const box = widgetEl('ai-widget-messages');
    if (box) {
        box.innerHTML = '';
        for (let i = 0; i < widgetMessages.length; i++) {
            appendWidgetMessage(widgetMessages[i].role, widgetMessages[i].content, i, widgetMessages[i].created_at);
        }
    }
    widgetCloseHistory();
    await widgetStreamCore();
}

function showWidgetTyping() {
    const box = widgetEl('ai-widget-messages');
    if (!box) return null;
    const row = document.createElement('div');
    row.className = 'msg-row';
    const el = document.createElement('div');
    el.className = 'msg assistant';
    const dots = document.createElement('div');
    dots.className = 'msg-typing';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'msg-typing-dot';
        dots.appendChild(dot);
    }
    el.appendChild(dots);
    row.appendChild(el);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return row;
}

function makeStreamBubble() {
    const box = widgetEl('ai-widget-messages');
    if (!box) return null;
    const row = document.createElement('div');
    row.className = 'msg-row';
    const el = document.createElement('div');
    el.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'msg-text';
    el.appendChild(bubble);
    row.appendChild(el);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return { el, row, bubble };
}

function widgetWelcomeText() {
    return WIDGET_T(
        '¡Hola! Soy tu asistente local de Null-Void Engine. Pregúntame lo que necesites.',
        'Hi! I\'m your local Null-Void Engine assistant. Ask me anything.'
    );
}

function widgetWelcome() {
    if (widgetMessages.length === 0 && !widgetEl('ai-widget-messages').children.length) {
        appendWidgetMessage('assistant', widgetWelcomeText());
        const box = widgetEl('ai-widget-messages');
        const last = box && box.lastElementChild;
        if (last) last.classList.add('widget-welcome');
    }
}

// Notificaciones y no leídos: cuando una respuesta se completa en segundo
// plano (cierre de pestaña, sesión distinta abierta...), el backend emite
// 'ai_response_ready' a la sala del usuario. Si no se está viendo esa
// conversación, se muestra una notificación del navegador y un badge de
// no leídos en el botón flotante.
const WIDGET_UNREAD_KEY = 'ai_widget_unread';

let widgetAiSocketReady = false;

function widgetUnreadLoad() {
    try {
        return JSON.parse(localStorage.getItem(WIDGET_UNREAD_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function widgetUnreadTotal() {
    return Object.values(widgetUnreadLoad()).reduce((a, b) => a + b, 0);
}

function widgetUnreadAdd(sessionId) {
    const m = widgetUnreadLoad();
    if (m[sessionId]) return; // ya avisado: el socket y el poll pueden coincidir
    m[sessionId] = 1;
    localStorage.setItem(WIDGET_UNREAD_KEY, JSON.stringify(m));
    widgetUnreadRender();
}

function widgetUnreadClear(sessionId) {
    const m = widgetUnreadLoad();
    if (m[sessionId] !== undefined) {
        delete m[sessionId];
        localStorage.setItem(WIDGET_UNREAD_KEY, JSON.stringify(m));
        widgetUnreadRender();
    }
}

function widgetUnreadRender() {
    const badge = widgetEl('ai-widget-badge');
    if (!badge) return;
    const total = widgetUnreadTotal();
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.hidden = total === 0;
    badge.style.display = total === 0 ? 'none' : 'flex';
}

function widgetRequestNotifyPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    try {
        Notification.requestPermission().catch(() => { });
    } catch (e) { /* navegador sin soporte */ }
}

function widgetNotify(sessionId, preview) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.hasFocus() && widgetOpen && String(widgetSessionId) === String(sessionId)) return;
    try {
        const n = new Notification(
            WIDGET_T('Nexus IA — respuesta lista', 'Nexus AI — response ready'),
            {
                body: preview || WIDGET_T('Tu respuesta ya está lista.', 'Your response is ready.'),
                tag: 'ai-response-' + sessionId,
            }
        );
        n.onclick = () => {
            window.focus();
            toggleAIWidget(true);
            if (String(widgetSessionId) !== String(sessionId)) widgetOpenSession(sessionId);
        };
    } catch (e) { /* permisos denegados */ }
}

function widgetInitAiSocket() {
    if (widgetAiSocketReady || typeof io === 'undefined') return;
    if (!window.dashSocket) {
        window.dashSocket = io({ auth: { token: window.TOKEN }, reconnection: true });
    }
    widgetAiSocketReady = true;
    window.dashSocket.on('ai_response_ready', (d) => {
        const sid = d && d.session_id;
        if (!sid) return;
        const seen = document.hasFocus() && widgetOpen && String(widgetSessionId) === String(sid);
        if (!seen) {
            widgetNotify(sid, d.preview);
            widgetUnreadAdd(sid);
        }
        if (widgetOpen) widgetLoadSessions();
    });
}

async function widgetSend() {
    const input = widgetEl('ai-widget-input');
    const text = (input.value || '').trim();
    if (!text || widgetStreaming) return;
    if (isModelPickerOpen(input)) return;  // la paleta /models está abierta
    if (text.startsWith('/')) return;  // los / son comandos

    widgetRequestNotifyPermission();

    if (!widgetModel && !widgetModels.length) {
        const msg = widgetT('wg_download_model_first');
        widgetToast(msg, 'warning');
        return;
    }

    const box = widgetEl('ai-widget-messages');
    if (box) {
        box.querySelectorAll('.widget-welcome').forEach((r) => r.remove());
    }

    input.value = '';
    widgetMessages.push({ role: 'user', content: text, created_at: new Date().toISOString(), model: widgetModel });
    appendWidgetMessage('user', text, widgetMessages.length - 1, widgetMessages[widgetMessages.length - 1].created_at);
    await widgetStreamCore();
}

async function widgetStreamCore() {
    const model = widgetModel || (widgetModels[0] && widgetModels[0].name) || 'llama3';
    const firstUser = widgetMessages.find((m) => m.role === 'user');
    const title = !widgetSessionId && firstUser
        ? (firstUser.content.length > 30 ? firstUser.content.substring(0, 30) + '...' : firstUser.content)
        : undefined;

    const typingEl = showWidgetTyping();
    widgetStreaming = true;
    widgetCancelled = false;
    widgetAlertEl = null;
    let full = '';
    let fullReasoning = '';
    let stream = null;
    let queueStatusEl = null;
    widgetSetSendState(true);

    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Token': window.TOKEN || '' },
            body: JSON.stringify({
                model,
                messages: widgetMessages,
                session_id: widgetSessionId,
                title,
                search_mode: false,
                workspace_id: null,
                mode: widgetChatMode,
                reasoning_mode: widgetReasoningMode === true,
                stream: true,
                options: {
                    num_ctx: parseInt(localStorage.getItem('model_num_ctx')) || 4096,
                    num_predict: parseInt(localStorage.getItem('model_num_predict')) || 1024,
                    temperature: parseFloat(localStorage.getItem('model_temperature')) || 0.2,
                    top_p: 0.9,
                    repeat_penalty: 1.1
                },
            }),
        });

        if (!res.ok) {
            let msg = WIDGET_T(
                'Error del servidor (' + res.status + ')',
                'Server error (' + res.status + ')'
            );
            try {
                const err = await res.json().catch(() => null);
                if (err && err.error) msg = WIDGET_ICONS.alert + ' ' + err.error;
            } catch (e) { /* cuerpo no JSON */ }
            throw new Error(msg);
        }

        if (widgetCancelled) throw new Error('cancel');

        widgetReader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await widgetReader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const j = JSON.parse(line);
                    if (j.session_id && !j.message) {
                        widgetSessionId = j.session_id;
                        localStorage.setItem('ai_widget_session', widgetSessionId);
                        continue;
                    }
                    if (j.queue) {
                        const pos = j.queue.position || 0;
                        if (pos > 0) {
                            const box = widgetEl('ai-widget-messages');
                            if (!queueStatusEl && box) {
                                const row = document.createElement('div');
                                row.className = 'msg-row';
                                queueStatusEl = document.createElement('div');
                                queueStatusEl.className = 'msg-alert';
                                const b = document.createElement('div');
                                b.className = 'msg-text';
                                queueStatusEl.appendChild(b);
                                row.appendChild(queueStatusEl);
                                box.appendChild(row);
                                box.scrollTop = box.scrollHeight;
                            }
                            if (queueStatusEl) {
                                queueStatusEl.querySelector('.msg-text').innerHTML = WIDGET_ICONS.clock + WIDGET_T('En cola… posición ' + pos, 'Queued… position ' + pos);
                            }
                        } else if (queueStatusEl && queueStatusEl.parentNode) {
                            queueStatusEl = widgetRemoveQueueStatus(queueStatusEl);
                        }
                        continue;
                    }
                    if (j.error) {
                        full += (full ? '\n\n' : '') + WIDGET_ICONS.alert + ' ' + j.error;
                        const box = widgetEl('ai-widget-messages');
                        if (box && !widgetAlertEl) {
                            widgetAlertEl = document.createElement('div');
                            widgetAlertEl.className = 'msg-row';
                            const a = document.createElement('div');
                            a.className = 'msg-alert';
                            a.textContent = WIDGET_ICONS.alert + ' ' + j.error;
                            widgetAlertEl.appendChild(a);
                            box.appendChild(widgetAlertEl);
                            box.scrollTop = box.scrollHeight;
                        }
                        continue;
                    }
                    const delta = (j.message && j.message.content) || '';
                    if (delta) {
                        if (!stream) {
                            if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                            if (queueStatusEl) queueStatusEl = widgetRemoveQueueStatus(queueStatusEl);
                            stream = makeStreamBubble();
                        }
                        full += delta;
                        stream.bubble.innerHTML = widgetRenderMD(full);
                        widgetHighlight(stream.bubble);
                        const box = widgetEl('ai-widget-messages');
                        if (box) box.scrollTop = box.scrollHeight;
                    }
                    if (j.reasoning) {
                        // Razonamiento ("thinking") del modelo: plegado encima
                        fullReasoning += j.reasoning;
                        if (!stream) {
                            if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                            stream = makeStreamBubble();
                        }
                        let rz = stream.el.querySelector('.msg-reasoning');
                        if (!rz) {
                            rz = document.createElement('details');
                            rz.className = 'msg-reasoning';
                            rz.innerHTML = '<summary>Razonamiento</summary><div class="msg-reasoning-body"></div>';
                            stream.el.insertBefore(rz, stream.el.firstChild);
                        }
                        rz.querySelector('.msg-reasoning-body').textContent = fullReasoning;
                        const box = widgetEl('ai-widget-messages');
                        if (box) box.scrollTop = box.scrollHeight;
                    }
                } catch (e) { /* línea no JSON (keep-alive) */ }
            }
        }
    } catch (e) {
        if (widgetCancelled) {
            full = '';
        } else {
            console.error('[AI Widget] Error de conexión:', e);
            full = e && e.message && /Error del servidor|<svg/.test(e.message)
                ? e.message
                : WIDGET_T(
                    'No se pudo conectar con el asistente. Comprueba que el servicio de IA esté activo.',
                    'Could not reach the assistant. Check that the AI service is running.'
                );
        }
    } finally {
        widgetStreaming = false;
        widgetReader = null;
        widgetSetSendState(false);
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (queueStatusEl) queueStatusEl = widgetRemoveQueueStatus(queueStatusEl);
        if (full && !widgetCancelled) {
            widgetMessages.push({ role: 'assistant', content: full, created_at: new Date().toISOString(), model: widgetModel });
            const idx = widgetMessages.length - 1;
            const t = document.createElement('span');
            t.className = 'msg-time';
            t.textContent = widgetShortDate(widgetMessages[idx].created_at);
            if (stream) {
                stream.row.dataset.idx = String(idx);
                stream.row.appendChild(t);
                widgetMaybeCollapse(stream.bubble, full);
                addCodeCopyButtons(stream.bubble);
                addWidgetActions(stream.row, 'assistant');
            } else {
                appendWidgetMessage('assistant', full, idx, widgetMessages[idx].created_at);
            }
            widgetRefreshEditButtons();
        }
    }
}

function widgetRemoveQueueStatus(el) {
    if (!el) return null;
    const row = el.parentNode;
    if (row && row.parentNode) row.parentNode.removeChild(row);
    return null;
}

async function widgetCancel() {
    if (!widgetStreaming) return;
    widgetCancelled = true;
    widgetToast(WIDGET_T('Mensaje cancelado', 'Message cancelled'), 'info');
    if (widgetSessionId) {
        try {
            await fetch('/api/ai/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Token': window.TOKEN || '' },
                body: JSON.stringify({ session_id: widgetSessionId }),
            });
        } catch (e) { /* sin red: se aborta igualmente el stream local */ }
    }
    if (widgetReader) {
        try { await widgetReader.cancel(); } catch (e) { /* ya cerrado */ }
    }
}

function widgetSetSendState(streaming) {
    const sendBtn = widgetEl('ai-widget-send');
    if (!sendBtn) return;
    sendBtn.setAttribute('data-i18n-title', streaming ? 'wg_stop' : 'wg_send');
    sendBtn.title = widgetT(streaming ? 'wg_stop' : 'wg_send');
    sendBtn.setAttribute('aria-label', sendBtn.title);
    if (streaming) {
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
        sendBtn.classList.add('stop');
        sendBtn.title = WIDGET_T('Detener generación', 'Stop generation');
    } else {
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.93l-.11 4.53c.57 0 .82-.25 1.13-.56l2.7-2.59 5.61 4.13c1.03.57 1.77.27 2.05-.96l3.71-17.48c.38-1.7-.64-2.63-1.78-2.19L1.02 10.08c-1.69.66-1.67 1.62-.31 2.04l5.04 1.58 11.95-7.54c.56-.37 1.08-.17.66.21L9.04 15.93z"/></svg>';
        sendBtn.classList.remove('stop');
        sendBtn.title = WIDGET_T('Enviar', 'Send');
    }
}

function toggleAIWidget(forceOpen) {
    const modal = widgetEl('ai-widget-modal');
    const toggle = widgetEl('ai-widget-toggle');
    if (!modal) return;
    widgetOpen = forceOpen !== undefined ? forceOpen : !widgetOpen;
    modal.classList.toggle('open', widgetOpen);
    modal.style.display = widgetOpen ? 'flex' : 'none';
    if (toggle) {
        toggle.style.display = widgetOpen ? 'none' : 'flex';
        toggle.setAttribute('aria-expanded', widgetOpen ? 'true' : 'false');
    }
    if (widgetOpen) {
        // Latido mientras el chat esté abierto: mantiene el contenedor de
        // Ollama activo únicamente mientras se usa la IA.
        if (!widgetHbTimer) {
            const ping = () => fetch('/api/ai/heartbeat', { method: 'POST' }).catch(() => { });
            ping();
            widgetHbTimer = setInterval(ping, 30000);
        }
        // Arranque perezoso: no contactar con el servicio de IA hasta
        // que el usuario abra el chat por primera vez
        if (!widgetModelsLoaded) {
            widgetModelsLoaded = true;
            loadAIModels();
        }
        widgetWelcome();
        widgetAutoResume();
        widgetCheckActiveGeneration();
        widgetRequestNotifyPermission();
        const input = widgetEl('ai-widget-input');
        if (input) input.focus();
    } else if (widgetHbTimer) {
        clearInterval(widgetHbTimer);
        widgetHbTimer = null;
        widgetCloseHistory();
    }
}

function initAIWidget() {
    const modal = widgetEl('ai-widget-modal');
    const toggle = widgetEl('ai-widget-toggle');
    const input = widgetEl('ai-widget-input');
    const sendBtn = widgetEl('ai-widget-send');
    const closeBtn = widgetEl('ai-widget-close');

    const statusEl = widgetEl('ai-widget-status');
    if (statusEl) {
        statusEl.textContent = WIDGET_T('En línea', 'Online');
    }

    if (modal && toggle) {
        toggle.addEventListener('click', () => toggleAIWidget());
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => toggleAIWidget(false));
    }
    const histBtn = widgetEl('ai-widget-history');
    if (histBtn) {
        histBtn.addEventListener('click', widgetToggleHistory);
    }
    const newBtn = widgetEl('ai-widget-newchat');
    if (newBtn) {
        newBtn.addEventListener('click', widgetNewChat);
    }
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (isModelPickerOpen(input)) return;  // la paleta /models gestiona el Enter
                e.preventDefault();
                widgetSend();
            }
        });
        // Ocultar el botón de enviar mientras se escribe/busca un comando
        input.addEventListener('input', () => {
            const sendBtn = widgetEl('ai-widget-send');
            if (!sendBtn) return;
            const isCmd = input.value.trim().startsWith('/') && !widgetStreaming;
            sendBtn.style.display = isCmd ? 'none' : '';
        });
    }
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (widgetStreaming) widgetCancel();
            else widgetSend();
        });
    }
    _widgetBindModeBtn();

    const modelBtn = null; // el selector de modelos es el comando /models

    initSlashCommands({
        input: widgetEl('ai-widget-input'),
        models: () => widgetModels || [],
        current: () => widgetModel || '',
        onSelectModel: (name) => {
            widgetSelectModel(name);
            if (name.startsWith('API:')) {
                widgetToast('Modelo externo (API): tus mensajes y datos se envían a un proveedor de terceros. Evita datos sensibles.', 'warning');
            } else {
                widgetToast(WIDGET_T('Modelo: ', 'Model: ') + name);
            }
        },
        commands: [
            { name: '/models', description: WIDGET_T('Cambiar de modelo — /models gratis - tools - nombre', 'Switch model — /models free - tools - name'), run: () => { } },
            { name: '/nuevo', description: WIDGET_T('Nueva conversación', 'New conversation'), run: () => { widgetNewChat(); } },
            { name: '/agenda', description: WIDGET_T('Activar / desactivar modo agenda', 'Toggle agenda mode'), run: () => { widgetToggleMode(); } },
            { name: '/normal', description: WIDGET_T('Activar modo normal', 'Enable normal mode'), run: () => { widgetToggleMode('normal'); } },
        ],
    });

    const handleOutsideInteraction = (e) => {
        if (!widgetOpen) return;
        // Mientras se edita un mensaje o se genera una respuesta no se cierra
        // el widget por un clic/toque exterior (evita cierres accidentales).
        if (widgetStreaming || widgetEl('ai-widget-messages')?.querySelector('.msg.editing')) return;
        const t = e.target;
        // Si el elemento ya no está conectado al DOM es que otro handler lo
        // eliminó mientras el evento seguía propagándose (p.ej. el diálogo de
        // confirmación al pulsar Eliminar/Cancelar): NO es una interacción
        // exterior real, así que no se cierra el widget.
        if (!(t instanceof Element) || !t.isConnected) return;
        // Cerrar el panel de historial si se pulsa fuera de él (dentro del
        // widget o fuera): en mensajes, input, header... El botón de historial
        // y el propio panel quedan excluidos (toggle/selección).
        const inHistory = t && t.closest && t.closest('#ai-widget-history-panel');
        const isHistoryToggle = t && t.closest && t.closest('#ai-widget-history');
        const inConfirm = t && t.closest && t.closest('.widget-confirm-overlay');
        if (!inHistory && !isHistoryToggle && !inConfirm) {
            widgetCloseHistory();
        }
        if (t && t.closest && (t.closest('#ai-agent-widget') || t.closest('.widget-confirm-overlay') || t.closest('#ai-widget-toggle'))) return;
        toggleAIWidget(false);
    };

    document.addEventListener('pointerdown', handleOutsideInteraction);
    document.addEventListener('click', handleOutsideInteraction);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAIWidget);
} else {
    initAIWidget();
}

widgetApplyLang();
window.addEventListener('languageChanged', widgetApplyLang);


function widgetUpdateModeBtn() {
    const btn = widgetEl('ai-widget-mode-btn');
    if (!btn) return;
    const isAgenda = widgetChatMode === 'agenda';
    btn.classList.toggle('active', isAgenda);
    // Estado visible garantizado (inline, inmune a la cascada), igual que el
    // del panel IA: fondo morado sólido + icono blanco cuando está activo.
    btn.style.background = isAgenda ? 'linear-gradient(135deg, #6d28d9, #7c3aed)' : 'none';
    btn.style.color = isAgenda ? '#ffffff' : '';
    btn.style.border = isAgenda ? '1px solid rgba(167, 139, 250, 0.5)' : 'none';
    btn.style.boxShadow = isAgenda ? '0 0 10px rgba(124, 58, 237, 0.5)' : 'none';
    btn.title = isAgenda
        ? 'Modo Agenda: responde con tus datos reales del calendario. Pulsa para modo Normal (sin agenda ni búsqueda web).'
        : 'Modo Normal: sin agenda ni búsqueda web. Pulsa para modo Agenda.';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = isAgenda ? WIDGET_MODE_AGENDA_ICON : WIDGET_MODE_CHAT_ICON;
}

function widgetToggleMode(target) {
    if (target instanceof Event) target = null;
    if (widgetStreaming) {
        widgetToast('No puedes cambiar el modo mientras se genera una respuesta');
        return;
    }
    if (target) {
        if (widgetChatMode === target) {
            widgetToast(target === 'agenda' ? 'Modo Agenda ya activo' : 'Modo Normal ya activo');
            return;
        }
        widgetChatMode = target;
    } else {
        widgetChatMode = widgetChatMode === 'agenda' ? 'normal' : 'agenda';
    }
    localStorage.setItem('ai_chat_mode', widgetChatMode);
    widgetUpdateModeBtn();
    widgetToast(widgetChatMode === 'agenda'
        ? 'Modo Agenda activado'
        : 'Modo Agenda desactivado');
}

var _modeBtnBound = false;  // var: hoisted, evita TDZ (initAIWidget se ejecuta antes)

function _widgetBindModeBtn() {
    if (_modeBtnBound) return;
    _modeBtnBound = true;
    const btn = widgetEl('ai-widget-mode-btn');
    if (btn) {
        btn.addEventListener('click', widgetToggleMode);
        widgetUpdateModeBtn();
    }
    const rBtn = widgetEl('ai-widget-reasoning-btn');
    if (rBtn) {
        rBtn.addEventListener('click', widgetToggleReasoningMode);
        widgetUpdateReasoningBtn();
    }
}

function widgetUpdateReasoningBtn() {
    const btn = widgetEl('ai-widget-reasoning-btn');
    if (!btn) return;
    btn.classList.toggle('active', widgetReasoningMode);
    btn.style.background = widgetReasoningMode ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'none';
    btn.style.color = widgetReasoningMode ? '#ffffff' : '';
    btn.style.border = widgetReasoningMode ? '1px solid rgba(245, 158, 11, 0.5)' : 'none';
    btn.style.boxShadow = widgetReasoningMode ? '0 0 10px rgba(217, 119, 6, 0.5)' : 'none';
}

function widgetToggleReasoningMode(target) {
    if (target instanceof Event) target = null;
    if (widgetStreaming) {
        widgetToast('No puedes cambiar el modo mientras se genera una respuesta');
        return;
    }
    widgetReasoningMode = !widgetReasoningMode;
    localStorage.setItem('ai_reasoning_mode', widgetReasoningMode);
    widgetUpdateReasoningBtn();
    widgetToast(widgetReasoningMode ? 'Modo Razonamiento activado' : 'Modo Razonamiento desactivado');

    // Dispatch event to sync with AI panel if needed
    window.dispatchEvent(new Event('ai-reasoning-mode-changed'));

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _widgetBindModeBtn);
} else {
    _widgetBindModeBtn();
}
widgetInitAiSocket();
widgetUnreadRender();
window.addEventListener('ai-mode-changed', () => {
    widgetChatMode = (localStorage.getItem('ai_chat_mode') || 'agenda');
    widgetUpdateModeBtn();
});
window.addEventListener('storage', (e) => {
    if (e.key === 'ai_chat_mode') {
        widgetChatMode = e.newValue || 'agenda';
        widgetUpdateModeBtn();
    } else if (e.key === 'ai_reasoning_mode') {
        widgetReasoningMode = e.newValue === 'true';
        widgetUpdateReasoningBtn();
    }
}
);

window.openWidgetModelSettingsDialog = function() {
    const ctx     = localStorage.getItem('model_num_ctx')     || '8192';
    const predict = localStorage.getItem('model_num_predict') || '2048';
    const temp    = localStorage.getItem('model_temperature') || '0.7';

    document.getElementById('widget-model-settings-ctx').value     = ctx;
    document.getElementById('widget-model-settings-predict').value = predict;
    document.getElementById('widget-model-settings-temp').value    = temp;
    document.getElementById('widget-temp-val-display').innerText   = temp;

    document.getElementById('widget-model-settings-dialog').classList.add('show');
};

window.closeWidgetModelSettingsDialog = function(e) {
    if (e && e.target !== document.getElementById('widget-model-settings-dialog')) return;
    document.getElementById('widget-model-settings-dialog').classList.remove('show');
};

window.saveWidgetModelSettings = function() {
    const ctx     = parseInt(document.getElementById('widget-model-settings-ctx').value)     || 8192;
    const predict = parseInt(document.getElementById('widget-model-settings-predict').value) || 2048;
    const temp    = parseFloat(document.getElementById('widget-model-settings-temp').value)  || 0.7;

    localStorage.setItem('model_num_ctx',     ctx);
    localStorage.setItem('model_num_predict', predict);
    localStorage.setItem('model_temperature', temp);

    widgetToast('✓ Ajustes del modelo guardados');
    document.getElementById('widget-model-settings-dialog').classList.remove('show');
};
