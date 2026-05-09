/* Cloud Module Logic */

let currentCloudPath = '';
let currentCloudView = 'home';
let currentCloudContextItem = null;
let currentCloudInfoItem = null;
let CLOUD_FILES = [];

async function fetchCloudFiles(path = '', view = 'home') {
    if (path === undefined) path = '';
    currentCloudPath = path;
    currentCloudView = view;

    const list = document.getElementById('cloud-file-list');

    try {
        let endpoint = `/api/cloud/files?view=${view}&path=${encodeURIComponent(path)}`;
        if (view === 'home') endpoint = '/api/cloud/recent';
        if (view === 'starred') endpoint = '/api/cloud/list_starred';

        const res = await fetch(endpoint, {
            headers: HEADERS,
            credentials: 'include'
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[Cloud] Error ${res.status}:`, errText);
            if (list) list.innerHTML = `<div style="padding:20px;color:#f87171;">Error ${res.status}: ${errText}</div>`;
            return;
        }

        const data = await res.json();
        CLOUD_FILES = data.files || [];
        
        renderCloudBreadcrumbs(path, view === 'home' ? 'Recientes' : (view === 'starred' ? 'Destacados' : null));
        
        const query = document.getElementById('cloud-search')?.value.toLowerCase() || '';
        if (query) {
            filterCloudFiles();
        } else {
            renderCloudFiles(CLOUD_FILES, view === 'home');
        }
        
        updateCloudQuotaInfo();

    } catch (err) {
        console.error("[Cloud] Error de carga:", err);
        if (list) list.innerHTML = `<div style="padding:20px;color:#f87171;">Error: ${err.message}</div>`;
    }
}

function filterCloudFiles() {
    const query = document.getElementById('cloud-search')?.value.toLowerCase() || '';
    const filtered = CLOUD_FILES.filter(f => 
        f.name.toLowerCase().includes(query)
    );
    renderCloudFiles(filtered, currentCloudView === 'home');
}

function renderCloudBreadcrumbs(path, customTitle = null) {
    const container = document.getElementById('cloud-breadcrumbs');
    if (!container) return;

    if (customTitle) {
        container.innerHTML = `<span class="breadcrumb-item active">${customTitle}</span>`;
        return;
    }

    const parts = path.split('/').filter(p => p);

    let rootName = 'Mi unidad';
    let rootAction = "fetchCloudFiles('', 'drive')";

    if (currentCloudView === 'computers') {
        rootName = 'Computadoras';
        rootAction = "fetchCloudFiles('', 'computers')";
    } else if (currentCloudView === 'trash') {
        rootName = 'Papelera';
        rootAction = "fetchCloudFiles('', 'trash')";
    }

    let html = `<span class="breadcrumb-item ${!path ? 'active' : ''}" onclick="${rootAction}">${rootName}</span>`;

    let currentAccumulated = '';
    parts.forEach((p, i) => {
        currentAccumulated += (i === 0 ? '' : '/') + p;
        html += `<span style="margin: 0 8px; opacity: 0.5;">›</span>`;
        html += `<span class="breadcrumb-item ${i === parts.length - 1 ? 'active' : ''}" onclick="navigateCloud('${currentAccumulated}')">${p}</span>`;
    });

    container.innerHTML = html;
}

function renderCloudFiles(files, isRecent = false) {
    const list = document.getElementById('cloud-file-list');
    const header = document.querySelector('.cloud-table-header');
    if (!list) return;

    if (header) {
        header.style.display = isRecent ? 'none' : 'grid';
    }

    if (!files || files.length === 0) {
        list.innerHTML = `<div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.3; margin-top: 50px;">
        <div style="font-size: 4rem; margin-bottom: 10px;">📂</div>
        <p>${isRecent ? 'No hay actividad reciente' : 'Esta carpeta está vacía'}</p>
    </div>`;
        return;
    }

    let html = '';

    if (isRecent) {
        const suggested = files.slice(0, 4);
        html += `
    <div style="padding: 20px 24px 10px 24px;">
        <h3 style="font-size: 1rem; font-weight: 500; margin-bottom: 15px; opacity: 0.8;">Sugeridos</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 24px; margin-bottom: 40px;">
            ${suggested.map(f => {
            const isImg = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(f.ext);
            const isVid = ['.mp4', '.webm', '.mov'].includes(f.ext);
            const isPdf = f.ext === '.pdf';

            let previewContent = `<span style="font-size: 2.5rem;">${getFileIcon(f.ext)}</span>`;

            if (isImg) {
                previewContent = `<img src="/api/cloud/preview?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}&view=${f.view || currentCloudView}" class="card-preview-img">`;
            } else if (isVid) {
                previewContent = `
                        <div style="width:100%; height:100%; background:#000; display:flex; align-items:center; justify-content:center;">
                            <span style="font-size: 2.5rem; opacity:0.3;">🎬</span>
                            <div class="video-overlay">▶</div>
                        </div>`;
            } else if (isPdf) {
                previewContent = `<img src="/api/cloud/preview?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}&view=${f.view || currentCloudView}" class="card-preview-img">`;
            }

            return `
                    <div class="cloud-suggested-card" 
                         data-name="${f.name}" data-path="${f.path}" data-is-dir="false" data-starred="${f.starred}"
                         onclick="downloadCloudFile(\`${f.name.replace(/'/g, "\\'")}\`, \`${f.path.replace(/'/g, "\\'")}\`)">
                        <div class="card-preview">
                            ${previewContent}
                        </div>
                        <div class="card-info">
                            <span class="card-name">${f.name}</span>
                            <span class="card-meta">${f.action_type || 'Visto'} · ${timeAgo(f.action_time || f.mtime)}</span>
                        </div>
                    </div>
                `;
        }).join('')}
        </div>
        <h3 style="font-size: 1rem; font-weight: 500; margin-bottom: 15px; opacity: 0.8;">Actividad reciente</h3>
        <div class="cloud-table-header" style="display: grid; grid-template-columns: 2fr 1fr 1.2fr 1fr 40px; padding: 12px 24px; border-bottom: 1px solid var(--border); font-size: 0.75rem; font-weight: 700; color: var(--text-muted); background: transparent; position: static;">
            <span>Nombre</span>
            <span>Propietario</span>
            <span>Fecha de modificación</span>
            <span>Tamaño del archivo</span>
            <span></span>
        </div>
    </div>`;
    }

    html += files.map(f => {
        const fpath = isRecent ? f.path : currentCloudPath;
        const fullPath = [fpath, f.name].filter(Boolean).join('/');

        const clickAction = f.is_dir
            ? `navigateCloud(\`${fullPath.replace(/'/g, "\\'")}\`)`
            : `downloadCloudFile(\`${f.name.replace(/'/g, "\\'")}\`, \`${fpath.replace(/'/g, "\\'")}\`)`;

        const ownerDisplay = (f.owner === CURRENT_USER || f.owner === 'Yo') ? 'Yo' : f.owner;

        return `
    <div class="cloud-file-row" 
         data-name="${f.name}" data-path="${fpath}" data-is-dir="${f.is_dir}" data-starred="${f.starred}" data-protected="${f.protected === true}"
         data-trash-id="${f.id || ''}"
         onclick="${f.trash ? '' : clickAction}">
        <div class="cloud-file-name">
            <span style="font-size: 1.2rem;">${f.is_dir ? '📁' : getFileIcon(f.ext)}</span>
            <div style="display: flex; flex-direction: column; overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${f.name}</span>
                    ${f.starred ? '<span style="color: #fbbf24; font-size: 0.8rem;">★</span>' : ''}
                    ${f.protected ? '<span style="font-size: 0.8rem; opacity: 0.6; cursor: help;" title="Este elemento está protegido contra eliminación">🔒</span>' : ''}
                </div>
                ${isRecent && f.path ? `<span style="font-size: 0.65rem; opacity: 0.5;">en ${f.path}</span>` : ''}
            </div>
        </div>
        <div class="cloud-file-owner" style="flex: 1; font-size: 0.9rem; opacity: 1; color: var(--text-dim);">
            ${ownerDisplay || 'Yo'}
        </div>
        <div class="cloud-file-date" style="flex: 1; font-size: 0.9rem; opacity: 1; color: var(--text-dim);">
            ${new Date(f.mtime * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        <div class="cloud-file-size" style="flex: 1; font-size: 0.9rem; opacity: 1; color: var(--text-dim);">
            ${f.is_dir ? '--' : formatBytes(f.size)}
        </div>
        <div class="cloud-file-actions" style="width: 40px; display: flex; justify-content: flex-end;">
             <button onclick="handleCloudAction(event, '${f.name}', ${f.is_dir}, '${fpath}')" style="background: none; border: none; color: inherit; cursor: pointer; padding: 5px; opacity: 0.5;">⋮</button>
        </div>
    </div>`;
    }).join('');

    list.innerHTML = html;
}

function navigateCloud(path) {
    fetchCloudFiles(path, currentCloudView);
}

function handleCloudNavClick(el, section) {
    document.querySelectorAll('#cloud-sidebar-nav .cloud-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    el.classList.add('active');

    if (section === 'home') {
        fetchCloudFiles('', 'home');
    } else if (section === 'drive') {
        fetchCloudFiles('', 'drive');
    } else if (section === 'computers') {
        fetchCloudFiles('', 'computers');
    } else if (section === 'starred') {
        fetchCloudFiles('', 'starred');
    } else if (section === 'trash') {
        fetchCloudFiles('', 'trash');
    } else {
        renderCloudFiles([]);
    }
}

function showCloudNewMenu(e) {
    if (currentCloudView !== 'drive' && currentCloudView !== 'computers') {
        fetchCloudFiles('', 'drive');
        document.querySelectorAll('.cloud-nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.innerText.includes('Mi unidad')) item.classList.add('active');
        });
    }

    e.stopPropagation();
    const menu = document.getElementById('cloud-new-menu');
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();

    menu.style.display = 'block';
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 8) + 'px';

    const closeMenu = () => {
        menu.style.display = 'none';
        window.removeEventListener('click', closeMenu);
    };
    setTimeout(() => window.addEventListener('click', closeMenu), 10);
}

async function updateCloudQuotaInfo() {
    const bar = document.getElementById('cloud-quota-bar');
    const text = document.getElementById('cloud-quota-text');

    try {
        const token = getCookie('token') || '';
        const res = await fetch('/api/cloud/quota', {
            method: 'GET',
            headers: { 'X-Token': token, 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (!res.ok) throw new Error("Status: " + res.status);
        const data = await res.json();

        const usedBytes = data.used_bytes || 0;
        const limitGb = data.limit_gb || 5;
        const freeDisk = data.disk_free || 0;

        const limitBytes = limitGb * 1024 * 1024 * 1024;
        const percent = (usedBytes / limitBytes) * 100;

        if (bar) {
            bar.style.width = Math.min(percent, 100) + '%';
            bar.style.background = percent > 90 ? '#ea4335' : '#4285f4';
        }

        if (text) {
            text.innerHTML = `
            <div class="quota-text-main" style="font-size: 0.85rem;">
                ${formatBytes(usedBytes)} de ${limitGb} GB utilizados
            </div>
            <div class="quota-text-disk" style="font-size: 0.75rem; margin-top: 6px;">
                Disco: ${formatBytes(freeDisk)} disponibles
            </div>
        `;
        }

        const input = document.getElementById('cloud-quota-input');
        if (input) input.value = limitGb;
    } catch (err) {
        console.error("Error cuota cloud:", err);
        if (text) text.innerHTML = '<span style="color:#f87171">Error de conexión</span>';
    }
}

async function updateCloudQuota() {
    const limit = document.getElementById('cloud-quota-input').value;
    try {
        await fetch('/api/cloud/quota', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ limit_gb: limit })
        });
        updateCloudQuotaInfo();
    } catch (err) { }
}

async function handleCloudUpload(e, isFolder = false) {
    const input = e.target;
    if (!input.files || input.files.length === 0) return;

    const files = Array.from(input.files);
    console.log(`[Cloud] Iniciando subida de ${files.length} elementos...`);

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        let uploadPath = currentCloudPath;
        if (isFolder && file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            parts.pop(); 
            if (parts.length > 0) {
                uploadPath = [currentCloudPath, ...parts].filter(Boolean).join('/');
            }
        }

        formData.append('path', uploadPath);
        formData.append('view', currentCloudView);

        try {
            await fetch(`/api/cloud/upload?token=${TOKEN}`, {
                method: 'POST',
                body: formData,
                headers: { 'X-Token': HEADERS['X-Token'] }
            });
        } catch (err) {
            console.error("[Cloud] Error al subir:", file.name, err);
        }
    }
    
    // Una sola recarga al final de todos los archivos
    fetchCloudFiles(currentCloudPath, currentCloudView);
    updateCloudQuotaInfo();
    input.value = '';
}

