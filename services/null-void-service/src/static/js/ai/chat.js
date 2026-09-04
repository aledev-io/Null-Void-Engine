import { initSlashCommands, isModelPickerOpen, getProviderInfo } from './slash_commands.js';
import { attachmentServerUrl } from './files.js';

export function updateChatGenStatus(position) {
    // El indicador superior de estado se eliminó por petición del usuario.
}

export function clearChatGenStatus() {
    // El indicador superior de estado se eliminó por petición del usuario.
}

export function modelDisplayName(m) {
    const name = (m && (typeof m === 'string' ? m : m.name)) || '';
    if (name.startsWith('API: openrouter:')) return name.replace(/^API:\s*openrouter\s*:\s*/, '');
    if (name.startsWith('API: google:')) return name.replace(/^API:\s*google\s*:\s*/, '');
    if (name.startsWith('API: openai:')) return name.replace(/^API:\s*openai\s*:\s*/, '');
    if (name.startsWith('API: deepseek:')) return name.replace(/^API:\s*deepseek\s*:\s*/, '');
    if (name.startsWith('API: ')) return name.replace(/^API:\s*/, '');
    return name;
}

export function isMobileDevice() {
    return window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
}

export function isFreeModel(m) {
    return !!(m && m.is_external && m.pricing && parseFloat(m.pricing.prompt) === 0);
}

export function modelBadgeHtml(m) {
    if (!m) return '';
    const provInfo = getProviderInfo(m);
    const provBadge = `<span style="font-size:0.62rem;font-weight:600;color:${provInfo.color};background:${provInfo.bg};border:1px solid ${provInfo.border};border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:1px;">${provInfo.label}</span>`;
    const freeBadge = isFreeModel(m) ? '<span style="font-size:0.62rem;font-weight:700;color:#34d399;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.3);border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:1px;">gratis</span>' : '';
    return provBadge + freeBadge;
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

// Errores de stream que son interrupciones (desconexión, recarga, cancelación
// del motor) y no fallos reales del modelo: se muestran como "Mensaje
// cancelado" en vez de inyectar el texto técnico en la burbuja.
const INTERRUPT_ERROR_RE = /^Failed to fetch|networkerror|load failed|in input stream|user aborted|interrupted|interrumpid|cancel(ado|ada|ed|led|ing)|connection\s*(aborted|closed|reset|refused)|conexi[oó]n\s*(abort|cerrad|reset|rehusad|interrump)|reset\s*by\s*peer|max\s*retries|timed?\s*out/i;

export function _isInterruptedError(errText) {
    return !!(errText && INTERRUPT_ERROR_RE.test(String(errText)));
}

// ¿La generación activa corresponde a la conversación que se está mostrando?
// Cuando el stream corre en esta misma pestaña no hay generatingChatId, así
// que se asume que sí es la conversación activa.
function _chatIsGenerating() {
    if (!window.isGenerating) return false;
    if (window.generatingChatId != null) {
        return String(window.generatingChatId) === String(window.currentChatId);
    }
    return true;
}

// Mensajes procedentes de la BD: descartar respuestas de la IA vacías al final
// (p. ej. un stream interrumpido que no llegó a generar texto) y limpiar
// fragmentos JSON/tool call a medio generar que el backend haya persistido.
// De lo contrario al recargar se renderiza una burbuja vacía o JSON crudo.
export function _sanitizeDbMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    const list = messages.map(m => ({ ...m }));
    while (list.length > 0 && list[list.length - 1].role === 'assistant') {
        const last = list[list.length - 1];
        const content = String(last.content || '');
        const trimmed = content.trim();
        // Los marcadores de cancelación (content vacío + cancelled) SÍ se
        // conservan: son la única evidencia de que la generación se canceló.
        if (!trimmed && !last.cancelled) {
            list.pop();
            continue;
        }
        if (_isJsonishToolFragment(content)) {
            const stripped = _stripJsonishFragment(content);
            if (!stripped.trim()) list.pop();
            else last.content = stripped;
            continue;
        }
        break;
    }
    return list;
}

// Indicador visual persistente de interrupción: se adjunta a la respuesta
// inacabada y a los mensajes marcados como cancelados en el historial.
function createCancelledBadge() {
    const el = document.createElement('div');
    el.className = 'msg-cancelled';
    el.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Mensaje cancelado</span>';
    return el;
}

