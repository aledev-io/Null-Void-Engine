export async function loadBackupConfig() {
}

let _bkpSelectedFiles = [];
let _bkpFolderTree = null;
let _currentBkpPath = '';

export function _addFiles(newFiles) {
    const existingNames = new Set(_bkpSelectedFiles.map(f => f.name));
    newFiles.forEach(f => {
        if (!existingNames.has(f.name)) {
            _bkpSelectedFiles.push(f);
            existingNames.add(f.name);
        }
    });
    _updateSourcePreview();
}

export function clearBkpFiles() {
    _bkpSelectedFiles = [];
    const preview = document.getElementById('bkp-source-preview');
    preview.innerHTML = `
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="11" x2="12" y2="17"></line>
            <line x1="9" y1="14" x2="15" y2="14"></line>
        </svg>
        <span style="font-size: 0.85rem; color: var(--text-muted); text-align: center; font-weight: 500;">Haz clic aquí para seleccionar archivos</span>
        <span style="font-size: 0.7rem; color: var(--text-muted); opacity: 0.6;">o arrastra archivos a esta zona</span>
    `;
    preview.style.borderColor = 'var(--border)';
    preview.style.background = 'transparent';
}

export function removeBkpFile(e, name) {
    if (e) e.stopPropagation();
    _bkpSelectedFiles = _bkpSelectedFiles.filter(f => f.name !== name);
    if (_bkpSelectedFiles.length === 0) {
        clearBkpFiles();
    } else {
        _updateSourcePreview();
    }
}

export function _updateSourcePreview() {
    const preview = document.getElementById('bkp-source-preview');
    if (_bkpSelectedFiles.length > 0) {
        const names = _bkpSelectedFiles.map(f => f.name);
        let html = `<div style="width: 100%; text-align: left; position: relative;">`;
        html += `<button class="btn-clear-bkp" onclick="clearBkpFiles()" style="position: absolute; right: 0; top: 0; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: #f87171; cursor: pointer; font-size: 0.7rem; font-weight: bold; padding: 4px 8px; border-radius: 6px; z-index: 10;">Quitar Todos</button>`;
        html += `<div style="font-size: 0.72rem; color: var(--indigo); font-weight: 700; margin-bottom: 8px;">${_bkpSelectedFiles.length} archivo${_bkpSelectedFiles.length > 1 ? 's' : ''} seleccionado${_bkpSelectedFiles.length > 1 ? 's' : ''} (clic para añadir más)</div>`;
        const shown = names.slice(0, 8);
        shown.forEach(name => {
            html += `<div style="font-size: 0.75rem; color: var(--text-main); padding: 4px 6px; display: flex; align-items: center; justify-content: space-between; border-radius: 6px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(248,113,113,0.1)'; this.querySelector('.remove-icon').style.display='block';" onmouseout="this.style.background='transparent'; this.querySelector('.remove-icon').style.display='none';" onclick="removeBkpFile(event, '${name.replace(/'/g, "\\'")}')" title="Clic para quitar">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    <span style="white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${name}</span>
                </div>
                <svg class="remove-icon" style="display: none; flex-shrink: 0;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </div>`;
        });
        if (names.length > 8) {
            html += `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; padding-left: 6px;">... y ${names.length - 8} más</div>`;
        }
        html += `</div>`;
        preview.innerHTML = html;
        preview.style.borderColor = 'var(--indigo)';
        preview.style.background = 'rgba(99, 102, 241, 0.04)';
    }
}

export function selectSourceFiles(e) {
    if (e && e.target && e.target.closest('.btn-clear-bkp')) {
        e.stopPropagation();
        return;
    }
    const fileInput = document.getElementById('bkp-source-file');
    if (fileInput) {
        fileInput.click();
    }
}