async function deleteCloudItem(name, path, isDir, trashId = null) {
    if (!name && !trashId) return;
    
    const isPermanent = currentCloudView === 'trash';
    const msg = isPermanent 
        ? `¿Eliminar PERMANENTEMENTE "${name || 'este elemento'}"?` 
        : `¿Mover a la papelera ${isDir ? 'la carpeta' : 'el archivo'} "${name}"?`;
    
    if (!await NV_Confirm(msg)) return;
    
    try {
        const res = await fetch('/api/cloud/delete', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: currentCloudView, id: trashId })
        });
        
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        } else {
            const data = await res.json();
            await NV_Alert(data.error || "Error al procesar la eliminación.");
        }
    } catch (err) {
        await NV_Alert("Error de conexión al intentar eliminar.");
    }
}

async function renameCloudItem(oldName, path) {
    const newName = await NV_Prompt(`Cambiar nombre de "${oldName}" a:`, oldName);
    if (!newName || newName === oldName) return;
    try {
        const res = await fetch('/api/cloud/rename', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ old_name: oldName, new_name: newName, path: path, view: currentCloudView })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        } else {
            const data = await res.json();
            await NV_Alert(data.error || "Error al renombrar.");
        }
    } catch (err) {
        await NV_Alert("Error al intentar renombrar el elemento.");
    }
}

