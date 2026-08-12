// ─────────────────────────────────────────────────────────────────────────────
// Widget flotante "Nexus AI" del Dashboard: chat con el agente local (Ollama)
// vía /api/ai/chat (streaming SSE, líneas JSON). Autocontenido, sin
// dependencias: solo un botón flotante + panel + consumo del stream.
// ─────────────────────────────────────────────────────────────────────────────

const WIDGET_T = (es, en) => (window.currentLang === 'en' ? en : es);

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

let widgetOpen = false;
let widgetStreaming = false;
let widgetCancelled = false;
let widgetReader = null;
let widgetMessages = [];
let widgetSessionId = null;
let widgetModels = [];
let widgetModel = null;
let widgetModelsLoaded = false;
let widgetModelRetries = 0;
let widgetHbTimer = null;
let widgetSessions = [];

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
        item.appendChild(t);
        item.appendChild(d);
        item.addEventListener('click', () => widgetOpenSession(s.id));
        list.appendChild(item);
    }
}

async function widgetOpenSession(sessionId) {
    const box = widgetEl('ai-widget-messages');
    try {
        const res = await fetch('/api/ai/sessions/' + encodeURIComponent(sessionId) + '/messages');
        if (!res.ok) return false;
        const msgs = await res.json();
        widgetSessionId = sessionId;
        widgetMessages = msgs
            .map((m) => ({ role: m.role, content: m.content }))
            .filter((m) => m.role === 'user' || m.role === 'assistant');
        const s = widgetSessions.find((x) => String(x.id) === String(sessionId));
        if (s && s.model) {
            const sel = widgetEl('ai-widget-model');
            if (sel && sel.querySelector('option[value="' + s.model + '"]')) {
                widgetModel = s.model;
                sel.value = s.model;
            }
        }
        if (box) box.innerHTML = '';
        for (const m of widgetMessages) appendWidgetMessage(m.role, m.content);
        if (box) box.scrollTop = box.scrollHeight;
        widgetCloseHistory();
        const input = widgetEl('ai-widget-input');
        if (input) input.focus();
        return true;
    } catch (e) {
        return false;
    }
}

async function widgetAutoResume() {
    if (widgetSessionId) return;
    const box = widgetEl('ai-widget-messages');
    if (box && box.children.length) return;
    try {
        const res = await fetch('/api/ai/sessions');
        if (!res.ok) return;
        const sessions = await res.json();
        if (!sessions.length) return;
        widgetSessions = sessions;
        await widgetOpenSession(sessions[0].id);
    } catch (e) { /* sin red: se mantiene el mensaje de bienvenida */ }
}

function widgetToggleHistory() {
    const panel = widgetEl('ai-widget-history-panel');
    if (!panel) return;
    if (panel.classList.toggle('open')) widgetLoadSessions();
}

function widgetCloseHistory() {
    const panel = widgetEl('ai-widget-history-panel');
    if (panel) panel.classList.remove('open');
}

function widgetNewChat() {
    if (widgetStreaming) widgetCancel();
    widgetSessionId = null;
    widgetMessages = [];
    const box = widgetEl('ai-widget-messages');
    if (box) box.innerHTML = '';
    widgetCloseHistory();
    widgetWelcome();
    const input = widgetEl('ai-widget-input');
    if (input) input.focus();
}

