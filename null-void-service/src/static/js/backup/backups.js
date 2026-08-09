import { formatBytes } from '../dashboard/utils.js';

const _t = key => window.t ? window.t(key) : key;

// Garantiza que todas las peticiones fetch incluyan credenciales (cookies) para
// preservar el token de sesión durante operaciones largas de descarga/streaming.
if (!window.__nvFetchCredentialsPatched) {
    window.__nvFetchCredentialsPatched = true;
    const _origFetch = window.fetch.bind(window);
    window.fetch = function (url, options) {
        options = Object.assign({}, options);
        if (options.credentials === undefined) {
            options.credentials = 'include';
        }
        return _origFetch(url, options);
    };
}

export async function loadBackupConfig() {
    try {
        const res = await fetch('/api/backup/automation?token=' + TOKEN);
        const data = await res.json();
        if (!data.ok || !data.automation) return;
        const a = data.automation;
        _bkpAutoConfig = a;
        const enabled = document.getElementById('bkp-auto-enabled');
        const freq = document.getElementById('bkp-auto-frequency');
        const time = document.getElementById('bkp-auto-time');
        const limit = document.getElementById('bkp-auto-limit');
        if (enabled) enabled.checked = !!a.enabled;
        if (freq) freq.value = a.frequency || 'daily';
        if (time) time.value = a.time || '02:00';
        if (limit) limit.value = a.copies_limit || 5;
        const manualType = document.querySelector('input[name="bkp_type"][value="' + (a.backup_type || 'full') + '"]');
        if (manualType) manualType.checked = true;
        toggleBkpType();
        if (Array.isArray(a.days)) {
            a.days.forEach(d => {
                const btn = document.querySelector('#bkp-auto-days [data-day="' + d + '"]');
                if (btn) btn.classList.add('active');
            });
        }
        if (a.dest_mode === 'cloud') {
            const cloudRadio = document.querySelector('input[name="bkp_dest_mode"][value="cloud"]');
            if (cloudRadio) {
                cloudRadio.checked = true;
                await toggleBkpDestMode();
            }
        }
        if (Array.isArray(a.source_paths)) {
            _bkpAutoSourcePaths = a.source_paths.filter(p => typeof p === 'string');
            _renderBkpSourceList('auto');
        }
        if (Array.isArray(a.exclude_exts)) {
            _bkpAutoExcludeExts = a.exclude_exts.filter(x => typeof x === 'string');
        }
        if (Array.isArray(a.exclude_paths)) {
            _bkpAutoExcludePaths = a.exclude_paths.filter(p => typeof p === 'string');
        }
        bkpFrequencyChanged();
        _updateBkpButtonLabel();
    } catch (e) {
        console.error("Error loading backup automation:", e);
    }
    _loadBkpMetaInfo();
    _renderBkpTaskList();
}

export function switchBkpMode(mode) {
    const isAuto = mode === 'auto';
    const manualCard = document.getElementById('bkp-mode-manual');
    const autoCard = document.getElementById('bkp-mode-auto');
    const manualPanel = document.getElementById('bkp-manual-panel');
    const autoPanel = document.getElementById('bkp-auto-panel');
    if (manualCard) {
        manualCard.classList.toggle('active', !isAuto);
        manualCard.style.border = !isAuto ? '2px solid var(--indigo)' : '2px solid transparent';
        manualCard.style.background = !isAuto ? 'rgba(99, 102, 241, 0.12)' : 'var(--surface-hi)';
        manualCard.style.color = !isAuto ? 'var(--indigo)' : 'var(--text-secondary)';
        manualCard.style.boxShadow = !isAuto ? '0 0 12px rgba(99, 102, 241, 0.2)' : 'none';
    }
    if (autoCard) {
        autoCard.classList.toggle('active', isAuto);
        autoCard.style.border = isAuto ? '2px solid var(--indigo)' : '2px solid transparent';
        autoCard.style.background = isAuto ? 'rgba(99, 102, 241, 0.12)' : 'var(--surface-hi)';
        autoCard.style.color = isAuto ? 'var(--indigo)' : 'var(--text-secondary)';
        autoCard.style.boxShadow = isAuto ? '0 0 12px rgba(99, 102, 241, 0.2)' : 'none';
    }
    if (manualPanel) manualPanel.style.display = isAuto ? 'none' : 'block';
    if (autoPanel) autoPanel.style.display = isAuto ? 'block' : 'none';
    try {
        localStorage.setItem('nullvoid_backups_mode', isAuto ? 'auto' : 'manual');
    } catch (e) { }
}

export function toggleBkpTaskActive() {
    if (!_bkpAutoConfig) return;
    _bkpAutoConfig.enabled = !_bkpAutoConfig.enabled;
    const enabled = document.getElementById('bkp-auto-enabled');
    if (enabled) enabled.checked = _bkpAutoConfig.enabled;
    saveBkpAutomation();
}