export async function toggleBkpDestMode() {
    const mode = document.querySelector('input[name="bkp_dest_mode"]:checked').value;
    const cloudDest = document.getElementById('bkp-cloud-dest');
    const lblDownload = document.getElementById('bkp-lbl-download');
    const lblCloud = document.getElementById('bkp-lbl-cloud');
    if (mode === 'cloud') {
        cloudDest.style.display = 'block';
        lblCloud.style.borderColor = 'var(--indigo)';
        lblCloud.style.background = 'rgba(99,102,241,0.05)';
        lblDownload.style.borderColor = 'var(--border)';
        lblDownload.style.background = 'var(--surface-hi)';
        await _loadCloudFoldersForBackup();
    } else {
        cloudDest.style.display = 'none';
        lblDownload.style.borderColor = 'var(--indigo)';
        lblDownload.style.background = 'rgba(99,102,241,0.05)';
        lblCloud.style.borderColor = 'var(--border)';
        lblCloud.style.background = 'var(--surface-hi)';
    }
}

export async function _loadCloudFoldersForBackup() {
    try {
        const res = await fetch('/api/cloud/folders?view=backups&token=' + TOKEN);
        const data = await res.json();
        if (data.tree) {
            _bkpFolderTree = data.tree;
            _bkpFolderTree._expanded = true;
            _currentBkpPath = '';
            const pathInput = document.getElementById('bkp-cloud-path');
            const display = document.getElementById('bkp-selected-path-display');
            if (pathInput) pathInput.value = '';
            if (display) display.innerText = '/ (Raíz de Backups)';
            _refreshBkpTreeUI();
        }
    } catch (e) {
        console.error("Error loading backup folders:", e);
    }
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
    const isExpanded = depth < 2;

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
    label.innerText = (node.path === '') ? 'Raíz de Backups' : node.name;
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
        if (!await NV_Confirm(`¿Seguro que deseas eliminar la carpeta "${node.name}" y todo su contenido?`)) return;
        const parts = node.path.split('/');
        const name = parts.pop();
        const parent = parts.join('/');
        try {
            const res = await fetch('/api/cloud/delete', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ name: name, path: parent, view: 'backups' })
            });
            const data = await res.json();
            if (data.ok) {
                if (_currentBkpPath === node.path || _currentBkpPath.startsWith(node.path + '/')) {
                    _currentBkpPath = '';
                    const pathInput = document.getElementById('bkp-cloud-path');
                    const display = document.getElementById('bkp-selected-path-display');
                    if (pathInput) pathInput.value = '';
                    if (display) display.innerText = '/ (Raíz de Backups)';
                }
                await _loadCloudFoldersForBackup();
            } else {
                await NV_Alert(data.error || 'Error al eliminar');
            }
        } catch (err) {
            await NV_Alert('Error de conexión al eliminar');
        }
    };

    folderRow.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.folder-tree-row-bkp').forEach(row => {
            row.style.background = 'transparent';
            row.style.border = '1px solid transparent';
        });
        folderRow.style.background = 'rgba(129, 140, 248, 0.2)';
        folderRow.style.border = '1px solid rgba(129, 140, 248, 0.4)';
        _currentBkpPath = node.path;
        const pathInput = document.getElementById('bkp-cloud-path');
        const display = document.getElementById('bkp-selected-path-display');
        if (pathInput) pathInput.value = _currentBkpPath;
        if (display) display.innerText = '/' + (_currentBkpPath || ' (Raíz de Backups)');
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
    const folderName = await NV_Prompt("Introduce el nombre de la nueva carpeta:", "", "Nueva Carpeta");
    if (!folderName || !folderName.trim()) return;
    const parts = _currentBkpPath ? _currentBkpPath.split('/') : [];
    function getNode(tree, pParts) {
        if (pParts.length === 0 || (pParts.length === 1 && pParts[0] === '')) return tree;
        let curr = tree;
        for (let p of pParts) {
            if (!curr.subdirs) return null;
            let found = curr.subdirs.find(s => s.name === p);
            if (!found) return null;
            curr = found;
        }
        return curr;
    }
    const node = getNode(_bkpFolderTree, parts);
    if (node) {
        if (!node.subdirs) node.subdirs = [];
        const safeName = folderName.trim().replace(/[<>:"/\\|?*]/g, '');
        if (!safeName) return;
        const newPath = _currentBkpPath ? `${_currentBkpPath}/${safeName}` : safeName;
        if (node.subdirs.find(s => s.name.toLowerCase() === safeName.toLowerCase())) {
            await NV_Alert("Ya existe una carpeta con ese nombre aquí.");
            return;
        }
        node.subdirs.push({
            name: safeName,
            path: newPath,
            subdirs: [],
            _expanded: true
        });
        node.subdirs.sort((a, b) => a.name.localeCompare(b.name));
        node._expanded = true;
        _currentBkpPath = newPath;
        const pathInput = document.getElementById('bkp-cloud-path');
        const display = document.getElementById('bkp-selected-path-display');
        if (pathInput) pathInput.value = _currentBkpPath;
        if (display) display.innerText = '/' + _currentBkpPath;
        _refreshBkpTreeUI();
    }
}

export async function doBackup() {
    const btn = document.getElementById('btn-backup');
    const out = document.getElementById('backup-result');
    if (!_bkpSelectedFiles.length) {
        await NV_Alert('Selecciona al menos un archivo para respaldar.', 'Faltan datos');
        return;
    }
    if (btn) btn.disabled = true;
    if (out) {
        out.innerHTML = '<span style="color: var(--text-muted); animation: pulse 2s infinite;">⏳ Comprimiendo archivos... esto puede tardar un poco.</span>';
    }
    try {
        const formData = new FormData();
        _bkpSelectedFiles.forEach(f => formData.append('files', f));
        const destMode = document.querySelector('input[name="bkp_dest_mode"]:checked').value;
        const cloudPath = document.getElementById('bkp-cloud-path').value;
        formData.append('dest_mode', destMode);
        formData.append('cloud_path', cloudPath);
        const res = await fetch('/api/backup?token=' + TOKEN, {
            method: 'POST',
            headers: { 'X-Token': TOKEN },
            body: formData
        });
        const data = await res.json();
        if (data.ok) {
            if (data.cloud) {
                if (out) out.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ Backup guardado en tu Nube: ${data.zip_name}</span>`;
            } else if (data.zip_url) {
                const a = document.createElement('a');
                a.href = data.zip_url;
                a.download = data.zip_name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                if (out) out.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ Backup creado: ${data.zip_name} — descargando...</span>`;
            }
            clearBkpFiles();
        } else {
            if (out) out.innerHTML = `<span style="color: #f87171; font-weight: 600;">❌ ${data.error || 'Error desconocido'}</span>`;
        }
    } catch (e) {
        if (out) out.innerHTML = '<span style="color: #f87171; font-weight: 600;">❌ Error de conexión con el servidor.</span>';
    }
    if (btn) btn.disabled = false;
}

export function initBackups() {
    window.selectSourceFiles = selectSourceFiles;
    window.clearBkpFiles = clearBkpFiles;
    window.removeBkpFile = removeBkpFile;
    window.toggleBkpDestMode = toggleBkpDestMode;
    window.bkpCreateFolder = bkpCreateFolder;
    window.doBackup = doBackup;
    const fileInput = document.getElementById('bkp-source-file');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                _addFiles(Array.from(e.target.files));
            }
        });
    }

    const dropzone = document.getElementById('bkp-source-preview');
    if (dropzone) {
        ['dragenter', 'dragover'].forEach(evt => {
            dropzone.addEventListener(evt, e => {
                e.preventDefault();
                dropzone.style.borderColor = 'var(--indigo)';
                dropzone.style.background = 'rgba(99, 102, 241, 0.08)';
            });
        });
        ['dragleave', 'drop'].forEach(evt => {
            dropzone.addEventListener(evt, e => {
                e.preventDefault();
                if (evt === 'dragleave' && !_bkpSelectedFiles.length) {
                    dropzone.style.borderColor = '';
                    dropzone.style.background = '';
                }
            });
        });
        dropzone.addEventListener('drop', e => {
            e.preventDefault();
            _addFiles(Array.from(e.dataTransfer.files));
        });
    }
}
