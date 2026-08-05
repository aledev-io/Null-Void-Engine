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
    if (manualCard) manualCard.classList.toggle('active', !isAuto);
    if (autoCard) autoCard.classList.toggle('active', isAuto);
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
let _bkpSourceModalRef = null;
let _bkpSourceModalChecked = new Set();
let _bkpSourceTypes = {};


function _getBkpSourcePaths(ref) {
    return ref === 'auto' ? _bkpAutoSourcePaths : _bkpManualSourcePaths;
}


export function openBkpSourceModal(ref) {
    _bkpSourceModalRef = ref;
    _bkpSourceModalChecked = new Set();
    const modal = document.getElementById('bkp-source-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    loadBkpSourceTree();
}

export function closeBkpSourceModal() {
    const modal = document.getElementById('bkp-source-modal');
    if (modal) modal.style.display = 'none';
    _bkpSourceModalRef = null;
    _bkpSourceModalChecked = new Set();
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
        lblAll.style.background = isAll ? 'rgba(99,102,241,0.12)' : 'var(--surface-hi)';
        lblAll.style.color = isAll ? 'var(--indigo)' : 'var(--text-secondary)';
    }
    if (lblCustom) {
        lblCustom.style.borderColor = isAll ? 'var(--border)' : 'var(--indigo)';
        lblCustom.style.background = isAll ? 'var(--surface-hi)' : 'rgba(99,102,241,0.12)';
        lblCustom.style.color = isAll ? 'var(--text-secondary)' : 'var(--indigo)';
    }
    if (allHint) allHint.style.display = isAll ? 'flex' : 'none';
    if (customBlock) customBlock.style.display = isAll ? 'none' : 'block';
}