async function restoreCloudItem(trashId) {
    try {
        const res = await fetch('/api/cloud/restore', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ id: trashId })
        });
        if (res.ok) {
            fetchCloudFiles('', 'trash');
            closeCloudInfoPanel();
        } else {
            const data = await res.json();
            await NV_Alert(data.error || "Error al restaurar.");
        }
    } catch (err) { }
}

async function emptyCloudTrash() {
    if (!await NV_Confirm("¿Seguro que quieres vaciar la papelera? Esta acción no se puede deshacer.")) return;
    try {
        const res = await fetch('/api/cloud/empty_trash', {
            method: 'POST',
            headers: HEADERS
        });
        if (res.ok) {
            fetchCloudFiles('', 'trash');
        }
    } catch (err) { }
}

async function toggleCloudProtect(name, path) {
    try {
        const res = await fetch('/api/cloud/toggle_protect', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: currentCloudView })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        }
    } catch (err) {
        await NV_Alert("Error al cambiar estado de protección.");
    }
}

async function toggleCloudStar(name, path) {
    try {
        const res = await fetch('/api/cloud/toggle_star', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: currentCloudView })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        }
    } catch (err) {
        await NV_Alert("Error al cambiar estado de destacado.");
    }
}

async function handleCreateFolder() {
    const name = await NV_Prompt("Nombre de la nueva carpeta:");
    if (!name) return;
    try {
        const res = await fetch('/api/cloud/mkdir', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path: currentCloudPath, view: currentCloudView })
        });
        const data = await res.json();
        if (data.error) {
            await NV_Alert("Error: " + data.error);
            return;
        }

        // Si estamos en 'home', cambiar a 'drive' para ver la carpeta o refrescar
        if (currentCloudView === 'home') {
            fetchCloudFiles('', 'drive');
        } else {
            fetchCloudFiles(currentCloudPath, currentCloudView);
        }
        closeCloudInfoPanel();
    } catch (err) {
        await NV_Alert("Error de conexión al crear carpeta.");
    }
}