export function _renderBkpTaskList() {
    const list = document.getElementById('bkp-task-list');
    if (!list) return;
    const cfg = _bkpAutoConfig;
    if (!cfg) {
        list.innerHTML = `
            <div style="padding: 18px 16px; border: 1px dashed var(--border); border-radius: 12px; text-align: center; color: var(--text-secondary); font-size: 0.8rem; box-sizing: border-box; width: 100%;">
                ${_t('bkp_no_tasks')}
            </div>`;
        return;
    }
    const typeLabel = { full: _t('bkp_type_full'), differential: _t('bkp_type_diff'), incremental: _t('bkp_type_incr') }[cfg.backup_type] || _t('bkp_type_full');
    const freqLabel = { daily: _t('bkp_freq_daily'), weekly: _t('bkp_freq_weekly'), monthly: _t('bkp_freq_monthly') }[cfg.frequency] || _t('bkp_freq_daily');
    const dayNames = [_t('bkp_day_0'), _t('bkp_day_1'), _t('bkp_day_2'), _t('bkp_day_3'), _t('bkp_day_4'), _t('bkp_day_5'), _t('bkp_day_6')];
    const daysLabel = Array.isArray(cfg.days) && cfg.days.length
        ? cfg.days.map(d => dayNames[d] || '?').join(' · ')
        : (cfg.frequency === 'weekly' ? _t('bkp_no_days') : _t('bkp_all_days'));
    const destLabel = cfg.dest_mode === 'cloud' ? _t('bkp_dest_cloud_label') : _t('bkp_dest_device_label');
    const enabled = !!cfg.enabled;
    list.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid ${enabled ? 'rgba(99,102,241,0.35)' : 'var(--border)'}; border-radius: 12px; background: var(--surface-hi); box-sizing: border-box; width: 100%;">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: ${enabled ? '#10b981' : 'var(--border-hi)'}; flex-shrink: 0; ${enabled ? 'box-shadow: 0 0 8px rgba(16,185,129,0.5);' : ''}"></div>
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 0.88rem; font-weight: 700; color: var(--text-main);">${_t('bkp_task_summary').replace('{0}', typeLabel).replace('{1}', freqLabel).replace('{2}', cfg.time || '02:00')}</span>
                    <span style="font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 8px; border-radius: 20px; ${enabled ? 'background: rgba(16,185,129,0.12); color: #10b981;' : 'background: rgba(148,163,184,0.12); color: var(--text-muted);'}">${enabled ? _t('bkp_task_active') : _t('bkp_task_inactive')}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 3px;">${_t('bkp_task_details').replace('{0}', daysLabel).replace('{1}', destLabel).replace('{2}', cfg.copies_limit || 5)}</div>
            </div>
            <button onclick="toggleBkpTaskActive()"
                style="flex-shrink: 0; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 0.78rem; font-weight: 700; transition: all 0.2s; ${enabled ? 'background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: #f87171;' : 'background: var(--surface-hi); border: 1px solid var(--indigo); color: var(--indigo);'}">${enabled ? _t('bkp_btn_disable') : _t('bkp_btn_enable')}</button>
        </div>`;
}

export function toggleBkpType() {
    const checked = document.querySelector('input[name="bkp_type"]:checked');
    document.querySelectorAll('.bkp-type-card').forEach(card => {
        const input = card.querySelector('input[name="bkp_type"]');
        card.classList.toggle('active', !!input && input === checked);
    });
}

export function _getSelectedBackupType() {
    const input = document.querySelector('input[name="bkp_type"]:checked');
    return input ? input.value : 'full';
}

export async function _loadBkpMetaInfo() {
    try {
        const res = await fetch('/api/backup/meta?token=' + TOKEN);
        const data = await res.json();
        if (!data.ok || !data.meta) return;
        const fmt = ts => ts ? new Date(ts).toLocaleString() : '—';
        const lf = document.getElementById('bkp-last-full');
        const ls = document.getElementById('bkp-last-snapshot');
        if (lf) lf.innerText = fmt(data.meta.last_full);
        if (ls) ls.innerText = fmt(data.meta.last_snapshot);
    } catch (e) {
        console.error("Error loading backup meta:", e);
    }
}

let _bkpFolderTree = null;
let _currentBkpPath = '';
let _bkpAutoConfig = null;
let _bkpAutoSourcePaths = [];
let _bkpManualSourcePaths = [];
let _bkpAutoExcludeExts = [];
let _bkpManualExcludeExts = [];
let _bkpAutoExcludePaths = [];
let _bkpManualExcludePaths = [];
let _bkpSourceModalRef = null;
let _bkpSourceModalChecked = new Set();
let _bkpSourceModalExcluded = new Set();
let _bkpSourceTypes = {};
let _bkpModalTree = null;
let _bkpModalExpanded = new Set();
let _bkpCtxMenuPath = null;
let _bkpLongPressJustFiredAt = 0;


function _getBkpSourcePaths(ref) {
    return ref === 'auto' ? _bkpAutoSourcePaths : _bkpManualSourcePaths;
}

function _getBkpExcludeExts(ref) {
    return ref === 'auto' ? _bkpAutoExcludeExts : _bkpManualExcludeExts;
}

function _getBkpExcludePaths(ref) {
    return ref === 'auto' ? _bkpAutoExcludePaths : _bkpManualExcludePaths;
}


export function openBkpSourceModal(ref) {
    _bkpSourceModalRef = ref;
    _bkpSourceModalChecked = new Set();
    _bkpSourceModalExcluded = new Set(_getBkpExcludePaths(ref));
    _bkpModalExpanded = new Set();
    const modal = document.getElementById('bkp-source-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    loadBkpSourceTree();
}

export function openBkpSourceModalIfEmpty(ref) {
    const paths = _getBkpSourcePaths(ref);
    if (!paths || paths.length === 0) {
        openBkpSourceModal(ref);
    }
}

export function closeBkpSourceModal() {
    const modal = document.getElementById('bkp-source-modal');
    if (modal) modal.style.display = 'none';
    _bkpSourceModalRef = null;
    _bkpSourceModalChecked = new Set();
    _bkpSourceModalExcluded = new Set();
    _hideBkpModalCtxMenu();
}

export function toggleBkpSourceMode() {
    const input = document.querySelector('input[name="bkp_source_mode"]:checked');
    const mode = input ? input.value : 'all';
    const lblAll = document.getElementById('bkp-lbl-src-all');
    const lblCustom = document.getElementById('bkp-lbl-src-custom');
    const allHint = document.getElementById('bkp-src-all-hint');
    const customBlock = document.getElementById('bkp-custom-source');
    const isAll = mode === 'all';
    if (lblAll) {
        lblAll.style.borderColor = isAll ? 'var(--indigo)' : 'var(--border)';
        lblAll.style.background = isAll ? 'rgba(99,102,241,0.14)' : 'var(--surface-hi)';
        lblAll.style.color = isAll ? 'var(--indigo)' : 'var(--text-secondary)';
        lblAll.style.boxShadow = isAll ? '0 0 14px rgba(99, 102, 241, 0.22)' : 'none';
        lblAll.style.fontWeight = isAll ? '700' : '500';
    }
    if (lblCustom) {
        lblCustom.style.borderColor = isAll ? 'var(--border)' : 'var(--indigo)';
        lblCustom.style.background = isAll ? 'var(--surface-hi)' : 'rgba(99,102,241,0.14)';
        lblCustom.style.color = isAll ? 'var(--text-secondary)' : 'var(--indigo)';
        lblCustom.style.boxShadow = isAll ? 'none' : '0 0 14px rgba(99, 102, 241, 0.22)';
        lblCustom.style.fontWeight = isAll ? '500' : '700';
    }
    if (allHint) allHint.style.display = isAll ? 'flex' : 'none';
    if (customBlock) customBlock.style.display = isAll ? 'none' : 'block';
}

async function loadBkpSourceTree() {
    const container = document.getElementById('bkp-source-tree-container');
    if (!container) return;
    container.innerHTML = `<div style="text-align: center; opacity: 0.5; padding: 20px;">${_t('cloud_loading_dirs')}</div>`;
    try {
        const res = await fetch('/api/cloud/folders?view=drive', { headers: HEADERS });
        if (!res.ok) throw new Error('Error al cargar');
        const data = await res.json();
        if (!data.tree) throw new Error('Sin datos');
        _bkpModalTree = data.tree;
        _bkpModalTree._loaded = true;
        container.innerHTML = '';
        _bkpSourceModalChecked = new Set(_getBkpSourcePaths(_bkpSourceModalRef));
        container.appendChild(_renderBkpModalNode(_bkpModalTree, 0, _bkpBuildModalState(), false));
        _renderBkpModalInclusionList();
        _renderBkpModalExclusionList();
        _updateBkpModalCount();
    } catch (e) {
        container.innerHTML = `<div style="text-align: center; color: #f87171; padding: 20px;">${_t('bkp_src_modal_load_error')}</div>`;
    }
}

// Carga perezosa de un nivel del árbol: al expandir una carpeta aún no
// cargada se pide SOLO esa rama al servidor y se inyecta en el nodo en
// memoria. Así el modal abre al instante (payload pequeño) y puede bajar a
// cualquier profundidad sin límites predefinidos.
async function _bkpLoadModalChildren(node) {
    const res = await fetch('/api/cloud/folders?view=drive&path=' + encodeURIComponent(node.path || ''),
        { headers: HEADERS });
    if (!res.ok) throw new Error('Error al cargar');
    const data = await res.json();
    if (!data.tree) throw new Error('Sin datos');
    node.subdirs = data.tree.subdirs || [];
    node.files = data.tree.files || [];
    node.has_subdirs = !!data.tree.has_subdirs;
    node.has_children = !!data.tree.has_children;
    node._loaded = true;
}

// Estado de selección del árbol del modal: únicamente lo marcado de forma
// explícita (casillas + elementos ya guardados). Cada carpeta o archivo se
// marca de forma independiente: marcar una carpeta NO arrastra ni deshabilita
// a sus hijos, y no existen estados intermedios (indeterminado).
function _bkpBuildModalState() {
    return { allSelected: new Set(_bkpSourceModalChecked) };
}

function _bkpDriveIcon() {
    // En documentos HTML, createElement('svg'|'rect'|'line') genera elementos
    // SVG nativos sin necesidad de namespaces externos (todo local).
    const svg = document.createElement('svg');
    svg.setAttribute('width', '17');
    svg.setAttribute('height', '17');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const rect = document.createElement('rect');
    rect.setAttribute('x', '2');
    rect.setAttribute('y', '4');
    rect.setAttribute('width', '20');
    rect.setAttribute('height', '13');
    rect.setAttribute('rx', '2');
    const screen = document.createElement('rect');
    screen.setAttribute('x', '6');
    screen.setAttribute('y', '8');
    screen.setAttribute('width', '12');
    screen.setAttribute('height', '2');
    screen.setAttribute('rx', '1');
    const line = document.createElement('line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '18');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '20');
    const stand = document.createElement('line');
    stand.setAttribute('x1', '8');
    stand.setAttribute('y1', '21');
    stand.setAttribute('x2', '16');
    stand.setAttribute('y2', '21');
    svg.appendChild(rect);
    svg.appendChild(screen);
    svg.appendChild(line);
    svg.appendChild(stand);
    return svg;
}

// Render de un nodo carpeta del modal.
// - inBlock: el nodo está DENTRO de una carpeta marcada como bloque (o de la
//   raíz marcada): su contenido queda incluido en cascada automáticamente.
// - byExcludedParent: el nodo está dentro de una carpeta excluida.
function _renderBkpModalNode(node, depth, state, inBlock, byExcludedParent) {
    depth = depth || 0;
    const li = document.createElement('div');
    li.style.display = 'flex';
    li.style.flexDirection = 'column';

    const explicit = state.allSelected.has(node.path);
    const excluded = _bkpSourceModalExcluded.has(node.path);
    const blockIncluded = !!inBlock || explicit;
    const exclByParent = !!byExcludedParent || excluded;
    const isRoot = node.path === '';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '8px 10px';
    row.style.borderRadius = '6px';
    row.style.cursor = 'pointer';
    row.style.transition = 'all 0.2s';
    row.style.userSelect = 'none';

    if (excluded) {
        row.style.background = 'rgba(248, 113, 113, 0.14)';
    } else if (explicit || inBlock) {
        row.style.background = 'rgba(129, 140, 248, 0.18)';
    }
    if (byExcludedParent) {
        row.style.opacity = '0.6';
        row.title = _t('bkp_src_modal_excluded_by_parent');
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = blockIncluded && !excluded;
    cb.disabled = !!inBlock;
    cb.style.flexShrink = '0';
    cb.style.cursor = !!inBlock ? 'default' : 'pointer';
    cb.onclick = (e) => {
        e.stopPropagation();
        _toggleBkpModalFolder(node.path, !!inBlock);
    };

    // Formato robusto: los stubs del servidor llegan con has_children/has_subdirs; si por
    // caché o versión antigua llega un árbol sin ese campo, se deduce de los
    // subdirs o archivos presentes.
    const hasChildren = !!node.has_children || !!node.has_subdirs || (node.subdirs && node.subdirs.length > 0) || (node.files && node.files.length > 0);
    const arrow = document.createElement('span');
    arrow.style.fontFamily = 'monospace';
    arrow.style.fontSize = '0.75rem';
    arrow.style.opacity = hasChildren ? '0.5' : '0.2';
    arrow.style.width = '14px';
    arrow.style.display = 'inline-block';
    arrow.style.flexShrink = '0';
    arrow.innerText = hasChildren ? (_bkpModalExpanded.has(node.path) ? '▼' : '▶') : '•';

    const icon = document.createElement('span');
    if (isRoot) {
        icon.appendChild(_bkpDriveIcon());
    } else {
        icon.innerHTML = _BKP_FOLDER_SVG;
    }
    icon.style.flexShrink = '0';
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';

    const label = document.createElement('span');
    label.innerText = (node.path === '') ? _t('my_drive') : node.name;
    label.style.fontWeight = '500';
    label.style.color = excluded ? '#f87171' : 'var(--text-main)';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';

    if (excluded) {
        const tag = document.createElement('span');
        tag.appendChild(_bkpExcludedIcon(14));
        tag.style.marginLeft = 'auto';
        tag.style.flexShrink = '0';
        tag.style.display = 'inline-flex';
        tag.style.alignItems = 'center';
        row.appendChild(cb);
        row.appendChild(arrow);
        row.appendChild(icon);
        row.appendChild(label);
        row.appendChild(tag);
    } else {
        row.appendChild(cb);
        row.appendChild(arrow);
        row.appendChild(icon);
        row.appendChild(label);
    }

    li.appendChild(row);

    const childrenContainer = document.createElement('div');
    childrenContainer.style.display = _bkpModalExpanded.has(node.path) ? 'flex' : 'none';
    childrenContainer.style.flexDirection = 'column';
    childrenContainer.style.borderLeft = '1px dashed rgba(255,255,255,0.15)';
    childrenContainer.style.marginLeft = '18px';
    childrenContainer.style.paddingLeft = '6px';

    if (node.subdirs && node.subdirs.length > 0) {
        node.subdirs.forEach(sub => {
            childrenContainer.appendChild(_renderBkpModalNode(sub, depth + 1, state, blockIncluded, exclByParent));
        });
    }

    if (node.files && node.files.length) {
        node.files.forEach(file => {
            childrenContainer.appendChild(_renderBkpModalFileRow(file, state, blockIncluded, byExcludedParent));
        });
    }

    li.appendChild(childrenContainer);

    if (hasChildren) {
        arrow.onclick = (e) => {
            e.stopPropagation();
            _bkpToggleExpand(node, childrenContainer, arrow);
        };
    }

    row.onclick = (e) => {
        if (row.contains(e.target) && e.target === cb) return;
        if (Date.now() - _bkpLongPressJustFiredAt < 600) return;
        if (e.shiftKey) {
            if (!isRoot) _toggleBkpModalExclusion(node.path, byExcludedParent);
            return;
        }
        if (!hasChildren) return;
        _bkpToggleExpand(node, childrenContainer, arrow);
    };

    if (!isRoot) {
        _attachBkpRowLongPress(row, node.path, byExcludedParent);
    }

    return li;
}

function _renderBkpModalFileRow(file, state, inBlock, byExcludedParent) {
    const explicit = state.allSelected.has(file.path);
    const excluded = _bkpSourceModalExcluded.has(file.path);
    const blockIncluded = !!inBlock || explicit;
    const exclByParent = !!byExcludedParent || excluded;
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '7px 10px';
    row.style.borderRadius = '6px';
    row.style.cursor = 'pointer';
    row.style.transition = 'all 0.2s';
    row.style.userSelect = 'none';

    if (excluded) {
        row.style.background = 'rgba(248, 113, 113, 0.14)';
    } else if (explicit || inBlock) {
        row.style.background = 'rgba(129, 140, 248, 0.18)';
    }
    if (byExcludedParent) {
        row.style.opacity = '0.6';
        row.title = _t('bkp_src_modal_excluded_by_parent');
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = blockIncluded && !excluded;
    cb.disabled = !!inBlock;
    cb.style.flexShrink = '0';
    cb.style.cursor = !!inBlock ? 'default' : 'pointer';

    const bullet = document.createElement('span');
    bullet.innerText = '•';
    bullet.style.fontFamily = 'monospace';
    bullet.style.fontSize = '0.75rem';
    bullet.style.opacity = '0.2';
    bullet.style.width = '14px';
    bullet.style.display = 'inline-block';
    bullet.style.flexShrink = '0';

    const icon = document.createElement('span');
    icon.innerHTML = _bkpFileIcon(file.ext);
    icon.style.flexShrink = '0';
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';

    const label = document.createElement('span');
    label.innerText = file.name;
    label.style.fontSize = '0.86rem';
    label.style.color = excluded ? '#f87171' : 'var(--text-secondary)';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';

    row.appendChild(cb);
    row.appendChild(bullet);
    row.appendChild(icon);
    row.appendChild(label);

    if (excluded) {
        const tag = document.createElement('span');
        tag.appendChild(_bkpExcludedIcon(13));
        tag.style.marginLeft = 'auto';
        tag.style.flexShrink = '0';
        tag.style.display = 'inline-flex';
        tag.style.alignItems = 'center';
        row.appendChild(tag);
    } else if (file.size > 0) {
        const size = document.createElement('span');
        size.innerText = formatBytes(file.size);
        size.style.marginLeft = 'auto';
        size.style.fontSize = '0.68rem';
        size.style.color = 'var(--text-muted)';
        size.style.flexShrink = '0';
        size.style.paddingLeft = '8px';
        row.appendChild(size);
    }

    cb.onclick = (e) => {
        e.stopPropagation();
        _toggleBkpModalFile(file.path, !!inBlock);
    };
    row.onclick = (e) => {
        if (row.contains(e.target) && e.target === cb) return;
        if (Date.now() - _bkpLongPressJustFiredAt < 600) return;
        if (e.shiftKey) {
            _toggleBkpModalExclusion(file.path, exclByParent);
            return;
        }
        _toggleBkpModalFile(file.path, !!inBlock);
    };

    _attachBkpRowLongPress(row, file.path, byExcludedParent);

    return row;
}

// Expande/colapsa una carpeta del modal. Si la rama aún no está cargada
// (carga perezosa), primero se solicita ese nivel al servidor y se re-renderiza.
async function _bkpToggleExpand(node, childrenContainer, arrow) {
    const isHidden = childrenContainer.style.display === 'none';
    const hasChildren = !!node.has_children || !!node.has_subdirs || (node.subdirs && node.subdirs.length > 0) || (node.files && node.files.length > 0);
    if (isHidden && hasChildren && !node._loaded) {
        arrow.innerText = '…';
        try {
            await _bkpLoadModalChildren(node);
        } catch (e) {
            arrow.innerText = '▶';
            return;
        }
        _bkpModalExpanded.add(node.path);
        _refreshBkpModalTree();
        return;
    }
    childrenContainer.style.display = isHidden ? 'flex' : 'none';
    arrow.innerText = isHidden ? '▼' : '▶';
    if (isHidden) _bkpModalExpanded.add(node.path);
    else _bkpModalExpanded.delete(node.path);
}

// Icono de exclusión profesional (prohibido): círculo con barra diagonal.
function _bkpExcludedIcon(size) {
    const svg = document.createElement('svg');
    svg.setAttribute('width', String(size || 15));
    svg.setAttribute('height', String(size || 15));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#f87171');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const circle = document.createElement('circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    const line = document.createElement('line');
    line.setAttribute('x1', '4.93');
    line.setAttribute('y1', '4.93');
    line.setAttribute('x2', '19.07');
    line.setAttribute('y2', '19.07');
    svg.appendChild(circle);
    svg.appendChild(line);
    return svg;
}

const _BKP_EXCLUDED_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>';

// Marcado en bloque con cascada: marcar una carpeta (o la raíz) incluye todo
// su contenido — los hijos se muestran marcados automáticamente y no pueden
// desmarcarse individualmente (para omitir algo se usa la exclusión,
// Shift+Click / pulsación larga, que gana sobre el bloque al empaquetar).
// Marcar un elemento siempre levanta su propia exclusión.
function _toggleBkpModalFolder(path, inBlock) {
    if (inBlock) return;
    if (_bkpSourceModalChecked.has(path)) {
        _bkpSourceModalChecked.delete(path);
        delete _bkpSourceTypes[path];
    } else {
        _bkpSourceModalChecked.add(path);
        _bkpSourceTypes[path] = 'folder';
        _bkpSourceModalExcluded.delete(path);
    }
    _refreshBkpModalTree();
}

function _toggleBkpModalFile(path, inBlock) {
    if (inBlock) return;
    if (_bkpSourceModalChecked.has(path)) {
        _bkpSourceModalChecked.delete(path);
        delete _bkpSourceTypes[path];
    } else {
        _bkpSourceModalChecked.add(path);
        _bkpSourceTypes[path] = 'file';
        _bkpSourceModalExcluded.delete(path);
    }
    _refreshBkpModalTree();
}

// Exclusión por elemento: Shift+Click (escritorio) o menú de pulsación larga
// (móvil). Un elemento excluido se ignora al empaquetar; excluir un ancestro
// excluye todo su subárbol, y los hijos de una carpeta excluida no pueden
// manipularse hasta levantar la exclusión del padre.
function _toggleBkpModalExclusion(path, excludedByParent) {
    if (excludedByParent || path === '') return;
    if (_bkpSourceModalExcluded.has(path)) {
        _bkpSourceModalExcluded.delete(path);
    } else {
        _bkpSourceModalExcluded.add(path);
        _bkpSourceModalChecked.delete(path);
        delete _bkpSourceTypes[path];
    }
    _refreshBkpModalTree();
}

function _refreshBkpModalTree() {
    const container = document.getElementById('bkp-source-tree-container');
    if (!container || !_bkpModalTree) return;
    container.innerHTML = '';
    container.appendChild(_renderBkpModalNode(_bkpModalTree, 0, _bkpBuildModalState(), false));
    _renderBkpModalInclusionList();
    _renderBkpModalExclusionList();
    _updateBkpModalCount();
}

// Elementos de inclusión EFECTIVOS: los marcados que no quedan ya cubiertos
// por un bloque ancestro (una carpeta marcada incluye a sus hijos).
function _bkpModalEffectiveInclusion() {
    const all = Array.from(_bkpSourceModalChecked);
    return all.filter(p =>
        !all.some(q => q !== p && (q === '' || p.startsWith(q + '/'))));
}

// Lista de inclusión explícita: muestra los bloques/archivos que se van a
// comprimir (los hijos de una carpeta marcada están implícitos en ella).
function _renderBkpModalInclusionList() {
    const container = document.getElementById('bkp-source-inclusion-list');
    if (!container) return;
    const items = _bkpModalEffectiveInclusion()
        .sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    if (items.length === 0) {
        container.innerHTML = `<div style="font-size: 0.78rem; opacity: 0.45; padding: 8px 4px;">${_t('bkp_src_modal_include_empty')}</div>`;
        return;
    }
    let html = '';
    items.forEach(p => {
        const display = (p === '') ? _t('my_drive') : '/' + p;
        html += `<div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--surface-hi); border: 1px solid var(--border); border-radius: 8px; font-size: 0.8rem; margin-bottom: 6px;">
            <span style="flex-shrink: 0;">${_bkpSourceIcon(p)}</span>
            <span style="flex: 1; min-width: 0; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.split('/').pop() || _t('my_drive')}</span>
            <span style="flex-shrink: 0; font-size: 0.68rem; color: var(--text-muted); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left;">${display}</span>
            <button onclick="removeFromBkpInclusion('${p.replace(/'/g, "\\'")}')" title="${_t('bkp_source_remove')}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.95rem; padding: 0 4px; flex-shrink: 0; border-radius: 4px;" onmouseover="this.style.background='rgba(248,113,113,0.15)'; this.style.color='#f87171';" onmouseout="this.style.background='transparent'; this.style.color='var(--text-muted)';">✕</button>
        </div>`;
    });
    container.innerHTML = html;
}

export function removeFromBkpInclusion(path) {
    if (!_bkpSourceModalChecked.has(path)) return;
    _bkpSourceModalChecked.delete(path);
    delete _bkpSourceTypes[path];
    _refreshBkpModalTree();
}

function _updateBkpModalCount() {
    const el = document.getElementById('bkp-source-selected-count');
    const hint = document.getElementById('bkp-source-selected-hint');
    if (el) el.innerText = String(_bkpModalEffectiveInclusion().length);
    if (hint) {
        if (_bkpSourceModalChecked.has('')) {
            hint.style.display = 'block';
            hint.innerText = _t('bkp_src_modal_root_selected');
        } else {
            hint.style.display = 'none';
        }
    }
}

export function clearBkpSourceModalSelection() {
    _bkpSourceModalChecked = new Set();
    _bkpSourceModalExcluded = new Set();
    _hideBkpModalCtxMenu();
    _refreshBkpModalTree();
}

// Lista de exclusiones explícitas: muestra en rojo los elementos que el
// usuario ha marcado para ignorar al empaquetar (Shift+Click / pulsación
// larga). Solo aparece cuando existe al menos una exclusión.
function _renderBkpModalExclusionList() {
    const container = document.getElementById('bkp-source-excluded-list');
    if (!container) return;
    const items = Array.from(_bkpSourceModalExcluded)
        .sort((a, b) => a.localeCompare(b));
    const block = document.getElementById('bkp-source-excluded-block');
    if (block) block.style.display = items.length ? 'block' : 'none';
    const count = document.getElementById('bkp-source-excluded-count');
    if (count) count.innerText = String(items.length);
    if (items.length === 0) {
        container.innerHTML = `<div style="font-size: 0.78rem; opacity: 0.45; padding: 8px 4px;">${_t('bkp_src_modal_excluded_empty')}</div>`;
        return;
    }
    let html = '';
    items.forEach(p => {
        const display = '/' + p;
        html += `<div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.3); border-radius: 8px; font-size: 0.8rem; margin-bottom: 6px;">
            <span style="flex-shrink: 0; display: inline-flex; align-items: center;">${_BKP_EXCLUDED_SVG}</span>
            <span style="flex: 1; min-width: 0; font-weight: 600; color: #f87171; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.split('/').pop()}</span>
            <span style="flex-shrink: 0; font-size: 0.68rem; color: var(--text-muted); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left;">${display}</span>
            <button onclick="removeFromBkpExclusion('${p.replace(/'/g, "\\'")}')" title="${_t('bkp_source_remove')}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.95rem; padding: 0 4px; flex-shrink: 0; border-radius: 4px;" onmouseover="this.style.background='rgba(248,113,113,0.15)'; this.style.color='#f87171';" onmouseout="this.style.background='transparent'; this.style.color='var(--text-muted)';">✕</button>
        </div>`;
    });
    container.innerHTML = html;
}

export function removeFromBkpExclusion(path) {
    if (!_bkpSourceModalExcluded.has(path)) return;
    _bkpSourceModalExcluded.delete(path);
    _refreshBkpModalTree();
}

// ---------------------------------------------------------------------------
// Pulsación larga (móvil): menú contextual flotante para excluir/incluir.
// ---------------------------------------------------------------------------
function _ensureBkpModalCtxMenu() {
    let menu = document.getElementById('bkp-modal-ctx-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'bkp-modal-ctx-menu';
    menu.style.cssText = 'display:none; position:fixed; z-index:100001; min-width:190px; background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:6px; box-shadow:0 10px 30px rgba(0,0,0,0.45); font-size:0.84rem;';
    const btn = document.createElement('button');
    btn.id = 'bkp-modal-ctx-menu-btn';
    btn.style.cssText = 'width:100%; padding:9px 12px; border:none; border-radius:7px; background:none; color:var(--text-main); font-weight:600; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px;';
    btn.onclick = () => {
        if (_bkpCtxMenuPath !== null) {
            _toggleBkpModalExclusion(_bkpCtxMenuPath, false);
        }
        _hideBkpModalCtxMenu();
    };
    menu.appendChild(btn);
    document.body.appendChild(menu);
    document.addEventListener('click', (e) => {
        if (menu.style.display !== 'none' && !menu.contains(e.target)) {
            _hideBkpModalCtxMenu();
        }
    }, true);
    return menu;
}

function _showBkpModalCtxMenu(x, y, path) {
    const menu = _ensureBkpModalCtxMenu();
    _bkpCtxMenuPath = path;
    const btn = document.getElementById('bkp-modal-ctx-menu-btn');
    const isExcluded = _bkpSourceModalExcluded.has(path);
    btn.innerHTML = isExcluded
        ? `<span style="color:#10b981;">✓</span> ${_t('bkp_src_modal_ctx_include')}`
        : `<span style="display:inline-flex;align-items:center;color:#f87171;">${_BKP_EXCLUDED_SVG}</span> ${_t('bkp_src_modal_ctx_exclude')}`;
    menu.style.display = 'block';
    const mw = menu.offsetWidth || 190;
    const mh = menu.offsetHeight || 46;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + 'px';
}

function _hideBkpModalCtxMenu() {
    const menu = document.getElementById('bkp-modal-ctx-menu');
    if (menu) menu.style.display = 'none';
    _bkpCtxMenuPath = null;
}

// Asocia long-press a una fila del árbol: tras ~500ms sin mover el dedo se
// abre el menú contextual en la posición del toque. El 'click' posterior del
// navegador se suprime (bandera temporal) para no expandir/marcar la fila.
function _attachBkpRowLongPress(row, path, excludedByParent) {
    let timer = null;
    let startX = 0;
    let startY = 0;

    row.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        if (excludedByParent || path === '') return;
        timer = setTimeout(() => {
            _bkpLongPressJustFiredAt = Date.now();
            _showBkpModalCtxMenu(t.clientX, t.clientY, path);
        }, 500);
    }, { passive: true });

    const cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    row.addEventListener('touchmove', (e) => {
        if (timer) {
            const t = e.touches[0];
            if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
                cancel();
            }
        }
    }, { passive: true });

    row.addEventListener('touchend', cancel);
    row.addEventListener('touchcancel', cancel);
    row.addEventListener('contextmenu', (e) => {
        if (excludedByParent || path === '') return;
        e.preventDefault();
        _bkpLongPressJustFiredAt = Date.now();
        _showBkpModalCtxMenu(e.clientX, e.clientY, path);
    });
}

export async function confirmBkpSource() {
    if (!_bkpSourceModalRef) return;
    const ref = _bkpSourceModalRef;
    // Solo se guardan los bloques/archivos efectivos: los hijos de una
    // carpeta marcada quedan implícitos en el bloque.
    const checked = _bkpModalEffectiveInclusion();
    if (checked.length === 0) {
        await NV_Alert(_t('bkp_src_modal_empty'));
        return;
    }
    const excludePathsTarget = _getBkpExcludePaths(ref);
    excludePathsTarget.length = 0;
    Array.from(_bkpSourceModalExcluded).sort().forEach(p => excludePathsTarget.push(p));

    const paths = _getBkpSourcePaths(ref);
    paths.length = 0;
    checked.forEach(p => {
        if (!paths.includes(p)) paths.push(p);
    });
    closeBkpSourceModal();
    _renderBkpSourceList(ref);
}

export function removeBkpSourcePath(ref, path) {
    const paths = _getBkpSourcePaths(ref);
    const idx = paths.indexOf(path);
    if (idx !== -1) paths.splice(idx, 1);
    _renderBkpSourceList(ref);
}

export async function removeBkpSourcePathConfirm(ref, path) {
    const display = (path === '') ? _t('my_drive') : '/' + path;
    const confirmed = await NV_Confirm(_t('bkp_source_remove_confirm').replace('{0}', display));
    if (confirmed) removeBkpSourcePath(ref, path);
}

const _BKP_FOLDER_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';

function _bkpSourceIcon(path) {
    if (_bkpSourceTypes[path] === 'folder') return _BKP_FOLDER_SVG;
    const last = (path || '').split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot > 0 && dot < last.length - 1) return _bkpFileIcon(last.slice(dot));
    return _bkpFileIcon('');
}

// Iconos de archivo profesionales (SVG estilo feather) con color por tipo,
// en lugar de emojis.
const _BKP_FILE_ICONS = {
    '.pdf': { c: '#f87171', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>' },
    '.doc': { c: '#60a5fa', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>' },
    '.docx': { c: '#60a5fa', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>' },
    '.xls': { c: '#34d399', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line>' },
    '.xlsx': { c: '#34d399', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line>' },
    '.ppt': { c: '#fbbf24', p: '<path d="M2 3h20"></path><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"></path><line x1="12" y1="16" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line>' },
    '.pptx': { c: '#fbbf24', p: '<path d="M2 3h20"></path><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"></path><line x1="12" y1="16" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line>' },
    '.jpg': { c: '#a78bfa', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
    '.jpeg': { c: '#a78bfa', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
    '.png': { c: '#a78bfa', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
    '.gif': { c: '#a78bfa', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
    '.svg': { c: '#a78bfa', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
    '.webp': { c: '#a78bfa', p: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
    '.mp3': { c: '#f472b6', p: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>' },
    '.wav': { c: '#f472b6', p: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>' },
    '.mp4': { c: '#fb7185', p: '<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect>' },
    '.mkv': { c: '#fb7185', p: '<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect>' },
    '.zip': { c: '#f59e0b', p: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>' },
    '.rar': { c: '#f59e0b', p: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>' },
    '.tar': { c: '#f59e0b', p: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>' },
    '.gz': { c: '#f59e0b', p: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>' },
    '.txt': { c: '#94a3b8', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>' },
    '.md': { c: '#94a3b8', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>' },
    '.json': { c: '#94a3b8', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>' },
    '.csv': { c: '#94a3b8', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>' },
    '.py': { c: '#34d399', p: '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>' },
    '.js': { c: '#eab308', p: '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>' },
    '.html': { c: '#38bdf8', p: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>' },
    '.css': { c: '#22d3ee', p: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>' },
    '.cpp': { c: '#c084fc', p: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>' },
    '.exe': { c: '#94a3b8', p: '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>' },
    '.iso': { c: '#94a3b8', p: '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>' },
    '.db': { c: '#818cf8', p: '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>' },
    '.sql': { c: '#818cf8', p: '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>' },
    _default: { c: '#94a3b8', p: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>' },
};

function _bkpFileIcon(ext) {
    const entry = _BKP_FILE_ICONS[(ext || '').toLowerCase()] || _BKP_FILE_ICONS._default;
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${entry.c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${entry.p}</svg>`;
}

