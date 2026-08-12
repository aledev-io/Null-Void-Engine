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

let widgetOpen = false;
let widgetStreaming = false;
let widgetMessages = [];
let widgetSessionId = null;
let widgetModels = [];
let widgetModel = null;
let widgetModelsLoaded = false;
let widgetModelRetries = 0;
let widgetHbTimer = null;

function widgetEl(id) {
    return document.getElementById(id);
}

function timeNow() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
    bubble.textContent = text;
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
    let full = '';
    let stream = null;

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

        const reader = res.body.getReader();
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
                    if (j.error) {
                        full += (full ? '\n\n' : '') + '⚠️ ' + j.error;
                        continue;
                    }
                    const delta = (j.message && j.message.content) || '';
                    if (delta) {
                        if (!stream) {
                            if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
                            stream = makeStreamBubble();
                        }
                        full += delta;
                        stream.bubble.textContent = full;
                        const box = widgetEl('ai-widget-messages');
                        if (box) box.scrollTop = box.scrollHeight;
                    }
                } catch (e) { /* línea no JSON (keep-alive) */ }
            }
        }
    } catch (e) {
        console.error('[AI Widget] Error de conexión:', e);
        full = e && e.message && /Error del servidor|⚠️/.test(e.message)
            ? e.message
            : WIDGET_T(
                'No se pudo conectar con el asistente. Comprueba que el servicio de IA esté activo.',
                'Could not reach the assistant. Check that the AI service is running.'
            );
    } finally {
        widgetStreaming = false;
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (full) {
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
        const input = widgetEl('ai-widget-input');
        if (input) input.focus();
    } else if (widgetHbTimer) {
        clearInterval(widgetHbTimer);
        widgetHbTimer = null;
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
        statusEl.textContent = WIDGET_T('En línea — modelo local', 'Online — local model');
    }

    if (modal && toggle) {
        toggle.addEventListener('click', () => toggleAIWidget());
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => toggleAIWidget(false));
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
        sendBtn.addEventListener('click', () => widgetSend());
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