// ¿El contenido acumulado parece un fragmento de JSON / llamada a herramienta
// a medio generar? Al cortarse el stream (recarga/desconexión) el modelo puede
// dejar un JSON incompleto que NO debe mostrarse como texto natural.
export function _isJsonishToolFragment(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    const opens = (t.match(/[{\[]/g) || []).length;
    const closes = (t.match(/[}\]]/g) || []).length;
    if (opens !== closes) {
        // Desbalanceado: fragmento interrumpido. Solo si empieza como JSON o
        // tiene aspecto de objeto JSON (keys entrecomilladas), no código.
        if (t.startsWith('{') || t.startsWith('[')) return true;
        return /"[^"\n]{0,40}"\s*:/.test(t);
    }
    // Balanceado: solo llaves/corchetes vacíos ("{ }", "{}", "["...)
    if (/^[\s{}[\]]+$/.test(t)) return true;
    const firstOpen = t.search(/[{\[]/);
    if (firstOpen === -1) return false;
    const fragment = t.slice(firstOpen);
    const isPureObject = fragment.startsWith('{') || fragment.startsWith('[');
    // El fragmento debe parecer JSON (objeto con keys), no una lista natural
    // ("[1, 2, 3]") ni un bloque de código sin terminar de parsear.
    if (!isPureObject || !/["']?[a-zA-Z_][a-zA-Z0-9_]*["']?\s*:/.test(fragment)) return false;
    // JSON crudo de tool call (keys internas de tools.py) sin narrativa.
    if (/["'](tool|function|tool_calls|args)["']\s*:/.test(fragment)) {
        const plain = fragment.replace(/[{\[\]}"',:]/g, ' ').trim();
        if (plain.length < 40) return true;
    }
    // Fragmento que es un único valor JSON (objeto/array): modelos
    // fine-tuneados que alucinan su formato interno de entrenamiento
    // (p. ej. {"text": "...", "category": "ocio"}).
    try {
        const parsed = JSON.parse(fragment);
        if (parsed !== null && typeof parsed === 'object') return true;
    } catch (e) { /* no es JSON completo válido */ }
    return false;
}

// Corta el fragmento JSON/tool call a medio generar, conservando solo el texto
// narrativo que lo precede (si existe).
export function _stripJsonishFragment(text) {
    const t = String(text || '');
    const idx = t.search(/[{\[]/);
    if (idx < 0) return t;
    if (idx === 0) return '';
    return t.slice(0, idx).trimEnd();
}

// Limpia una respuesta de la IA: si es (o contiene al final) un JSON/tool call
// sin valor narrativo, devuelve solo el texto limpio. Vacío si era solo JSON.
export function _cleanAssistantContent(content) {
    const t = String(content || '');
    if (!_isJsonishToolFragment(t)) return t;
    return _stripJsonishFragment(t);
}

// Tras la confirmación de que la generación terminó sin respuesta persistida
// (cancelación, error sin texto o recarga prematura), deja un marcador visual
// persistente debajo del último mensaje del usuario para que el historial
// explique la interrupción en futuras visitas.
function _appendCancelledMarker() {
    const msgs = window.chatMessages;
    if (!Array.isArray(msgs) || msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'user' || last.cancelled) return; // ya marcado o respondido
    msgs.push({
        role: 'assistant',
        content: '',
        cancelled: true,
        model: (document.getElementById('model-select') || {}).value || ''
    });
    saveHistory();
    renderChat();
}

// Reconciliación del último mensaje: si la sesión ya no está generando y el
// último mensaje del usuario quedó sin respuesta (ni en BD ni en curso), se
// marca como cancelado. Usa DOBLE verificación: el worker del backend anuncia
// la sesión inactiva ANTES de persistir la respuesta (ventana de milisegundos),
// así que una sola comprobación produce falsos "Mensaje cancelado" al recargar.
let _reconcileLock = false;

async function _generationStillActive() {
    if (_chatIsGenerating()) return true;
    if (!window.currentChatId) return false;
    try {
        const genRes = await fetch('/api/ai/generating');
        if (genRes.ok) {
            const data = await genRes.json();
            const active = data.active || {};
            if (active[window.currentChatId]) return true;
        }
    } catch (e) { /* sin red */ }
    return false;
}

async function _answerPersisted() {
    if (!window.currentChatId) return false;
    try {
        const res = await fetch(`/api/ai/sessions/${window.currentChatId}/messages`);
        if (res.ok) {
            const dbMsgs = await res.json();
            const clean = _sanitizeDbMessages(Array.isArray(dbMsgs) ? dbMsgs : []);
            if (clean.length && clean[clean.length - 1].role === 'assistant') return true;
        }
    } catch (e) { /* sin red */ }
    return false;
}

async function _maybeMarkCancelledChat() {
    if (_reconcileLock) return;
    _reconcileLock = true;
    try {
        if (!window.currentChatId) return;
        const msgs = window.chatMessages;
        if (!Array.isArray(msgs) || msgs.length === 0) return;
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== 'user' || last.cancelled) return;
        // Fase 1: comprobación inicial.
        if (await _generationStillActive()) return;
        if (await _answerPersisted()) return;
        // Fase 2: la respuesta puede estar persistiéndose justo ahora; esperar
        // y volver a comprobar antes de declarar el mensaje cancelado.
        await new Promise(r => setTimeout(r, 2500));
        if (await _generationStillActive()) return;
        if (await _answerPersisted()) return;
        // Comprobaciones finales sobre el estado actual del chat.
        const msgs2 = window.chatMessages;
        if (!Array.isArray(msgs2) || msgs2.length === 0) return;
        const last2 = msgs2[msgs2.length - 1];
        if (!last2 || last2.role !== 'user' || last2.cancelled) return;
        _appendCancelledMarker();
    } catch (e) { /* nunca romper el flujo */ } finally {
        _reconcileLock = false;
    }
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
    if (!el) return;
    el.style.height = 'auto';
    const isMobile = window.innerWidth <= 767 || (window.innerHeight && window.innerHeight <= 600);
    const minH = 24;
    const maxH = isMobile ? 112 : 180;
    const targetH = Math.min(Math.max(el.scrollHeight, minH), maxH);
    el.style.height = targetH + 'px';
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
}

// Feedback háptico sutil en móvil (navigator.vibrate). No-op en escritorio.
export function haptic() {
    try {
        if (window.innerWidth <= 767 && navigator.vibrate) navigator.vibrate(10);
    } catch (e) { /* sin soporte háptico */ }
}
window.haptic = haptic;

// Estado del botón de enviar: atenuado con el input vacío, con acento al
// escribir (la primera pulsación/Enter no se ve bloqueada: solo el botón).
export function updateSendButtonState() {
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('chat-input');
    if (!btn || !input) return;
    if (window.isGenerating) { btn.disabled = false; return; }
    const hasContent = input.value.trim().length > 0
        || (Array.isArray(window.attachedFiles) && window.attachedFiles.length > 0);
    btn.disabled = !hasContent;
    btn.classList.toggle('has-text', hasContent);
}
window.updateSendButtonState = updateSendButtonState;

// Teclado móvil (visualViewport): el layout se ajusta a la altura útil y el
// chat se ancla al último mensaje al desplegarse el teclado, sin saltos.
// IMPORTANTE: la altura solo se fija inline en móvil MIENTRAS el teclado
// está abierto. En escritorio (o con teclado cerrado) se limpia para que
// mande el CSS (100dvh / zoom de pantallas grandes): fijarla inline allí
// rompería la compensación de zoom y dejaría un hueco muerto bajo el input.
export function setupVisualViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const isMobile = () => window.innerWidth <= 767;
    const nextFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    let raf = null;
    let maxH = vv.height;
    let kbOpen = false;
    const apply = (scrollToBottom) => {
        if (raf) return;
        raf = nextFrame(() => {
            raf = null;
            const layout = document.querySelector('.app-layout') || document.body;
            if (!isMobile()) {
                layout.style.height = '';
                return;
            }
            layout.style.height = kbOpen ? vv.height + 'px' : '';
            if (scrollToBottom) {
                const log = document.getElementById('chat-log');
                if (log) log.scrollTop = log.scrollHeight;
            }
        });
    };
    vv.addEventListener('resize', () => {
        maxH = Math.max(maxH, vv.height);
        // El teclado se acaba de desplegar: la altura útil baja una buena
        // cantidad => anclar al último mensaje para no perder lo que se
        // escribe. Los eventos de pinch/URL-bar no fuerzan scroll.
        const opened = vv.height < maxH - 140;
        const closed = vv.height >= maxH - 20;
        if (opened) kbOpen = true;
        if (closed) kbOpen = false;
        apply(opened);
        // Respaldo para navegadores sin auto-posicionamiento nativo: exponer
        // la altura del teclado como offset inferior del chat.
        document.documentElement.style.setProperty('--kb-offset', kbOpen ? (window.innerHeight - vv.height) + 'px' : '0px');
    });
    vv.addEventListener('scroll', () => apply(false));
    apply(false);
}

// Al enfocar el textarea en móvil, el último mensaje queda visible sobre el
// teclado (scroll suave hasta el final del historial).
export function setupInputFocusScroll() {
    const input = document.getElementById('chat-input');
    const log = document.getElementById('chat-log');
    if (!input || !log) return;
    input.addEventListener('focus', () => {
        if (window.innerWidth > 767) return;
        try {
            log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
        } catch (e) {
            log.scrollTop = log.scrollHeight;
        }
    });
}

// Header "sticky-hide": se oculta al hacer scroll hacia abajo y reaparece al
// subir, maximizando el área de lectura del chat en móvil.
export function setupStickyHeader() {
    const log = document.getElementById('chat-log');
    const view = document.getElementById('chat-view');
    if (!log || !view) return;
    let lastY = log.scrollTop;
    log.addEventListener('scroll', () => {
        const y = log.scrollTop;
        if (y < 0) return;
        if (y > lastY + 10 && y > 120) {
            view.classList.add('nav-hidden');
        } else if (y < lastY - 10 || y < 40) {
            view.classList.remove('nav-hidden');
        }
        lastY = y;
    });
}

// Rellena todos los selectores de modelo (header, workspace, detalle) con la
// lista actual de window.aiModelList. Se llama en el arranque (lista vacía:
// solo muestra la preferencia guardada) y de nuevo cuando los modelos se
// cargan bajo demanda.
function populateModelSelects(defaultModel) {
    const noModelsText = (window.t && window.t('wg_no_models')) || 'Sin modelos';

    const selects = document.querySelectorAll('.model-selector');
    selects.forEach(select => {
        select.innerHTML = '';
        const models = window.aiModelList || [];
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
            select.innerHTML = `<option value="" selected>${noModelsText}</option>`;
        }
    });

    const populateWsMenu = (btnLabel, input, menuId) => {
        const models = window.aiModelList || [];
        if (btnLabel && input) {
            if (models.length > 0) {
                const menu = document.getElementById(menuId);
                if (menu) {
                    Array.from(menu.querySelectorAll('.ws-model-item')).forEach(el => el.remove());
                    models.forEach((m) => {
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
                        menu.appendChild(item);
                    });
                }
                btnLabel.textContent = modelDisplayName({ name: defaultModel });
                btnLabel.title = defaultModel;
                input.value = defaultModel;
            } else {
                btnLabel.textContent = noModelsText;
                input.value = '';
                const menu = document.getElementById(menuId);
                if (menu) {
                    Array.from(menu.querySelectorAll('.ws-model-item')).forEach(el => el.remove());
                    const emptyItem = document.createElement('div');
                    emptyItem.className = 'menu-item ws-model-item';
                    emptyItem.style.padding = '10px 16px';
                    emptyItem.style.color = 'var(--text-dim)';
                    emptyItem.style.cursor = 'default';
                    emptyItem.textContent = noModelsText;
                    menu.appendChild(emptyItem);
                }
            }
        }
    };

    populateWsMenu(document.getElementById('ws-model-label'), document.getElementById('ws-model-select'), 'ws-model-menu');
    populateWsMenu(document.getElementById('workspace-model-label'), document.getElementById('workspace-model-select'), 'workspace-model-menu');

    // Etiqueta del modelo actual: preferencia guardada, o el primer modelo
    // de la lista si ya está cargada; si nada, placeholder neutro.
    const mainBtnLabel = document.getElementById('main-model-label');
    const topModelLabel = document.getElementById('top-model-label');
    const topModelBtn = document.getElementById('top-model-btn');
    const mainInput = document.getElementById('model-select');
    if (mainInput) {
        const models = window.aiModelList || [];
        const activeModel = defaultModel || (models.length > 0 && models[0].name) || '';
        if (activeModel) {
            const disp = modelDisplayName({ name: activeModel });
            if (mainBtnLabel) {
                mainBtnLabel.textContent = disp;
                mainBtnLabel.title = activeModel;
            }
            if (topModelLabel) {
                topModelLabel.textContent = disp;
                topModelLabel.title = 'Modelo actual: ' + activeModel;
            }
            if (topModelBtn) topModelBtn.title = 'Modelo actual: ' + activeModel;
            mainInput.value = activeModel;
        } else {
            if (mainBtnLabel) {
                mainBtnLabel.textContent = noModelsText;
                mainBtnLabel.title = '';
            }
            if (topModelLabel) {
                topModelLabel.textContent = noModelsText;
                topModelLabel.title = '';
            }
            mainInput.value = '';
        }
    }
}

// Carga la lista de modelos BAJO DEMANDA (picker, ajustes o envío). La
// primera llamada hace el fetch; el resultado queda cacheado y repuebla
// todos los selectores. Si falla, se reintenta en la siguiente llamada.
let _modelsPromise = null;
export function ensureModelsLoaded() {
    if (!_modelsPromise) {
        _modelsPromise = (async () => {
            let models = [];
            try {
                models = await window.fetchModels();
            } catch (e) {
                models = [];
            }
            window.aiModelList = models;

            // Preferencia por defecto: si no hay (o es obsoleta/inexistente),
            // fijar el primer modelo disponible. "Ollama/Local" no es un
            // modelo real y un valor vacío rompía el envío.
            let defaultModel = null;
            try {
                const prefRes = await fetch('/api/ai/preferences');
                if (prefRes.ok) {
                    const pData = await prefRes.json();
                    defaultModel = pData.default_model;
                }
            } catch (e) { }
            if (models.length > 0 && (!defaultModel || !models.some(m => m.name === defaultModel))) {
                defaultModel = models[0].name;
                fetch('/api/ai/preferences', {
                    method: 'POST',
                    body: JSON.stringify({ default_model: defaultModel })
                }).catch(() => { });
            }
            populateModelSelects(defaultModel);
            return models;
        })().catch((e) => {
            _modelsPromise = null;
            window.aiModelList = window.aiModelList || [];
            return window.aiModelList;
        });
    }
    return _modelsPromise;
}
window.ensureModelsLoaded = ensureModelsLoaded;

export async function init() {
    // Arranque: sustituir la bienvenida pre-renderizada por un estado de carga
    // y restaurar el último chat de forma SÍNCRONA desde localStorage ANTES de
    // esperar a la red. Evita el flash de "sin chat" al recargar la página.
    _bootChatLog();
    // Red de seguridad: si algo del arranque síncrono falla (localStorage
    // corrupto, etc.), NUNCA debe impedir cargar los modelos ni mostrar la
    // bienvenida.
    try { loadHistory(); } catch (e) { console.error('loadHistory falló durante el arranque:', e); }
    try { _restoreLastChat(); } catch (e) { console.error('Fallo restaurando el último chat:', e); }
    // Red de seguridad: si el arranque síncrono no restauró ningún chat y la
    // red falla, la bienvenida aparece en 2s (nunca dejar el contenedor en
    // "Cargando conversación..." esperando a la red).
    setTimeout(() => _showWelcomeIfIdle(), 2000);

    // Modelos BAJO DEMANDA: la lista no se carga al arrancar (puede ser
    // enorme con las APIs externas). Solo se lee la preferencia guardada
    // para mostrar el modelo elegido; la lista completa se obtiene cuando
    // el usuario abre el selector/ajustes o envía sin modelo cargado.
    window.aiModelList = [];
    let defaultModel = null;
    try {
        const prefRes = await fetch('/api/ai/preferences');
        if (prefRes.ok) {
            const pData = await prefRes.json();
            defaultModel = pData.default_model;
        }
    } catch (e) { }
    populateModelSelects(defaultModel);

    const logContainer = document.getElementById('chat-log');
    if (logContainer && !logContainer.dataset.scrollListenerAttached) {
        logContainer.dataset.scrollListenerAttached = 'true';
        let isScrollLoading = false;
        logContainer.addEventListener('scroll', () => {
            if (logContainer.scrollTop <= 20 && !isScrollLoading) {
                if (window.chatMessages && (window._renderedMessageCount || 20) < window.chatMessages.length) {
                    isScrollLoading = true;
                    window.loadMoreHistoryMessages();
                    setTimeout(() => { isScrollLoading = false; }, 400);
                }
            }
        });
    }

    const slashCommands = [
        { name: '/agenda', description: 'Activar / desactivar modo agenda', run: () => { if (window.toggleAIMode) window.toggleAIMode(); } },
        { name: '/web', description: 'Activar / desactivar búsqueda web', run: () => { if (window.toggleWebSearch) window.toggleWebSearch(); } },
    ];

    initSlashCommands({
        input: document.getElementById('chat-input'),
        commands: slashCommands,
    });

    // Ocultar el botón de enviar mientras se escribe/busca un comando
    const chatInputEl = document.getElementById('chat-input');
    if (chatInputEl) {
        chatInputEl.addEventListener('input', () => {
            updateSendButtonState();
            const sendBtn = document.getElementById('send-btn');
            if (!sendBtn) return;
            const isCmd = chatInputEl.value.trim().startsWith('/') && !window.isGenerating;
            sendBtn.style.display = isCmd ? 'none' : '';
        });
    }

    // Chat del detalle de workspace
    initSlashCommands({
        input: document.getElementById('workspace-chat-input'),
        commands: slashCommands,
    });

    try { loadHistory(); } catch (e) { console.error('loadHistory falló tras el arranque:', e); }
    syncHistoryFromDB();
    checkActiveGenerations();
    updateSendButtonState();
    setupVisualViewport();
    setupStickyHeader();
    setupInputFocusScroll();

    // Red de seguridad: si el chequeo de generaciones no respondió, mostrar la
    // bienvenida para no dejar el contenedor en "cargando" indefinidamente.
    // (Ya programado al inicio de init(); se mantiene aquí por si el arranque
    // se prolonga más de 8s con una restauración en curso.)
    setTimeout(() => _showWelcomeIfIdle(), 2000);
}

window.selectMainModel = function (val, label) {
    const input = document.getElementById('model-select');
    const btnLabel = document.getElementById('main-model-label');
    const topModelLabel = document.getElementById('top-model-label');
    const topModelBtn = document.getElementById('top-model-btn');
    const disp = modelDisplayName({ name: label || val });

    if (input) input.value = val;
    if (btnLabel) { btnLabel.textContent = disp; btnLabel.title = label || val; }
    if (topModelLabel) { topModelLabel.textContent = disp; topModelLabel.title = 'Modelo actual: ' + (label || val); }
    if (topModelBtn) topModelBtn.title = 'Modelo actual: ' + (label || val);

    // Save preference to backend
    fetch('/api/ai/preferences', {
        method: 'POST',
        body: JSON.stringify({ default_model: val })
    }).catch(e => { });
};

export async function checkActiveGenerations() {
    if (window.isGenerating) return;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    try {
        const res = await fetch('/api/ai/generating', { signal: ctrl.signal });
        clearTimeout(timeout);
        if (!res.ok) return;
        const data = await res.json();
        const active = data.active || {};

        const activeIds = Object.keys(active);
        if (activeIds.length > 0) {
            // Check if current chat is generating, otherwise pick the first one
            const generatingId = (window.currentChatId && active[window.currentChatId]) ? window.currentChatId : activeIds[0];
            window.generatingChatId = generatingId;

            // Recarga tan rápida que el session_id aún no llegó a esta pestaña:
            // restaurar la sesión que está generando para mostrar el estado
            // correcto (3 puntos) en lugar de la pantalla de bienvenida.
            if (!window.currentChatId && generatingId) {
                window.currentChatId = generatingId;
                _saveLastChatId(generatingId);
                try {
                    const msgRes = await fetch(`/api/ai/sessions/${generatingId}/messages`);
                    if (msgRes.ok) {
                        const messages = await msgRes.json();
                        const clean = _sanitizeDbMessages(Array.isArray(messages) ? messages : []);
                        if (clean.length) {
                            window.chatMessages = clean.map(m => ({
                                role: m.role,
                                content: m.content || '',
                                attachments: m.attachments || [],
                                cancelled: !!m.cancelled
                            }));
                            addChatToSidebar(generatingId);
                            renderChat();
                        }
                    }
                } catch (e) { /* sin red: seguir con la pantalla actual */ }
                // Sin mensajes en BD: dejar al menos la bienvenida como fondo
                // para el indicador de generación.
                _showWelcomeIfIdle();
            }

            enterGeneratingState();
            pollGenerationStatus(generatingId);
        } else {
            window.generatingChatId = null;
            // Sin generación en curso: si el último mensaje quedó sin respuesta,
            // dejar el marcador persistente de interrupción.
            setTimeout(() => _maybeMarkCancelledChat(), 800);
            // Arranque sin nada que restaurar: ya se puede mostrar la bienvenida.
            _showWelcomeIfIdle();
        }
    } catch (e) {
        // Fallo de red en el chequeo: no dejar el contenedor cargando.
        _showWelcomeIfIdle();
    }
}

function enterGeneratingState() {
    window.isGenerating = true;
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.innerHTML = '<div style="width:12px;height:12px;background:white;border-radius:2px;"></div>';
        sendBtn.style.background = '#ef4444';
        sendBtn.disabled = false;
        // Onda de pulso mientras se genera la respuesta (micro-interacción)
        sendBtn.classList.add('generating');
    }
    const input = document.getElementById('chat-input');
    if (input) {
        input.placeholder = 'Enviar un Mensaje';
    }
    const searchBtn = document.getElementById('search-mode-btn');
    if (searchBtn) searchBtn.disabled = true;

    // Show typing dots if not present and the generating chat is the active one
    if (window.generatingChatId === window.currentChatId) {
        const log = document.getElementById('chat-log');
        if (log && !log.querySelector('.msg-typing')) {
            const typingDots = document.createElement('div');
            typingDots.className = 'msg-typing';
            typingDots.innerHTML = '<span></span><span></span><span></span>';
            log.appendChild(typingDots);
            log.scrollTop = log.scrollHeight;
        }
    }
}

function exitGeneratingState() {
    window.isGenerating = false;
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.93l-.11 4.53c.57 0 .82-.25 1.13-.56l2.7-2.59 5.61 4.13c1.03.57 1.77.27 2.05-.96l3.71-17.48c.38-1.7-.64-2.63-1.78-2.19L1.02 10.08c-1.69.66-1.67 1.62-.31 2.04l5.04 1.58 11.95-7.54c.56-.37 1.08-.17.66.21L9.04 15.93z"/></svg>';
        sendBtn.style.background = 'transparent';
        sendBtn.classList.remove('generating');
        updateSendButtonState();
    }
    const input = document.getElementById('chat-input');
    if (input) {
        input.placeholder = 'Enviar un Mensaje';
    }
    const searchBtn = document.getElementById('search-mode-btn');
    if (searchBtn) searchBtn.disabled = false;

    // Remove typing dots if present
    const log = document.getElementById('chat-log');
    if (log) {
        const dots = log.querySelector('.msg-typing');
        if (dots) dots.remove();
    }
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
                // La generación terminó: si no quedó respuesta persistida para el
                // último mensaje del usuario, dejar el marcador de interrupción.
                // El retardo cubre la ventana en la que el worker del backend
                // persiste la respuesta justo después de marcar la sesión inactiva.
                setTimeout(() => _maybeMarkCancelledChat(), 3500);
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

            // La BD no persiste interrupciones (cancelación, error sin texto):
            // recoger TODOS los marcadores de cancelación del chat local (no
            // solo el último) para re-insertarlos tras su mensaje de usuario.
            const localMarkersByUser = new Map();
            if (Array.isArray(window.chatMessages)) {
                let lastUserContent = null;
                for (const m of window.chatMessages) {
                    if (!m) continue;
                    if (m.role === 'user') {
                        lastUserContent = String(m.content ?? '');
                    } else if (m.role === 'assistant' && m.cancelled && lastUserContent !== null) {
                        if (!localMarkersByUser.has(lastUserContent)) {
                            localMarkersByUser.set(lastUserContent, []);
                        }
                        localMarkersByUser.get(lastUserContent).push({
                            role: 'assistant',
                            content: '',
                            cancelled: true,
                            model: (document.getElementById('model-select') || {}).value || ''
                        });
                    }
                }
            }

            const dbList = _sanitizeDbMessages(messages).map(m => ({
                role: m.role,
                content: m.content || '',
                attachments: m.attachments || [],
                cancelled: !!m.cancelled
            }));

            // La BD NO persiste errores ni respuestas interrumpidas sin texto
            // final (el worker solo guarda respuestas completas). Si no se
            // conservan, al recargar el error se pierde y el mensaje se marca
            // falsamente como "cancelado". Se recogen las respuestas locales
            // (no canceladas) que la BD no tiene, para re-insertarlas tras su
            // mensaje de usuario.
            const dbKeys = new Set(dbList.map(m => `${m.role}\u0000${String(m.content ?? '')}`));
            const localMsgs = Array.isArray(window.chatMessages) ? window.chatMessages : [];
            const extrasAfterUser = new Map();
            {
                let lastUserKey = null;
                for (const lm of localMsgs) {
                    if (!lm) continue;
                    if (lm.role === 'user') { lastUserKey = String(lm.content ?? ''); continue; }
                    if (lm.role !== 'assistant' || lm.cancelled) continue;
                    if (!String(lm.content ?? '').trim()) continue;
                    if (dbKeys.has(`${lm.role}\u0000${String(lm.content ?? '')}`)) continue;
                    if (lastUserKey === null) continue;
                    if (!extrasAfterUser.has(lastUserKey)) extrasAfterUser.set(lastUserKey, []);
                    extrasAfterUser.get(lastUserKey).push(lm);
                }
            }

            const isGenerating = _chatIsGenerating();
            const rebuilt = [];
            for (let i = 0; i < dbList.length; i++) {
                const m = dbList[i];
                rebuilt.push(m);
                if (m.role !== 'user') continue;
                // Solo si la BD tampoco tiene respuesta para este mensaje de
                // usuario (si la respuesta se completó, el marcador no aplica).
                const next = dbList[i + 1];
                if (next && next.role === 'assistant') continue;
                const queue = localMarkersByUser.get(String(m.content ?? ''));
                const marker = queue && queue.length ? queue.shift() : null;
                // Si el último mensaje está recibiendo respuesta aún (3 puntos),
                // no colgarle el marcador todavía.
                if (marker && !(isGenerating && i === dbList.length - 1)) {
                    rebuilt.push(marker);
                }
                // Errores/interrupciones locales no persistidos: conservarlos
                // para que el usuario vea qué falló (y no "cancelado").
                const extras = extrasAfterUser.get(String(m.content ?? ''));
                if (extras && extras.length) rebuilt.push(...extras);
            }
            window.chatMessages = rebuilt;

            renderChat();

            // Update in local history too
            let history = _parseLocalHistory();
            const idx = history.findIndex(c => String(c.id) === String(window.currentChatId));
            if (idx !== -1) {
                history[idx].messages = window.chatMessages;
                localStorage.setItem(`nv_ai_history_${currentUserId}`, JSON.stringify(history));
            }
            // Reconciliación final por si la respuesta apareció justo después del
            // fetch (ventana en la que el worker persiste tras marcar inactivo).
            setTimeout(() => _maybeMarkCancelledChat(), 2500);
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

        let history = _parseLocalHistory();
        let modified = false;

        // Sesiones nuevas en BD (no están en localStorage): solo las más
        // recientes, en PARALELO y con timeout individual — un request colgado
        // nunca debe retrasar el resto (antes: fetch secuencial 1 a 1, que con
        // muchas sesiones o red lenta alargaba el arranque varios segundos).
        const missing = (dbSessions || [])
            .filter(s => !history.find(x => String(x.id) === String(s.id)))
            .slice(0, 30);
        const results = await Promise.all(missing.map(async (session) => {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 4000);
            try {
                const msgRes = await fetch(`/api/ai/sessions/${session.id}/messages`, { signal: ctl.signal });
                if (!msgRes.ok) return null;
                const messages = await msgRes.json();
                return { session, messages };
            } catch (e) {
                return null;
            } finally {
                clearTimeout(timer);
            }
        }));

        for (const item of results) {
            if (!item) continue;
            const { session, messages } = item;
            // Saltar sesiones sin mensajes: no ensucian el historial
            if (!Array.isArray(messages) || messages.length === 0) continue;
            history.push({
                id: session.id,
                title: session.title,
                shared_by: session.shared_by || null,
                workspace_id: session.workspace_id || null,
                messages: _sanitizeDbMessages(messages).map(m => ({
                    role: m.role,
                    content: m.content,
                    cancelled: !!m.cancelled
                }))
            });
            modified = true;
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
    haptic();
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = text;
    autoResize(input);
    if (!isMobileDevice()) input.focus();
}

window.openArtifactPanel = function (codeContent, language = 'html', title = 'Artefacto') {
    let panel = document.getElementById('artifact-panel');
    const layout = document.querySelector('.app-layout') || document.querySelector('.main-chat')?.parentElement;

    if (!panel) return;

    let validLang = (language && typeof language === 'string' && language.toLowerCase() !== 'undefined') ? language.toLowerCase() : 'html';

    window._currentArtifactCode = codeContent;
    window._currentArtifactLang = validLang;

    const titleEl = document.getElementById('artifact-title');
    if (titleEl) titleEl.textContent = `${title} • ${validLang.toUpperCase()}`;

    const iframe = document.getElementById('artifact-iframe');
    const codeBlock = document.getElementById('artifact-code-block');

    if (codeBlock) {
        codeBlock.textContent = codeContent;
        delete codeBlock.dataset.highlighted;

        const isKnown = window.hljs && typeof window.hljs.getLanguage === 'function' && window.hljs.getLanguage(validLang);
        codeBlock.className = isKnown ? `hljs language-${validLang}` : 'hljs';

        if (isKnown) {
            try {
                window.hljs.highlightElement(codeBlock);
            } catch (e) { }
        }
    }

    if (iframe) iframe.srcdoc = codeContent;

    window.switchArtifactTab('preview');

    panel.style.display = 'flex';
    if (layout) layout.classList.add('has-artifact');
};

window.switchArtifactTab = function (tab) {
    const iframe = document.getElementById('artifact-iframe');
    const pre = document.getElementById('artifact-code-pre');
    const tabPrev = document.getElementById('artifact-tab-preview');
    const tabCode = document.getElementById('artifact-tab-code');

    if (!iframe || !pre) return;

    if (tab === 'preview') {
        iframe.style.display = 'block';
        pre.style.display = 'none';
        if (tabPrev) tabPrev.classList.add('active');
        if (tabCode) tabCode.classList.remove('active');
    } else {
        iframe.style.display = 'none';
        pre.style.display = 'block';
        if (tabCode) tabCode.classList.add('active');
        if (tabPrev) tabPrev.classList.remove('active');
    }
};

window.closeArtifactPanel = function () {
    const panel = document.getElementById('artifact-panel');
    const layout = document.querySelector('.app-layout') || document.querySelector('.main-chat')?.parentElement;
    const notesView = document.getElementById('notes-view');
    if (panel) {
        panel.classList.remove('fullscreen');
        panel.style.display = 'none';
        if (layout && notesView && panel.parentElement !== layout) {
            layout.insertBefore(panel, notesView);
        }
    }
    if (layout) layout.classList.remove('has-artifact');
};

window.copyArtifactCode = function () {
    if (window._currentArtifactCode) {
        navigator.clipboard.writeText(window._currentArtifactCode);
        if (window.showToast) window.showToast('Código copiado al portapapeles', 'success');
    }
};

window.toggleArtifactFullscreen = function () {
    const panel = document.getElementById('artifact-panel');
    const layout = document.querySelector('.app-layout') || document.querySelector('.main-chat')?.parentElement;
    const notesView = document.getElementById('notes-view');
    if (!panel) return;

    const isFullscreen = panel.classList.toggle('fullscreen');
    if (isFullscreen) {
        document.body.appendChild(panel);
    } else {
        if (layout && notesView && panel.parentElement !== layout) {
            layout.insertBefore(panel, notesView);
        }
    }
};

export function addCodeCopyButtons(container, forceWidget = false) {
    if (!container) return;
    const isWidget = forceWidget || !!(container.id === 'ai-widget-messages' || container.closest('#ai-widget-messages') || container.closest('#ai-agent-widget'));

    container.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-header-bar')) return;

        const code = pre.querySelector('code');
        if (!code) return;

        pre.style.position = 'relative';
        pre.style.padding = '0';
        pre.style.overflow = 'hidden';
        pre.style.borderRadius = '8px';

        const langClass = (code.className || '').toLowerCase();
        const codeText = code.innerText.trim();
        const isHtml = langClass.includes('html') || langClass.includes('xml') || langClass.includes('svg') || codeText.startsWith('<!doctype html') || codeText.startsWith('<html');

        const headerBar = document.createElement('div');
        headerBar.className = 'code-header-bar';
        headerBar.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: var(--cs-surface-container); border-bottom: 1px solid var(--cs-border); padding: 8px 12px; font-size: 0.78rem; font-family: inherit; color: var(--cs-text-muted); border-top-left-radius: 8px; border-top-right-radius: 8px; margin: 0; position: sticky; top: 0; z-index: 5; backdrop-filter: blur(8px); flex-wrap: wrap; gap: 6px;';

        code.style.display = 'block';
        code.style.padding = '14px 16px';
        code.style.overflowX = 'auto';

        const leftGroup = document.createElement('div');
        leftGroup.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const langBadge = document.createElement('span');
        langBadge.style.cssText = 'font-weight: 700; text-transform: uppercase; color: var(--primary, #6366f1); font-size: 0.7rem; letter-spacing: 0.05em;';
        const detectedLang = isHtml ? 'HTML' : (langClass.match(/language-([a-z0-9]+)/)?.[1] || 'CODE');
        langBadge.textContent = detectedLang;
        leftGroup.appendChild(langBadge);

        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        if (!isWidget) {
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.title = 'Expandir / Ver completo';
            expandBtn.style.cssText = 'background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: var(--text-main, #e2e8f0); border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: all 0.2s;';
            const expandIconSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
            expandBtn.innerHTML = `${expandIconSVG} <span>Expandir</span>`;
            expandBtn.onclick = () => {
                const isExpanded = pre.classList.toggle('expanded');
                expandBtn.querySelector('span').textContent = isExpanded ? 'Reducir' : 'Expandir';
            };
            rightGroup.appendChild(expandBtn);
        }

        if (isHtml && !isWidget) {
            const tabPreview = document.createElement('button');
            tabPreview.type = 'button';
            tabPreview.style.cssText = 'background: var(--primary, #6366f1); color: #fff; border: none; border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; shadow: 0 2px 8px rgba(99,102,241,0.3);';
            const eyeIconSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
            tabPreview.innerHTML = `${eyeIconSVG} <span>Vista Previa</span>`;

            tabPreview.onclick = () => {
                const titleMatch = codeText.match(/<title>(.*?)<\/title>/i);
                const title = titleMatch ? titleMatch[1] : 'Vista Previa de Código';
                window.openArtifactPanel(code.innerText, 'HTML', title);
            };

            leftGroup.appendChild(tabPreview);
        }

        const downloadCodeBtn = document.createElement('button');
        downloadCodeBtn.type = 'button';
        downloadCodeBtn.title = 'Descargar archivo de código';
        downloadCodeBtn.style.cssText = 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; color: var(--text-main, #e2e8f0); cursor: pointer; padding: 3px 8px; font-size: 0.72rem; display: flex; align-items: center; gap: 5px; transition: all 0.2s;';
        const downloadIconSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
        downloadCodeBtn.innerHTML = `${downloadIconSVG} <span>Descargar</span>`;
        downloadCodeBtn.onclick = () => {
            const rawCode = code.innerText;
            const titleMatch = codeText.match(/<title>(.*?)<\/title>/i);
            const titleName = titleMatch ? titleMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '_') : '';

            let ext = 'txt';
            const upperLang = detectedLang.toUpperCase();
            if (isHtml || upperLang === 'HTML') ext = 'html';
            else if (upperLang === 'JS' || upperLang === 'JAVASCRIPT') ext = 'js';
            else if (upperLang === 'CSS') ext = 'css';
            else if (upperLang === 'PYTHON' || upperLang === 'PY') ext = 'py';
            else if (upperLang === 'JSON') ext = 'json';
            else if (upperLang === 'MD' || upperLang === 'MARKDOWN') ext = 'md';
            else ext = detectedLang.toLowerCase() || 'txt';

            const fileName = isHtml ? (titleName ? `${titleName}.html` : 'index.html') : `codigo.${ext}`;

            const blob = new Blob([rawCode], { type: isHtml ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 4000);

            if (window.showToast) window.showToast(`✓ Archivo descargado: ${fileName}`, 'success');
        };

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.title = 'Copiar código';
        copyBtn.style.cssText = 'background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; color: var(--text-main, #e2e8f0); cursor: pointer; padding: 3px 8px; font-size: 0.72rem; display: flex; align-items: center; gap: 5px; transition: all 0.2s;';
        const copyIconSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.innerHTML = `${copyIconSVG} <span>Copiar</span>`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(code.innerText).then(() => {
                const checkSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                copyBtn.innerHTML = `${checkSVG} <span>Copiado</span>`;
                setTimeout(() => {
                    copyBtn.innerHTML = `${copyIconSVG} <span>Copiar</span>`;
                }, 2000);
            });
        };
        rightGroup.appendChild(downloadCodeBtn);
        rightGroup.appendChild(copyBtn);

        headerBar.appendChild(leftGroup);
        headerBar.appendChild(rightGroup);

        pre.insertBefore(headerBar, pre.firstChild);
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
        document.querySelectorAll('.msg-edit-btn').forEach(b => b.remove());
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn msg-edit-btn';
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
    row.className = 'message-row ' + (role === 'assistant' ? 'ai-row' : 'user-row');
    row.oncontextmenu = (e) => {
        e.preventDefault();
        const idx = window.chatMessages.findIndex(m => m.content === content && m.role === role);
        openMessageContextMenu(e, role, content, idx >= 0 ? idx : window.chatMessages.length - 1);
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
            const isImage = att.isImage || att.type?.startsWith('image/') || att.data?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att.name || '');
            const isAudio = att.isAudio || att.type?.startsWith('audio/') || att.name?.endsWith('.webm');

            if (isImage && (att.data || attachmentServerUrl(att))) {
                const img = document.createElement('img');
                img.src = att.data || attachmentServerUrl(att);
                img.style.maxWidth = '250px';
                img.style.maxHeight = '250px';
                img.style.borderRadius = '8px';
                img.style.border = '1px solid var(--border)';
                img.style.cursor = 'pointer';
                img.onclick = () => openAttachmentPreview(att);
                attachContainer.appendChild(img);
            } else if (isAudio && (att.data || attachmentServerUrl(att))) {
                const audio = document.createElement('audio');
                audio.src = att.data || attachmentServerUrl(att);
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
                const iconSVG = isImage
                    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
                    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
                fileChip.innerHTML = `${iconSVG}<span>${att.name}</span>`;
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
    if (fromButton) haptic();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    let model = document.getElementById('model-select').value;
    // Modelos bajo demanda: si aún no hay modelo cargado, intentar obtener
    // la lista antes de bloquear el envío con el aviso de descarga.
    if ((!model || model === 'loading') && !window.isGenerating) {
        await ensureModelsLoaded();
        model = document.getElementById('model-select').value;
    }

    if (isModelPickerOpen(input)) return;  // el Enter lo gestiona la paleta
    if (text.startsWith('/') && !window.isGenerating) return;  // los / son comandos
    if (window.isGenerating) {
        if (fromButton) {
            if (window.abortController) {
                window.abortController.abort();
            }
            window._manualCancel = true;
            fetch('/api/ai/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: window.currentChatId })
            }).catch(() => { });
            if (window.showToast) window.showToast('Mensaje cancelado', 'info');
            exitGeneratingState();
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
    window._manualCancel = false;
    window.abortController = new AbortController();

    // Keepalive: touch the session every 10s to prevent logout during long responses
    const keepAliveInterval = setInterval(() => {
        if (!window.isGenerating) { clearInterval(keepAliveInterval); return; }
        fetch('/api/ai/heartbeat', { method: 'POST' }).catch(() => { });
    }, 10000);
    input.value = ''; input.style.height = 'auto';

    let finalPrompt = text;
    const currentAttachments = [...(window.attachedFiles || [])];
    if (window.attachedFiles && window.attachedFiles.length > 0) {
        const fileContext = window.attachedFiles.map(f => {
            const ext = (f.name || '').split('.').pop().toLowerCase();
            const isText = f.isText || f.type?.startsWith('text/') || ['txt', 'md', 'markdown', 'js', 'jsx', 'ts', 'tsx', 'py', 'pyw', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx', 'cs', 'java', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'jsonc', 'xml', 'yaml', 'yml', 'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'csv', 'tsv', 'env', 'ini', 'cfg', 'conf', 'toml', 'log', 'dockerfile', 'makefile', 'r', 'm', 'dart', 'scala', 'lua'].includes(ext);
            if (!f.isImage && isText && f.data && typeof f.data === 'string' && !f.data.startsWith('data:image')) {
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
    let wasCancelled = false;
    const _showError = (errText) => {
        hadError = true;
        fullResponse += `\n\n*Error: ${errText}*`;
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        appendChatAlert(aiWrapper, errText);
        if (window.showToast) window.showToast('Error: ' + errText, 'error');
    };

    // Interrupción del stream (desconexión, recarga o cancelación): cerrar la
    // respuesta inacabada de forma limpia, sin volcar el error técnico del
    // socket/fetch ni fragmentos JSON a medio generar en la burbuja de la IA.
    const _markCancelled = () => {
        hadError = true;
        wasCancelled = true;
        if (typingDots && typingDots.parentNode) typingDots.remove();
        if (_isJsonishToolFragment(fullResponse)) {
            fullResponse = _stripJsonishFragment(fullResponse);
        }
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        if (!aiWrapper.querySelector('.msg-cancelled')) {
            aiWrapper.appendChild(createCancelledBadge());
        }
        const manual = !!window._manualCancel;
        window._manualCancel = false;
        if (!manual && window.showToast) window.showToast('Mensaje cancelado', 'info');
    };

    try {
        const _numCtx = parseInt(localStorage.getItem('model_num_ctx')) || 262144;
        const _numPred = parseInt(localStorage.getItem('model_num_predict')) || 65536;
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
                messages: [...window.chatMessages.slice(0, -1), (() => {
                    // Los adjuntos ya subidos al servidor viajan como refs ligeros
                    // (sin base64); los que aún no se persistieron conservan su data.
                    const payloadAttachments = currentAttachments.map(a => {
                        if (!a.fileId && !(a.id && !a.data && typeof a.id === 'string')) return a;
                        return {
                            id: a.fileId || a.id,
                            name: a.name,
                            size: a.size,
                            sizeLabel: a.sizeLabel,
                            type: a.type,
                            isImage: a.isImage,
                            isText: a.isText,
                            isAudio: a.isAudio
                        };
                    });
                    const userMsgObj = { role: 'user', content: finalPrompt, attachments: payloadAttachments };
                    const imgList = [];
                    currentAttachments.forEach(att => {
                        const isImg = att.isImage || att.type?.startsWith('image/') || att.data?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att.name || '');
                        if (isImg && att.data && !att.fileId) {
                            const b64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                            if (b64) imgList.push(b64);
                        }
                    });
                    if (imgList.length > 0) userMsgObj.images = imgList;
                    return userMsgObj;
                })()].map(m => {
                    const item = { role: m.role, content: m.content };
                    if (m.images) item.images = m.images;
                    if (m.attachments) item.attachments = m.attachments;
                    return item;
                })
                    // El historial local puede contener marcadores de cancelación u
                    // otros mensajes con contenido vacío (la BD/validación del
                    // backend los rechaza con "Mensaje vacío en el historial").
                    .filter(m => String(m.content || '').trim()),
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
                        if (_isInterruptedError(json.error)) {
                            _markCancelled();
                        } else {
                            _showError(json.error);
                        }
                        break;
                    }
                    if (json.message?.content) {
                        fullResponse += json.message.content;
                        const chatLog = document.getElementById('chat-log');
                        const isAtBottom = chatLog ? (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 150) : false;
                        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
                        if (chatLog && isAtBottom) chatLog.scrollTop = chatLog.scrollHeight;
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
                        const chatLog = document.getElementById('chat-log');
                        const isAtBottom = chatLog ? (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 150) : false;
                        if (chatLog && isAtBottom) chatLog.scrollTop = chatLog.scrollHeight;
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            _markCancelled();
        } else if (_isInterruptedError(e && e.message)) {
            // Desconexión/recarga a mitad del stream: cancelación limpia si ya
            // había contenido generado; si no llegó a empezar, es un fallo de
            // conexión normal y se muestra el mensaje amigable.
            if (fullResponse.trim() || fullReasoning.trim()) {
                _markCancelled();
            } else {
                _showError('No se pudo conectar con el servidor de IA. Comprueba que el servicio esté activo.');
            }
        } else {
            const errText = (e && e.message && !/^Failed to fetch/.test(e.message))
                ? e.message
                : 'No se pudo conectar con el servidor de IA. Comprueba que el servicio esté activo.';
            _showError(errText);
        }
    }

    // Modelos (p. ej. fine-tuneados) que alucinan su formato interno de JSON:
    // limpiar la respuesta antes de mostrarla/persistirla como texto natural.
    const wasJsonGarbage = _isJsonishToolFragment(fullResponse);
    if (wasJsonGarbage) {
        fullResponse = _stripJsonishFragment(fullResponse);
    }

    if (!hadError && !fullResponse.trim()) {
        if (wasJsonGarbage) {
            // El modelo solo emitió JSON sin texto útil: nota neutra en vez de
            // un error de conexión/modelo.
            fullResponse = '*(El modelo no generó una respuesta válida.)*';
        } else {
            const isExternal = model.startsWith('API:');
            const errMsg = isExternal
                ? 'No se recibió respuesta del modelo externo. Verifica que tengas saldo/créditos suficientes en tu cuenta, o prueba con otro modelo.'
                : 'No se recibió respuesta del modelo. Verifica que el modelo esté instalado y que el motor de IA local (Ollama) esté activo.';
            _showError(errMsg);
        }
    }

    if (wasJsonGarbage) {
        // Re-render con el contenido limpio (el stream pudo haber mostrado el
        // JSON crudo mientras llegaba).
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        if (wasCancelled && !aiWrapper.querySelector('.msg-cancelled')) {
            aiWrapper.appendChild(createCancelledBadge());
        }
    }

    if (typingDots && typingDots.parentNode) typingDots.remove();

    const endTime = performance.now();
    const durationStr = ((endTime - startTime) / 1000).toFixed(1);

    window.isGenerating = false;
    clearInterval(keepAliveInterval);
    window._streamingCompleted = true; // Tell pollGenerationStatus not to re-fetch from DB
    clearChatGenStatus();
    sendBtn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.93l-.11 4.53c.57 0 .82-.25 1.13-.56l2.7-2.59 5.61 4.13c1.03.57 1.77.27 2.05-.96l3.71-17.48c.38-1.7-.64-2.63-1.78-2.19L1.02 10.08c-1.69.66-1.67 1.62-.31 2.04l5.04 1.58 11.95-7.54c.56-.37 1.08-.17.66.21L9.04 15.93z"/></svg>';
    sendBtn.style.background = 'transparent';
    window.chatMessages.push({ role: 'assistant', content: fullResponse, model: model, duration: durationStr, reasoning: fullReasoning || undefined, cancelled: wasCancelled });
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
            <div class="ai-identity" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <path d="M12 3l1.9 5.7a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"></path>
                </svg>
            </div>
            <div class="welcome-title">Hola, ${username}</div>
            <div class="welcome-subtitle">¿Cómo puedo ayudarte hoy?</div>
            <div class="welcome-hint" style="margin:0 0 24px 0;display:inline-flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--text-dim);background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);padding:4px 10px;border-radius:16px;opacity:0.7;">
                <span>Escribe</span>
                <code style="color:#818cf8;background:rgba(129,140,248,0.15);padding:1px 5px;border-radius:4px;font-weight:700;font-size:0.75rem;">/</code>
                <span>para comandos y modelos</span>
            </div>
            <div class="suggestion-grid">
                <div class="suggestion-card" onclick="setInput('/agenda')">
                    <div style="font-weight:600;font-size:0.88rem;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                        <code style="color:#818cf8;background:rgba(129,140,248,0.15);padding:1px 6px;border-radius:4px;font-size:0.8rem;">/agenda</code>
                        <span>Modo Agenda</span>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-dim);line-height:1.4;">Activa el modo enfocado en gestión de tareas y organización.</div>
                </div>
                <div class="suggestion-card" onclick="setInput('/web')">
                    <div style="font-weight:600;font-size:0.88rem;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                        <code style="color:#818cf8;background:rgba(129,140,248,0.15);padding:1px 6px;border-radius:4px;font-size:0.8rem;">/web</code>
                        <span>Búsqueda Web</span>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-dim);line-height:1.4;">Alterna la búsqueda en tiempo real en internet para tus consultas.</div>
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
    const history = _parseLocalHistory();
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
    const history = _parseLocalHistory();
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

// Estado de carga inicial: sustituye la pantalla de bienvenida pre-renderizada
// del template para que el arranque NUNCA muestre "sin chat" antes de saber si
// existe un último chat que restaurar (localStorage) o una generación activa en
// el servidor. La bienvenida real se decide al final (checkActiveGenerations).
function _bootChatLog() {
    if (window._aiBooted) return;
    window._aiBooted = true;
    const log = document.getElementById('chat-log');
    if (!log) return;
    if (Array.isArray(window.chatMessages) && window.chatMessages.length > 0) return;
    log.innerHTML = '<div class="chat-loading"><div class="chat-loading-spinner"></div><span>Cargando conversación...</span></div>';
}

// Si el arranque terminó sin ningún chat que mostrar (no hay último chat en
// cache ni generación activa), pintar la pantalla de bienvenida.
function _showWelcomeIfIdle() {
    const log = document.getElementById('chat-log');
    if (!log) return;
    if (Array.isArray(window.chatMessages) && window.chatMessages.length > 0) return;
    if (!log.querySelector('.chat-loading')) return;
    log.innerHTML = _welcomeHtml();
}

function _restoreLastChat() {
    try {
        let lastId = null;
        try { lastId = localStorage.getItem('nv_ai_last_chat'); } catch (e) { /* sin almacenamiento */ }
        if (!lastId) return;
        const history = _parseLocalHistory();
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

        // Ensure sidebar is closed on mobile when restoring chat automatically
        if (window.innerWidth <= 767) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.remove('open');
            }
        }
    } catch (e) {
        console.error('Error restaurando el último chat:', e);
        // Nunca dejar el contenedor en negro: mantener el estado de carga; la
        // bienvenida se decide al final del arranque.
        _bootChatLog();
    }
}

// El historial local puede corromperse (escrituras parciales, versiones antiguas
// del código, extensión del navegador...). Un JSON inválido NUNCA debe poder
// romper el arranque ni el resto de funciones que leen el historial.
function _parseLocalHistory() {
    try {
        const raw = localStorage.getItem(`nv_ai_history_${currentUserId}`);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('Historial local corrupto, se descarta:', e);
        try { localStorage.removeItem(`nv_ai_history_${currentUserId}`); } catch (e2) { /* sin almacenamiento */ }
        return [];
    }
}

export function loadHistory() {
    const history = _parseLocalHistory();
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
            if (window.innerWidth <= 767) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    sidebar.classList.remove('open');
                }
            }
        };
        dotsBtn.onclick = (e) => { e.stopPropagation(); openChatContextMenu(e, chat, div); };

        div.appendChild(label); div.appendChild(dotsBtn);
        container.appendChild(div);
    });
}