export function _renderBkpSourceList(ref) {
    const paths = _getBkpSourcePaths(ref);
    const listEl = ref === 'auto' ? document.getElementById('bkp-auto-source-list') : document.getElementById('bkp-source-list');
    const noneHint = ref === 'auto' ? document.getElementById('bkp-auto-source-none-hint') : document.getElementById('bkp-source-none-hint');
    if (!listEl) return;
    if (paths.length === 0) {
        listEl.innerHTML = '';
        if (noneHint) {
            noneHint.style.display = 'block';
            listEl.appendChild(noneHint);
        }
        return;
    }
    if (noneHint) noneHint.style.display = 'none';
    let html = '';
    paths.forEach(p => {
        const display = (p === '') ? _t('my_drive') : '/' + p;
        html += `<div onclick="if(!event.target.closest('button')) openBkpSourceModal('${ref}')" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: var(--surface-hi); border: 1px solid var(--border); border-radius: 8px; font-size: 0.82rem; box-sizing: border-box; width: 100%; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.borderColor='var(--indigo)';" onmouseout="this.style.borderColor='var(--border)';">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 0;">
                <span style="flex-shrink: 0;">${_bkpSourceIcon(p)}</span>
                <span style="display: inline-block; min-width: 0; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.split('/').pop() || _t('my_drive')}</span>
                <span style="flex-shrink: 0; font-size: 0.7rem; color: var(--text-muted); max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left;">${display}</span>
            </div>
            <button onclick="removeBkpSourcePath('${ref}', '${p.replace(/'/g, "\\'")}')" title="${_t('bkp_source_remove')}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem; padding: 2px 6px; flex-shrink: 0; border-radius: 4px;" onmouseover="this.style.background='rgba(248,113,113,0.15)'; this.style.color='#f87171';" onmouseout="this.style.background='transparent'; this.style.color='var(--text-muted)';">
                ✕
            </button>
        </div>`;
    });
    html += `<div style="font-size: 0.72rem; color: var(--text-muted); padding-left: 4px;">${_t('bkp_source_count').replace('{0}', paths.length)}</div>`;
    const excl = _getBkpExcludePaths(ref);
    if (excl.length) {
        html += `<div style="font-size: 0.72rem; color: #f87171; padding: 6px 4px 0; display: flex; align-items: center; gap: 5px;">${_BKP_EXCLUDED_SVG} ${_t('bkp_source_excluded_note').replace('{0}', excl.map(q => '/' + q).join(', '))}</div>`;
    }
    listEl.innerHTML = html;
}

