// Comandos de barra estilo opencode para los inputs de chat:
//  - "/" abre el menú de comandos (filtrado en vivo).
//  - Tab autocompleta el comando (y el modelo en /models).
//  - ↑/↓ navegan, Enter ejecuta/elige, Escape cierra.
// El comando /models abre la paleta de modelos con filtro por lo escrito.

const _MODEL_CMD_RE = /^\/model[os]?(\s|$)/i;

export function initSlashCommands(opts) {
    const input = opts && opts.input;
    if (!input) return;
    const models = (opts && opts.models) || (() => []);
    const current = (opts && opts.current) || (() => '');
    const onSelectModel = (opts && opts.onSelectModel) || (() => {});
    const commands = (opts && opts.commands) || [];

    let overlay = null;
    let mode = null;      // null | 'menu' | 'models'
    let list = [];
    let activeIdx = 0;

    function displayName(name) {
        const n = String(name || '');
        return n.startsWith('API: openrouter:')
            ? n.replace(/^API:\s*openrouter\s*:\s*/, '')
            : n;
    }

    function open(newMode) {
        if (newMode === 'models' && !models().length) return;
        mode = newMode;
        input.dataset.picker = '1';
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'nv-model-picker';
            document.body.appendChild(overlay);
        }
        activeIdx = 0;
        render();
        position();
    }

    function close() {
        mode = null;
        delete input.dataset.picker;
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }

    function filterQuery() {
        return input.value
            .replace(/^\/models/i, '')
            .replace(/^\/modelo/i, '')
            .replace(/^\/model/i, '')
            .trim()
            .toLowerCase();
    }

    function visibleCommands() {
        const t = input.value.trim().toLowerCase();
        if (t === '/') return commands;
        return commands.filter((c) => c.name.toLowerCase().startsWith(t));
    }

    function visibleModels() {
        // Filtro por palabras: "gratis"/"free" dejan solo los gratuitos,
        // "tools" solo los compatibles con llamadas de herramientas, y el
        // resto de palabras filtran por el nombre (p. ej. /models gratis tools gemini).
        const tokens = filterQuery().split(/\s+/).filter(Boolean);
        const KEYWORDS = { free: 'free', gratis: 'free', tools: 'tools' };
        const requireFree = tokens.some((t) => KEYWORDS[t] === 'free');
        const requireTools = tokens.some((t) => KEYWORDS[t] === 'tools');
        const nameTokens = tokens.filter((t) => !KEYWORDS[t]);
        return models().filter((m) => {
            if (requireFree && !(m.pricing && parseFloat(m.pricing.prompt) === 0)) return false;
            if (requireTools && !((m.supported_parameters || []).includes('tools'))) return false;
            const n = String(m.name || '').toLowerCase();
            const d = displayName(n).toLowerCase();
            return nameTokens.every((t) => n.includes(t) || d.includes(t));
        });
    }

    function render() {
        if (!overlay) return;
        overlay.innerHTML = '';
        if (mode === 'menu') {
            list = visibleCommands();
            if (activeIdx > list.length - 1) activeIdx = Math.max(0, list.length - 1);
            if (!list.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:10px 14px;font-size:0.8rem;color:var(--nv-dim, var(--text-dim));';
                empty.textContent = 'Sin comandos que coincidan';
                overlay.appendChild(empty);
                return;
            }
            list.forEach((c, i) => {
                const item = document.createElement('div');
                item.className = 'nv-model-picker-item' + (i === activeIdx ? ' active' : '');
                item.style.cssText = [
                    'display:flex;align-items:center;gap:10px;padding:7px 14px;cursor:pointer;',
                    'font-size:0.85rem;color:var(--nv-main, var(--text-main));min-width:0;'
                ].join('');
                const name = document.createElement('span');
                name.style.cssText = 'font-weight:600;color:#818cf8;flex-shrink:0;';
                name.textContent = c.name;
                const desc = document.createElement('span');
                desc.style.cssText = 'color:var(--nv-dim, var(--text-dim));font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                desc.textContent = c.description || '';
                item.appendChild(name);
                item.appendChild(desc);
                // Clic: autocompleta la opción completa en el input (sin
                // ejecutar); doble clic: la ejecuta.
                item.addEventListener('mousedown', (e) => { e.preventDefault(); completeIndex(i); });
                item.addEventListener('dblclick', (e) => { e.preventDefault(); run(c); });
                item.addEventListener('mouseenter', () => { activeIdx = i; highlightActive(); });
                overlay.appendChild(item);
            });
        } else {
            list = visibleModels();
            if (activeIdx > list.length - 1) activeIdx = Math.max(0, list.length - 1);
            if (!filterQuery()) {
                const hint = document.createElement('div');
                hint.style.cssText = [
                    'padding:6px 14px 8px;font-size:0.7rem;color:var(--nv-dim, var(--text-dim));',
                    'border-bottom:1px solid var(--nv-border, var(--border));margin-bottom:4px;',
                    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
                ].join('');
                hint.textContent = '/models gratis - tools - nombre';
                overlay.appendChild(hint);
            }
            if (!list.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:10px 14px;font-size:0.8rem;color:var(--nv-dim, var(--text-dim));';
                empty.textContent = 'Sin modelos que coincidan';
                overlay.appendChild(empty);
                return;
            }
            const cur = current();
            list.forEach((m, i) => {
                const item = document.createElement('div');
                item.className = 'nv-model-picker-item' + (i === activeIdx ? ' active' : '');
                item.style.cssText = [
                    'display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer;',
                    'font-size:0.85rem;color:var(--nv-main, var(--text-main));white-space:nowrap;min-width:0;'
                ].join('');
                const nameSpan = document.createElement('span');
                nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;';
                nameSpan.textContent = displayName(m.name);
                item.appendChild(nameSpan);
                if (m.pricing && parseFloat(m.pricing.prompt) === 0) {
                    const badge = document.createElement('span');
                    badge.style.cssText = 'font-size:0.62rem;font-weight:700;color:#34d399;background:rgba(52,211,153,0.12);border:1px solid rgba(52,211,153,0.3);border-radius:6px;padding:1px 6px;flex-shrink:0;';
                    badge.textContent = 'gratis';
                    item.appendChild(badge);
                }
                if (String(m.name) === String(cur)) {
                    const mark = document.createElement('span');
                    mark.style.cssText = 'color:#34d399;flex-shrink:0;font-size:0.8rem;';
                    mark.textContent = '✓';
                    item.appendChild(mark);
                }
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    completeIndex(i);
                });
                item.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    selectModel(m.name);
                });
                item.addEventListener('mouseenter', () => { activeIdx = i; highlightActive(); });
                overlay.appendChild(item);
            });
        }
        highlightActive(true);
    }

    function highlightActive(scroll) {
        if (!overlay) return;
        overlay.querySelectorAll('.nv-model-picker-item').forEach((el, i) => {
            el.classList.toggle('active', i === activeIdx);
        });
        if (scroll) {
            const activeEl = overlay.children[activeIdx];
            if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
        }
    }

    function position() {
        const rect = input.getBoundingClientRect();
        const w = Math.min(Math.max(rect.width, 300), 460);
        const h = Math.min(list.length * 34 + 30, 320);
        const top = rect.top - h - 8;
        overlay.style.cssText = [
            'position:fixed;z-index:999999;',
            `left:${rect.left}px;top:${top >= 8 ? top : rect.bottom + 8}px;`,
            `width:${w}px;max-height:320px;overflow-y:auto;`,
            'background:var(--nv-bg2, var(--bg-secondary));',
            'border:1px solid var(--nv-border, var(--border));border-radius:12px;',
            'box-shadow:0 8px 24px rgba(0,0,0,0.4);padding:6px 0;'
        ].join('');
    }

    function run(cmd) {
        close();
        input.value = '';
        if (cmd && cmd.run) cmd.run();
    }

    function selectModel(name) {
        close();
        input.value = '';
        onSelectModel(name);
    }

    // Rellena el input con la opción completa de la posición i (clic o Tab).
    function completeIndex(i) {
        if (mode === 'menu') {
            const cmd = list[i];
            if (!cmd) return;
            input.value = cmd.name + ' ';
            if (/^\/model[os]?$/i.test(cmd.name)) {
                open('models');
            } else {
                render();
            }
        } else {
            const m = list[i];
            if (!m) return;
            input.value = '/models ' + m.name;
            render();  // el filtro se ajusta al nombre completado
        }
    }

    // Tab: autocompleta el comando (menú) o el modelo activo (/models)
    function complete() {
        if (mode === 'menu') {
            completeIndex(list[activeIdx] ? activeIdx : 0);
        } else if (mode === 'models') {
            completeIndex(activeIdx);
        }
    }

    function onInput() {
        const v = input.value.trim();
        if (!v) {
            close();
        } else if (_MODEL_CMD_RE.test(v)) {
            open('models');
        } else if (v.startsWith('/')) {
            open('menu');
        } else {
            close();
        }
    }

    input.addEventListener('input', onInput);

    input.addEventListener('keydown', (e) => {
        if (!mode && e.key === 'Tab' && input.value.trim() === '/') {
            e.preventDefault();
            open('menu');
            complete();
            return;
        }
        if (!mode) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (list.length) {
                const d = e.key === 'ArrowDown' ? 1 : -1;
                activeIdx = (activeIdx + d + list.length) % list.length;
                render();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            complete();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (mode === 'menu') {
                run(list[activeIdx] || list[0]);
            } else {
                const m = list[activeIdx] || list[0];
                if (m) selectModel(m.name);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    });

    document.addEventListener('click', (e) => {
        if (mode && overlay && e.target !== input && !overlay.contains(e.target)) {
            close();
        }
    });

    window.addEventListener('resize', () => { if (mode) position(); });
    document.addEventListener('scroll', () => { if (mode) position(); }, true);
}

export function isModelPickerOpen(input) {
    return !!(input && input.dataset && input.dataset.picker);
}