async function downloadCloudFile(name, overridePath = null, forceDownload = false) {
    try {
        const path = overridePath !== null ? overridePath : currentCloudPath;
        const res = await fetch('/api/cloud/get_token', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: currentCloudView })
        });
        const data = await res.json();

        if (!data.t) {
            await NV_Alert("Error al generar token de acceso.");
            return;
        }

        const url = `/api/cloud/download?t=${data.t}`;
        const ext = name.split('.').pop().toLowerCase();
        const previewExts = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'txt', 'mp4', 'webm', 'mov'];

        if (!forceDownload && previewExts.includes(ext)) {
            openCloudPreview(name, url, path);
        } else {
            const link = document.createElement('a');
            link.href = url + (forceDownload ? '&dl=1' : '');
            link.download = name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    } catch (err) {
        alert("Error de seguridad al acceder al archivo.");
    }
}

function openCloudPreview(name, url, path) {
    const modal = document.getElementById('cloud-preview-modal');
    const body = document.getElementById('preview-body');
    const nameEl = document.getElementById('preview-filename');
    const dlBtn = document.getElementById('preview-download-btn');
    const ext = name.split('.').pop().toLowerCase();

    nameEl.innerText = name;
    dlBtn.onclick = () => downloadCloudFile(name, path, true);

    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        body.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 75vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">`;
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
        body.innerHTML = `
        <video controls autoplay style="max-width: 100%; max-height: 75vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <source src="${url}" type="video/${ext === 'mov' ? 'quicktime' : ext.replace('.', '')}">
            Tu navegador no soporta la reproducción de video.
        </video>`;
    } else if (ext === 'pdf') {
        body.innerHTML = `<iframe src="${url}" style="width: 80vw; height: 75vh; border: none; border-radius: 8px;"></iframe>`;
    } else {
        body.innerHTML = `<iframe src="${url}" style="width: 80vw; height: 75vh; border: none; background: #fff; border-radius: 8px;"></iframe>`;
    }

    modal.style.display = 'flex';
}