export function _updateBkpButtonLabel() {
    const label = document.getElementById('btn-backup-label');
    const iconContainer = document.getElementById('btn-backup-icon');
    if (!label) return;
    const mode = document.querySelector('input[name="bkp_dest_mode"]:checked');
    const isCloud = mode && mode.value === 'cloud';
    label.innerText = isCloud ? _t('bkp_btn_create_cloud') : _t('bkp_btn_create_download');
    if (iconContainer) {
        if (isCloud) {
            iconContainer.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>`;
        } else {
            iconContainer.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
        }
    }
}

export async function toggleBkpDestMode() {
    const mode = document.querySelector('input[name="bkp_dest_mode"]:checked').value;
    const cloudDest = document.getElementById('bkp-cloud-dest');
    const cloudAutoHint = document.getElementById('bkp-cloud-auto-dest-hint');
    const lblDownload = document.getElementById('bkp-lbl-download');
    const lblCloud = document.getElementById('bkp-lbl-cloud');
    const isCloud = mode === 'cloud';
    if (isCloud) {
        if (cloudDest) cloudDest.style.display = 'none';
        if (cloudAutoHint) cloudAutoHint.style.display = 'block';
        if (lblCloud) {
            lblCloud.style.borderColor = 'var(--indigo)';
            lblCloud.style.background = 'rgba(99,102,241,0.14)';
            lblCloud.style.color = 'var(--indigo)';
            lblCloud.style.boxShadow = '0 0 14px rgba(99, 102, 241, 0.22)';
            lblCloud.style.fontWeight = '700';
        }
        if (lblDownload) {
            lblDownload.style.borderColor = 'var(--border)';
            lblDownload.style.background = 'var(--surface-hi)';
            lblDownload.style.color = 'var(--text-secondary)';
            lblDownload.style.boxShadow = 'none';
            lblDownload.style.fontWeight = '500';
        }
    } else {
        if (cloudDest) cloudDest.style.display = 'none';
        if (cloudAutoHint) cloudAutoHint.style.display = 'none';
        if (lblDownload) {
            lblDownload.style.borderColor = 'var(--indigo)';
            lblDownload.style.background = 'rgba(99,102,241,0.14)';
            lblDownload.style.color = 'var(--indigo)';
            lblDownload.style.boxShadow = '0 0 14px rgba(99, 102, 241, 0.22)';
            lblDownload.style.fontWeight = '700';
        }
        if (lblCloud) {
            lblCloud.style.borderColor = 'var(--border)';
            lblCloud.style.background = 'var(--surface-hi)';
            lblCloud.style.color = 'var(--text-secondary)';
            lblCloud.style.boxShadow = 'none';
            lblCloud.style.fontWeight = '500';
        }
    }
    _updateBkpButtonLabel();
}

export async function _loadCloudFoldersForBackup() {
    try {
        const res = await fetch('/api/cloud/folders?view=drive&token=' + TOKEN);
        const data = await res.json();
        if (data.tree) {
            _bkpFolderTree = data.tree;
            _bkpFolderTree._loaded = true;
            _currentBkpPath = '';
            _selectBkpPath('');
        }
    } catch (e) {
        console.error("Error loading backup folders:", e);
    }
}

export function _selectBkpPath(path) {
    _currentBkpPath = path || '';
    const pathInput = document.getElementById('bkp-cloud-path');
    const display = document.getElementById('bkp-selected-path-display');
    if (pathInput) pathInput.value = _currentBkpPath;
    if (display) display.innerText = '/' + (_currentBkpPath || ' (' + _t('my_drive') + ')');
    _refreshBkpTreeUI();
}

export function _renderBkpTree(node, depth) {
    depth = depth || 0;
    const li = document.createElement('div');
    li.style.display = 'flex';
    li.style.flexDirection = 'column';
    li.style.paddingLeft = '14px';
    li.style.position = 'relative';

    const folderRow = document.createElement('div');
    folderRow.className = 'folder-tree-row-bkp';
    folderRow.style.display = 'flex';
    folderRow.style.alignItems = 'center';
    folderRow.style.gap = '6px';
    folderRow.style.padding = '8px 10px';
    folderRow.style.borderRadius = '6px';
    folderRow.style.cursor = 'pointer';
    folderRow.style.transition = 'all 0.2s';
    folderRow.style.userSelect = 'none';

    if (_currentBkpPath === node.path) {
        folderRow.style.background = 'rgba(129, 140, 248, 0.2)';
        folderRow.style.border = '1px solid rgba(129, 140, 248, 0.4)';
    } else {
        folderRow.style.border = '1px solid transparent';
    }

    const arrow = document.createElement('span');
    arrow.style.fontFamily = 'monospace';
    arrow.style.fontSize = '0.75rem';
    arrow.style.opacity = '0.5';
    arrow.style.width = '14px';
    arrow.style.display = 'inline-block';

    const hasSubdirs = !!node.has_subdirs || (node.subdirs && node.subdirs.length > 0);
    const selectedPath = _currentBkpPath || '';
    const isAncestor = selectedPath.startsWith((node.path ? node.path + '/' : ''));
    const isExpanded = depth < 1 || node._expanded === true
        || (node._loaded && selectedPath && (isAncestor || node.path === selectedPath));

    if (hasSubdirs) {
        arrow.innerText = isExpanded ? '▼' : '▶';
        arrow.style.cursor = 'pointer';
    } else {
        arrow.innerText = '•';
        arrow.style.opacity = '0.2';
    }

    const icon = document.createElement('span');
    icon.innerHTML = _BKP_FOLDER_SVG;
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';

    const label = document.createElement('span');
    label.innerText = (node.path === '') ? _t('my_drive') : node.name;
    label.style.fontWeight = '500';
    label.style.color = 'var(--text-main)';

    folderRow.appendChild(arrow);
    folderRow.appendChild(icon);
    folderRow.appendChild(label);
    li.appendChild(folderRow);

    const childrenContainer = document.createElement('div');
    childrenContainer.style.display = isExpanded ? 'flex' : 'none';
    childrenContainer.style.flexDirection = 'column';
    childrenContainer.style.borderLeft = '1px dashed rgba(255,255,255,0.15)';
    childrenContainer.style.marginLeft = '18px';
    childrenContainer.style.paddingLeft = '6px';

    if (hasSubdirs) {
        node.subdirs.forEach(sub => {
            childrenContainer.appendChild(_renderBkpTree(sub, depth + 1));
        });
    }

    li.appendChild(childrenContainer);

    arrow.onclick = (e) => {
        if (!hasSubdirs) return;
        e.stopPropagation();
        _bkpToggleDestExpand(node, childrenContainer, arrow);
    };

    folderRow.oncontextmenu = async (e) => {
        e.preventDefault();
        if (node.path === '') return;
        if (!await NV_Confirm(_t('bkp_folder_delete_confirm').replace('{0}', node.name))) return;
        const parts = node.path.split('/');
        const name = parts.pop();
        const parent = parts.join('/');
        try {
            const res = await fetch('/api/cloud/delete', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ name: name, path: parent, view: 'drive' })
            });
            const data = await res.json();
            if (data.ok) {
                if (_currentBkpPath === node.path || _currentBkpPath.startsWith(node.path + '/')) {
                    _selectBkpPath('');
                }
                await _loadCloudFoldersForBackup();
            } else {
                await NV_Alert(data.error || _t('bkp_folder_delete_error'));
            }
        } catch (err) {
            await NV_Alert(_t('bkp_folder_conn_error'));
        }
    };

    folderRow.onclick = (e) => {
        e.stopPropagation();
        _selectBkpPath(node.path);
    };

    return li;
}

export function _refreshBkpTreeUI() {
    const container = document.getElementById('bkp-folder-tree-container');
    if (container && _bkpFolderTree) {
        container.innerHTML = '';
        container.appendChild(_renderBkpTree(_bkpFolderTree));
    }
}

// Expande/colapsa una carpeta del selector de destino con carga perezosa:
// la primera vez que se expande una rama se pide ese nivel al servidor.
async function _bkpLoadDestChildren(node) {
    const res = await fetch('/api/cloud/folders?view=drive&path=' + encodeURIComponent(node.path || ''),
        { headers: HEADERS });
    if (!res.ok) throw new Error('Error al cargar');
    const data = await res.json();
    if (!data.tree) throw new Error('Sin datos');
    node.subdirs = data.tree.subdirs || [];
    node.files = data.tree.files || [];
    node.has_subdirs = !!data.tree.has_subdirs;
    node._loaded = true;
}

async function _bkpToggleDestExpand(node, childrenContainer, arrow) {
    const isHidden = childrenContainer.style.display === 'none';
    if (isHidden && node.has_subdirs && !node._loaded) {
        arrow.innerText = '…';
        try {
            await _bkpLoadDestChildren(node);
        } catch (e) {
            arrow.innerText = '▶';
            return;
        }
        node._expanded = true;
        _refreshBkpTreeUI();
        return;
    }
    childrenContainer.style.display = isHidden ? 'flex' : 'none';
    arrow.innerText = isHidden ? '▼' : '▶';
    node._expanded = isHidden;
}

export async function bkpCreateFolder() {
    const folderName = await NV_Prompt(_t('bkp_folder_create_prompt'), "", _t('bkp_folder_create_title'));
    if (!folderName || !folderName.trim()) return;
    const safeName = folderName.trim().replace(/[<>:"/\\|?*]/g, '');
    if (!safeName) return;
    const newPath = _currentBkpPath ? `${_currentBkpPath}/${safeName}` : safeName;
    try {
        const res = await fetch('/api/cloud/mkdir', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name: safeName, path: _currentBkpPath, view: 'drive' })
        });
        const data = await res.json();
        if (!data.ok) {
            await NV_Alert(data.error || _t('bkp_folder_create_error'));
            return;
        }
    } catch (err) {
        await NV_Alert(_t('bkp_folder_conn_error_create'));
        return;
    }
    await _loadCloudFoldersForBackup();
    await _selectBkpPath(newPath);
}

export async function doBackup() {
    const btn = document.getElementById('btn-backup');
    const out = document.getElementById('backup-result');
    const wrap = document.getElementById('backup-progress-wrap');
    const bar = document.getElementById('backup-progress-bar');
    const pctTxt = document.getElementById('backup-progress-text');

    const srcModeInput = document.querySelector('input[name="bkp_source_mode"]:checked');
    const isAllDrive = !srcModeInput || srcModeInput.value === 'all';
    let sourcePaths;
    if (isAllDrive) {
        sourcePaths = [''];
    } else {
        sourcePaths = _bkpManualSourcePaths.slice();
        if (sourcePaths.length === 0) {
            await NV_Alert(_t('bkp_select_source_folder'), _t('bkp_missing_data'));
            return;
        }
    }
    if (btn) btn.disabled = true;
    if (out) out.innerHTML = '';
    if (wrap) wrap.style.display = 'block';
    if (bar) bar.style.width = '0%';
    if (pctTxt) pctTxt.innerText = _t('bkp_scanning');
    try {
        const destMode = document.querySelector('input[name="bkp_dest_mode"]:checked').value;
        const res = await fetch('/api/backup/cloud?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                source_paths: sourcePaths,
                dest_mode: destMode,
                cloud_path: '',
                backup_type: 'full',
                exclude_exts: _bkpManualExcludeExts,
                exclude_paths: _bkpManualExcludePaths
            })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => null);
            throw new Error((errData && errData.error) || _t('bkp_server_error'));
        }
        if (!res.body || !res.body.getReader) throw new Error(_t('bkp_no_stream'));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = null;
        for (;;) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
                const raw = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const line = raw.split('\n').find(l => l.startsWith('data: '));
                if (!line) continue;
                let evt;
                try { evt = JSON.parse(line.slice(6)); } catch (e) { continue; }
                if (evt.type === 'progress' && evt.phase === 'compress') {
                    const pct = Math.round((evt.current / Math.max(1, evt.total)) * 95);
                    if (bar) bar.style.width = pct + '%';
                    if (pctTxt) pctTxt.innerText = _t('bkp_compressing').replace('{0}', evt.file).replace('{1}', pct);
                } else if (evt.type === 'progress' && evt.phase === 'scan') {
                    if (bar) bar.style.width = '2%';
                    if (pctTxt) pctTxt.innerText = evt.file;
                } else if (evt.type === 'done') {
                    done = evt;
                } else if (evt.type === 'error') {
                    throw new Error(evt.message || _t('bkp_unknown_error'));
                }
            }
        }
        if (!done) throw new Error(_t('bkp_no_complete'));
        if (bar) bar.style.width = '100%';
        if (pctTxt) pctTxt.innerText = _t('bkp_finalizing');
        const typeLabel = { full: _t('bkp_type_full'), differential: _t('bkp_type_diff'), incremental: _t('bkp_type_incr') }[done.backup_type] || _t('bkp_type_full');
        const countTxt = done.count ? _t('bkp_count_files').replace('{0}', done.count) : '';
        if (done.cloud) {
            if (out) out.innerHTML = `<span style="color: #10b981; font-weight: 600;">${_t('bkp_saved_cloud').replace('{0}', typeLabel).replace('{1}', done.zip_name).replace('{2}', countTxt)}</span>`;
        } else if (done.zip_url) {
            const a = document.createElement('a');
            a.href = done.zip_url;
            a.download = done.zip_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            if (out) out.innerHTML = `<span style="color: #10b981; font-weight: 600;">${_t('bkp_created_download').replace('{0}', typeLabel).replace('{1}', done.zip_name).replace('{2}', countTxt)}</span>`;
        }
        if (wrap) wrap.style.display = 'none';
        _loadBkpMetaInfo();
    } catch (e) {
        if (out) out.innerHTML = `<span style="color: #f87171; font-weight: 600;">❌ ${e.message || _t('bkp_conn_error')}</span>`;
        if (wrap) wrap.style.display = 'none';
    }
    if (btn) btn.disabled = false;
}

export function bkpFrequencyChanged() {
    const daysRow = document.getElementById('bkp-auto-days');
    const freq = document.getElementById('bkp-auto-frequency');
    if (!daysRow || !freq) return;
    daysRow.style.display = freq.value === 'weekly' ? 'flex' : 'none';
}

export function toggleBkpDay(el) {
    if (el) el.classList.toggle('active');
}

export async function saveBkpAutomation() {
    const status = document.getElementById('bkp-automation-status');
    if (status) status.innerHTML = `<span style="color: var(--text-muted);">${_t('bkp_saving')}</span>`;
    try {
        const enabled = !!(document.getElementById('bkp-auto-enabled') || {}).checked;
        const frequency = (document.getElementById('bkp-auto-frequency') || {}).value || 'daily';
        const time = (document.getElementById('bkp-auto-time') || {}).value || '02:00';
        const copiesLimit = parseInt((document.getElementById('bkp-auto-limit') || {}).value || '5', 10) || 5;
        const days = Array.from(document.querySelectorAll('#bkp-auto-days .bkp-day-btn.active'))
            .map(b => parseInt(b.dataset.day, 10));
        const destModeInput = document.querySelector('input[name="bkp_dest_mode"]:checked');
        const destMode = destModeInput ? destModeInput.value : 'download';
        const cloudPath = (document.getElementById('bkp-cloud-path') || {}).value || '';
        const backupType = _getSelectedBackupType();
        const res = await fetch('/api/backup/automation?token=' + TOKEN, {
            method: 'POST',
            headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ enabled, frequency, days, time, copies_limit: copiesLimit, backup_type: backupType, dest_mode: destMode, cloud_path: cloudPath, source_paths: _bkpAutoSourcePaths, exclude_exts: _bkpAutoExcludeExts, exclude_paths: _bkpAutoExcludePaths })
        });
        const data = await res.json();
        if (data.ok) {
            _bkpAutoConfig = data.automation;
            _renderBkpTaskList();
            if (status) status.innerHTML = `<span style="color: #10b981; font-weight: 600;">${_t('bkp_saved')}</span>`;
        } else {
            if (status) status.innerHTML = `<span style="color: #f87171; font-weight: 600;">❌ ${data.error || _t('bkp_save_error')}</span>`;
        }
    } catch (e) {
        if (status) status.innerHTML = `<span style="color: #f87171; font-weight: 600;">❌ ${_t('bkp_conn_error')}</span>`;
    }
}

export function initBackups() {
    window.toggleBkpDestMode = toggleBkpDestMode;
    window.toggleBkpSourceMode = toggleBkpSourceMode;
    window.toggleBkpType = toggleBkpType;
    window.switchBkpMode = switchBkpMode;
    window.toggleBkpTaskActive = toggleBkpTaskActive;
    window.bkpCreateFolder = bkpCreateFolder;
    window.doBackup = doBackup;
    window.bkpFrequencyChanged = bkpFrequencyChanged;
    window.toggleBkpDay = toggleBkpDay;
    window.saveBkpAutomation = saveBkpAutomation;
    window.openBkpSourceModal = openBkpSourceModal;
    window.openBkpSourceModalIfEmpty = openBkpSourceModalIfEmpty;
    window.closeBkpSourceModal = closeBkpSourceModal;
    window.confirmBkpSource = confirmBkpSource;
    window.clearBkpSourceModalSelection = clearBkpSourceModalSelection;
    window.removeBkpSourcePathConfirm = removeBkpSourcePathConfirm;
    window.removeBkpSourcePath = removeBkpSourcePath;
    window.removeFromBkpInclusion = removeFromBkpInclusion;
    window.removeFromBkpExclusion = removeFromBkpExclusion;
    _updateBkpButtonLabel();
    toggleBkpSourceMode();
    toggleBkpType();
    bkpFrequencyChanged();
    _renderBkpTaskList();
    _renderBkpSourceList('manual');
    _selectBkpPath('');
    let savedMode = 'manual';
    try {
        savedMode = localStorage.getItem('nullvoid_backups_mode') || 'manual';
    } catch (e) { }
    switchBkpMode(savedMode === 'auto' ? 'auto' : 'manual');
}

window.addEventListener('languageChanged', () => {
    _updateBkpButtonLabel();
    _renderBkpTaskList();
    _selectBkpPath(_currentBkpPath);
    _renderBkpSourceList('auto');
    _renderBkpSourceList('manual');
    _renderBkpModalInclusionList();
    _renderBkpModalExclusionList();
});