async function loadAIModels() {
    try {
        const res = await fetch('/api/ai/models');
        const data = await res.json().catch(() => ({}));
        const models = (data.models || []).filter((m) => m.name && !m.name.startsWith('API:'));
        widgetModels = models;
        widgetModelRetries = 0;
        const sel = widgetEl('ai-widget-model');
        if (sel) {
            sel.innerHTML = models
                .map((m) => `<option value="${wEsc(m.name)}">${wEsc(m.name)}</option>`)
                .join('');
            const preferred = models.find((m) => /phi|qwen|llama/i.test(m.name)) || models[0];
            if (preferred) {
                widgetModel = preferred.name;
                sel.value = widgetModel;
            }
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

function appendWidgetMessage(role, text) {
    const box = widgetEl('ai-widget-messages');
    if (!box) return null;
    const el = document.createElement('div');
    el.className = role === 'user' ? 'msg user' : 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'msg-text';
    bubble.innerHTML = widgetRenderMD(text);
    widgetHighlight(bubble);
    el.appendChild(bubble);
    const t = document.createElement('span');
    t.className = 'msg-time';
    t.textContent = timeNow();
    el.appendChild(t);
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return bubble;
}

function showWidgetTyping() {
    const box = widgetEl('ai-widget-messages');
    if (!box) return null;
    const el = document.createElement('div');
    el.className = 'typing';
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(document.createElement('span'));
    el.appendChild(document.createElement('span'));
    el.appendChild(document.createElement('span'));
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
}

function makeStreamBubble() {
    const box = widgetEl('ai-widget-messages');
    if (!box) return null;
    const el = document.createElement('div');
    el.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'msg-text';
    el.appendChild(bubble);
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return { el, bubble };
}

function widgetWelcome() {
    if (widgetMessages.length === 0 && !widgetEl('ai-widget-messages').children.length) {
        appendWidgetMessage('assistant', WIDGET_T(
            '¡Hola! Soy tu asistente local de Null-Void Engine. Pregúntame lo que necesites.',
            'Hi! I\'m your local Null-Void Engine assistant. Ask me anything.'
        ));
    }
}

async function widgetSend() {
    const input = widgetEl('ai-widget-input');
    const text = (input.value || '').trim();
    if (!text || widgetStreaming) return;

    const model = widgetModel || (widgetModels[0] && widgetModels[0].name) || 'llama3';
    input.value = '';
    widgetMessages.push({ role: 'user', content: text });
    appendWidgetMessage('user', text);

    const typingEl = showWidgetTyping();
    widgetStreaming = true;
    widgetCancelled = false;
    let full = '';
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
                title: widgetMessages.length <= 2 ? (text.length > 30 ? text.substring(0, 30) + '...' : text) : undefined,
                search_mode: false,
                workspace_id: null,
                stream: true,
                options: { num_ctx: 4096, num_predict: 1024, temperature: 0.7, repeat_penalty: 1.1 },
            }),
        });

        if (!res.ok) {
            let msg = WIDGET_T(
                'Error del servidor (' + res.status + ')',
                'Server error (' + res.status + ')'
            );
            try {
                const err = await res.json().catch(() => null);
                if (err && err.error) msg = '⚠️ ' + err.error;
            } catch (e) { /* cuerpo no JSON */ }
            throw new Error(msg);
        }

        if (widgetCancelled) throw new Error('cancel');

        widgetReader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
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
                        continue;
                    }
                    if (j.queue) {
                        const pos = j.queue.position || 0;
                        const box = widgetEl('ai-widget-messages');
                        if (!queueStatusEl && box) {
                            queueStatusEl = document.createElement('div');
                            queueStatusEl.className = 'msg assistant queue-status';
                            const b = document.createElement('div');
                            b.className = 'msg-text';
                            queueStatusEl.appendChild(b);
                            box.appendChild(queueStatusEl);
                            box.scrollTop = box.scrollHeight;
                        }
                        if (queueStatusEl) {
                            queueStatusEl.querySelector('.msg-text').textContent = pos > 0
                                ? WIDGET_T('⏳ En cola… posición ' + pos, '⏳ Queued… position ' + pos)
                                : WIDGET_T('⚡ Generando respuesta…', '⚡ Generating response…');
                        }
                        continue;
                    }
                    if (j.error) {
                        full += (full ? '\n\n' : '') + '⚠️ ' + j.error;
                        continue;
                    }
                    const delta = (j.message && j.message.content) || '';
                    if (delta) {
                        if (!stream) {
                            if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                            if (queueStatusEl && queueStatusEl.parentNode) queueStatusEl.parentNode.removeChild(queueStatusEl);
                            stream = makeStreamBubble();
                        }
                        full += delta;
                        stream.bubble.innerHTML = widgetRenderMD(full);
                        widgetHighlight(stream.bubble);
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
            full = e && e.message && /Error del servidor|⚠️/.test(e.message)
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
        if (queueStatusEl && queueStatusEl.parentNode) queueStatusEl.parentNode.removeChild(queueStatusEl);
        if (full && !widgetCancelled) {
            if (stream) {
                const t = document.createElement('span');
                t.className = 'msg-time';
                t.textContent = timeNow();
                stream.el.appendChild(t);
            } else {
                appendWidgetMessage('assistant', full);
            }
            widgetMessages.push({ role: 'assistant', content: full });
        }
    }
}

async function widgetCancel() {
    if (!widgetStreaming) return;
    widgetCancelled = true;
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
    if (streaming) {
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
        sendBtn.classList.add('stop');
        sendBtn.title = WIDGET_T('Detener generación', 'Stop generation');
    } else {
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>';
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
            const ping = () => fetch('/api/ai/heartbeat', { method: 'POST' }).catch(() => {});
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
                e.preventDefault();
                widgetSend();
            }
        });
    }
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (widgetStreaming) widgetCancel();
            else widgetSend();
        });
    }
    const sel = widgetEl('ai-widget-model');
    if (sel) {
        sel.addEventListener('change', () => {
            widgetModel = sel.value;
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAIWidget);
} else {
    initAIWidget();
}
