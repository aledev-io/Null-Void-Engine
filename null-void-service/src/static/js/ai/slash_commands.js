// Comandos de barra rápida para los inputs de chat:
//  - "/" abre el menú de comandos en vivo.
//  - Tab autocompleta el comando.
//  - ↑/↓ navegan, Enter ejecuta, Escape cierra.

export function getProviderInfo(m) {
    const name = typeof m === 'string' ? m : (m && m.name) || '';
    const isExternal = typeof m === 'object' && m ? !!m.is_external : name.startsWith('API:');
    let providerRaw = (typeof m === 'object' && m && m.provider) ? m.provider : '';

    if (!providerRaw) {
        if (name.startsWith('API: openrouter:') || name.startsWith('api:openrouter') || name.startsWith('API:openrouter')) {
            providerRaw = 'openrouter';
        } else if (name.startsWith('API:')) {
            const parts = name.split(':');
            providerRaw = parts[1] ? parts[1].trim() : 'api';
        } else {
            providerRaw = 'ollama';
        }
    }

    const provLower = providerRaw.toLowerCase();
    let vendor = '';
    if (provLower === 'openrouter') {
        const cleanName = name.replace(/^API:\s*openrouter\s*:\s*/i, '');
        if (cleanName.includes('/')) {
            const vPrefix = cleanName.split('/')[0].toLowerCase();
            if (vPrefix === 'google') vendor = 'Google';
            else if (vPrefix === 'anthropic') vendor = 'Anthropic';
            else if (vPrefix === 'openai') vendor = 'OpenAI';
            else if (vPrefix === 'meta-llama' || vPrefix === 'meta') vendor = 'Meta';
            else if (vPrefix === 'deepseek') vendor = 'DeepSeek';
            else if (vPrefix === 'mistralai') vendor = 'Mistral';
            else if (vPrefix === 'qwen' || vPrefix === 'alibaba') vendor = 'Qwen';
            else vendor = vPrefix.charAt(0).toUpperCase() + vPrefix.slice(1);
        }
    }

    let label = 'Local (Ollama)';
    let color = '#34d399';
    let bg = 'rgba(52, 211, 153, 0.12)';
    let border = 'rgba(52, 211, 153, 0.3)';

    if (provLower === 'openrouter') {
        label = vendor ? `OpenRouter (${vendor})` : 'OpenRouter';
        color = '#c084fc';
        bg = 'rgba(192, 132, 252, 0.15)';
        border = 'rgba(192, 132, 252, 0.3)';
    } else if (provLower === 'google') {
        label = 'Google AI';
        color = '#60a5fa';
        bg = 'rgba(96, 165, 250, 0.15)';
        border = 'rgba(96, 165, 250, 0.3)';
    } else if (provLower === 'openai') {
        label = 'OpenAI';
        color = '#34d399';
        bg = 'rgba(52, 211, 153, 0.15)';
        border = 'rgba(52, 211, 153, 0.3)';
    } else if (provLower === 'anthropic') {
        label = 'Anthropic';
        color = '#f97316';
        bg = 'rgba(249, 115, 22, 0.15)';
        border = 'rgba(249, 115, 22, 0.3)';
    } else if (provLower === 'deepseek') {
        label = 'DeepSeek';
        color = '#38bdf8';
        bg = 'rgba(56, 189, 248, 0.15)';
        border = 'rgba(56, 189, 248, 0.3)';
    } else if (provLower === 'groq') {
        label = 'Groq';
        color = '#f43f5e';
        bg = 'rgba(244, 63, 94, 0.15)';
        border = 'rgba(244, 63, 94, 0.3)';
    } else if (isExternal || provLower !== 'ollama') {
        label = providerRaw.toUpperCase();
        color = '#fbbf24';
        bg = 'rgba(251, 191, 36, 0.15)';
        border = 'rgba(251, 191, 36, 0.3)';
    }

    return { provider: providerRaw, vendor, label, color, bg, border };
}