function closeCloudPreview() {
    document.getElementById('cloud-preview-modal').style.display = 'none';
    document.getElementById('preview-body').innerHTML = '';
}

function handleCloudAction(e, name, isDir, overridePath = null) {
    e.stopPropagation();
    e.preventDefault();
    
    currentCloudContextItem = {
        name: name,
        isDir: isDir,
        path: overridePath !== null ? overridePath : currentCloudPath
    };
    
    const menu = document.getElementById('cloud-context-menu');
    const itemActions = document.getElementById('ctx-item-actions');
    const creationActions = document.getElementById('ctx-creation-actions');
    
    itemActions.style.display = 'block';
    creationActions.style.display = 'none';

    menu.style.display = 'block';
    let x = e.clientX;
    let y = e.clientY;
    if (x + 220 > window.innerWidth) x -= 220;
    if (y + 350 > window.innerHeight) y -= 350;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function closeCloudInfoPanel() {
    const panel = document.getElementById('cloud-info-panel');
    if (panel) panel.style.display = 'none';
    currentCloudInfoItem = null;
}

async function toggleCloudInfoPanel() {
    const panel = document.getElementById('cloud-info-panel');
    if (!panel) return;
    if (panel.style.display === 'flex') {
        closeCloudInfoPanel();
    } else {
        panel.style.display = 'flex';
    }
}

function switchCloudInfoTab(btn, tab) {
    document.querySelectorAll('.info-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    
    if (!currentCloudInfoItem) return;
    
    if (tab === 'details') {
        showCloudDetails(currentCloudInfoItem.name, currentCloudInfoItem.path, currentCloudInfoItem.data);
    } else {
        showCloudActivity(currentCloudInfoItem.name, currentCloudInfoItem.path);
    }
}

async function showCloudInfo(name, path, trashId = null) {
    const panel = document.getElementById('cloud-info-panel');
    const body = document.getElementById('info-panel-body');
    const title = document.getElementById('info-title');
    
    panel.style.display = 'flex';
    body.innerHTML = `<div style="display:flex; justify-content:center; padding:20px;"><div class="loading-spinner"></div></div>`;
    const displayTitle = name.length > 25 ? name.substring(0, 22) + '...' : name;
    title.innerText = displayTitle;

    document.querySelectorAll('.info-tab').forEach(t => t.classList.remove('active'));
    const firstTab = document.querySelector('.info-tab');
    if (firstTab) firstTab.classList.add('active');

    const activityTab = document.querySelector('.info-tab:nth-child(2)');
    if (currentCloudView === 'trash') {
        if (activityTab) activityTab.style.display = 'none';
    } else {
        if (activityTab) activityTab.style.display = 'block';
    }

    try {
        const res = await fetch('/api/cloud/info', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: currentCloudView, id: trashId })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        currentCloudInfoItem = { name, path, data, id: trashId };
        showCloudDetails(name, path, data);
    } catch (err) {
        body.innerHTML = `<div style="padding:20px; color:#f87171;">${err.message}</div>`;
    }
}

function showCloudDetails(name, path, data) {
    const body = document.getElementById('info-panel-body');
    const icon = document.getElementById('info-icon');
    const ext = name.split('.').pop().toLowerCase();
    const owner = data.owner || 'Usuario';
    icon.innerText = data.is_dir ? '📁' : getFileIcon('.' + ext);

    const isTrash = currentCloudView === 'trash';
    let previewHtml = `<span style="font-size: 4rem; opacity: 0.2;">${data.is_dir ? '📁' : getFileIcon('.' + ext)}</span>`;
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'].includes(ext)) {
        const trashId = currentCloudInfoItem ? currentCloudInfoItem.id : null;
        const idParam = (isTrash && trashId) ? `&id=${trashId}` : '';
        previewHtml = `<img src="/api/cloud/preview?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}&view=${currentCloudView}${idParam}" style="max-width:100%; max-height:100%; object-fit:cover;">`;
    }

    body.innerHTML = `
        <div class="info-file-preview">
            ${previewHtml}
        </div>

        <div style="padding: 0 4px;">
            <div class="info-section-title">Quién tiene acceso</div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 36px; height: 36px; border-radius: 50%; background: #4285f4; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; font-weight: 700; box-shadow: 0 4px 10px rgba(66, 133, 244, 0.3);">
                    ${owner.charAt(0).toUpperCase()}
                </div>
                <div>
                    <div style="font-size: 0.9rem; font-weight: 600; color: #ffffff;">${owner}</div>
                    <div style="font-size: 0.75rem; color: var(--text-dim); opacity: 0.9;">Propietario</div>
                </div>
            </div>
        </div>

        <div style="margin-top: 24px; padding: 0 4px;">
            <div class="info-section-title">Detalles del archivo</div>
            <div class="info-detail-row">
                <div class="info-detail-label">Tipo</div>
                <div class="info-detail-value">${data.is_dir ? 'Carpeta' : 'Archivo ' + ext.toUpperCase()}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">Tamaño</div>
                <div class="info-detail-value">${formatBytes(data.size)}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">Ubicación</div>
                <div class="info-detail-value">${path || 'Mi unidad'}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">Modificado</div>
                <div class="info-detail-value">${new Date(data.mtime * 1000).toLocaleString()}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">Creado</div>
                <div class="info-detail-value">${new Date(data.ctime * 1000).toLocaleString()}</div>
            </div>
        </div>
    `;
}