const MESSAGES_PER_PAGE = 20;
window._renderedMessageCount = MESSAGES_PER_PAGE;

export function loadMoreHistoryMessages() {
    const log = document.getElementById('chat-log');
    if (!log || !Array.isArray(window.chatMessages)) return;

    const oldScrollHeight = log.scrollHeight;
    const oldScrollTop = log.scrollTop;

    window._renderedMessageCount = (window._renderedMessageCount || MESSAGES_PER_PAGE) + MESSAGES_PER_PAGE;
    renderChat(false, false);

    requestAnimationFrame(() => {
        const newScrollHeight = log.scrollHeight;
        log.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
    });
}
window.loadMoreHistoryMessages = loadMoreHistoryMessages;

export function renderChat(resetPagination = false, scrollToBottom = true) {
    const log = document.getElementById('chat-log');
    if (!log) return;

    if (resetPagination) {
        window._renderedMessageCount = MESSAGES_PER_PAGE;
    }

    log.innerHTML = '';
    if (!Array.isArray(window.chatMessages) || window.chatMessages.length === 0) {
        log.innerHTML = _welcomeHtml();
        return;
    }

    const totalMessages = window.chatMessages.length;
    const currentCount = window._renderedMessageCount || MESSAGES_PER_PAGE;
    const startIndex = Math.max(0, totalMessages - currentCount);
    const visibleMessages = window.chatMessages.slice(startIndex);

    if (startIndex > 0) {
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'load-more-history-container';
        loadMoreContainer.innerHTML = `
            <button type="button" class="load-more-history-btn" onclick="window.loadMoreHistoryMessages()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
                <span>Cargar mensajes anteriores (${startIndex} restantes)</span>
            </button>
        `;
        log.appendChild(loadMoreContainer);
    }

    visibleMessages.forEach((msg, idx) => {
        const index = startIndex + idx;
        try {
            const row = document.createElement('div'); row.className = 'message-row ' + (msg.role === 'assistant' ? 'ai-row' : 'user-row');
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
                let editVal = String(msg.content ?? '');
                if (editVal.includes('Contexto de archivos:\n') || editVal.startsWith('Contexto de archivos:\n')) {
                    const marker = '\n\nConsulta del usuario: ';
                    const idx = editVal.lastIndexOf(marker);
                    if (idx !== -1) {
                        editVal = editVal.substring(idx + marker.length).trim();
                    } else {
                        editVal = editVal.replace(/^[\s\S]*?Consulta del usuario:\s*/, '').trim();
                    }
                    if (editVal === '(Archivos adjuntos sin texto)') {
                        editVal = '';
                    }
                }
                textarea.value = editVal;
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

                if (!isMobileDevice()) {
                    setTimeout(() => {
                        textarea.focus();
                        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                    }, 50);
                }
            } else {
                let contentStr = String(msg.content ?? '');
                // Respuestas que son JSON/garbage puro (modelos alucinando su
                // formato interno): limpiarlas al renderizar, también datos viejos.
                if (msg.role === 'assistant') {
                    contentStr = _cleanAssistantContent(contentStr);
                }
                const extractedFiles = [];

                if (contentStr.includes('Contexto de archivos:\n') || contentStr.startsWith('Contexto de archivos:\n')) {
                    const fileMatches = contentStr.match(/\[(?:Archivo Adjunto|Contenido del archivo|Archivo de Audio Adjunto):\s*([^\]]+)\]/g);
                    if (fileMatches) {
                        fileMatches.forEach(m => {
                            const fileName = m.replace(/^\[(?:Archivo Adjunto|Contenido del archivo|Archivo de Audio Adjunto):\s*/, '').replace(/\]$/, '');
                            extractedFiles.push({ name: fileName });
                        });
                    }
                    const marker = '\n\nConsulta del usuario: ';
                    const idx = contentStr.lastIndexOf(marker);
                    if (idx !== -1) {
                        contentStr = contentStr.substring(idx + marker.length).trim();
                    } else {
                        contentStr = contentStr.replace(/^[\s\S]*?Consulta del usuario:\s*/, '').trim();
                    }
                    if (contentStr === '(Archivos adjuntos sin texto)') {
                        contentStr = '';
                    }
                }
                text.innerHTML = DOMPurify.sanitize(marked.parse(contentStr));

                // Respuesta interrumpida/cancelada: indicador visual persistente
                if (msg.cancelled && !text.querySelector('.msg-cancelled')) {
                    text.appendChild(createCancelledBadge());
                }

                const effectiveAttachments = (msg.attachments && msg.attachments.length > 0) ? msg.attachments : extractedFiles;

                if (effectiveAttachments && effectiveAttachments.length > 0) {
                    const attachContainer = document.createElement('div');
                    attachContainer.style.display = 'flex';
                    attachContainer.style.gap = '10px';
                    attachContainer.style.flexWrap = 'wrap';
                    attachContainer.style.marginTop = '10px';

                    effectiveAttachments.forEach(att => {
                        const isImage = att.isImage || att.type?.startsWith('image/') || att.data?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att.name || '');
                        const isAudio = att.isAudio || att.type?.startsWith('audio/') || att.name?.endsWith('.webm');

                        if (isImage && (att.data || attachmentServerUrl(att))) {
                            const img = document.createElement('img');
                            img.src = att.data || attachmentServerUrl(att);
                            img.style.maxWidth = '250px';
                            img.style.maxHeight = '250px';
                            img.style.borderRadius = '8px';
                            img.style.border = '1px solid var(--border)';
                            img.style.cursor = 'pointer';
                            img.onclick = () => openAttachmentPreview(att);
                            attachContainer.appendChild(img);
                        } else if (isAudio && (att.data || attachmentServerUrl(att))) {
                            const audio = document.createElement('audio');
                            audio.src = att.data || attachmentServerUrl(att);
                            audio.controls = true;
                            audio.style.display = 'block';
                            audio.style.maxWidth = '300px';
                            audio.style.marginTop = '6px';
                            audio.style.borderRadius = '8px';
                            attachContainer.appendChild(audio);
                        } else if (att.name) {
                            const fileChip = document.createElement('div');
                            fileChip.style.cssText = 'background: rgba(255,255,255,0.06); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: var(--text-main); cursor: pointer;';
                            fileChip.onclick = () => openAttachmentPreview(att);
                            const iconSVG = isImage
                                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
                                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
                            fileChip.innerHTML = `${iconSVG}<span>${att.name}</span>`;
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

    if (window.hljs) hljs.highlightAll();

    // Generación en curso recuperada tras recargar la página: si el último
    // mensaje no tiene respuesta completada (es del usuario, o la respuesta de
    // la IA quedó vacía en BD), renderizar el indicador de los 3 puntos en vez
    // de dejar un hueco vacío. renderChat() pisa el DOM completo, así que el
    // indicador debe re-crearse aquí para sobrevivir a los re-renders.
    if (_chatIsGenerating() && !log.querySelector('.msg-typing')) {
        const lastMsg = window.chatMessages[window.chatMessages.length - 1];
        const unanswered = lastMsg && (
            lastMsg.role === 'user'
            || (lastMsg.role === 'assistant' && !String(lastMsg.content || '').trim())
        );
        if (unanswered) {
            const dots = document.createElement('div');
            dots.className = 'msg-typing';
            dots.innerHTML = '<span></span><span></span><span></span>';
            log.appendChild(dots);
        }
    }

    if (scrollToBottom) {
        log.scrollTop = log.scrollHeight;
        setTimeout(() => { log.scrollTop = log.scrollHeight; }, 50);
    }
    renderChatFilesBar();
}

export function renderChatFilesBar() {
    const bar = document.getElementById('chat-files-bar');
    if (bar) bar.style.display = 'none';
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
    window._manualCancel = false;
    window.abortController = new AbortController();

    // Keepalive: touch the session every 10s to prevent logout during long responses
    const keepAliveInterval = setInterval(() => {
        if (!window.isGenerating) { clearInterval(keepAliveInterval); return; }
        fetch('/api/ai/heartbeat', { method: 'POST' }).catch(() => { });
    }, 10000);

    let finalPrompt = newText;
    if (attachments.length > 0) {
        const fileContext = attachments.map(f => {
            const ext = (f.name || '').split('.').pop().toLowerCase();
            const isText = f.isText || f.type?.startsWith('text/') || ['txt', 'md', 'markdown', 'js', 'jsx', 'ts', 'tsx', 'py', 'pyw', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx', 'cs', 'java', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'jsonc', 'xml', 'yaml', 'yml', 'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'csv', 'tsv', 'env', 'ini', 'cfg', 'conf', 'toml', 'log', 'dockerfile', 'makefile', 'r', 'm', 'dart', 'scala', 'lua'].includes(ext);
            if (!f.isImage && isText && f.data && typeof f.data === 'string' && !f.data.startsWith('data:image')) {
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
    let wasCancelled = false;
    const _showError = (errText) => {
        hadError = true;
        fullResponse += `\n\n*Error: ${errText}*`;
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        appendChatAlert(aiWrapper, errText);
        if (window.showToast) window.showToast('Error: ' + errText, 'error');
    };

    // Interrupción del stream (desconexión, recarga o cancelación): cerrar la
    // respuesta inacabada de forma limpia, sin volcar el error técnico del
    // socket/fetch ni fragmentos JSON a medio generar en la burbuja de la IA.
    const _markCancelled = () => {
        hadError = true;
        wasCancelled = true;
        if (typingDots && typingDots.parentNode) typingDots.remove();
        if (_isJsonishToolFragment(fullResponse)) {
            fullResponse = _stripJsonishFragment(fullResponse);
        }
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        if (!aiWrapper.querySelector('.msg-cancelled')) {
            aiWrapper.appendChild(createCancelledBadge());
        }
        const manual = !!window._manualCancel;
        window._manualCancel = false;
        if (!manual && window.showToast) window.showToast('Mensaje cancelado', 'info');
    };

    try {
        const _numCtx = parseInt(localStorage.getItem('model_num_ctx')) || 262144;
        const _numPred = parseInt(localStorage.getItem('model_num_predict')) || 65536;
        const _temp = parseFloat(localStorage.getItem('model_temperature')) || 0.7;

        const payloadAttachments = attachments.map(a => {
            if (!a.fileId && !(a.id && !a.data && typeof a.id === 'string')) return a;
            return {
                id: a.fileId || a.id,
                name: a.name,
                size: a.size,
                sizeLabel: a.sizeLabel,
                type: a.type,
                isImage: a.isImage,
                isText: a.isText,
                isAudio: a.isAudio,
                data: a.data
            };
        });
        const userMsgObj = { role: 'user', content: finalPrompt, attachments: payloadAttachments };
        const imgList = [];
        attachments.forEach(att => {
            const isImg = att.isImage || att.type?.startsWith('image/') || att.data?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att.name || '');
            if (isImg && att.data && !att.fileId) {
                const b64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                if (b64) imgList.push(b64);
            }
        });
        if (imgList.length > 0) userMsgObj.images = imgList;

        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: window.currentChatId,
                model,
                messages: [...window.chatMessages.slice(0, -1), userMsgObj].map(m => {
                    const item = { role: m.role, content: m.content };
                    if (m.images) item.images = m.images;
                    if (m.attachments) item.attachments = m.attachments;
                    return item;
                }).filter(m => String(m.content || '').trim()),
                search_mode: window.webSearchMode === true,
                workspace_id: window.currentWorkspaceId || null,
                mode: window.aiChatMode || 'agenda',
                reasoning_mode: window.reasoningMode === true,
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
                        if (_isInterruptedError(json.error)) {
                            _markCancelled();
                        } else {
                            _showError(json.error);
                        }
                        break;
                    }
                    if (json.message?.content) {
                        fullResponse += json.message.content;
                        const chatLog = document.getElementById('chat-log');
                        const isAtBottom = chatLog ? (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 150) : false;
                        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
                        if (chatLog && isAtBottom) chatLog.scrollTop = chatLog.scrollHeight;
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
                        const chatLog = document.getElementById('chat-log');
                        const isAtBottom = chatLog ? (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 150) : false;
                        if (chatLog && isAtBottom) chatLog.scrollTop = chatLog.scrollHeight;
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            _markCancelled();
        } else if (_isInterruptedError(e && e.message)) {
            // Desconexión/recarga a mitad del stream: cancelación limpia si ya
            // había contenido generado; si no llegó a empezar, es un fallo de
            // conexión normal y se muestra el mensaje amigable.
            if (fullResponse.trim() || fullReasoning.trim()) {
                _markCancelled();
            } else {
                _showError('No se pudo conectar con el servidor de IA. Comprueba que el servicio esté activo.');
            }
        } else {
            const errText = (e && e.message && !/^Failed to fetch/.test(e.message))
                ? e.message
                : 'No se pudo conectar con el servidor de IA. Comprueba que el servicio esté activo.';
            _showError(errText);
        }
    }

    // Modelos (p. ej. fine-tuneados) que alucinan su formato interno de JSON:
    // limpiar la respuesta antes de mostrarla/persistirla como texto natural.
    const wasJsonGarbage = _isJsonishToolFragment(fullResponse);
    if (wasJsonGarbage) {
        fullResponse = _stripJsonishFragment(fullResponse);
    }

    if (!hadError && !fullResponse.trim()) {
        if (wasJsonGarbage) {
            // El modelo solo emitió JSON sin texto útil: nota neutra en vez de
            // un error de conexión/modelo.
            fullResponse = '*(El modelo no generó una respuesta válida.)*';
        } else {
            const isExternal = model.startsWith('API:');
            const errMsg = isExternal
                ? 'No se recibió respuesta del modelo externo. Verifica que tengas saldo/créditos suficientes en tu cuenta, o prueba con otro modelo.'
                : 'No se recibió respuesta del modelo. Verifica que el modelo esté instalado y que el motor de IA local (Ollama) esté activo.';
            _showError(errMsg);
        }
    }

    if (wasJsonGarbage) {
        // Re-render con el contenido limpio (el stream pudo haber mostrado el
        // JSON crudo mientras llegaba).
        aiWrapper.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        if (wasCancelled && !aiWrapper.querySelector('.msg-cancelled')) {
            aiWrapper.appendChild(createCancelledBadge());
        }
    }

    if (typingDots && typingDots.parentNode) typingDots.remove();

    const endTime = performance.now();
    const durationStr = ((endTime - startTime) / 1000).toFixed(1);

    window.isGenerating = false;
    clearInterval(keepAliveInterval);
    window._streamingCompleted = true;
    clearChatGenStatus();
    if (sendBtn) {
        sendBtn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.93l-.11 4.53c.57 0 .82-.25 1.13-.56l2.7-2.59 5.61 4.13c1.03.57 1.77.27 2.05-.96l3.71-17.48c.38-1.7-.64-2.63-1.78-2.19L1.02 10.08c-1.69.66-1.67 1.62-.31 2.04l5.04 1.58 11.95-7.54c.56-.37 1.08-.17.66.21L9.04 15.93z"/></svg>';
        sendBtn.style.background = 'transparent';
    }
    window.chatMessages.push({ role: 'assistant', content: fullResponse, model: model, duration: durationStr, reasoning: fullReasoning || undefined, cancelled: wasCancelled });
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
    if (window.innerWidth <= 767) {
        // Móvil: el cajón se abre/cierra con .open
        sidebar.classList.toggle('open');
    }
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
            const history = _parseLocalHistory();
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
            const history = _parseLocalHistory().filter(c => c.id !== chatId);
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
    if (!isMobileDevice()) {
        setTimeout(() => document.getElementById('search-input')?.focus(), 50);
    }
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
    const history = _parseLocalHistory();
    const section = document.getElementById('search-history-section');
    const empty = document.getElementById('search-empty');
    const actionsLabel = document.getElementById('search-actions-label');

    const staticItems = document.querySelectorAll('#search-body > .search-result-item');
    const filtered = query ? history.filter(c => String(c.title || '').toLowerCase().includes(query)) : history;

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
        if (btn) btn.classList.add('active');
        if (wsBtn) wsBtn.classList.add('active');
        window.showToast('Búsqueda web activada');
    } else {
        if (btn) btn.classList.remove('active');
        if (wsBtn) wsBtn.classList.remove('active');
        window.showToast('Búsqueda web desactivada');
    }
}
window.toggleWebSearch = toggleWebSearch;

// Progressive disclosure (móvil): panel de herramientas secundarias (adjuntos,
// búsqueda web, modos, micrófono) que abre el botón '+' de la barra inferior.
export function toggleToolsMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('tools-menu');
    if (!menu) return;
    const open = !menu.classList.contains('show');
    menu.classList.toggle('show', open);
    const scrim = document.getElementById('tools-scrim');
    if (scrim) scrim.classList.toggle('show', open);
    if (open) {
        haptic();
        // Al abrir el sheet, retirar el teclado para que el panel se vea entero
        const input = document.getElementById('chat-input');
        if (input && document.activeElement === input) input.blur();
        updateToolsMenuState();
    }
}
window.toggleToolsMenu = toggleToolsMenu;

// Sincroniza los indicadores de estado del panel con el estado real
// (búsqueda web, modo agenda/normal, razonamiento).
export function updateToolsMenuState() {
    const web = document.getElementById('tools-web');
    const mode = document.getElementById('tools-mode');
    const reason = document.getElementById('tools-reason');
    if (web) web.classList.toggle('active', !!window.webSearchMode);
    if (reason) reason.classList.toggle('active', !!window.reasoningMode);
    if (mode) {
        const isAgenda = window.aiChatMode === 'agenda';
        mode.classList.toggle('active', isAgenda);
        const label = mode.querySelector('.tools-item-label');
        if (label) label.textContent = isAgenda ? 'Modo Agenda' : 'Modo Normal';
    }
}
window.updateToolsMenuState = updateToolsMenuState;

document.addEventListener('click', (e) => {
    const menu = document.getElementById('tools-menu');
    const btn = document.getElementById('tools-btn');
    const scrim = document.getElementById('tools-scrim');
    if (menu && menu.classList.contains('show') && !menu.contains(e.target) && !(btn && btn.contains(e.target))) {
        menu.classList.remove('show');
        if (scrim) scrim.classList.remove('show');
    }
});

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

export async function exportConversation(format = 'md') {
    const messages = window.chatMessages || [];
    const messageRows = document.querySelectorAll('#chat-log .message-row');
    const sessionId = window.currentChatId;

    if (!messages.length && !messageRows.length) {
        if (window.showToast) window.showToast('No hay mensajes en la conversación', 'warning');
        return;
    }

    try {
        if (window.showToast) window.showToast('Generando archivo de exportación...', 'info');

        let fileName = `conversacion_${new Date().toISOString().slice(0, 10)}.${format}`;
        let fileContent = '';

        if (sessionId) {
            try {
                const res = await fetch('/api/ai/exports/conversation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId, format: format })
                });
                if (res.ok) {
                    const ref = await res.json();
                    if (ref.name) fileName = ref.name;
                    if (ref.content) fileContent = ref.content;
                }
            } catch (e) { }
        }

        if (!fileContent) {
            if (messages.length > 0) {
                if (format === 'json') {
                    fileContent = JSON.stringify(messages, null, 2);
                } else if (format === 'txt') {
                    fileContent = messages.map(m => `[${m.role === 'user' ? 'Usuario' : 'Asistente'}]:\n${m.content}\n`).join('\n');
                } else if (format === 'html') {
                    fileContent = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Conversación Nexus AI</title><style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;max-width:800px;margin:0 auto;line-height:1.6;}.msg{margin-bottom:20px;padding:16px;border-radius:10px;background:#161b22;border:1px solid #30363d;}.user{border-left:4px solid #6366f1;}.assistant{border-left:4px solid #10b981;}.role{font-size:0.75rem;font-weight:700;text-transform:uppercase;color:#8b949e;margin-bottom:6px;}</style></head><body>` +
                        messages.map(m => `<div class="msg ${m.role}"><div class="role">${m.role === 'user' ? 'Usuario' : 'Asistente'}</div><div>${String(m.content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div></div>`).join('') +
                        `</body></html>`;
                } else {
                    fileContent = messages.map(m => `**${m.role === 'user' ? 'Usuario' : 'Asistente'}**:\n${m.content}\n`).join('\n');
                }
            } else if (messageRows.length > 0) {
                const lines = [];
                if (format === 'html') lines.push(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Conversación Nexus AI</title><style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;max-width:800px;margin:0 auto;line-height:1.6;}.msg{margin-bottom:20px;padding:16px;border-radius:10px;background:#161b22;border:1px solid #30363d;}.user{border-left:4px solid #6366f1;}.assistant{border-left:4px solid #10b981;}.role{font-size:0.75rem;font-weight:700;text-transform:uppercase;color:#8b949e;margin-bottom:6px;}</style></head><body>`);

                messageRows.forEach(row => {
                    const isUser = row.querySelector('.avatar:not(.ai)') || row.classList.contains('user-message');
                    const roleLabel = isUser ? 'Usuario' : 'Asistente';
                    const bodyText = (row.innerText || row.textContent || '').trim();
                    if (bodyText) {
                        if (format === 'html') {
                            const roleClass = isUser ? 'user' : 'assistant';
                            lines.push(`<div class="msg ${roleClass}"><div class="role">${roleLabel}</div><div>${bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div></div>`);
                        } else if (format === 'md') {
                            lines.push(`**${roleLabel}**:\n${bodyText}\n`);
                        } else {
                            lines.push(`[${roleLabel}]:\n${bodyText}\n`);
                        }
                    }
                });
                if (format === 'html') lines.push(`</body></html>`);
                fileContent = lines.join('\n');
            }
        }

        if (!fileContent) {
            throw new Error('No hay contenido para exportar');
        }

        const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
        const blob = new Blob([fileContent], { type: mime });
        const downloadUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

        if (window.showToast) {
            window.showToast(`✓ Conversación descargada: ${fileName}`, 'success');
        }
    } catch (err) {
        if (window.showToast) window.showToast(err.message || 'Error al exportar', 'error');
    }
}

window.exportConversation = exportConversation;

window.toggleExportMenu = function (e) {
    if (e) e.stopPropagation();
    const btn = document.getElementById('export-chat-btn');
    if (btn && (btn.style.pointerEvents === 'none' || btn.disabled)) return;

    const dropdown = document.getElementById('export-menu-dropdown');
    if (!dropdown) return;

    const isVisible = dropdown.style.display === 'flex';
    dropdown.style.display = isVisible ? 'none' : 'flex';
};

window.closeExportMenu = function () {
    const dropdown = document.getElementById('export-menu-dropdown');
    if (dropdown) dropdown.style.display = 'none';
};

document.addEventListener('click', () => window.closeExportMenu());

window.copyFullConversation = async function () {
    const messages = window.chatMessages || [];
    const messageRows = document.querySelectorAll('#chat-log .message-row');

    if (!messages.length && !messageRows.length) {
        if (window.showToast) window.showToast('La conversación está vacía', 'warning');
        return;
    }

    try {
        if (window.showToast) window.showToast('Copiando conversación al portapapeles...', 'info');

        let fullText = '';
        if (messages.length > 0) {
            fullText = messages.map(m => `[${m.role === 'user' ? 'Usuario' : 'Asistente'}]:\n${m.content}`).join('\n\n');
        } else {
            const lines = [];
            messageRows.forEach(row => {
                const isUser = row.querySelector('.avatar:not(.ai)') || row.classList.contains('user-message');
                const roleLabel = isUser ? 'Usuario' : 'Asistente';
                const bodyText = (row.innerText || row.textContent || '').trim();
                if (bodyText) lines.push(`[${roleLabel}]:\n${bodyText}`);
            });
            fullText = lines.join('\n\n');
        }

        if (!fullText.trim()) {
            if (window.showToast) window.showToast('La conversación está vacía', 'warning');
            return;
        }

        await navigator.clipboard.writeText(fullText.trim());
        if (window.showToast) window.showToast('✓ Chat completo copiado al portapapeles', 'success');
    } catch (err) {
        if (window.showToast) window.showToast('Error al copiar al portapapeles', 'error');
    }
};

window.updateExportButtonState = function () {
    const btn = document.getElementById('export-chat-btn');
    if (!btn) return;

    const welcomeScreen = document.getElementById('welcome-screen');
    const isWelcomeVisible = welcomeScreen && welcomeScreen.style.display !== 'none';
    const messageRows = document.querySelectorAll('#chat-log .message-row');
    const msgs = window.chatMessages || [];

    const hasContent = !isWelcomeVisible && (msgs.length > 0 || messageRows.length > 0);

    if (hasContent) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.title = 'Exportar conversación';
    } else {
        btn.style.opacity = '0.35';
        btn.style.pointerEvents = 'none';
        btn.title = 'Exportar conversación (Sin mensajes)';
        window.closeExportMenu();
    }
};

setInterval(() => {
    if (window.updateExportButtonState) window.updateExportButtonState();
}, 800);