export function initSlashCommands(opts) {
    const input = opts && opts.input;
    if (!input) return;
    const commands = (opts && opts.commands) || [];

    let overlay = null;
    let isOpen = false;
    let list = [];
    let activeIdx = 0;
    let _prevBodyOverflow = '';

    function open() {
        isOpen = true;
        input.dataset.picker = '1';
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'nv-model-picker';
            document.body.appendChild(overlay);
        }
        _prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        activeIdx = 0;
        render();
        position();
    }

    function close() {
        isOpen = false;
        delete input.dataset.picker;
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
        document.body.style.overflow = _prevBodyOverflow;
    }

    function visibleCommands() {
        const t = input.value.trim().toLowerCase();
        if (t === '/') return commands;
        return commands.filter((c) => c.name.toLowerCase().startsWith(t));
    }

    function render() {
        if (!overlay) return;
        overlay.innerHTML = '';
        list = visibleCommands();
        if (activeIdx > list.length - 1) activeIdx = Math.max(0, list.length - 1);
        if (!list.length) {
            close();
            return;
        }
        list.forEach((c, i) => {
            const item = document.createElement('div');
            item.className = 'nv-model-picker-item' + (i === activeIdx ? ' active' : '');
            item.style.cssText = [
                'display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;',
                'font-size:0.84rem;color:var(--text-main, #f4f4f5);min-width:0;border-radius:6px;'
            ].join('');
            const name = document.createElement('span');
            name.style.cssText = 'font-weight:600;color:#818cf8;flex-shrink:0;';
            name.textContent = c.name;
            const desc = document.createElement('span');
            desc.style.cssText = 'color:#a1a1aa;font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            desc.textContent = c.description || '';
            item.appendChild(name);
            item.appendChild(desc);

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                run(c);
            });
            item.addEventListener('mouseenter', () => {
                activeIdx = i;
                highlightActive();
            });
            overlay.appendChild(item);
        });
    }

    function highlightActive() {
        if (!overlay) return;
        overlay.querySelectorAll('.nv-model-picker-item').forEach((el, i) => {
            el.classList.toggle('active', i === activeIdx);
        });
    }

    function position() {
        if (!overlay) return;
        const rect = input.getBoundingClientRect();
        const vv = window.visualViewport;
        const vw = (vv && vv.width) || window.innerWidth;
        const vh = (vv && vv.height) || window.innerHeight;
        const offTop = (vv && vv.offsetTop) || 0;

        const w = Math.min(Math.max(rect.width, 240), 420);
        const left = Math.min(Math.max(rect.left, 8), Math.max(8, vw - w - 8));

        const itemH = 34;
        const estH = Math.min(list.length * itemH + 16, 260);
        const spaceAbove = rect.top - offTop;
        const spaceBelow = (offTop + vh) - rect.bottom;

        let top;
        let maxH;
        if (spaceAbove >= estH + 8 || spaceAbove >= 120) {
            top = Math.max(offTop + 8, rect.top - estH - 8);
            maxH = Math.min(estH, Math.max(80, spaceAbove - 16));
        } else {
            top = rect.bottom + 8;
            maxH = Math.min(estH, Math.max(80, spaceBelow - 16));
        }

        overlay.style.cssText = [
            'position:fixed;z-index:999999;',
            `left:${left}px;top:${top}px;`,
            `width:${w}px;max-height:${maxH}px;overflow-y:auto;`,
            `overscroll-behavior:contain;`,
            'background:#18181b;',
            'border:1px solid rgba(255, 255, 255, 0.1);border-radius:10px;',
            'box-shadow:0 12px 32px rgba(0,0,0,0.6);padding:4px;'
        ].join('');
    }

    function run(cmd) {
        close();
        input.value = '';
        if (cmd && cmd.run) cmd.run();
    }

    function onInput() {
        const v = input.value.trim();
        if (v.startsWith('/')) {
            open();
        } else {
            close();
        }
    }

    input.addEventListener('input', onInput);

    input.addEventListener('keydown', (e) => {
        if (!isOpen) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (list.length) {
                const d = e.key === 'ArrowDown' ? 1 : -1;
                activeIdx = (activeIdx + d + list.length) % list.length;
                highlightActive();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            const cmd = list[activeIdx] || list[0];
            if (cmd) {
                input.value = cmd.name + ' ';
                render();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            run(list[activeIdx] || list[0]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    });

    document.addEventListener('click', (e) => {
        if (isOpen && overlay && e.target !== input && !overlay.contains(e.target)) {
            close();
        }
    });

    window.addEventListener('resize', () => { if (isOpen) position(); });
    document.addEventListener('scroll', () => { if (isOpen) position(); }, true);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => { if (isOpen) position(); });
        window.visualViewport.addEventListener('scroll', () => { if (isOpen) position(); });
    }
}

export function isModelPickerOpen(input) {
    return !!(input && input.dataset && input.dataset.picker);
}