async function showCloudActivity(name, path) {
    const body = document.getElementById('info-panel-body');
    body.innerHTML = `<div style="display:flex; justify-content:center; padding:20px;"><div class="loading-spinner"></div></div>`;

    try {
        const res = await fetch('/api/cloud/item_activity', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path })
        });
        const data = await res.json();
        
        if (!data.activity || data.activity.length === 0) {
            body.innerHTML = `<div style="text-align:center; padding:40px; opacity:0.5;">No hay actividad reciente.</div>`;
            return;
        }

        let html = `<div style="padding: 10px 4px;">`;
        data.activity.forEach(act => {
            const date = new Date(act.time * 1000);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString([], { day: '2-digit', month: 'short' });

            html += `
                <div style="display: flex; gap: 15px; margin-bottom: 24px; position: relative;">
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--indigo-dim); color: var(--indigo); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; z-index: 1;">
                            ${act.action.charAt(0)}
                        </div>
                        <div style="width: 1px; flex: 1; background: var(--border); margin: 4px 0;"></div>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: #ffffff;">${act.action}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${act.user} • ${dateStr}, ${timeStr}</div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        body.innerHTML = html;

    } catch (err) {
        body.innerHTML = `<div style="padding:20px; color:#f87171;">Error al cargar actividad.</div>`;
    }
}

// Initializing Context Menu for Cloud
document.addEventListener('contextmenu', function (e) {
    const menu = document.getElementById('cloud-context-menu');
    const viewCloud = document.getElementById('view-cloud');
    const explorer = document.getElementById('cloud-explorer-main');
    const itemActions = document.getElementById('ctx-item-actions');

    if (viewCloud && viewCloud.classList.contains('active')) {
        e.preventDefault();

        if (explorer && explorer.contains(e.target)) {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

            const row = e.target.closest('.cloud-file-row') || e.target.closest('.cloud-suggested-card');
            const isTrashView = currentCloudView === 'trash';

            if (row) {
                const name = row.getAttribute('data-name');
                const path = row.getAttribute('data-path');
                const isDir = row.getAttribute('data-is-dir') === 'true';
                const trashId = row.getAttribute('data-trash-id');

                if (name || trashId) {
                    if (isTrashView) {
                        itemActions.style.display = 'block';
                        document.getElementById('ctx-star-btn').style.display = 'none';
                        document.getElementById('ctx-rename-btn').style.display = 'none';
                        document.getElementById('ctx-protect-btn').style.display = 'none';
                        document.getElementById('ctx-download-btn').style.display = 'none';
                        document.getElementById('ctx-share-btn').style.display = 'none';
                        document.getElementById('ctx-organize-btn').style.display = 'none';

                        const delBtn = document.getElementById('ctx-delete-btn');
                        document.getElementById('ctx-delete-text').innerText = 'Eliminar permanentemente';
                        
                        const restoreBtn = document.getElementById('ctx-restore-btn');
                        restoreBtn.style.display = 'block';

                        menu.querySelector('#ctx-creation-actions').style.display = 'none';
                        currentCloudContextItem = { name, path, isDir, trashId };
                    } else {
                        document.getElementById('ctx-download-btn').style.display = 'block';
                        document.getElementById('ctx-star-btn').style.display = 'block';
                        document.getElementById('ctx-rename-btn').style.display = 'block';
                        document.getElementById('ctx-protect-btn').style.display = 'block';
                        document.getElementById('ctx-share-btn').style.display = 'block';
                        document.getElementById('ctx-organize-btn').style.display = 'block';
                        
                        document.getElementById('ctx-delete-text').innerText = 'Mover a la papelera';
                        document.getElementById('ctx-restore-btn').style.display = 'none';
                        menu.querySelector('#ctx-creation-actions').style.display = 'block';

                        const isStarred = row.getAttribute('data-starred') === 'true';
                        currentCloudContextItem = { name, path, isDir, starred: isStarred };
                        itemActions.style.display = 'block';

                        const starText = document.getElementById('ctx-star-text');
                        starText.innerText = isStarred ? 'Quitar de destacados' : 'Añadir a destacados';

                        const isProtected = row.getAttribute('data-protected') === 'true';
                        const protectText = document.getElementById('ctx-protect-text');
                        const protectIcon = document.getElementById('ctx-protect-icon');

                        protectText.innerText = isProtected ? 'Desproteger' : 'Bloquear eliminación';
                        protectIcon.innerText = isProtected ? '🔓' : '🔒';
                    }
                } else {
                    currentCloudContextItem = null;
                    itemActions.style.display = 'none';
                }
            } else {
                currentCloudContextItem = null;
                itemActions.style.display = 'none';
            }

            const isAllowedView = (currentCloudView === 'drive' || currentCloudView === 'computers');

            if (!isAllowedView && !currentCloudContextItem) {
                menu.style.display = 'none';
                return;
            }

            const creationItems = Array.from(menu.children).filter(child => child.id !== 'ctx-item-actions');
            creationItems.forEach(item => {
                item.style.display = isAllowedView ? '' : 'none';
            });

            menu.style.display = 'block';

            let x = e.pageX;
            let y = e.pageY;
            const menuWidth = 200;
            const menuHeight = menu.offsetHeight || 220;

            if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
            if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
        } else {
            if (menu) menu.style.display = 'none';
        }
    } else {
        if (menu) menu.style.display = 'none';
    }
});

document.addEventListener('click', function (e) {
    const menu = document.getElementById('cloud-context-menu');
    if (menu) menu.style.display = 'none';
});

document.getElementById('cloud-context-menu').addEventListener('click', async function(e) { 
    const btn = e.target.closest('.context-item');
    if (!btn || !currentCloudContextItem) return;
    const action = btn.id;
    const {name, path, isDir, trashId} = currentCloudContextItem;
    if (action === 'ctx-download-btn') downloadCloudFile(name, path, true);
    else if (action === 'ctx-rename-btn') renameCloudItem(name, path);
    else if (action === 'ctx-delete-btn') deleteCloudItem(name, path, isDir, trashId);
    else if (action === 'ctx-restore-btn') restoreCloudItem(trashId);
    else if (action === 'ctx-star-btn') toggleCloudStar(name, path);
    else if (action === 'ctx-protect-btn') toggleCloudProtect(name, path);
    else if (action === 'ctx-share-btn') await NV_Alert("Enlace generado.");
    else if (action === 'ctx-info-btn') showCloudInfo(name, path, trashId);
    else if (action === 'ctx-move-btn') {
        const newPath = await NV_Prompt("Mover a:", path);
        if (newPath !== null && newPath !== path) moveCloudItem(name, path, newPath);
    }
    this.style.display = 'none';
});

async function moveCloudItem(name, oldPath, newPath) {
    try {
        const res = await fetch('/api/cloud/move', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, old_path: oldPath, new_path: newPath, view: currentCloudView })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        }
        else {
            const data = await res.json();
            await NV_Alert(data.error || "Error al mover");
        }
    } catch (err) { await NV_Alert("Error de red al mover"); }
}