async function loadBkpSourceTree() {
    const container = document.getElementById('bkp-source-tree-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; opacity: 0.5; padding: 20px;">Cargando directorios…</div>';
    try {
        const res = await fetch('/api/cloud/folders?view=drive', { headers: HEADERS });
        if (!res.ok) throw new Error('Error al cargar');
        const data = await res.json();
        if (!data.tree) throw new Error('Sin datos');
        container.innerHTML = '';
        _bkpSourceModalChecked = new Set(_getBkpSourcePaths(_bkpSourceModalRef));
        container.appendChild(_renderBkpModalNode(data.tree, 0));
        _updateBkpModalCount();
    } catch (e) {
        container.innerHTML = '<div style="text-align: center; color: #f87171; padding: 20px;">Error al cargar elementos</div>';
    }
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

function _renderBkpModalNode(node, depth) {
    depth = depth || 0;
    const li = document.createElement('div');
    li.style.display = 'flex';
    li.style.flexDirection = 'column';

    const existing = _getBkpSourcePaths(_bkpSourceModalRef);
    const nodeType = 'folder';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '6px 8px';
    row.style.borderRadius = '6px';
    row.style.cursor = 'pointer';
    row.style.transition = 'all 0.2s';
    row.style.userSelect = 'none';

    if (_bkpSourceModalChecked.has(node.path) || existing.includes(node.path)) {
        row.style.background = 'rgba(129, 140, 248, 0.18)';
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = _bkpSourceModalChecked.has(node.path) || existing.includes(node.path);
    cb.disabled = existing.includes(node.path);
    cb.style.flexShrink = '0';
    cb.style.cursor = 'pointer';
    cb.onclick = (e) => {
        e.stopPropagation();
        _toggleBkpModalCheck(node.path, nodeType, row);
    };

    const hasSubdirs = node.subdirs && node.subdirs.length > 0;
    const arrow = document.createElement('span');
    arrow.style.fontFamily = 'monospace';
    arrow.style.fontSize = '0.75rem';
    arrow.style.opacity = hasSubdirs ? '0.5' : '0.2';
    arrow.style.width = '14px';
    arrow.style.display = 'inline-block';
    arrow.style.flexShrink = '0';
    arrow.innerText = hasSubdirs ? '▶' : '•';

    const icon = document.createElement('span');
    if (node.path === '') {
        icon.appendChild(_bkpDriveIcon());
    } else {
        icon.innerText = '📁';
    }
    icon.style.fontSize = '1.05rem';
    icon.style.flexShrink = '0';
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';

    const label = document.createElement('span');
    label.innerText = (node.path === '') ? _t('my_drive') : node.name;
    label.style.fontWeight = '500';
    label.style.color = 'var(--text-main)';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';

    if (existing.includes(node.path)) {
        const tag = document.createElement('span');
        tag.innerText = '✓';
        tag.style.fontSize = '0.75rem';
        tag.style.color = '#10b981';
        tag.style.fontWeight = '700';
        tag.style.marginLeft = 'auto';
        tag.style.flexShrink = '0';
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
    childrenContainer.style.display = 'none';
    childrenContainer.style.flexDirection = 'column';
    childrenContainer.style.borderLeft = '1px dashed rgba(255,255,255,0.15)';
    childrenContainer.style.marginLeft = '16px';
    childrenContainer.style.paddingLeft = '4px';

    if (hasSubdirs) {
        node.subdirs.forEach(sub => {
            childrenContainer.appendChild(_renderBkpModalNode(sub, depth + 1));
        });
    }

    if (node.files && node.files.length) {
        node.files.forEach(file => {
            childrenContainer.appendChild(_renderBkpModalFileRow(file));
        });
    }

    li.appendChild(childrenContainer);

    if (hasSubdirs) {
        arrow.onclick = (e) => {
            e.stopPropagation();
            _toggleBkpNodeExpand(childrenContainer, arrow);
        };
    }

    row.onclick = (e) => {
        if (row.contains(e.target) && e.target === cb) return;
        if (!hasSubdirs) return;
        _toggleBkpNodeExpand(childrenContainer, arrow);
    };

    return li;
}

function _renderBkpModalFileRow(file) {
    const existing = _getBkpSourcePaths(_bkpSourceModalRef);
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '5px 8px';
    row.style.borderRadius = '6px';
    row.style.cursor = 'pointer';
    row.style.transition = 'all 0.2s';
    row.style.userSelect = 'none';

    if (_bkpSourceModalChecked.has(file.path) || existing.includes(file.path)) {
        row.style.background = 'rgba(129, 140, 248, 0.18)';
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = _bkpSourceModalChecked.has(file.path) || existing.includes(file.path);
    cb.disabled = existing.includes(file.path);
    cb.style.flexShrink = '0';
    cb.style.cursor = 'pointer';

    const bullet = document.createElement('span');
    bullet.innerText = '•';
    bullet.style.fontFamily = 'monospace';
    bullet.style.fontSize = '0.75rem';
    bullet.style.opacity = '0.2';
    bullet.style.width = '14px';
    bullet.style.display = 'inline-block';
    bullet.style.flexShrink = '0';

    const icon = document.createElement('span');
    icon.innerText = _bkpFileIcon(file.ext);
    icon.style.fontSize = '0.95rem';
    icon.style.flexShrink = '0';

    const label = document.createElement('span');
    label.innerText = file.name;
    label.style.fontSize = '0.86rem';
    label.style.color = 'var(--text-secondary)';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';

    row.appendChild(cb);
    row.appendChild(bullet);
    row.appendChild(icon);
    row.appendChild(label);

    if (existing.includes(file.path)) {
        const tag = document.createElement('span');
        tag.innerText = '✓';
        tag.style.fontSize = '0.75rem';
        tag.style.color = '#10b981';
        tag.style.fontWeight = '700';
        tag.style.marginLeft = 'auto';
        tag.style.flexShrink = '0';
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
        _toggleBkpModalCheck(file.path, 'file', row);
    };
    row.onclick = (e) => {
        if (e.target === cb) return;
        _toggleBkpModalCheck(file.path, 'file', row);
    };

    return row;
}

function _toggleBkpNodeExpand(childrenContainer, arrow) {
    const isHidden = childrenContainer.style.display === 'none';
    childrenContainer.style.display = isHidden ? 'flex' : 'none';
    arrow.innerText = isHidden ? '▼' : '▶';
}

function _toggleBkpModalCheck(path, type, row) {
    if (_bkpSourceModalChecked.has(path)) {
        _bkpSourceModalChecked.delete(path);
        row.style.background = 'transparent';
    } else {
        _bkpSourceModalChecked.add(path);
        _bkpSourceTypes[path] = type;
        row.style.background = 'rgba(129, 140, 248, 0.18)';
    }
    _updateBkpModalCount();
}

function _updateBkpModalCount() {
    const el = document.getElementById('bkp-source-selected-count');
    if (el) el.innerText = String(_bkpSourceModalChecked.size);
}

export function clearBkpSourceModalSelection() {
    _bkpSourceModalChecked = new Set();
    const container = document.getElementById('bkp-source-tree-container');
    const ref = _bkpSourceModalRef;
    if (container && ref) {
        fetch('/api/cloud/folders?view=drive', { headers: HEADERS })
            .then(r => r.json())
            .then(data => {
                if (data.tree) {
                    container.innerHTML = '';
                    container.appendChild(_renderBkpModalNode(data.tree, 0));
                    _updateBkpModalCount();
                }
            })
            .catch(() => { });
    }
}

export async function confirmBkpSource() {
    if (!_bkpSourceModalRef) return;
    const ref = _bkpSourceModalRef;
    const checked = Array.from(_bkpSourceModalChecked);
    if (checked.length === 0) {
        await NV_Alert(_t('bkp_src_modal_empty'));
        return;
    }
    const paths = _getBkpSourcePaths(ref);
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

function _bkpSourceIcon(path) {
    if (_bkpSourceTypes[path] === 'folder') return '📁';
    const last = (path || '').split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot > 0 && dot < last.length - 1) return _bkpFileIcon(last.slice(dot));
    return '📄';
}

function _bkpFileIcon(ext) {
    const map = {
        '.pdf': '📕', '.doc': '📘', '.docx': '📘', '.xls': '📗', '.xlsx': '📗',
        '.ppt': '📙', '.pptx': '📙', '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️',
        '.gif': '🖼️', '.svg': '🖼️', '.webp': '🖼️', '.mp3': '🎵', '.wav': '🎵',
        '.mp4': '🎬', '.mkv': '🎬', '.zip': '🗜️', '.rar': '🗜️', '.tar': '🗜️',
        '.gz': '🗜️', '.txt': '📄', '.md': '📄', '.json': '📄', '.csv': '📄',
        '.py': '🐍', '.js': '📜', '.html': '🌐', '.css': '🎨', '.cpp': '⚙️',
        '.exe': '💿', '.iso': '💿', '.db': '🗄️', '.sql': '🗄️',
    };
    return map[(ext || '').toLowerCase()] || '📄';
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
        html += `<div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: var(--surface-hi); border: 1px solid var(--border); border-radius: 8px; font-size: 0.82rem; box-sizing: border-box; width: 100%;">
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
    listEl.innerHTML = html;
}

export function _updateBkpButtonLabel() {
    const label = document.getElementById('btn-backup-label');
    if (!label) return;
    const mode = document.querySelector('input[name="bkp_dest_mode"]:checked');
    label.innerText = mode && mode.value === 'cloud' ? _t('bkp_btn_create_cloud') : _t('bkp_btn_create_download');
}

export async function toggleBkpDestMode() {
    const mode = document.querySelector('input[name="bkp_dest_mode"]:checked').value;
    const cloudDest = document.getElementById('bkp-cloud-dest');
    const cloudAutoHint = document.getElementById('bkp-cloud-auto-dest-hint');
    const lblDownload = document.getElementById('bkp-lbl-download');
    const lblCloud = document.getElementById('bkp-lbl-cloud');
    if (mode === 'cloud') {
        if (cloudDest) cloudDest.style.display = 'none';
        if (cloudAutoHint) cloudAutoHint.style.display = 'block';
        lblCloud.style.borderColor = 'var(--indigo)';
        lblCloud.style.background = 'rgba(99,102,241,0.05)';
        lblDownload.style.borderColor = 'var(--border)';
        lblDownload.style.background = 'var(--surface-hi)';
    } else {
        if (cloudDest) cloudDest.style.display = 'none';
        if (cloudAutoHint) cloudAutoHint.style.display = 'none';
        lblDownload.style.borderColor = 'var(--indigo)';
        lblDownload.style.background = 'rgba(99,102,241,0.05)';
        lblCloud.style.borderColor = 'var(--border)';
        lblCloud.style.background = 'var(--surface-hi)';
    }
    _updateBkpButtonLabel();
}

export async function _loadCloudFoldersForBackup() {
    try {
        const res = await fetch('/api/cloud/folders?view=drive&token=' + TOKEN);
        const data = await res.json();
        if (data.tree) {
            _bkpFolderTree = data.tree;
            _bkpFolderTree._expanded = true;
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
    li.style.paddingLeft = '12px';
    li.style.position = 'relative';

    const folderRow = document.createElement('div');
    folderRow.className = 'folder-tree-row-bkp';
    folderRow.style.display = 'flex';
    folderRow.style.alignItems = 'center';
    folderRow.style.gap = '6px';
    folderRow.style.padding = '6px 8px';
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

    const hasSubdirs = node.subdirs && node.subdirs.length > 0;
    const selectedPath = _currentBkpPath || '';
    const isAncestor = selectedPath.startsWith((node.path ? node.path + '/' : ''));
    const isExpanded = depth < 2 || node._expanded === true || (selectedPath && (isAncestor || node.path === selectedPath));

    if (hasSubdirs) {
        arrow.innerText = isExpanded ? '▼' : '▶';
        arrow.style.cursor = 'pointer';
    } else {
        arrow.innerText = '•';
        arrow.style.opacity = '0.2';
    }

    const icon = document.createElement('span');
    icon.innerText = '📁';
    icon.style.fontSize = '1.05rem';

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
    childrenContainer.style.marginLeft = '16px';
    childrenContainer.style.paddingLeft = '4px';

    if (hasSubdirs) {
        node.subdirs.forEach(sub => {
            childrenContainer.appendChild(_renderBkpTree(sub, depth + 1));
        });
    }

    li.appendChild(childrenContainer);

    arrow.onclick = (e) => {
        if (!hasSubdirs) return;
        e.stopPropagation();
        if (childrenContainer.style.display === 'none') {
            childrenContainer.style.display = 'flex';
            arrow.innerText = '▼';
        } else {
            childrenContainer.style.display = 'none';
            arrow.innerText = '▶';
        }
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
                backup_type: 'full'
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
            body: JSON.stringify({ enabled, frequency, days, time, copies_limit: copiesLimit, backup_type: backupType, dest_mode: destMode, cloud_path: cloudPath, source_paths: _bkpAutoSourcePaths })
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
    window.closeBkpSourceModal = closeBkpSourceModal;
    window.confirmBkpSource = confirmBkpSource;
    window.clearBkpSourceModalSelection = clearBkpSourceModalSelection;
    window.removeBkpSourcePathConfirm = removeBkpSourcePathConfirm;
    window.removeBkpSourcePath = removeBkpSourcePath;
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
});
