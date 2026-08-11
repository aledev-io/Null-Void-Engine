import { NV_Alert, NV_Confirm, NV_Prompt } from '../dashboard/ui.js';
import { getCookie, formatBytes, getFileIcon, getFolderIcon, getComputerIcon, timeAgo } from '../dashboard/utils.js';

// Garantiza que todas las peticiones fetch incluyan credenciales (cookies) para
// preservar el token de sesión durante operaciones largas de descarga/streaming.
// Además aplica un timeout automático para evitar peticiones colgadas: se
// respeta una señal externa si el llamador la proporciona y se excluyen los
// envíos de archivos (FormData/ReadableStream) y descargas/streams de vídeo.
if (!window.__nvFetchCredentialsPatched) {
    window.__nvFetchCredentialsPatched = true;
    const _origFetch = window.fetch.bind(window);
    const _FETCH_TIMEOUT_MS = 120000;
    const _noTimeout = u => /\/get_token|\/download|stream_video|\/stream\?/.test(String(u || ''));
    window.fetch = function (url, options) {
        options = Object.assign({}, options);
        if (options.credentials === undefined) {
            options.credentials = 'include';
        }
        if (options.signal || _noTimeout(url)) {
            return _origFetch(url, options);
        }
        const body = options.body;
        if (body instanceof FormData || (body && typeof body.pipe === 'function') ||
            (body && typeof body.getReader === 'function')) {
            return _origFetch(url, options);
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), _FETCH_TIMEOUT_MS);
        return _origFetch(url, Object.assign({}, options, { signal: ctrl.signal }))
            .then(res => { clearTimeout(timer); return res; })
            .catch(err => {
                clearTimeout(timer);
                if (err && err.name === 'AbortError') {
                    console.warn(`[Cloud] Petición agotada (timeout ${_FETCH_TIMEOUT_MS / 1000}s): ${url}`);
                }
                throw err;
            });
    };
}

// Parseo JSON defensivo: nunca lanza aunque el servidor responda HTML o vacío.
async function _cloudJson(res, fallback = {}) {
    if (!res) return fallback;
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : fallback;
    } catch (e) {
        return fallback;
    }
}

let currentCloudPath = '';
let currentCloudView = 'home';
let currentCloudContextItem = null;
let uploadDestinationOverridePath = null;
let uploadDestinationOverrideView = null;
let currentCloudInfoItem = null;
let CLOUD_FILES = [];

// ---------------------------------------------------------------------------
// Helpers de seguridad: escape HTML para contenido y atributos, y saneado de
// nombres de archivos/carpetas introducidos por el usuario.
// ---------------------------------------------------------------------------

// Escape HTML básico (texto visible dentro de innerHTML).
function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escape orientado a atributos HTML (p.ej. onclick="...") y URLs dentro de
// atributos: también neutraliza backticks y el cierre de atributo.
function escAttr(v) {
    return esc(v).replace(/`/g, '&#96;').replace(/\//g, '&#47;');
}

// Convierte un valor en un literal de string JavaScript SEGURO para interpolar
// dentro de onclick="...". El truco de los escapes unicode impide que las
// comillas cierren el literal aunque el atributo se decodifique después.
function jsStr(v) {
    return String(v == null ? '' : v)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\u0027")
        .replace(/"/g, "\\u0022")
        .replace(/`/g, "\\u0060")
        .replace(/<\//g, '<\\/');
}

// Sanedado de nombres de archivo/carpeta: whitelist de caracteres seguros,
// colapso de espacios, recorte y límite de longitud. Devuelve el nombre
// limpio (puede quedar vacío si todo era inválido).
function sanitizeName(v, maxLen = 150) {
    return String(v == null ? '' : v)
        .replace(/[^\p{L}\p{N}\s\-_().,\[\]{}@+#%&~!=]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '')
        .replace(/[.]+$/g, '')
        .slice(0, maxLen);
}

// Fallback de avatar seguro: sustituye la <img> rota por un círculo con la
// primera letra del usuario. Se construye con createElement/textContent para
// no interpolar datos del usuario en HTML/strings.
window.cloudAvatarFallback = function (img, username) {
    if (!img || !img.parentNode) return;
    const style = img.getAttribute('style') || '';
    const size = (style.match(/width:\s*(\d+)px/) || [])[1] || '';
    const letter = String(username || '').trim().charAt(0).toUpperCase() || 'U';
    const div = document.createElement('div');
    div.style.cssText = style.replace(/width:\s*[^;]+;?/, '')
        .replace(/height:\s*[^;]+;?/, '')
        .replace(/;?\s*$/, '') +
        (size ? `; width:${size}px; height:${size}px;` : '; width:32px; height:32px;') +
        '; border-radius:50%; background:var(--indigo, #6366f1); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:' + Math.max(9, Math.round(parseInt(size || '32') * 0.42)) + 'px;';
    div.textContent = letter;
    img.parentNode.replaceChild(div, img);
};

// ---------------------------------------------------------------------------

// Reintenta peticiones GET fallidas (reinicio del servidor) con backoff.
// Devuelve null si agota los intentos. NO usar con peticiones que mutan datos.
async function fetchCloudWithRetry(url, options, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            if (res.status === 429) {
                console.warn(`[Cloud] Límite de peticiones (429) en ${url}, sin reintentos`);
                return null;
            }
            console.warn(`[Cloud] Respuesta ${res.status} de ${url}, intento ${attempt}/${retries}`);
        } catch (error) {
            console.warn(`[Cloud] Red caída en ${url}, intento ${attempt}/${retries}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
    }
    return null;
}

function updateTableHeaderVisibility(targetView = currentCloudView, targetPath = currentCloudPath) {
    const tableHeader = document.querySelector('.cloud-table-header');
    if (!tableHeader) return;
    const isHome = targetView === 'home' && !targetPath;
    const isBackupsRoot = targetView === 'backups' && !targetPath;
    const isAggregate = targetView === 'recent' || targetView === 'starred' || targetView === 'shared' || targetView === 'shared_by_me';
    const isGrid = (typeof currentCloudLayout !== 'undefined') && currentCloudLayout === 'grid';

    if (isHome || isBackupsRoot || isAggregate || isGrid) {
        tableHeader.style.display = 'none';
    } else {
        tableHeader.style.display = 'grid';
    }
}

async function fetchCloudFiles(path = '', view = 'home') {
    if (path === undefined) path = '';
    currentCloudPath = path;
    currentCloudView = view;
    window.currentCloudPath = path;
    window.currentCloudView = view;

    if (window.cloudFolderRefreshInterval) {
        clearInterval(window.cloudFolderRefreshInterval);
        window.cloudFolderRefreshInterval = null;
    }

    try {
        const url = new URL(window.location.href);
        if (view && view !== 'home') {
            url.searchParams.set('view', view);
        } else {
            url.searchParams.delete('view');
        }
        url.searchParams.delete('path');
        window.history.replaceState({}, '', url.pathname + url.search);
    } catch (e) { }
    document.querySelectorAll('#cloud-sidebar-nav .cloud-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const targetItem = document.querySelector(`#cloud-sidebar-nav .cloud-nav-item[onclick*="'${view}'"]`);
    if (targetItem) {
        targetItem.classList.add('active');
    }

    const backupsContainer = document.getElementById('cloud-backups-container');
    const fileList = document.getElementById('cloud-file-list');

    const isBackupsRoot = view === 'backups' && !path;

    if (isBackupsRoot) {
        if (backupsContainer) backupsContainer.style.display = 'block';
        if (fileList) fileList.style.display = 'none';
    } else {
        if (backupsContainer) backupsContainer.style.display = 'none';
        if (fileList) fileList.style.display = 'block';
    }
    if (fileList && !isBackupsRoot) {
        fileList.innerHTML = `<div style="height: 100%; display: flex; align-items: center; justify-content: center; padding: 40px; box-sizing: border-box;"><div class="loading-spinner"></div></div>`;
    }
    updateTableHeaderVisibility(view, path);

    const header = document.querySelector('.cloud-header');
    if (header) {
        if (view === 'home' && (path === '' || path === '/')) {
            header.classList.remove('hide-mobile-search');
        } else {
            header.classList.add('hide-mobile-search');
        }
    }

    const list = document.getElementById('cloud-file-list');

    try {
        let endpoint = `/api/cloud/files?view=${view}&path=${encodeURIComponent(path)}`;
        if (view === 'home') endpoint = '/api/cloud/recent';
        if (view === 'recent') endpoint = '/api/cloud/recent';
        if (view === 'starred') endpoint = '/api/cloud/list_starred';
        if (view === 'shared') {
            if (!path) endpoint = '/api/cloud/shared_with_me';
            else endpoint = `/api/cloud/files?view=shared&path=${encodeURIComponent(path)}`;
        }
        if (view === 'shared_by_me') endpoint = '/api/cloud/shared_by_me';

        const res = await fetchCloudWithRetry(endpoint, {
            headers: HEADERS,
            credentials: 'include'
        });

        if (!res) {
            console.error('[Cloud] No se pudo cargar la lista tras reintentos');
            if (list) list.innerHTML = `<div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 40px; box-sizing: border-box; text-align: center;">
                <div style="color:#f87171;">${window.t('conn_server_restart')}</div>
                <button onclick="location.reload()" style="padding: 9px 22px; border-radius: 8px; border: none; background: var(--accent); color: #fff; cursor: pointer; font-size: 0.9rem;">${window.t('btn_retry_now')}</button>
            </div>`;
            return;
        }

        const data = await _cloudJson(res);
        CLOUD_FILES = data.files || [];

        renderCloudBreadcrumbs(path, view === 'home' ? null : (view === 'recent' ? window.t_cloud('nav_recent', 'Recientes') : (view === 'starred' ? window.t_cloud('nav_starred', 'Destacados') : null)));

        const query = document.getElementById('cloud-search')?.value.toLowerCase() || '';
        const closeBtn = document.getElementById('btn-close-mobile-search');
        if (closeBtn) {
            closeBtn.style.display = query ? 'flex' : 'none';
        }
        if (query) {
            filterCloudFiles();
        } else {
            renderCloudFiles(CLOUD_FILES, view === 'home' || view === 'recent');
        }

        updateCloudQuotaInfo();

        const btnNew = document.querySelector('.btn-new-drive');
        if (btnNew) {
            btnNew.style.display = (view === 'drive' || view === 'computers' || view === 'backups' || view === 'business' || view === 'home' || view === 'recent') ? 'flex' : 'none';
        }

        const layoutToggle = document.getElementById('cloud-layout-toggle-group');
        if (layoutToggle) {
            layoutToggle.style.display = (view === 'home' || view === 'computers' || view === 'backups') ? 'none' : 'flex';
        }

        if (view === 'computers' && path !== '') {
            window.cloudFolderRefreshInterval = setInterval(async () => {
                if (currentCloudView === 'computers' && currentCloudPath === path) {
                    try {
                        let refreshEndpoint = `/api/cloud/files?view=computers&path=${encodeURIComponent(path)}`;
                        const refreshRes = await fetch(refreshEndpoint, { headers: HEADERS, credentials: 'include' });
                        if (refreshRes.ok) {
                            const refreshData = await _cloudJson(refreshRes);
                            CLOUD_FILES = refreshData.files || [];
                            const queryVal = document.getElementById('cloud-search')?.value.toLowerCase() || '';
                            if (!queryVal && currentCloudView === 'computers' && currentCloudPath === path) {
                                if (SELECTED_CLOUD_ITEMS.length === 0) {
                                    renderCloudFiles(CLOUD_FILES, false);
                                }
                            }
                        }
                    } catch (e) {
                        console.error("[Cloud] Error en autorefresco de archivos:", e);
                    }
                } else {
                    clearInterval(window.cloudFolderRefreshInterval);
                    window.cloudFolderRefreshInterval = null;
                }
            }, 10000);
        }

        // Actividad reciente: refresco periódico para mantenerla al día
        if (view === 'recent' && path === '') {
            window.cloudFolderRefreshInterval = setInterval(async () => {
                if (currentCloudView !== 'recent') {
                    clearInterval(window.cloudFolderRefreshInterval);
                    window.cloudFolderRefreshInterval = null;
                    return;
                }
                try {
                    const refreshRes = await fetch('/api/cloud/recent', { headers: HEADERS, credentials: 'include' });
                    if (refreshRes.ok) {
                        const refreshData = await _cloudJson(refreshRes);
                        const queryVal = document.getElementById('cloud-search')?.value.toLowerCase() || '';
                        if (!queryVal && SELECTED_CLOUD_ITEMS.length === 0 && currentCloudView === 'recent') {
                            CLOUD_FILES = refreshData.files || [];
                            renderCloudFiles(CLOUD_FILES, true);
                        }
                    }
                } catch (e) {
                    console.error("[Cloud] Error refrescando actividad reciente:", e);
                }
            }, 30000);
        }

    } catch (err) {
        console.error("[Cloud] Error de carga:", err);
        if (list) list.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px;text-align:center;"><div style="color:#f87171;">${window.t('conn_server_restart')}</div><button onclick="location.reload()" style="padding:9px 22px;border-radius:8px;border:none;background:var(--accent);color:#fff;cursor:pointer;">${window.t('btn_retry_now')}</button></div>`;
    }
}

let searchTimeout = null;

async function filterCloudFiles() {
    const query = document.getElementById('cloud-search')?.value.trim() || '';

    if (searchTimeout) clearTimeout(searchTimeout);

    const closeBtn = document.getElementById('btn-close-mobile-search');
    if (closeBtn) {
        // En móvil se maneja su visibilidad aquí.
        closeBtn.style.display = query ? 'flex' : 'none';
    }

    if (!query) {
        renderCloudFiles(CLOUD_FILES, currentCloudView === 'home' || currentCloudView === 'recent');
        renderCloudBreadcrumbs(currentCloudPath, currentCloudView === 'home' ? null : (currentCloudView === 'recent' ? window.t_cloud('nav_recent', 'Recientes') : (currentCloudView === 'starred' ? window.t_cloud('nav_starred', 'Destacados') : null)));
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/cloud/search?q=${encodeURIComponent(query)}`, { headers: HEADERS });
            if (!res.ok) return;
            const data = await _cloudJson(res);
            const displayQuery = query.length > 15 ? query.substring(0, 15) + '...' : query;
            renderCloudBreadcrumbs(null, `Resultados para "${displayQuery}"`);
            renderCloudFiles(data.files || [], false);
        } catch (err) {
            console.error("[Cloud] Error al buscar archivos:", err);
        }
    }, 250);
}

function renderCloudBreadcrumbs(path, customTitle = null) {
    const container = document.getElementById('cloud-breadcrumbs');
    if (!container) return;

    // Botón flotante "Vaciar papelera" (estilo widget de chat, abajo a la derecha): solo en raíz de la papelera con contenido
    const fabTrashBtn = document.getElementById('btn-empty-trash-fab');
    if (fabTrashBtn) {
        const showFabTrash = currentCloudView === 'trash' && (!path || path === '') && CLOUD_FILES && CLOUD_FILES.length > 0;
        fabTrashBtn.style.display = showFabTrash ? 'flex' : 'none';
    }

    if (currentCloudView === 'home' && (!path || path === '')) {
        container.innerHTML = `<span class="breadcrumb-item active hide-desktop">${window.t_cloud('nav_home', 'Home')}</span>`;
        return;
    }

    if (currentCloudView === 'computers' && currentCloudPath === '') {
        container.innerHTML = `<span class="breadcrumb-item active hide-desktop" style="color: var(--text-main);">${window.t_cloud('nav_computers', 'Computadoras')}</span>`;
        return;
    }

    if (customTitle) {
        container.innerHTML = `<span class="breadcrumb-item active hide-desktop" style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; width: 100%;">${customTitle}</span>`;
        return;
    }

    const parts = path.split('/').filter(p => p);

    let rootName = window.t_cloud('nav_drive', 'Mi unidad');
    let rootAction = "fetchCloudFiles('', 'drive')";

    if (currentCloudView === 'computers') {
        rootName = window.t_cloud('nav_computers', 'Computadoras');
        rootAction = "fetchCloudFiles('', 'computers')";
    } else if (currentCloudView === 'backups') {
        rootName = window.t_cloud('nav_backups', 'Backups');
        rootAction = "fetchCloudFiles('', 'backups')";
    } else if (currentCloudView === 'business') {
        rootName = window.t_cloud('nav_billing', 'Facturación');
        rootAction = "fetchCloudFiles('', 'business')";
    } else if (currentCloudView === 'trash') {
        rootName = window.t_cloud('nav_trash', 'Papelera');
        rootAction = "fetchCloudFiles('', 'trash')";
    } else if (currentCloudView === 'shared_by_me') {
        rootName = window.t_cloud('shared_by_me_title', 'Compartidos por mí');
        rootAction = "fetchCloudFiles('', 'shared_by_me')";
    } else if (currentCloudView === 'shared') {
        rootName = window.t_cloud('nav_shared', 'Compartidos conmigo');
        rootAction = "fetchCloudFiles('', 'shared')";
    }

    // Ocultar botón de vincular dispositivo si estamos en la papelera para ahorrar espacio
    const linkBtn = document.getElementById('btn-link-device-topbar');
    if (linkBtn) {
        linkBtn.style.display = currentCloudView === 'trash' ? 'none' : 'flex';
    }

    // Rutas acumuladas de cada nivel (para navegar a cualquier nivel previo)
    const accumulated = [];
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
        acc += (i === 0 ? '' : '/') + parts[i];
        accumulated.push(acc);
    }

    // Colapso de ruta tipo Google Drive: si la ruta supera MAX_FLAT
    // niveles, las carpetas intermedias se ocultan bajo el botón "…" con un
    // menú desplegable para saltar a cualquier nivel previo.
    const MAX_FLAT = 4;
    const FIRST_VISIBLE = 2;
    const LAST_VISIBLE = 2;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const firstVisible = isMobile ? 0 : FIRST_VISIBLE;
    const lastVisible = isMobile ? 2 : LAST_VISIBLE;

    const needsCollapse = parts.length > MAX_FLAT;
    const visibleSegs = [];
    const hiddenSegs = [];

    if (needsCollapse) {
        for (let i = 0; i < firstVisible; i++) visibleSegs.push({ name: parts[i], index: i, path: accumulated[i] });
        for (let i = parts.length - lastVisible; i < parts.length; i++) visibleSegs.push({ name: parts[i], index: i, path: accumulated[i] });
        for (let i = firstVisible; i < parts.length - lastVisible; i++) hiddenSegs.push({ name: parts[i], index: i, path: accumulated[i] });
        if (hiddenSegs.length === 0) {
            // Extremos solapados: se muestra la ruta completa en plano
            visibleSegs.length = 0;
            for (let i = 0; i < parts.length; i++) visibleSegs.push({ name: parts[i], index: i, path: accumulated[i] });
        }
    } else {
        for (let i = 0; i < parts.length; i++) visibleSegs.push({ name: parts[i], index: i, path: accumulated[i] });
    }

    // Secuencia final de renderizado (segmentos + nodo "…" en su posición)
    const renderSegs = [];
    if (needsCollapse && hiddenSegs.length > 0) {
        if (firstVisible > 0) {
            for (const seg of visibleSegs) {
                renderSegs.push({ type: 'seg', seg });
                if (seg.index === firstVisible - 1) renderSegs.push({ type: 'more', hidden: hiddenSegs });
            }
        } else {
            renderSegs.push({ type: 'more', hidden: hiddenSegs });
            for (const seg of visibleSegs) renderSegs.push({ type: 'seg', seg });
        }
    } else {
        for (const seg of visibleSegs) renderSegs.push({ type: 'seg', seg });
    }

    const sepHtml = hideMobile => `<span${hideMobile ? ' class="hide-mobile"' : ''} style="margin: 0 8px; opacity: 0.5;">›</span>`;

    let html = `<span class="breadcrumb-item ${!path ? 'active' : ''} ${parts.length > 0 ? 'hide-mobile' : 'hide-desktop'}" onclick="${rootAction}">${rootName}</span>`;

    let isFirst = true;
    for (const entry of renderSegs) {
        if (entry.type === 'more') {
            if (!isFirst) html += sepHtml(false);
            const menuItems = entry.hidden.map(seg =>
                `<div class="breadcrumb-more-item" title="${esc(seg.name)}" onclick="closeBreadcrumbMenus(); navigateCloud('${jsStr(seg.path)}')">${esc(seg.name)}</div>`
            ).join('');
            html += `<span class="breadcrumb-more">
                <span class="breadcrumb-more-btn" onclick="toggleBreadcrumbMenu(this)" title="${esc(window.t_cloud('nav_show_more', 'Mostrar carpetas intermedias'))}">…</span>
                <div class="breadcrumb-more-menu">${menuItems}</div>
            </span>`;
        } else {
            const seg = entry.seg;
            html += sepHtml(seg.index === 0 && parts.length > 0);
            html += `<span class="breadcrumb-item breadcrumb-truncate ${seg.index === parts.length - 1 ? 'active' : ''}" onclick="navigateCloud('${jsStr(seg.path)}')">${esc(seg.name)}</span>`;
        }
        isFirst = false;
    }

    container.innerHTML = html;

    container.querySelectorAll('.breadcrumb-item').forEach(item => {
        if (item.classList.contains('active')) return;

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            item.style.color = 'var(--indigo)';
            item.style.fontWeight = 'bold';
        });

        item.addEventListener('dragleave', () => {
            item.style.color = '';
            item.style.fontWeight = '';
        });

        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            item.style.color = '';
            item.style.fontWeight = '';

            const onclickAttr = item.getAttribute('onclick') || '';
            let targetPath = '';

            if (onclickAttr.includes("navigateCloud('")) {
                targetPath = onclickAttr.split("navigateCloud('")[1].split("')")[0];
            } else if (onclickAttr.includes("fetchCloudFiles('',")) {
                targetPath = '';
            }

            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data && data.items) {
                    let movedCount = 0;
                    for (const itemData of data.items) {
                        if (itemData.isDir && targetPath.startsWith([itemData.path, itemData.name].filter(Boolean).join('/'))) {
                            continue;
                        }

                        const res = await fetch('/api/cloud/move', {
                            method: 'POST',
                            headers: HEADERS,
                            body: JSON.stringify({
                                name: itemData.name,
                                old_path: itemData.path,
                                new_path: targetPath,
                                view: currentCloudView
                            })
                        });
                        if (res.ok) movedCount++;
                    }
                    if (movedCount > 0) {
                        clearCloudSelection();
                        fetchCloudFiles(currentCloudPath, currentCloudView);
                    }
                }
            } catch (err) {
                console.error("Error drop breadcrumb:", err);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Menú desplegable del breadcrumb colapsado (nodo "…"): muestra las carpetas
// intermedias ocultas y permite saltar a cualquier nivel previo. Se posiciona
// con position:fixed para no quedar recortado por el overflow del contenedor.
// ---------------------------------------------------------------------------

function toggleBreadcrumbMenu(btn) {
    const wrapper = btn.closest('.breadcrumb-more');
    const menu = wrapper && wrapper.querySelector('.breadcrumb-more-menu');
    if (!menu) return;

    const wasOpen = menu.classList.contains('open');
    closeBreadcrumbMenus();
    if (wasOpen) return;

    menu.classList.add('open');
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;

    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuWidth - 8);
    let top = rect.bottom + 6;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 6);

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = '';
}

function closeBreadcrumbMenus() {
    document.querySelectorAll('.breadcrumb-more-menu').forEach(menu => {
        menu.classList.remove('open');
        menu.style.display = 'none';
    });
}

function renderCloudFiles(files, isRecent = false) {
    const list = document.getElementById('cloud-file-list');
    const header = document.querySelector('.cloud-table-header');
    if (!list) return;

    const isHome = currentCloudView === 'home';

    if (currentCloudLayout === 'grid' && !isHome) {
        list.classList.add('grid-layout');
    } else {
        list.classList.remove('grid-layout');
    }

    if (typeof clearCloudSelection === 'function') {
        clearCloudSelection();
    }

    if (header) {
        if (currentCloudLayout === 'grid' && !isHome) {
            header.style.display = 'none';
        } else if (currentCloudView === 'computers' && currentCloudPath === '' && (!files || files.length === 0)) {
            header.style.display = 'none';
        } else {
            header.style.display = 'grid';
        }
    }

    if (!files || files.length === 0) {
        if (currentCloudView === 'computers' && currentCloudPath === '') {
            list.innerHTML = `
<div style="display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; min-height: 200px; width: 100%;">
    <div style="display: flex; flex-direction: column; align-items: center; text-align: center; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: clamp(16px, 4vw, 36px) clamp(16px, 5vw, 40px); box-sizing: border-box; box-shadow: 0 10px 30px rgba(0,0,0,0.15); width: 100%; max-width: 480px; gap: 0;">
        <div style="margin-bottom: clamp(10px, 2vw, 18px);"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg></div>
        <h3 style="font-size: clamp(0.95rem, 3.5vw, 1.35rem); font-weight: 700; color: var(--text-main); margin: 0 0 clamp(6px, 1.5vw, 10px); line-height: 1.3;">${window.t_cloud('link_modal_title')}</h3>
        <p style="font-size: clamp(0.75rem, 2.5vw, 0.88rem); color: var(--text-muted); margin: 0 0 clamp(14px, 3vw, 22px); line-height: 1.5;">
            ${window.t_cloud('link_modal_desc_computers')}
        </p>
        <button onclick="openLinkDeviceModal()" class="btn-primary" style="padding: clamp(8px, 2vw, 12px) clamp(16px, 4vw, 24px); border-radius: 8px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(99,102,241,0.4); cursor: pointer; border: none; background: var(--indigo); color: #fff; font-size: clamp(0.78rem, 2.5vw, 0.95rem); white-space: nowrap;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> ${window.t_cloud('link_this_device')}
        </button>
    </div>
</div>`;
        } else {
            list.innerHTML = `<div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.4; margin-top: 50px;">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <p>${isRecent ? window.t_cloud('no_recent_activity') : window.t_cloud('empty_folder')}</p>
        </div>`;
        }
        return;
    }

    function getFileTemplateData(f) {
        const fpath = (isRecent || f.path !== undefined) ? f.path : currentCloudPath;
        const fullPath = [fpath, f.name].filter(Boolean).join('/');
        const displayPath = fpath || window.t_cloud('nav_drive', 'Mi unidad');

        const ownerDisplayRaw = (f.owner === window.CURRENT_USER || f.owner === 'Yo') ? 'Yo' : f.owner;
        const ownerDisplay = (ownerDisplayRaw === 'Yo') ? window.t_cloud('me', 'Yo') : ownerDisplayRaw;
        const isMine = (ownerDisplayRaw === 'Yo') || (currentCloudView === 'shared_by_me');

        const clickAction = f.is_dir
            ? `navigateCloud(\`${jsStr(fullPath)}\`, '${f.view || currentCloudView}')`
            : `downloadCloudFile(\`${jsStr(f.name)}\`, \`${jsStr(fpath)}\`, false, '${jsStr(f.owner_id || '')}', '${jsStr(f.view || currentCloudView)}', '${currentCloudView === 'trash' ? jsStr(f.id || '') : ''}', \`${jsStr(ownerDisplay)}\`, ${f.shared ? 'true' : 'false'})`;

        let icon = f.is_dir ? getFolderIcon() : getFileIcon(f.ext);
        let statusBadge = '';
        if (currentCloudView === 'computers' && currentCloudPath === '') {
            icon = getComputerIcon();
            if (f.active) {
                statusBadge = `<span style="display:inline-block; width:8px; height:8px; background:#10b981; border-radius:50%; margin-left:4px;" title="Online"></span>`;
            } else {
                statusBadge = `<span style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-left:4px;" title="Offline"></span>`;
            }
        } else if (f.shared) {
            statusBadge = `<span style="color: #818cf8; display: inline-flex; align-items: center; margin-left: 6px;" title="Compartido"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>`;
        }

        const sharedBadge = (!isMine) ? `<span class="cloud-card-shared-badge" title="${esc(ownerDisplay || '')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>${esc(ownerDisplay || '')}</span>` : '';

        const safeClickAction = clickAction.replace(/`/g, "\\`").replace(/'/g, "\\'");
        const safeName = jsStr(f.name);
        const safePath = jsStr(fpath);
        const cleanName = esc(f.name);
        const cleanDisplayPath = esc(displayPath);
        const sharedWithName = f.shared_with_name || '';

        const checkboxHtml = (currentCloudView !== 'home')
            ? `<input type="checkbox" class="cloud-file-checkbox" onclick="event.stopPropagation(); toggleCloudFileSelection(this, \`${safeName}\`, \`${safePath}\`, ${f.is_dir}, '${f.owner_id || ''}')">`
            : '';

        const isImg = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(f.ext);
        const isVid = ['.mp4', '.webm', '.mov'].includes(f.ext);
        const isPdf = f.ext === '.pdf';

        let previewContent = `<span class="cloud-preview-fallback" style="font-size: 3rem;">${getFileIcon(f.ext)}</span>`;

        const previewView = f.id ? 'trash' : (f.view || currentCloudView);

        const thumbUrl = `/api/cloud/preview?path=${encodeURIComponent(fpath)}&name=${encodeURIComponent(f.name)}&view=${previewView}&id=${f.id || ''}&owner_id=${f.owner_id || ''}&thumbnail=1`;

        // Miniaturas: carga diferida (lazy) y, si fallan, se muestra el icono en vez de imagen rota
        const fallbackIcon = `<span class="cloud-preview-fallback" style="font-size: 3rem;">${getFileIcon(f.ext)}</span>`;

        if (isImg) {
            previewContent = `<div style="width:100%;height:100%;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;">${fallbackIcon}<img loading="lazy" src="${thumbUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()"></div>`;
        } else if (isVid) {
            previewContent = `
                <div style="width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    ${fallbackIcon}
                    <img loading="lazy" src="${thumbUrl}" style="position:absolute;inset:0;width:100%; height:100%; object-fit:cover;" onerror="this.remove()">
                    <div class="video-overlay" style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--indigo); color: #fff; font-size: 0.8rem; position:absolute; z-index:2;">▶</div>
                </div>`;
        } else if (isPdf) {
            previewContent = `<div style="width:100%;height:100%;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;">${fallbackIcon}<img loading="lazy" src="${thumbUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.remove()"></div>`;
        }

        return {
            fpath,
            fullPath,
            displayPath,
            ownerDisplay,
            sharedWithName,
            isMine,
            icon,
            statusBadge,
            safeClickAction,
            safeName,
            safePath,
            cleanName,
            cleanDisplayPath,
            checkboxHtml,
            previewContent,
            sharedBadge
        };
    }

    updateTableHeaderVisibility(currentCloudView, currentCloudPath);

    let html = '';

    if (isRecent) {
        const suggested = files.slice(0, 4);
        html += `
    <div style="padding: 20px 24px 10px 24px;">
        <h3 class="cloud-section-title" style="font-size: 1rem; font-weight: 500; margin-bottom: 15px; opacity: 0.8;">${window.t_cloud('suggested', 'Sugeridos')}</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 24px; margin-bottom: 40px;">
            ${suggested.map(f => {
            const isDir = f.is_dir === true;
            const isImg = !isDir && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(f.ext);
            const isVid = !isDir && ['.mp4', '.webm', '.mov'].includes(f.ext);
            const isPdf = !isDir && f.ext === '.pdf';

            let previewContent = `<span class="cloud-preview-fallback" style="font-size: 2.5rem;">${isDir ? getFolderIcon() : getFileIcon(f.ext)}</span>`;

            const cardThumb = `/api/cloud/preview?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}&view=${f.view || currentCloudView}&owner_id=${f.owner_id || ''}&thumbnail=1`;
            const cardFallback = `<span class="cloud-preview-fallback" style="font-size:2.5rem;">${isDir ? getFolderIcon() : getFileIcon(f.ext)}</span>`;

            if (isImg) {
                previewContent = `<div style="width:100%;height:100%;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;">${cardFallback}<img loading="lazy" src="${cardThumb}" class="card-preview-img" style="position:absolute;inset:0;" onerror="this.remove()"></div>`;
            } else if (isVid) {
                previewContent = `
                        <div style="width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                            ${cardFallback}
                            <img loading="lazy" src="${cardThumb}" class="card-preview-img" style="position:absolute;inset:0; width:100%; height:100%; object-fit:cover;" onerror="this.remove()">
                            <div class="video-overlay" style="display:flex; align-items:center; justify-content:center; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:36px; height:36px; border-radius:50%; background:rgba(0,0,0,0.5); color:#fff; font-size:0.9rem; z-index:2;">▶</div>
                        </div>`;
            } else if (isPdf) {
                previewContent = `<div style="width:100%;height:100%;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;">${cardFallback}<img loading="lazy" src="${cardThumb}" class="card-preview-img" style="position:absolute;inset:0;" onerror="this.remove()"></div>`;
            }

            const suggestedClick = isDir
                ? `navigateCloud(\`${jsStr([f.path, f.name].filter(Boolean).join('/'))}\`, '${jsStr(f.view || '')}')`
                : `downloadCloudFile(\`${jsStr(f.name)}\`, \`${jsStr(f.path)}\`, false, '${jsStr(f.owner_id || '')}')`;

            return `
                    <div class="cloud-suggested-card" 
                         data-name="${escAttr(f.name)}" data-path="${escAttr(f.path)}" data-is-dir="${isDir}" data-starred="${escAttr(f.starred)}" data-view="${escAttr(f.view || '')}"
                         onclick="${suggestedClick}">
                        <div class="card-preview">
                            ${previewContent}
                            ${f.view === 'shared' ? `<span class="cloud-card-shared-badge" title="${esc(f.owner || '')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>${esc(f.owner || '')}</span>` : ''}
                        </div>
                        <div class="card-info">
                            <span class="card-name">${esc(f.name)}</span>
                            <span class="card-meta">${window.t_cloud(f.action_type || 'act_abrio', f.action_type || 'Visto')} · ${timeAgo(f.action_time || f.mtime)}</span>
                        </div>
                    </div>
                `;
        }).join('')}
        </div>
        ${currentCloudLayout !== 'grid' ? `<h3 class="cloud-section-title" style="font-size: 1rem; font-weight: 500; margin-bottom: 15px; opacity: 0.8;">${window.t_cloud('recent_activity', 'Actividad reciente')}</h3>
        <div class="cloud-table-header" style="display: grid; grid-template-columns: 2fr 1fr 1.2fr 1fr 40px; column-gap: 16px; padding: 12px 24px; border-bottom: 1px solid var(--border); font-size: 0.75rem; font-weight: 700; color: var(--text-muted); background: transparent; position: static;">
            <span>${window.t_cloud('col_name', 'Nombre')}</span>
            <span>${window.t_cloud('col_owner', 'Propietario')}</span>
            <span>${window.t_cloud('col_date', 'Fecha de modificación')}</span>
            <span>${window.t_cloud('col_size', 'Tamaño del archivo')}</span>
            <span></span>
        </div>` : `<h3 class="cloud-section-title" style="font-size: 1rem; font-weight: 500; margin-bottom: 15px; opacity: 0.8;">${window.t_cloud('recent_activity', 'Actividad reciente')}</h3>`}
    </div>`;
    }

    if (currentCloudLayout === 'grid' && currentCloudView !== 'home') {
        const folders = files.filter(f => f.is_dir);
        const items = files.filter(f => !f.is_dir);

        let gridHtml = '';

        if (folders.length > 0) {
            gridHtml += `<div class="cloud-folders-grid">`;
            gridHtml += folders.map(f => {
                const d = getFileTemplateData(f);
                return `
                <div class="cloud-folder-row"
                     data-name="${escAttr(f.name)}" data-path="${escAttr(d.fpath)}" data-is-dir="true" data-starred="${escAttr(f.starred)}" data-protected="${f.protected === true}"
                     data-trash-id="${escAttr(f.id || '')}" data-owner-id="${escAttr(f.owner_id || '')}" data-view="${escAttr(f.view || '')}" data-is-mine="${d.isMine}"
                     onclick="handleCloudRowClick(event, \`${d.safeName}\`, \`${d.safePath}\`, true, '${jsStr(f.owner_id || '')}', ${f.trash === true}, \`${d.safeClickAction}\`)">
                    ${d.checkboxHtml}
                    <span class="cloud-folder-row-icon">${d.icon}</span>
                    <span class="cloud-folder-row-name">${d.cleanName}</span>
                    ${f.starred ? '<span style="color:#fbbf24;font-size:0.75rem;flex-shrink:0;">★</span>' : ''}
                    ${f.protected ? `<span title="Este elemento está protegido contra eliminación" class="cloud-protected-lock" style="display:inline-flex; flex-shrink:0; cursor:help;">${protectSvgIcon(true, 13)}</span>` : ''}
                    <button class="cloud-folder-row-menu" onclick="handleCloudAction(event, '${d.safeName}', true, '${d.safePath}')">⋮</button>
                </div>`;
            }).join('');
            gridHtml += `</div>`;
        }

        if (items.length > 0) {
            gridHtml += `<div class="cloud-files-grid">`;
            gridHtml += items.map(f => {
                const d = getFileTemplateData(f);
                return `
                <div class="cloud-file-card"
                     data-name="${escAttr(f.name)}" data-path="${escAttr(d.fpath)}" data-is-dir="false" data-starred="${escAttr(f.starred)}" data-protected="${f.protected === true}"
                     data-trash-id="${escAttr(f.id || '')}" data-owner-id="${escAttr(f.owner_id || '')}" data-view="${escAttr(f.view || '')}" data-is-mine="${d.isMine}"
                     onclick="handleCloudRowClick(event, \`${d.safeName}\`, \`${d.safePath}\`, false, '${jsStr(f.owner_id || '')}', ${f.trash === true}, \`${d.safeClickAction}\`)">
                    <div class="cloud-file-card-header">
                        ${d.checkboxHtml}
                        <span class="cloud-file-card-icon">${d.icon}</span>
                        <span class="cloud-file-card-name">${d.cleanName}</span>
                        ${f.starred ? '<span style="color:#fbbf24;font-size:0.75rem;flex-shrink:0;">★</span>' : ''}
                        ${f.protected ? `<span title="Este elemento está protegido contra eliminación" class="cloud-protected-lock" style="display:inline-flex; flex-shrink:0; cursor:help;">${protectSvgIcon(true, 13)}</span>` : ''}
                        <button class="cloud-file-card-menu" onclick="handleCloudAction(event, '${d.safeName}', false, '${d.safePath}')">⋮</button>
                    </div>
                    <div class="cloud-file-card-preview">
                        ${d.previewContent}
                        ${d.sharedBadge}
                    </div>
                </div>`;
            }).join('');
            gridHtml += `</div>`;
        }

        html += gridHtml;
    } else {
        // Si estamos en la papelera, agrupar por origen (view)
        if (currentCloudView === 'trash' && files.length > 0) {
            const viewLabels = { 'drive': window.t_cloud('nav_drive', 'Mi unidad'), 'backups': 'Backups', 'business': window.t_cloud('nav_business', 'Facturación'), 'computers': window.t_cloud('nav_computers', 'Computadoras') };
            const groups = {};
            files.forEach(f => {
                const src = f.view || 'drive';
                if (!groups[src]) groups[src] = [];
                groups[src].push(f);
            });
            const sortedKeys = Object.keys(groups).sort((a, b) => (viewLabels[a] || a).localeCompare(viewLabels[b] || b));
            sortedKeys.forEach(key => {
                html += `<div style="padding: 12px 24px 6px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); opacity: 0.7; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 2px;">${viewLabels[key] || key}</div>`;
                html += groups[key].map(f => renderListRow(f, isRecent, getFileTemplateData)).join('');
            });
        } else {
            html += files.map(f => renderListRow(f, isRecent, getFileTemplateData)).join('');
        }
    }

    list.innerHTML = html;
    if (currentCloudView !== 'home' && currentCloudView !== 'shared') {
        list.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card').forEach(row => {
            const name = row.getAttribute('data-name');
            const isDir = row.getAttribute('data-is-dir') === 'true';
            const path = row.getAttribute('data-path');

            row.setAttribute('draggable', 'true');

            row.addEventListener('dragstart', (e) => {
                if (row.getAttribute('data-protected') === 'true' || SELECTED_CLOUD_ITEMS.some(item => item.row && item.row.getAttribute('data-protected') === 'true')) {
                    e.preventDefault();
                    return;
                }
                row.classList.add('dragging');
                const isSelected = SELECTED_CLOUD_ITEMS.some(item => item.row === row);
                if (!isSelected) {
                    clearCloudSelection();
                    const checkbox = row.querySelector('.cloud-file-checkbox');
                    if (checkbox) {
                        checkbox.checked = true;
                        toggleCloudFileSelection(checkbox, name, path, isDir, row.getAttribute('data-owner-id'));
                    }
                }
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    items: SELECTED_CLOUD_ITEMS.map(item => ({ name: item.name, path: item.path, isDir: item.isDir }))
                }));
                e.dataTransfer.effectAllowed = 'move';

                const dragGhost = document.createElement('div');
                dragGhost.id = 'cloud-drag-ghost';
                dragGhost.style.position = 'absolute';
                dragGhost.style.top = '-9999px';
                dragGhost.style.left = '-9999px';
                dragGhost.style.display = 'flex';
                dragGhost.style.alignItems = 'center';
                dragGhost.style.gap = '10px';
                dragGhost.style.padding = '8px 16px';
                dragGhost.style.background = 'rgba(15, 23, 42, 0.95)';
                dragGhost.style.border = '1px solid rgba(99, 102, 241, 0.4)';
                dragGhost.style.borderRadius = '20px';
                dragGhost.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.4)';
                dragGhost.style.color = '#fff';
                dragGhost.style.fontFamily = 'system-ui, -apple-system, sans-serif';
                dragGhost.style.fontSize = '0.82rem';
                dragGhost.style.fontWeight = '600';
                dragGhost.style.pointerEvents = 'none';
                dragGhost.style.whiteSpace = 'nowrap';
                dragGhost.style.zIndex = '-99999';

                let ghostIcon = isDir ? getFolderIcon() : getFileIcon('.txt');
                const dotIdx = name.lastIndexOf('.');
                if (!isDir && dotIdx !== -1) {
                    const ext = name.substring(dotIdx + 1).toLowerCase();
                    if (typeof getFileIcon === 'function') {
                        ghostIcon = getFileIcon(ext);
                    }
                }
                let ghostText = name;

                if (SELECTED_CLOUD_ITEMS.length > 1) {
                    ghostIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#5f6368"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H8v-2h6v2zm2-4H6v-2h10v2zm0-4H6V6h10v2z"/></svg>`;
                    ghostText = `Moviendo ${SELECTED_CLOUD_ITEMS.length} elementos`;
                }

                dragGhost.innerHTML = `
                    <span style="font-size: 1.15rem; line-height: 1;">${ghostIcon}</span>
                    <span style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ghostText}</span>
                `;

                document.body.appendChild(dragGhost);

                e.dataTransfer.setDragImage(dragGhost, 25, 20);

                setTimeout(() => {
                    if (dragGhost.parentNode) {
                        dragGhost.parentNode.removeChild(dragGhost);
                    }
                }, 0);
            });

            row.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                list.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card').forEach(r => r.classList.remove('drag-over'));
            });

            if (isDir) {
                row.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    row.classList.add('drag-over');
                    e.dataTransfer.dropEffect = 'move';
                });

                row.addEventListener('dragleave', () => {
                    row.classList.remove('drag-over');
                });

                row.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    row.classList.remove('drag-over');
                    try {
                        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                        if (data && data.items) {
                            const targetPath = [path, name].filter(Boolean).join('/');
                            let movedCount = 0;
                            for (const item of data.items) {
                                if (item.isDir && targetPath.startsWith([item.path, item.name].filter(Boolean).join('/'))) {
                                    continue;
                                }
                                const res = await fetch('/api/cloud/move', {
                                    method: 'POST',
                                    headers: HEADERS,
                                    body: JSON.stringify({
                                        name: item.name,
                                        old_path: item.path,
                                        new_path: targetPath,
                                        view: currentCloudView
                                    })
                                });
                                if (res.ok) movedCount++;
                            }
                            if (movedCount > 0) {
                                clearCloudSelection();
                                fetchCloudFiles(currentCloudPath, currentCloudView);
                            }
                        }
                    } catch (err) {
                        console.error("Error drop:", err);
                    }
                });
            }
        });
    }
}

function protectSvgIcon(locked, size) {
    const s = size || 15;
    const rect = `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>`;
    const shackle = locked
        ? `<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>`
        : `<path d="M7 11V7a5 5 0 0 1 9.9-1"></path>`;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${rect}${shackle}</svg>`;
}

function renderListRow(f, isRecent, getFileTemplateData) {
    const d = getFileTemplateData(f);
    return `
    <div class="cloud-file-row" 
         data-name="${escAttr(f.name)}" data-path="${escAttr(d.fpath)}" data-is-dir="${f.is_dir}" data-starred="${escAttr(f.starred)}" data-protected="${f.protected === true}"
         data-trash-id="${escAttr(f.id || '')}" data-owner-id="${escAttr(f.owner_id || '')}" data-view="${escAttr(f.view || '')}" data-shared-with="${escAttr(f.shared_with || '')}" data-is-mine="${d.isMine}"
         onclick="handleCloudRowClick(event, \`${d.safeName}\`, \`${d.safePath}\`, ${f.is_dir}, '${jsStr(f.owner_id || '')}', ${f.trash === true}, \`${d.safeClickAction}\`)">
        <div class="cloud-file-name" style="position: relative; ${currentCloudView === 'home' ? 'padding-left: 0;' : ''}">
            ${d.checkboxHtml}
            <span class="cloud-file-icon" style="font-size: 1.2rem;">${d.icon}</span>
            <div style="display: flex; flex-direction: column; overflow: hidden; flex: 1; min-width: 0;">
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${(currentCloudView === 'computers' && currentCloudPath === '') ? 'color: #818cf8; font-weight: 600;' : ''}">${d.cleanName}</span>
                ${(!isRecent && (f.path !== undefined || (f.trash && f.origin))) ? `<span style="font-size: 0.65rem; opacity: 0.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${(f.trash && f.origin) ? window.t_cloud('trash_origin_from', 'sale de') + ' ' + esc(f.origin) : window.t_cloud('in_lower', 'en') + ' ' + d.cleanDisplayPath}</span>` : ''}
            </div>
        </div>
        <div class="cloud-file-owner" style="flex: 1; font-size: 0.9rem; opacity: 1; color: var(--text-dim); display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden;">
            ${(currentCloudView === 'shared_by_me' && f.shared_with) ? `<img src="/api/system/user/avatar/${escAttr(f.shared_with)}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;" onerror="window.cloudAvatarFallback(this, '${jsStr(d.sharedWithName || d.ownerDisplay || '')}')">` : ((f.owner_id && !d.isMine && currentCloudView !== 'shared_by_me') ? `<img src="/api/system/user/avatar/${escAttr(f.owner_id)}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;" onerror="window.cloudAvatarFallback(this, '${jsStr(d.ownerDisplay || '')}')">` : '')}
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;">${currentCloudView === 'shared_by_me' ? window.t_cloud('shared_with_label', 'Compartido con') + ' ' + esc(d.sharedWithName || d.ownerDisplay || '') : esc(d.ownerDisplay || window.t_cloud('me', 'Yo'))}</span>
            <span style="margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 10px; color: var(--text-muted);">
                ${f.starred ? '<span style="color: #fbbf24; font-size: 0.8rem; display:inline-flex;">★</span>' : ''}
                ${f.protected ? `<span title="Este elemento está protegido contra eliminación" class="cloud-protected-lock" style="display:inline-flex; flex-shrink:0; cursor:help;">${protectSvgIcon(true, 13)}</span>` : ''}
                ${d.statusBadge}
            </span>
        </div>
        <div class="cloud-file-date" style="flex: 1; font-size: 0.9rem; opacity: 1; color: var(--text-dim); min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
            ${new Date(f.mtime * 1000).toLocaleDateString(window.currentLang, { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        <div class="cloud-file-size" style="flex: 1; font-size: 0.9rem; opacity: 1; color: var(--text-dim);">
            ${formatBytes(f.size || 0)}
        </div>
        <div class="cloud-file-actions" style="width: 40px; display: flex; justify-content: flex-end;">
             <button onclick="handleCloudAction(event, '${d.safeName}', ${f.is_dir}, '${d.safePath}')" style="background: none; border: none; color: inherit; cursor: pointer; padding: 5px; opacity: 0.5;">⋮</button>
        </div>
    </div>`;
}

function navigateCloud(path, view = null) {
    let targetView = view || currentCloudView;
    if ((currentCloudView === 'home' || currentCloudView === 'recent') && !view) {
        if (path.includes('.computers') || path.startsWith('.computers')) {
            targetView = 'computers';
        } else if (path.includes('.backups') || path.startsWith('.backups')) {
            targetView = 'backups';
        } else if (path.includes('.business') || path.startsWith('.business')) {
            targetView = 'business';
        } else {
            targetView = 'drive';
        }
    }
    fetchCloudFiles(path, targetView);
}

function handleCloudNavClick(el, section) {
    closeCloudInfoPanel();
    document.querySelectorAll('#cloud-sidebar-nav .cloud-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    el.classList.add('active');

    if (section === 'home') {
        fetchCloudFiles('', 'home');
    } else if (section === 'recent') {
        fetchCloudFiles('', 'recent');
    } else if (section === 'drive') {
        fetchCloudFiles('', 'drive');
    } else if (section === 'computers') {
        fetchCloudFiles('', 'computers');
    } else if (section === 'backups') {
        fetchCloudFiles('', 'backups');
    } else if (section === 'business') {
        fetchCloudFiles('', 'business');
    } else if (section === 'starred') {
        fetchCloudFiles('', 'starred');
    } else if (section === 'trash') {
        fetchCloudFiles('', 'trash');
    } else if (section === 'shared') {
        fetchCloudFiles('', 'shared');
    } else if (section === 'shared_by_me') {
        fetchCloudFiles('', 'shared_by_me');
    } else {
        renderCloudFiles([]);
    }
}

function showCloudNewMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('cloud-new-menu');
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();

    if (currentCloudView === 'computers' && currentCloudPath === '') {
        menu.innerHTML = `
            <div class="context-item" onclick="openLinkDeviceModal()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg> <span data-i18n="new_computer">${window.t_cloud('new_computer') || 'Añadir computadora'}</span>
            </div>
        `;
    } else {
        menu.innerHTML = `
            <div class="context-item" onclick="triggerNewItemAction('file')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> <span data-i18n="new_upload_file">${window.t_cloud('new_upload_file') || 'Subir archivo'}</span>
            </div>
            <div class="context-item" onclick="triggerNewItemAction('folder')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> <span data-i18n="new_upload_folder">${window.t_cloud('new_upload_folder') || 'Subir carpeta'}</span>
            </div>
            <div class="context-item" onclick="triggerNewItemAction('mkdir')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> <span data-i18n="ctx_new_folder">${window.t_cloud('ctx_new_folder') || 'Carpeta nueva'}</span>
            </div>
        `;
    }

    menu.style.display = 'block';
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 8) + 'px';

    const closeMenu = () => {
        menu.style.display = 'none';
        window.removeEventListener('click', closeMenu);
    };
    setTimeout(() => window.addEventListener('click', closeMenu), 10);
}

let _currentCloudLimitBytes = Infinity;
let _currentCloudUsedBytes = 0;

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
        const data = await _cloudJson(res);

        const usedBytes = data.used_bytes || 0;
        const limitGb = data.limit_gb !== undefined ? data.limit_gb : 5;
        const freeDisk = data.disk_free || 0;

        const limitBytes = limitGb * 1024 * 1024 * 1024;
        _currentCloudLimitBytes = limitBytes;
        _currentCloudUsedBytes = usedBytes;
        let percent = 0;
        if (limitBytes === 0) {
            // If quota is 0, don't show an aggressive 100% full bar
            percent = usedBytes > 0 ? 100 : 0;
        } else {
            percent = (usedBytes / limitBytes) * 100;
        }

        if (bar) {
            bar.style.width = Math.min(percent, 100) + '%';
            // Only show red danger color if limit is actually greater than 0 and we are near it
            bar.style.background = (percent > 90 && limitBytes > 0) ? 'var(--cpu)' : 'var(--indigo)';
        }

        if (text) {
            text.innerHTML = `
            <div class="quota-text-main" style="font-size: 0.85rem;">
                ${formatBytes(usedBytes)} ${window.t_cloud('of')} ${limitGb} GB ${window.t_cloud('used')}
            </div>
            <div class="quota-text-disk" style="font-size: 0.75rem; margin-top: 6px;">
                ${window.t_cloud('disk')}: ${formatBytes(freeDisk)} ${window.t_cloud('available')}
            </div>
        `;
        }

        const btn = document.getElementById('cloud-quota-request-btn');
        if (btn) {
            if (data.has_pending_request) {
                btn.innerHTML = window.t_cloud('cancel_quota_request', 'Cancelar petición pendiente');
                btn.style.borderColor = 'rgba(248, 113, 113, 0.3)';
                btn.style.color = 'var(--cpu)';
                btn.onclick = cancelCloudQuotaRequest;
            } else {
                btn.innerHTML = window.t_cloud('get_more_space', 'Obtener más espacio');
                btn.style.borderColor = 'var(--border)';
                btn.style.color = 'var(--text-main)';
                btn.onclick = requestMoreCloudQuota;
            }
        }
    } catch (err) {
        console.error("Error cuota cloud:", err);
    }
}

async function cancelCloudQuotaRequest() {
    if (!await NV_Confirm(window.t_cloud('cancel_quota_confirm'), window.t_cloud('cancel_quota_title'), window.t_cloud('btn_confirm'), window.t_cloud('back'))) return;
    try {
        const res = await fetch('/api/cloud/quota', {
            method: 'DELETE',
            headers: HEADERS
        });
        if (res.ok) {
            updateCloudQuotaInfo();
        }
    } catch (err) { }
}

async function requestMoreCloudQuota() {
    if (!await NV_Confirm(window.t_cloud('request_10gb_confirm'), window.t_cloud('request_space_title'), window.t_cloud('btn_confirm'), window.t_cloud('btn_cancel'))) return;
    try {
        const res = await fetch('/api/cloud/quota', {
            method: 'POST',
            headers: HEADERS
        });
        if (res.ok) {
            await NV_Alert(window.t_cloud('request_sent'));
            updateCloudQuotaInfo();
        } else {
            const errData = await _cloudJson(res);
            await NV_Alert(errData.error || 'Error.');
        }
    } catch (err) { }
}

async function fetchAdminQuotaRequests() {
    try {
        const res = await fetch('/api/cloud/admin/quota_requests', { headers: HEADERS });
        if (res.ok) {
            const data = await _cloudJson(res);
            renderAdminQuotaRequests(data.requests || []);
        }
    } catch (err) { console.error(err); }
}

async function resolveQuotaRequest(id, action) {
    try {
        const res = await fetch('/api/cloud/admin/quota_requests', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ id, action })
        });
        if (res.ok) {
            fetchAdminQuotaRequests();
        }
    } catch (err) { }
}

function renderAdminQuotaRequests(requests) {
    const container = document.getElementById('admin-quota-list');
    if (!container) return;
    if (requests.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 20px; opacity: 0.5;">${window.currentLang === 'en' ? 'No pending requests.' : 'No hay peticiones pendientes.'}</div>`;
        return;
    }

    let html = '';
    requests.forEach(r => {
        html += `
            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600;">${r.username}</div>
                    <div style="font-size: 0.8rem; opacity: 0.7;">+${r.requested_gb}GB - ${new Date(r.created_at * 1000).toLocaleString(window.currentLang)}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="resolveQuotaRequest(${r.id}, 'rejected')" style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">${window.currentLang === 'en' ? 'Reject' : 'Rechazar'}</button>
                    <button onclick="resolveQuotaRequest(${r.id}, 'approved')" style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">${window.currentLang === 'en' ? 'Approve' : 'Aprobar'}</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}


async function uploadFilesWithProgress(files, baseUploadPath, baseUploadView, isFolder = false) {
    const panel = document.getElementById('cloud-global-upload-panel');
    const title = document.getElementById('global-upload-title');
    const details = document.getElementById('global-upload-details');

    panel.style.display = 'flex';
    details.innerHTML = ''; // Clear previous items
    details.style.display = 'block';
    title.innerText = window.currentLang === "en" ? `Uploading 0 of ${files.length} items...` : `Subiendo 0 de ${files.length} elementos...`;

    let completed = 0;

    const maxConcurrent = 4;
    const maxDomRows = 50;
    let currentIndex = 0;

    const processNext = async () => {
        if (currentIndex >= files.length) return;
        const index = currentIndex++;
        const file = files[index];
        const rowId = `upload-row-${Date.now()}-${index}`;

        let uploadPath = baseUploadPath;
        if (isFolder && file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            parts.pop();
            if (parts.length > 0) {
                uploadPath = [baseUploadPath, ...parts].filter(Boolean).join('/');
            }
        }

        if (index < maxDomRows) {
            const rowHtml = `
                    <div id="${rowId}" style="padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border);">
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                            <span style="color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${esc(file.name)}</span>
                            <span id="${rowId}-pct" style="color: var(--indigo); font-weight: 600;">0%</span>
                        </div>
                        <div style="height: 4px; background: rgba(0,0,0,0.2); border-radius: 2px; overflow: hidden;">
                            <div id="${rowId}-bar" style="height: 100%; width: 0%; background: var(--indigo); transition: width 0.2s;"></div>
                        </div>
                    </div>
                `;
            details.insertAdjacentHTML('beforeend', rowHtml);
        }

        await new Promise((resolve) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('path', uploadPath);
            formData.append('view', baseUploadView);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/cloud/upload`, true);
            xhr.setRequestHeader('X-Token', HEADERS['X-Token']);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && index < maxDomRows) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    const pctEl = document.getElementById(`${rowId}-pct`);
                    const barEl = document.getElementById(`${rowId}-bar`);
                    if (pctEl) pctEl.innerText = pct + '%';
                    if (barEl) barEl.style.width = pct + '%';
                }
            };

            xhr.onload = async () => {
                let isError = xhr.status !== 200 && xhr.status !== 201;
                let errMsg = 'Error';
                let isQuotaError = false;

                if (isError) {
                    try {
                        const resJson = JSON.parse(xhr.responseText);
                        if (resJson.error) {
                            if (resJson.error.includes("Espacio insuficiente")) {
                                isQuotaError = true;
                                errMsg = window.currentLang === 'en' ? "Not enough space, request more" : "No tienes suficiente espacio, solicita más";
                            } else {
                                errMsg = resJson.error;
                            }
                        }
                    } catch (e) { }
                    console.error(`Upload error for ${file.name}:`, errMsg);

                    if (index < maxDomRows) {
                        const pctEl = document.getElementById(`${rowId}-pct`);
                        const barEl = document.getElementById(`${rowId}-bar`);
                        if (pctEl) {
                            pctEl.innerText = 'Error';
                            pctEl.style.color = '#ef4444';
                            pctEl.title = errMsg;
                        }
                        if (barEl) barEl.style.background = '#ef4444';
                    }

                    if (isQuotaError) {
                        NV_Alert(errMsg, window.currentLang === 'en' ? 'Upload Failed' : 'Error al subir');
                    }
                } else {
                    if (index < maxDomRows) {
                        const pctEl = document.getElementById(`${rowId}-pct`);
                        const barEl = document.getElementById(`${rowId}-bar`);
                        if (pctEl) {
                            pctEl.innerText = window.currentLang === 'en' ? 'Completed' : 'Completado';
                            pctEl.style.color = '#10b981';
                        }
                        if (barEl) barEl.style.background = '#10b981';
                    }
                }
                completed++;
                title.innerText = window.currentLang === "en" ? `Uploading ${completed} of ${files.length} items...` : `Subiendo ${completed} de ${files.length} elementos...`;
                if (completed === files.length) {
                    title.innerText = window.currentLang === "en" ? `Finished uploading ${files.length} items.` : `Finalizada la subida de ${files.length} elementos.`;
                    setTimeout(() => fetchCloudFiles(currentCloudPath, currentCloudView), 500);
                    updateCloudQuotaInfo();
                }
                resolve();
            };

            xhr.onerror = () => {
                if (index < maxDomRows) {
                    const pctEl = document.getElementById(`${rowId}-pct`);
                    const barEl = document.getElementById(`${rowId}-bar`);
                    if (pctEl) {
                        pctEl.innerText = 'Error';
                        pctEl.style.color = '#ef4444';
                    }
                    if (barEl) barEl.style.background = '#ef4444';
                }
                completed++;
                title.innerText = window.currentLang === "en" ? `Uploading ${completed} of ${files.length} items...` : `Subiendo ${completed} de ${files.length} elementos...`;
                if (completed === files.length) {
                    title.innerText = window.currentLang === "en" ? `Finished uploading ${files.length} items.` : `Finalizada la subida de ${files.length} elementos.`;
                    setTimeout(() => fetchCloudFiles(currentCloudPath, currentCloudView), 500);
                    updateCloudQuotaInfo();
                }
                resolve();
            };

            xhr.send(formData);
        });

        await processNext();
    };

    const workers = [];
    for (let i = 0; i < maxConcurrent; i++) {
        workers.push(processNext());
    }

    await Promise.all(workers);
}

async function handleCloudUpload(e, isFolder = false) {
    const input = e.target;
    if (!input.files || input.files.length === 0) return;

    const fileCount = input.files.length;

    if (fileCount > 2000) {
        // DO NOT iterate to calculate size, it freezes the browser for 300k+ files!
        await NV_Alert(window.currentLang === "en" ?
            `You are trying to upload a folder with ${fileCount} files. To prevent your browser from crashing, the limit is 2000 files at once. Please compress the folder into a ZIP file first.` :
            `Has intentado subir una carpeta enorme con ${fileCount} archivos. Para evitar colapsar tu navegador, el límite es de 2000 archivos a la vez. Por favor, comprímela en un archivo ZIP primero.`
        );
        input.value = '';
        return;
    }

    let totalSize = 0;
    for (let i = 0; i < fileCount; i++) {
        totalSize += input.files[i].size;
    }

    if (_currentCloudUsedBytes + totalSize > _currentCloudLimitBytes) {
        await NV_Alert(window.currentLang === "en" ? "Not enough space, request more" : "No tienes suficiente espacio, solicita más");
        input.value = '';
        return;
    }

    const files = Array.from(input.files);

    // Validar límite de 50GB por archivo
    const MAX_SIZE = 50 * 1024 * 1024 * 1024;
    const oversizedFiles = files.filter(f => f.size > MAX_SIZE);
    if (oversizedFiles.length > 0) {
        await NV_Alert(window.currentLang === "en" ? `Cannot upload "${oversizedFiles[0].name}" because it exceeds the 50GB limit per file.` : `No se puede subir "${oversizedFiles[0].name}" porque supera el límite máximo de 50GB por archivo.`);
        input.value = '';
        return;
    }

    const { targetView: baseUploadView, targetPath: baseUploadPath } = getUploadTarget();

    await uploadFilesWithProgress(files, baseUploadPath, baseUploadView, isFolder);

    uploadDestinationOverridePath = null;
    uploadDestinationOverrideView = null;
    input.value = '';
}

async function deleteCloudItem(name, path, isDir, trashId = null, fileView = null, ownerId = null) {
    try {
        if (!name && !trashId) return;

        const view = fileView || currentCloudView;
        const isPermanent = currentCloudView === 'trash';
        const isComputer = currentCloudView === 'computers' && currentCloudPath === '';

        let msg = '';
        if (view === 'shared') {
            msg = window.t_cloud('confirm_unshare', '¿Dejar de compartir') + ` "${esc(name)}"?`;
        } else if (isPermanent) {
            msg = window.t_cloud('confirm_delete_permanent', '¿Eliminar PERMANENTEMENTE') + ` "${name || 'este elemento'}"?`;
        } else if (isComputer) {
            msg = window.t_cloud('confirm_unlink', '¿Desvincular y eliminar por completo la computadora') + ` "${esc(name)}"?`;
        } else {
            const typeStr = isDir ? window.t_cloud('item_folder', 'la carpeta') : window.t_cloud('item_file', 'el archivo');
            msg = window.t_cloud('confirm_trash', '¿Mover a la papelera') + ` ${typeStr} "${esc(name)}"?`;
        }

        if (!await NV_Confirm(msg, window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;

        let res;
        if (view === 'shared') {
            res = await fetch('/api/cloud/unshare', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ name, path, owner_id: ownerId })
            });
        } else {
            res = await fetch('/api/cloud/delete', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ name, path, view: currentCloudView === 'trash' ? 'trash' : view, id: trashId })
            });
        }

        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        } else {
            const data = await _cloudJson(res);
            await NV_Alert(data.error || window.currentLang === "en" ? "Error processing request." : "Error al procesar la solicitud.");
        }
    } catch (err) {
        console.error("Error en deleteCloudItem:", err);
        await NV_Alert(window.currentLang === "en" ? "An unexpected error occurred while deleting. Check console." : "Ocurrió un error inesperado al intentar eliminar. Revisa la consola.");
    }
}

async function handleUnshareItem(item) {
    // Si no se pasa un item por parámetro, usamos el del contexto global
    const targetItem = item || currentCloudContextItem;
    if (!targetItem) return;

    const { name, path, ownerId } = targetItem;

    if (currentCloudView === 'shared') {
        // CASO A: Estás en "Compartidos conmigo". La acción es ocultar/ignorar el archivo que te compartieron.
        if (!await NV_Confirm(window.t_cloud('confirm_ignore', '¿Seguro que deseas ignorar') + ` "${esc(name)}"?`, window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;
        try {
            const res = await fetch('/api/cloud/unshare', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({
                    name: name,
                    path: path || '',
                    owner_id: ownerId || null
                })
            });
            if (res.ok) {
                fetchCloudFiles(currentCloudPath, currentCloudView);
                closeCloudInfoPanel();
            } else {
                const data = await _cloudJson(res);
                await NV_Alert(data.error || window.currentLang === "en" ? "Error ignoring item." : "Error al ignorar el elemento.");
            }
        } catch (e) {
            console.error("Error ignoring shared item:", e);
            await NV_Alert(window.currentLang === "en" ? "Network error trying to ignore item." : "Error de red al intentar ignorar el elemento.");
        }
    } else if (currentCloudView === 'shared_by_me') {
        // CASO B: Estás en "Compartidos" (por ti). Quieres gestionar quién tiene acceso para quitar a alguien.
        openCloudShare(name, path);
    } else {
        // CASO C: Menú contextual común desde tu unidad si el archivo es compartido por ti
        // Abre el modal para revocar usuarios directamente
        openCloudShare(name, path);
    }
}

async function renameCloudItem(oldName, path, fileView = null, isDir = false) {
    const panel = document.getElementById('cloud-info-panel');
    const body = document.getElementById('info-panel-body');
    const title = document.getElementById('info-title');
    const icon = document.getElementById('info-icon');

    panel.style.display = 'flex';
    title.textContent = window.t_cloud('ctx_rename', 'Cambiar nombre');
    const ext = oldName.split('.').pop().toLowerCase();
    icon.innerHTML = isDir ? getFolderIcon() : getFileIcon('.' + ext);

    document.querySelectorAll('.info-tab').forEach(t => t.style.visibility = 'hidden');

    body.innerHTML = `
        <div style="padding: 12px; display: flex; flex-direction: column; gap: 12px;">
            <div style="text-align: center; padding: 8px 0;">
                <span style="font-size: 2rem; opacity: 0.6;">${isDir ? getFolderIcon() : getFileIcon('.' + ext)}</span>
            </div>
            <div>
                <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: block;">${window.t_cloud('rename_new_name', 'Nuevo nombre')}</label>
                <input type="text" id="rename-inline-input" value="${escAttr(oldName)}" 
                    style="width: 100%; box-sizing: border-box; background: var(--surface, #303134); border: 2px solid var(--indigo, #8ab4f8); border-radius: 6px; padding: 10px 12px; color: var(--text-main); font-size: 0.95rem; outline: none; transition: border-color 0.2s;" />
                <div id="rename-inline-error" style="font-size: 0.8rem; color: #f87171; margin-top: 8px; min-height: 1.2em;"></div>
            </div>
            ${!isDir ? `<div style="font-size: 0.8rem; color: var(--text-muted); background: rgba(255,255,255,0.03); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border);">
                <span style="font-weight: 600;">${window.t_cloud('rename_format', 'Formato')}:</span> ${ext.toUpperCase()}
            </div>` : ''}
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;">
                <button id="rename-inline-cancel" style="background: transparent; border: 1px solid var(--border); color: var(--text-muted); font-size: 0.85rem; font-weight: 600; padding: 8px 20px; border-radius: 6px; cursor: pointer; transition: all 0.15s;">${window.t_cloud('btn_cancel', 'Cancelar')}</button>
                <button id="rename-inline-confirm" style="background: var(--indigo, #8ab4f8); border: none; color: #fff; font-size: 0.85rem; font-weight: 700; padding: 8px 24px; border-radius: 6px; cursor: pointer; transition: all 0.15s;">${window.t_cloud('btn_confirm', 'Aceptar')}</button>
            </div>
        </div>
    `;

    const input = document.getElementById('rename-inline-input');
    const errorEl = document.getElementById('rename-inline-error');
    const confirmBtn = document.getElementById('rename-inline-confirm');
    const cancelBtn = document.getElementById('rename-inline-cancel');
    setTimeout(() => {
        input.focus();
        if (!isDir && oldName.includes('.')) {
            input.setSelectionRange(0, oldName.lastIndexOf('.'));
        } else {
            input.select();
        }
    }, 50);

    function validateName(name) {
        const cleaned = name.trim();
        if (cleaned === '') return window.t_cloud('rename_err_empty', 'El nombre no puede estar vacío.');
        const invalidChars = /[<>:"\/\\|?*]/;
        if (invalidChars.test(cleaned)) return window.t_cloud('rename_err_invalid', 'Contiene caracteres no permitidos (< > : " / \\ | ? *)');
        if (cleaned.startsWith('.')) return window.t_cloud('rename_err_dot', 'No puede empezar por punto.');
        if (cleaned.length > 150) return window.t_cloud('rename_err_long', window.currentLang === 'en' ? 'The name is too long (max 150 characters).' : 'El nombre es demasiado largo (máximo 150 caracteres).');
        if (sanitizeName(cleaned, 150) !== cleaned) return window.t_cloud('rename_err_chars', window.currentLang === 'en' ? 'The name contains invalid characters.' : 'El nombre contiene caracteres no válidos.');
        const existing = Array.from(document.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card')).find(row => row.getAttribute('data-name') === cleaned);
        if (existing && cleaned !== oldName) return window.t_cloud('rename_err_exists', 'Ya existe un elemento con ese nombre.');
        return null;
    }

    input.addEventListener('input', () => {
        const err = validateName(input.value);
        errorEl.textContent = err || '';
        confirmBtn.style.opacity = err ? '0.5' : '1';
        confirmBtn.disabled = !!err;
    });

    async function doRename() {
        const newName = input.value.trim();
        const err = validateName(input.value);
        if (err) { errorEl.textContent = err; return; }
        if (newName === oldName) { closeRenamePanel(); return; }

        if (!isDir && oldName.includes('.')) {
            const oldExt = oldName.split('.').pop();
            const newExt = newName.split('.').pop();
            if (!newName.includes('.')) {
                if (!await NV_Confirm(window.t_cloud('rename_warn_ext_lost', 'El archivo perderá su extensión. ¿Estás seguro?'), window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;
            } else if (oldExt !== newExt) {
                if (!await NV_Confirm(window.t_cloud('rename_warn_ext_change', 'La extensión cambiará') + ` de .${esc(oldExt)} a .${esc(newExt)}. ` + window.t_cloud('are_you_sure', '¿Estás seguro?'), window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;
            }
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Guardando...';
        const viewToUse = fileView || currentCloudView;
        try {
            const res = await fetch('/api/cloud/rename', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ old_name: oldName, new_name: newName, path: path, view: viewToUse })
            });
            if (res.ok) {
                fetchCloudFiles(currentCloudPath, currentCloudView);
                closeRenamePanel();
            } else {
                const data = await _cloudJson(res);
                errorEl.textContent = data.error || 'Error al renombrar.';
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Aceptar';
            }
        } catch (err) {
            errorEl.textContent = window.t('conn_error') + '.';
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Aceptar';
        }
    }

    function closeRenamePanel() {
        document.querySelectorAll('.info-tab').forEach(t => t.style.visibility = 'visible');
        closeCloudInfoPanel();
    }

    confirmBtn.onclick = doRename;
    cancelBtn.onclick = closeRenamePanel;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doRename(); }
        if (e.key === 'Escape') { closeRenamePanel(); }
    });
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
            const data = await _cloudJson(res);
            await NV_Alert(data.error || window.currentLang === "en" ? "Error restoring." : "Error al restaurar.");
        }
    } catch (err) { }
}

async function emptyCloudTrash() {
    if (!await NV_Confirm(window.t_cloud('confirm_empty_trash', '¿Seguro que quieres vaciar la papelera? Esta acción no se puede deshacer.'), window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;
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

async function toggleCloudProtect(name, path, fileView = null) {
    try {
        const view = fileView || currentCloudView;
        const res = await fetch('/api/cloud/toggle_protect', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: view })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        } else {
            const data = await _cloudJson(res);
            if (data.error === 'protected_ancestor') {
                await NV_Alert(window.t_cloud('cloud_protect_ancestor', window.currentLang === 'en' ? 'You cannot unlock this item: it is inside the protected folder "{0}". Unprotect that folder first.' : 'No puedes desbloquear este elemento: está dentro de la carpeta «{0}», que está protegida. Desprotege primero esa carpeta.').replace('{0}', esc(data.ancestor_name || '')));
                return;
            }
            await NV_Alert(data.error || (window.currentLang === "en" ? "Cannot change the protection of this item." : "No se puede cambiar el estado de protección de este elemento."));
        }
    } catch (err) {
        await NV_Alert(window.currentLang === "en" ? "Error changing protection state." : "Error al cambiar estado de protección.");
    }
}

async function toggleCloudStar(name, path, fileView = null, ownerId = null) {
    try {
        const view = fileView || currentCloudView;
        const res = await fetch('/api/cloud/toggle_star', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: view, owner_id: ownerId })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
        }
    } catch (err) {
        await NV_Alert(window.currentLang === "en" ? "Error changing starred state." : "Error al cambiar estado de destacado.");
    }
}

async function handleCreateFolder() {
    if (_currentCloudUsedBytes >= _currentCloudLimitBytes) {
        await NV_Alert(window.currentLang === "en" ? "Not enough space, request more" : "No tienes suficiente espacio, solicita más");
        return;
    }
    const name = await NV_Prompt('', '', window.t_cloud('ctx_new_folder', 'Carpeta nueva'), window.t_cloud('btn_confirm', 'Aceptar'), window.t_cloud('btn_cancel', 'Cancelar'));
    if (name === null) return;
    if (name.trim() === "") {
        await NV_Alert(window.currentLang === "en" ? "Folder name cannot be empty." : "El nombre de la carpeta no puede estar vacío.");
        return;
    }
    const trimmedName = name.trim();

    const invalidChars = /[<>:"\/\\|?*]/;
    if (invalidChars.test(trimmedName)) {
        await NV_Alert(window.currentLang === 'en' ? 'Name contains invalid characters (< > : \" / \ | ? *)' : 'El nombre contiene caracteres no permitidos (< > : \" / \ | ? *)');
        return;
    }
    if (trimmedName.startsWith('.')) {
        await NV_Alert(window.currentLang === "en" ? "Name cannot start with a dot." : "El nombre no puede empezar por punto.");
        return;
    }
    if (trimmedName.length > 150) {
        await NV_Alert(window.currentLang === "en" ? "The name is too long (max 150 characters)." : "El nombre es demasiado largo (máximo 150 caracteres).");
        return;
    }
    if (sanitizeName(trimmedName, 150) !== trimmedName) {
        await NV_Alert(window.currentLang === "en" ? "The folder name contains invalid characters. Only letters, numbers, spaces and -_().,[]{}@+#%&~!= are allowed." : "El nombre de la carpeta contiene caracteres no válidos. Solo se permiten letras, números, espacios y -_().,[]{}@+#%&~!=");
        return;
    }
    const existing = Array.from(document.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card')).find(row => row.getAttribute('data-name') === trimmedName);
    if (existing) {
        await NV_Alert(window.currentLang === "en" ? "A file or folder with that name already exists." : "Ya existe una carpeta o archivo con ese nombre.");
        return;
    }

    const { targetView, targetPath } = getUploadTarget();

    uploadDestinationOverridePath = null;
    uploadDestinationOverrideView = null;

    try {
        const res = await fetch('/api/cloud/mkdir', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name: trimmedName, path: targetPath, view: targetView })
        });
        const data = await _cloudJson(res);
        if (data.error) {
            await NV_Alert("Error: " + data.error);
            return;
        }

        fetchCloudFiles(targetPath, targetView);
        closeCloudInfoPanel();
    } catch (err) {
        await NV_Alert(window.currentLang === "en" ? "Connection error creating folder." : "Error de conexión al crear carpeta.");
    }
}

async function refreshRecentActivity() {
    if (currentCloudView !== 'recent') return;
    const queryVal = document.getElementById('cloud-search')?.value.toLowerCase() || '';
    if (queryVal || SELECTED_CLOUD_ITEMS.length > 0) return;
    try {
        const res = await fetch('/api/cloud/recent', { headers: HEADERS, credentials: 'include' });
        if (res.ok) {
            const data = await _cloudJson(res);
            CLOUD_FILES = data.files || [];
            renderCloudFiles(CLOUD_FILES, true);
        }
    } catch (e) {
        console.error("[Cloud] Error refrescando actividad reciente:", e);
    }
}

async function downloadCloudFile(name, overridePath = null, forceDownload = false, ownerId = null, fileView = null, trashId = null, ownerName = null, isShared = false) {
    try {
        const path = overridePath !== null ? overridePath : currentCloudPath;
        const view = trashId ? 'trash' : (fileView || currentCloudView);
        const ext = name.split('.').pop().toLowerCase();
        const previewExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'txt', 'md', 'json', 'mp4', 'webm', 'mov', 'svg'];
        const willPreview = !forceDownload && previewExts.includes(ext);
        const res = await fetch('/api/cloud/get_token', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: view, owner_id: ownerId, id: trashId, preview: willPreview })
        });
        const data = await _cloudJson(res);
        if (res.status === 401 || (data.error && String(data.error).toLowerCase().includes('no autorizado'))) {
            await NV_Alert(window.currentLang === 'en' ? 'Session expired. Please log in again.' : 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
            window.location.href = '/login';
            return;
        }

        if (!data.t) {
            if (data.error === 'access_revoked') {
                closeCloudPreview();
                await NV_Alert(window.t_cloud('access_revoked', 'Te han quitado el acceso a este archivo.'));
                loadCloudFiles();
            } else {
                await NV_Alert(data.error || window.t_cloud('err_token', 'Error al generar token de acceso.'));
            }
            return;
        }

        const url = `/api/cloud/download?t=${data.t}`;

        if (willPreview) {
            openCloudPreview(name, url, path, ownerId, fileView, ownerName, isShared);
        } else {
            const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const downloadUrl = url + (forceDownload ? '&dl=1' : '');
            if (isMobile) {
                window.location.href = downloadUrl;
            } else {
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
        refreshRecentActivity();
    } catch (err) {
        console.error('[Cloud] Error generando token de acceso:', err);
        await NV_Alert(window.t_cloud('err_token_fetch', 'Error al acceder al archivo. Si el problema persiste, recarga la página.'));
    }
}

window.openPdfBlob = async function (url) {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
        newWindow.document.write('<html style="background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100%;font-family:sans-serif;"><body>Cargando documento... / Loading document...</body></html>');
        newWindow.document.close();
    }
    try {
        const res = await fetch(url, { headers: window.HEADERS || {} });
        if (!res.ok) throw new Error('Fetch failed');
        const blob = await res.blob();
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(pdfBlob);
        if (newWindow) {
            newWindow.location.href = blobUrl;
        } else {
            window.open(blobUrl, '_blank');
        }
    } catch (e) {
        if (newWindow) newWindow.location.href = url;
        else window.open(url, '_blank');
    }
};

// Cola de previsualización múltiple: cuando hay varios documentos abiertos en
// el visor, las pestañas y las flechas navegan sobre esta lista.
let _previewQueue = [];
let _previewIndex = 0;

// Contador para cancelar cambios de calidad obsoletos: si el usuario pulsa
// 360p y luego 720p, el polling del 360p debe morir (no escribir la etiqueta
// ni aplicar su src después del nuevo cambio).
let _videoQualReqId = 0;

// Orden de calidades para el menú dinámico del reproductor (solo se muestran
// las versiones ya generadas en el caché + las que se están transcodificando).
const VIDEO_QUALITY_ORDER = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
let _previewVideoToken = '';

const PREVIEW_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'txt', 'md', 'json', 'mp4', 'webm', 'mov'];

function openCloudPreview(name, url, path, ownerId = null, fileView = null, ownerName = null, isShared = false) {
    const modal = document.getElementById('cloud-preview-modal');
    const nameEl = document.getElementById('preview-filename');
    const dlBtn = document.getElementById('preview-download-btn');
    const ext = name.split('.').pop().toLowerCase();

    // Show owner info
    const ownerLine = document.getElementById('preview-owner');
    if (ownerLine) {
        let actualOwner = ownerName || currentCloudContextItem?.owner;
        if (actualOwner && actualOwner !== 'Yo' && actualOwner !== window.t_cloud('me', 'Yo') && actualOwner !== window.CURRENT_USER) {
            ownerLine.textContent = window.t_cloud('shared', 'Compartido') + ' ' + window.t_cloud('by_lower', 'por') + ' ' + actualOwner;
            ownerLine.style.color = 'var(--indigo)';
        } else {
            ownerLine.textContent = window.t_cloud('nav_drive', 'Mi unidad');
            ownerLine.style.color = 'var(--text-muted)';
        }
        ownerLine.style.display = 'block';
    }

    nameEl.innerText = name;
    dlBtn.onclick = () => downloadCloudFile(name, path, true, ownerId, fileView);

    _previewQueue = [{ name, url, path, ownerId, fileView, ownerName, isShared, ext }];
    _previewIndex = 0;

    _renderCloudPreviewBody(ext, url, name, (path ? path + '/' : '') + name);
    _renderPreviewTabs();

    modal.style.display = 'flex';
}

// Visor de previsualización múltiple: pestañas + flechas (y teclado ←/→)
// para saltar entre los documentos seleccionados sin cerrar el modal.
window.openCloudMultiPreview = async function () {
    const items = SELECTED_CLOUD_ITEMS.filter(it =>
        !it.isDir && PREVIEW_EXTS.includes((it.name || '').split('.').pop().toLowerCase()));
    const skipped = SELECTED_CLOUD_ITEMS.length - items.length;

    if (items.length === 0) {
        await NV_Alert(window.t_cloud('preview_none', 'Ninguno de los elementos seleccionados se puede previsualizar.'));
        return;
    }

    const queue = [];
    for (const it of items) {
        try {
            const path = it.path !== undefined && it.path !== null ? it.path : currentCloudPath;
            const view = it.fileView || currentCloudView;
            const res = await fetch('/api/cloud/get_token', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ name: it.name, path, view, owner_id: it.ownerId || null })
            });
            const data = await _cloudJson(res);
            if (!data.t) {
                if (data.error === 'access_revoked') {
                    await NV_Alert(window.t_cloud('access_revoked', 'Te han quitado el acceso a un archivo.'));
                }
                continue;
            }
            queue.push({
                name: it.name,
                path,
                url: `/api/cloud/download?t=${data.t}`,
                ownerId: it.ownerId || null,
                fileView: view,
                ownerName: it.ownerName || null,
                isShared: !!it.isShared,
                ext: it.name.split('.').pop().toLowerCase()
            });
        } catch (err) {
            console.error('[Cloud] Error generando token de preview:', err);
        }
    }

    if (queue.length === 0) {
        await NV_Alert(window.t_cloud('preview_none', 'Ninguno de los elementos seleccionados se puede previsualizar.'));
        return;
    }

    _previewQueue = queue;
    _previewIndex = 0;

    const note = document.getElementById('preview-filtered-note');
    if (note) {
        if (skipped > 0) {
            note.style.display = 'block';
            note.textContent = window.t_cloud('preview_skipped', 'Se omitieron {0} elemento(s) no compatibles con la vista previa.').replace('{0}', skipped);
        } else {
            note.style.display = 'none';
            note.textContent = '';
        }
    }

    renderCloudPreviewItem(0);
    document.getElementById('cloud-preview-modal').style.display = 'flex';
};

function renderCloudPreviewItem(index) {
    if (!_previewQueue.length) return;
    index = ((index % _previewQueue.length) + _previewQueue.length) % _previewQueue.length;
    _previewIndex = index;
    const item = _previewQueue[index];

    const nameEl = document.getElementById('preview-filename');
    const dlBtn = document.getElementById('preview-download-btn');
    const ownerLine = document.getElementById('preview-owner');
    if (nameEl) nameEl.innerText = item.name;
    if (dlBtn) dlBtn.onclick = () => downloadCloudFile(item.name, item.path, true, item.ownerId, item.fileView);

    if (ownerLine) {
        if (item.ownerId && item.ownerId !== window.CURRENT_USER_ID) {
            ownerLine.textContent = window.t_cloud('shared', 'Compartido');
            ownerLine.style.color = 'var(--indigo)';
        } else {
            ownerLine.textContent = window.t_cloud('nav_drive', 'Mi unidad');
            ownerLine.style.color = 'var(--text-muted)';
        }
        ownerLine.style.display = 'block';
    }

    _renderCloudPreviewBody(item.ext, item.url, item.name, (item.path ? item.path + '/' : '') + item.name);
    _renderPreviewTabs();

    const nav = document.getElementById('preview-nav');
    const pos = document.getElementById('preview-position');
    if (nav && pos) {
        if (_previewQueue.length > 1) {
            nav.style.display = 'flex';
            pos.innerText = `${index + 1} / ${_previewQueue.length}`;
        } else {
            nav.style.display = 'none';
        }
    }
}

window._previewNav = function (dir) {
    renderCloudPreviewItem(_previewIndex + dir);
};

window._previewGo = function (index) {
    renderCloudPreviewItem(index);
};

function _renderPreviewTabs() {
    const tabsEl = document.getElementById('preview-tabs');
    if (!tabsEl) return;
    if (_previewQueue.length <= 1) {
        tabsEl.style.display = 'none';
        tabsEl.innerHTML = '';
        return;
    }
    tabsEl.style.display = 'flex';
    tabsEl.innerHTML = _previewQueue.map((item, idx) => {
        const active = idx === _previewIndex;
        return `<button onclick="window._previewGo(${idx})"
            style="flex-shrink: 0; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.78rem; font-weight: 600; white-space: nowrap; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px;
            ${active
                ? 'background: var(--indigo); color: #fff; border: 1px solid var(--indigo);'
                : 'background: var(--surface-hi); color: var(--text-secondary); border: 1px solid var(--border);'}">
            <span style="display: inline-flex; align-items: center; font-size: 1.15em;">${getFileIcon('.' + item.ext)}</span>
            ${item.name.length > 28 ? item.name.slice(0, 26) + '…' : item.name}
        </button>`;
    }).join('');
}

function _renderCloudPreviewBody(ext, url, name, fileKey) {
    const body = document.getElementById('preview-body');

    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        body.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 75vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">`;
    } else if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
        const token = new URLSearchParams(url.split('?')[1] || '').get('t') || '';
        const streamUrl = token ? `/api/cloud/stream_video?t=${token}&quality=original` : url;
        body.innerHTML = `
        <div style="position: relative; display: inline-block; width: min(80vw, 880px); max-width: 100%; max-height: 75vh; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); background: #000;">
            <video id="preview-video-player" controls autoplay style="width: 100%; height: auto; max-height: 75vh; border-radius: 8px; display: block; background: #000;">
                <source src="${streamUrl}" type="video/${ext === 'mov' ? 'quicktime' : ext}">
                ${window.t_cloud('video_not_supported', 'Tu navegador no soporta la reproducción de video.')}
            </video>
            <div style="position: absolute; top: 12px; right: 12px; z-index: 10;">
                <div style="position: relative; display: inline-block;">
                    <button type="button" onclick="window.toggleVideoQualityMenu(event)" style="background: rgba(0, 0, 0, 0.65); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; border-radius: 8px; padding: 6px 10px; font-size: 0.78rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; backdrop-filter: blur(8px);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        <span id="video-quality-label">Original</span>
                    </button>
                    <div id="video-quality-menu" style="display: none; position: absolute; right: 0; top: 36px; background: rgba(18, 18, 26, 0.95); border: 1px solid var(--border); border-radius: 10px; padding: 6px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); min-width: 170px; max-height: 280px; overflow-y: auto; z-index: 100; backdrop-filter: blur(12px);">
                    </div>
                </div>
            </div>
        </div>`;
        if (token) {
            _previewVideoToken = token;
            _previewVideoKey = fileKey || '';
            _renderVideoQualityMenu(token);
        }
        // Posición de reproducción: restaurar donde se dejó y guardar avance.
        _initVideoProgressTracking(fileKey || '');
    } else if (ext === 'pdf') {
        const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            body.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height: 50vh; text-align: center; color: var(--text-muted);">
                <div style="font-size: 4rem; margin-bottom: 20px; color: #f87171;">${getFileIcon('.pdf')}</div>
                <h3 style="color: var(--text-main); margin-bottom: 10px; font-size: 1.2rem;">${window.t_cloud('mobile_preview_title', 'Visualización en Móvil')}</h3>
                <p style="font-size: 0.95rem; max-width: 85%; line-height: 1.5; color: var(--text-muted);">${window.t_cloud('mobile_pdf_desc', 'Descarga este archivo si quieres usarlo o visualizarlo.')}</p>
            </div>`;
        } else {
            body.innerHTML = `<iframe src="${url}" style="width: 80vw; height: 75vh; border: none; border-radius: 8px;"></iframe>`;
        }
    } else {
        body.innerHTML = `<iframe src="${url}" style="width: 80vw; height: 75vh; border: none; background: #fff; border-radius: 8px;"></iframe>`;
    }
}

// ---------------------------------------------------------------------------
// Posición de reproducción de vídeo: se guarda en localStorage por ruta de
// archivo y se restaura al volver a abrir el mismo vídeo (o al cambiar de
// calidad se conserva el instante actual).
// ---------------------------------------------------------------------------
const _VIDEO_PROGRESS_KEY = 'nv_video_progress_v1';
let _previewVideoKey = '';

function _getSavedVideoTime(fileKey) {
    if (!fileKey) return 0;
    try {
        const map = JSON.parse(localStorage.getItem(_VIDEO_PROGRESS_KEY)) || {};
        const t = parseFloat(map[fileKey]);
        return isFinite(t) && t > 5 ? t : 0;
    } catch (e) {
        return 0;
    }
}

function _saveVideoTime(fileKey, t) {
    if (!fileKey || !isFinite(t) || t < 5) return;
    try {
        const map = JSON.parse(localStorage.getItem(_VIDEO_PROGRESS_KEY)) || {};
        map[fileKey] = Math.round(t);
        const keys = Object.keys(map);
        if (keys.length > 500) {
            // Acotar: conservar las 300 entradas con reproducción más reciente.
            keys.sort((a, b) => (map[b] || 0) - (map[a] || 0));
            keys.slice(300).forEach(k => delete map[k]);
        }
        localStorage.setItem(_VIDEO_PROGRESS_KEY, JSON.stringify(map));
    } catch (e) { /* noop */ }
}

function _initVideoProgressTracking(fileKey, restore) {
    const video = document.getElementById('preview-video-player');
    if (!video) return;
    let lastSaved = 0;

    // restore=false cuando se re-enlaza tras un cambio de calidad: la posición
    // ya se aplicó manualmente en el nuevo elemento y no debe re-buscarse.
    if (restore !== false) {
        const saved = _getSavedVideoTime(fileKey);
        if (saved) {
            video.addEventListener('loadedmetadata', function h() {
                try {
                    if (saved < video.duration - 15) video.currentTime = saved;
                } catch (e) { /* noop */ }
                video.removeEventListener('loadedmetadata', h);
            }, { once: true });
        }
    }
    video.addEventListener('timeupdate', () => {
        if (!video.duration || video.seeking) return;
        if (video.currentTime - lastSaved >= 10) {
            lastSaved = video.currentTime;
            _saveVideoTime(fileKey, video.currentTime);
        }
    });
    video.addEventListener('pause', () => _saveVideoTime(fileKey, video.currentTime));
    video.addEventListener('ended', () => {
        try {
            const map = JSON.parse(localStorage.getItem(_VIDEO_PROGRESS_KEY)) || {};
            delete map[fileKey];
            localStorage.setItem(_VIDEO_PROGRESS_KEY, JSON.stringify(map));
        } catch (e) { /* noop */ }
    });
}

function closeCloudPreview() {
    // Guardar la posición antes de destruir el reproductor.
    const video = document.getElementById('preview-video-player');
    if (video && video.currentTime) {
        _saveVideoTime(_previewVideoKey, video.currentTime);
    }
    document.getElementById('cloud-preview-modal').style.display = 'none';
    document.getElementById('preview-body').innerHTML = '';
    _previewQueue = [];
    _previewIndex = 0;
    _previewVideoKey = '';
    const tabsEl = document.getElementById('preview-tabs');
    if (tabsEl) {
        tabsEl.style.display = 'none';
        tabsEl.innerHTML = '';
    }
    const nav = document.getElementById('preview-nav');
    if (nav) nav.style.display = 'none';
    const note = document.getElementById('preview-filtered-note');
    if (note) {
        note.style.display = 'none';
        note.textContent = '';
    }
}

function setCloudDeleteVisible(visible) {
    const btn = document.getElementById('ctx-delete-btn');
    const sep = document.getElementById('ctx-sep-item');
    if (btn) btn.style.display = visible ? 'block' : 'none';
    if (sep) sep.style.display = visible ? 'block' : 'none';
}

function handleCloudAction(e, name, isDir, overridePath = null) {
    e.stopPropagation();
    e.preventDefault();

    let trashId = null;
    let ownerId = null;
    let isMine = true;
    let isStarred = false;
    let isProtected = false;

    // Mapeo seguro del dataset de la fila
    const targetEl = e.currentTarget || e.target;
    if (targetEl) {
        const row = targetEl.closest('.cloud-folder-row, .cloud-file-card, .cloud-file-row');
        if (row) {
            trashId = row.getAttribute('data-trash-id') || null;
            ownerId = row.getAttribute('data-owner-id') || null;
            isMine = row.getAttribute('data-is-mine') !== 'false';
            isStarred = row.getAttribute('data-starred') === 'true';
            isProtected = row.getAttribute('data-protected') === 'true';
        }
    }

    currentCloudContextItem = {
        name: name,
        isDir: isDir,
        path: overridePath !== null ? overridePath : currentCloudPath,
        view: currentCloudView,
        trashId: trashId,
        ownerId: ownerId,
        protected: isProtected === true
    };

    if ((currentCloudView === 'home' || currentCloudView === 'recent') && currentCloudContextItem.path.includes('.computers')) {
        currentCloudContextItem.view = 'computers';
    }

    const menu = document.getElementById('cloud-context-menu');
    const itemActions = document.getElementById('ctx-item-actions');
    const creationActions = document.getElementById('ctx-creation-actions');

    // RAMA C: Tarjeta de dispositivo/computadora vinculada.
    // Menú aislado del menú contextual genérico de archivos: únicamente "Información" y "Desvincular" (destructivo).
    const isComputerCard = currentCloudView === 'computers' && currentCloudPath === '';
    if (isComputerCard) {
        const hiddenBtns = ['ctx-download-btn', 'ctx-rename-btn', 'ctx-share-btn', 'ctx-unshare-btn', 'ctx-organize-btn', 'ctx-star-btn', 'ctx-move-btn', 'ctx-copy-btn', 'ctx-zip-btn', 'ctx-unzip-btn', 'ctx-protect-btn', 'ctx-restore-btn', 'ctx-empty-trash-btn'];
        hiddenBtns.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const tokenBtn = document.getElementById('ctx-token-btn');
        if (tokenBtn) tokenBtn.style.display = 'block';

        document.getElementById('ctx-info-btn').style.display = 'block';

        const deleteBtn = document.getElementById('ctx-delete-btn');
        setCloudDeleteVisible(true);
        deleteBtn.style.color = '#f87171';
        const deleteText = document.getElementById('ctx-delete-text');
        if (deleteText) {
            deleteText.setAttribute('data-i18n', 'btn_unlink');
            deleteText.innerText = window.t_cloud('btn_unlink', 'Desvincular');
        }
    } else if (currentCloudView === 'shared' || currentCloudView === 'shared_by_me') {
        document.getElementById('ctx-download-btn').style.display = 'block';

        // Forzamos la traducción por si acaso
        const downloadBtn = document.getElementById('ctx-download-btn');
        if (downloadBtn && downloadBtn.children[1]) {
            downloadBtn.setAttribute('data-i18n', 'ctx_download');
            downloadBtn.children[1].innerText = window.t_cloud('ctx_download', 'Descargar');
        }

        document.getElementById('ctx-info-btn').style.display = 'block';
        document.getElementById('ctx-unshare-btn').style.display = 'block';

        const unshareText = document.getElementById('ctx-unshare-text');
        if (unshareText) {
            if (currentCloudView === 'shared') {
                unshareText.setAttribute('data-i18n', 'ctx_ignore');
                unshareText.innerText = window.t_cloud('ctx_ignore', 'Ignorar');
            } else {
                unshareText.setAttribute('data-i18n', 'ctx_unshare');
                unshareText.innerText = window.t_cloud('ctx_unshare', 'Dejar de compartir');
            }
        }

        // Ocultación total de herramientas de propietario comunes
        document.getElementById('ctx-rename-btn').style.display = 'none';
        setCloudDeleteVisible(false);
        document.getElementById('ctx-share-btn').style.display = 'none';
        document.getElementById('ctx-protect-btn').style.display = 'none';
        document.getElementById('ctx-restore-btn').style.display = 'none';
        document.getElementById('ctx-move-btn').style.display = 'none';

        // Permitimos organizar (star, copy)
        document.getElementById('ctx-organize-btn').style.display = 'block';
        document.getElementById('ctx-star-btn').style.display = 'block';
        document.getElementById('ctx-copy-btn').style.display = 'block';

        const starText = document.getElementById('ctx-star-text');
        if (starText) {
            starText.setAttribute('data-i18n', isStarred ? 'ctx_unstar' : 'ctx_star');
            starText.innerText = isStarred ? window.t_cloud('ctx_unstar', 'Quitar de destacados') : window.t_cloud('ctx_star', 'Destacar');
        }
    } else {
        // RAMA B: Vistas estándar (Mi unidad, Computadoras, Trash...)
        document.getElementById('ctx-download-btn').style.display = currentCloudView === 'trash' ? 'none' : 'block';
        document.getElementById('ctx-info-btn').style.display = 'block';
        document.getElementById('ctx-organize-btn').style.display = currentCloudView === 'trash' ? 'none' : 'block';
        document.getElementById('ctx-copy-btn').style.display = currentCloudView === 'trash' ? 'none' : 'block';

        // Gestión de visibilidad según propiedad y contexto
        document.getElementById('ctx-rename-btn').style.display = (currentCloudView === 'shared_by_me' || !isMine || isProtected) ? 'none' : 'block';
        setCloudDeleteVisible(currentCloudView !== 'shared_by_me' && isMine && !isProtected);
        document.getElementById('ctx-delete-text').innerText = currentCloudView === 'computers' && currentCloudPath === '' ? window.t_cloud('btn_unlink', 'Desvincular') : window.t_cloud('ctx_trash', 'Mover a la papelera');
        document.getElementById('ctx-share-btn').style.display = (!isMine) ? 'none' : 'block';
        document.getElementById('ctx-restore-btn').style.display = currentCloudView === 'trash' ? 'block' : 'none';

        const unshareBtn = document.getElementById('ctx-unshare-btn');
        if (unshareBtn) unshareBtn.style.display = 'none';

        // Destacados dinámicos
        document.getElementById('ctx-star-btn').style.display = currentCloudView === 'trash' ? 'none' : 'block';
        const starText = document.getElementById('ctx-star-text');
        if (starText) {
            starText.setAttribute('data-i18n', isStarred ? 'ctx_unstar' : 'ctx_star');
            starText.innerText = isStarred ? window.t_cloud('ctx_unstar', 'Quitar de destacados') : window.t_cloud('ctx_star', 'Destacar');
        }

        // Protección dinámicos
        document.getElementById('ctx-protect-btn').style.display = (currentCloudView === 'shared_by_me' || !isMine || currentCloudView === 'trash') ? 'none' : 'block';
        const protectText = document.getElementById('ctx-protect-text');
        const protectIcon = document.getElementById('ctx-protect-icon');
        if (protectText) {
            protectText.setAttribute('data-i18n', isProtected ? 'ctx_unprotect' : 'ctx_protect');
            protectText.innerText = isProtected ? window.t_cloud('ctx_unprotect', 'Desproteger') : window.t_cloud('ctx_protect', 'Bloquear eliminación');
        }
        if (protectIcon) protectIcon.innerHTML = protectSvgIcon(!isProtected);

        // Movimientos
        document.getElementById('ctx-move-btn').style.display = (currentCloudView === 'shared_by_me' || !isMine || currentCloudView === 'trash' || isProtected) ? 'none' : 'block';
    }

    // Despliegue del panel del menú
    itemActions.style.display = 'block';
    creationActions.style.display = 'none';
    menu.style.display = 'block';

    // Cálculo geométrico de la pantalla
    const rect = menu.getBoundingClientRect();
    const menuWidth = rect.width || 200;
    const menuHeight = rect.height || 300;
    const submenuWidth = 180;

    let x = e.clientX;
    let y = e.clientY;

    if (x - submenuWidth < 0) {
        x = submenuWidth + 10;
    }
    if (x + menuWidth > window.innerWidth - 10) {
        x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight - 10) {
        y = window.innerHeight - menuHeight - 10;
        if (y < 0) y = 10;
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function closeCloudInfoPanel() {
    const panel = document.getElementById('cloud-info-panel');
    if (panel) panel.style.display = 'none';
    currentCloudInfoItem = null;
    window.currentCloudInfoItem = null;
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

function refreshCloudInfoPanel() {
    const panel = document.getElementById('cloud-info-panel');
    if (panel && panel.style.display === 'flex' && currentCloudInfoItem) {
        showCloudInfo(currentCloudInfoItem.name, currentCloudInfoItem.path, currentCloudInfoItem.id, currentCloudInfoItem.owner_id);
    }
}

function switchCloudInfoTab(btn, tab) {
    document.querySelectorAll('.info-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    if (!currentCloudInfoItem) return;

    if (tab === 'details') {
        showCloudDetails(currentCloudInfoItem.name, currentCloudInfoItem.path, currentCloudInfoItem.data);
    } else {
        showCloudActivity(currentCloudInfoItem.name, currentCloudInfoItem.path, currentCloudInfoItem.owner_id);
    }
}

async function showCloudInfo(name, path, trashId = null, ownerId = null) {
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
    const isComputer = currentCloudView === 'computers' && currentCloudPath === '';
    if (currentCloudView === 'trash' || isComputer) {
        if (activityTab) activityTab.style.display = 'none';
    } else {
        if (activityTab) activityTab.style.display = 'block';
    }

    try {
        const res = await fetch('/api/cloud/info', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, view: currentCloudView, id: trashId, owner_id: ownerId })
        });
        const data = await _cloudJson(res);
        if (data.error) throw new Error(data.error);

        currentCloudInfoItem = { name, path, data, id: trashId, owner_id: ownerId };
        window.currentCloudInfoItem = currentCloudInfoItem;
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

    const isComputer = currentCloudView === 'computers' && currentCloudPath === '';

    if (isComputer) {
        icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';
    } else {
        icon.innerHTML = data.is_dir ? getFolderIcon() : getFileIcon('.' + ext);
    }

    const isTrash = currentCloudView === 'trash';
    let previewHtml = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.5;">${data.is_dir ? getFolderIcon() : getFileIcon('.' + ext)}</div>`;

    if (isComputer) {
        previewHtml = `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto; filter: drop-shadow(0 8px 20px rgba(99,102,241,0.25));"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'].includes(ext)) {
        const trashId = currentCloudInfoItem ? currentCloudInfoItem.id : null;
        const ownerId = data.owner_id || '';
        const idParam = (isTrash && trashId) ? `&id=${trashId}` : '';
        const ownerParam = ownerId ? `&owner_id=${ownerId}` : '';
        previewHtml = `<img src="/api/cloud/preview?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}&view=${currentCloudView}${idParam}${ownerParam}" style="max-width:100%; max-height:100%; object-fit:cover;">`;
    }

    let typeText = data.is_dir ? window.t_cloud('folder_caps', 'Carpeta') : window.t_cloud('file_caps', 'Archivo') + ' ' + ext.toUpperCase();
    let locationText = path || window.t_cloud('my_drive', 'Mi unidad');

    if (isComputer) {
        typeText = window.t_cloud('linked_device', 'Dispositivo Vinculado');
        locationText = window.t_cloud('nav_computers', 'Computadoras');
    }

    body.innerHTML = `
        <div class="info-file-preview">
            ${previewHtml}
        </div>

        <div style="padding: 0 4px;">
            <div class="info-section-title">${window.t_cloud('who_has_access', 'Quién tiene acceso').toUpperCase()}</div>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                ${data.owner_id ?
            `<img src="/api/system/user/avatar/${escAttr(data.owner_id)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; box-shadow: 0 4px 10px rgba(0,0,0,0.2);" onerror="window.cloudAvatarFallback(this, '${jsStr(owner)}')" >`
            :
            `<div style="width: 36px; height: 36px; border-radius: 50%; background: #4285f4; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; font-weight: 700; box-shadow: 0 4px 10px rgba(66, 133, 244, 0.3);">
                        ${esc(owner.charAt(0).toUpperCase())}
                    </div>`
        }
                <div>
                    <div style="font-size: 0.9rem; font-weight: 600; color: #ffffff;">${esc(owner)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-dim); opacity: 0.9;">${window.t_cloud('col_owner', 'Propietario')}</div>
                </div>
            </div>
            ${(data.shared_users && data.shared_users.length > 0) ? data.shared_users.map(u => `
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                <img src="/api/system/user/avatar/${escAttr(u.user_id)}" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover;" onerror="window.cloudAvatarFallback(this, '${jsStr(u.username)}')">
                <div>
                    <div style="font-size: 0.85rem; font-weight: 500; color: var(--text-main);">${esc(u.username)}</div>
                    <div style="font-size: 0.7rem; color: var(--text-dim); opacity: 0.9;">${window.t_cloud('guest', 'Invitado')}</div>
                </div>
            </div>`).join('') : ''}
        </div>

        <div style="margin-top: 24px; padding: 0 4px;">
            <div class="info-section-title">${window.t_cloud('file_details', 'Detalles del archivo').toUpperCase()}</div>
            <div class="info-detail-row">
                <div class="info-detail-label">${window.t_cloud('type', 'Tipo')}</div>
                <div class="info-detail-value">${typeText}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">${window.t_cloud('col_size', 'Tamaño')}</div>
                <div class="info-detail-value">${formatBytes(data.size)}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">${window.t_cloud('location', 'Ubicación')}</div>
                <div class="info-detail-value">${locationText}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">${window.t_cloud('modified', 'Modificado')}</div>
                <div class="info-detail-value">${new Date(data.mtime * 1000).toLocaleString(window.currentLang)}</div>
            </div>
            <div class="info-detail-row">
                <div class="info-detail-label">${window.t_cloud('created', 'Creado')}</div>
                <div class="info-detail-value">${new Date(data.ctime * 1000).toLocaleString(window.currentLang)}</div>
            </div>
        </div>
    `;
}

function copyInfoSyncCommand() {
    const cmdBox = document.getElementById('info-sync-cmd-box');
    if (!cmdBox) return;

    navigator.clipboard.writeText(cmdBox.innerText.trim()).then(() => {
        NV_Alert(window.t_cloud('link_modal_token_copied', 'Token copiado al portapapeles'));
    }).catch(err => {
        console.error("Error al copiar:", err);
    });
}

function showSyncInstructionsAlert(deviceName) {
    const cleanName = deviceName.replace('', '');
    const alertHtml = `
        <div style="text-align: left; line-height: 1.5; font-size: 0.9rem; color: #e2e8f0; font-family: sans-serif;">
            <div style="font-weight: 700; color: #fbbf24; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 1.05rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.55.63 2.89 1.63 3.82.64.6 1.33 2.18"></path></svg> Guía de Ejecución Permanente (nohup)
            </div>
            <p style="margin-bottom: 12px; color: #94a3b8; font-size: 0.85rem;">Si deseas que el Agente de Sincronización siga ejecutándose en tu ordenador incluso si cierras la ventana de tu terminal física, ejecútalo usando <b>nohup</b> en segundo plano:</p>
            <div style="position: relative; margin-bottom: 16px;">
                <pre id="adv-sync-cmd" style="background: rgba(0,0,0,0.4); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.78rem; color: #818cf8; word-break: break-all; white-space: pre-wrap; border: 1px solid rgba(255,255,255,0.05); margin: 0; padding-right: 70px; min-height: 50px;">nohup python3 -c "$(curl -fsSLk '${window.location.origin}/api/cloud/sync-agent/script?device=${encodeURIComponent(cleanName)}')" &amp;</pre>
                <button onclick="navigator.clipboard.writeText(document.getElementById('adv-sync-cmd').innerText.trim()); NV_Alert('¡Comando avanzado copiado!');" style="position: absolute; right: 6px; top: 6px; padding: 4px 8px; border-radius: 4px; border: none; background: var(--indigo); color: #fff; font-size: 0.7rem; font-weight: 600; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">Copiar</button>
            </div>
            <div style="font-weight: 600; color: #ffffff; margin-bottom: 6px; font-size: 0.85rem;">Instrucciones rápidas:</div>
            <ol style="margin-left: 20px; padding: 0; color: #cbd5e1; font-size: 0.82rem; line-height: 1.6;">
                <li style="margin-bottom: 4px;">Copia el comando de arriba haciendo clic en "Copiar".</li>
                <li style="margin-bottom: 4px;">Pégalo en tu terminal física y presiona <b>Enter</b>.</li>
                <li>¡Listo! El agente se ejecutará en segundo plano permanentemente y los logs se guardarán en <code style="background:rgba(255,255,255,0.1); padding:2px 4px; border-radius:3px; font-family:monospace; font-size:0.75rem;">nohup.out</code>.</li>
            </ol>
        </div>
    `;
    NV_Alert(alertHtml);
}

async function showCloudActivity(name, path, ownerId = null) {
    const body = document.getElementById('info-panel-body');
    body.innerHTML = `<div style="display:flex; justify-content:center; padding:20px;"><div class="loading-spinner"></div></div>`;

    try {
        const res = await fetch('/api/cloud/item_activity', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, path, owner_id: ownerId })
        });
        const data = await _cloudJson(res);

        if (!data.activity || data.activity.length === 0) {
            body.innerHTML = `<div style="text-align:center; padding:40px; opacity:0.5;">${window.t_cloud('no_recent_activity', 'No hay actividad reciente')}</div>`;
            return;
        }

        let html = `<div style="padding: 10px 4px;">`;
        data.activity.forEach(act => {
            const date = new Date(act.time * 1000);
            const timeStr = date.toLocaleTimeString(window.currentLang, { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString(window.currentLang, { day: '2-digit', month: 'short' });

            // Backward compatibility: old activities may have Spanish strings
            const actMap = {
                "Subiste": "act_subiste",
                "Creaste la carpeta": "act_creaste_la_carpeta",
                "Desvinculaste el dispositivo": "act_desvinculaste_el_dispositivo",
                "Renombraste": "act_renombraste",
                "Abrió": "act_abrio",
                "Descargó": "act_descargo"
            };
            const actKey = act.action.startsWith('act_') ? act.action : (actMap[act.action] || act.action);
            const translatedAction = window.t_cloud(actKey, act.action);

            html += `
                <div style="display: flex; gap: 15px; margin-bottom: 24px; position: relative;">
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--indigo-dim); color: var(--indigo); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; z-index: 1;">
                            ${translatedAction.charAt(0).toUpperCase()}
                        </div>
                        <div style="width: 1px; flex: 1; background: var(--border); margin: 4px 0;"></div>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 0.85rem; font-weight: 600; color: #ffffff;">${esc(translatedAction)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${esc(act.user)} • ${dateStr}, ${timeStr}</div>
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

document.addEventListener('contextmenu', function (e) {
    const menu = document.getElementById('cloud-context-menu');
    const viewCloud = document.getElementById('view-cloud');
    const explorer = document.getElementById('cloud-explorer-main');
    const itemActions = document.getElementById('ctx-item-actions');

    if (viewCloud && viewCloud.classList.contains('active')) {



        e.preventDefault();

        if (explorer && explorer.contains(e.target)) {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

            if (currentCloudView === 'home') return;

            const row = e.target.closest('.cloud-file-row') || e.target.closest('.cloud-folder-row') || e.target.closest('.cloud-file-card') || e.target.closest('.cloud-suggested-card');
            const isTrashView = currentCloudView === 'trash';

            const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            if (isMobile) {
                if (row) {
                    if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('.cloud-file-actions')) {
                        if (menu) menu.style.display = 'none';
                        return;
                    }

                    const name = row.getAttribute('data-name');
                    const path = row.getAttribute('data-path');
                    const isDir = row.getAttribute('data-is-dir') === 'true';
                    const ownerId = row.getAttribute('data-owner-id');
                    const checkbox = row.querySelector('.cloud-file-checkbox');

                    const isAlreadySelected = row.classList.contains('selected') || SELECTED_CLOUD_ITEMS.some(item => item.name === name && (item.path || '') === (path || ''));

                    if (checkbox) checkbox.checked = !isAlreadySelected;
                    toggleCloudFileSelection(checkbox, name, path, isDir, ownerId);
                }
                if (menu) menu.style.display = 'none';
                return;
            }

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

                        setCloudDeleteVisible(true);
                        document.getElementById('ctx-delete-text').innerText = window.t_cloud('ctx_delete_perm', 'Eliminar permanentemente');

                        const restoreBtn = document.getElementById('ctx-restore-btn');
                        restoreBtn.style.display = 'block';

                        menu.querySelector('#ctx-creation-actions').style.display = 'none';
                        currentCloudContextItem = { name, path, isDir, trashId, ownerId: row.getAttribute('data-owner-id'), protected: row.getAttribute('data-protected') === 'true' };
                    } else if (currentCloudView === 'computers' && currentCloudPath === '') {
                        ['ctx-download-btn', 'ctx-rename-btn', 'ctx-share-btn', 'ctx-unshare-btn', 'ctx-organize-btn', 'ctx-star-btn', 'ctx-move-btn', 'ctx-copy-btn', 'ctx-zip-btn', 'ctx-unzip-btn', 'ctx-protect-btn', 'ctx-restore-btn', 'ctx-empty-trash-btn'].forEach(hiddenId => {
                            const hiddenBtn = document.getElementById(hiddenId);
                            if (hiddenBtn) hiddenBtn.style.display = 'none';
                        });

                        const tokenBtn = document.getElementById('ctx-token-btn');
                        if (tokenBtn) tokenBtn.style.display = 'block';

                        document.getElementById('ctx-info-btn').style.display = 'block';

                        const deleteBtn = document.getElementById('ctx-delete-btn');
                        setCloudDeleteVisible(true);
                        deleteBtn.style.color = '#f87171';
                        const deleteText = document.getElementById('ctx-delete-text');
                        if (deleteText) {
                            deleteText.setAttribute('data-i18n', 'btn_unlink');
                            deleteText.innerText = window.t_cloud('btn_unlink', 'Desvincular');
                        }
                        menu.querySelector('#ctx-creation-actions').style.display = 'none';

                        const fileView = row.getAttribute('data-view');
                        currentCloudContextItem = { name, path, isDir, view: fileView, trashId, ownerId: row.getAttribute('data-owner-id'), protected: row.getAttribute('data-protected') === 'true' };
                        itemActions.style.display = 'block';
                    } else {
                        document.getElementById('ctx-download-btn').style.display = 'block';
                        document.getElementById('ctx-star-btn').style.display = 'block';
                        const isMineRow = row.getAttribute('data-is-mine') === 'true';
                        const itemProtected = row.getAttribute('data-protected') === 'true';
                        document.getElementById('ctx-rename-btn').style.display = (currentCloudView === 'shared' || currentCloudView === 'shared_by_me' || !isMineRow || itemProtected) ? 'none' : 'block';
                        document.getElementById('ctx-protect-btn').style.display = (currentCloudView === 'shared' || currentCloudView === 'shared_by_me' || !isMineRow) ? 'none' : 'block';
                        document.getElementById('ctx-share-btn').style.display = (currentCloudView === 'shared_by_me' || !isMineRow) ? 'none' : 'block';

                        const unshareBtn = document.getElementById('ctx-unshare-btn');
                        if (unshareBtn) {
                            unshareBtn.style.display = ((currentCloudView === 'shared' && !isMineRow) || currentCloudView === 'shared_by_me') ? 'block' : 'none';
                            const unshareText = document.getElementById('ctx-unshare-text');
                            if (unshareText) {
                                if (currentCloudView === 'shared') {
                                    unshareText.setAttribute('data-i18n', 'ctx_ignore');
                                    unshareText.innerText = window.t_cloud('ctx_ignore', 'Ignorar');
                                } else {
                                    unshareText.setAttribute('data-i18n', 'ctx_unshare');
                                    unshareText.innerText = window.t_cloud('ctx_unshare', 'Dejar de compartir');
                                }
                            }
                        }

                        document.getElementById('ctx-organize-btn').style.display = 'block';
                        const noMoveViews = (currentCloudView === 'shared' || currentCloudView === 'shared_by_me' || currentCloudView === 'recent' || currentCloudView === 'starred');
                        document.getElementById('ctx-move-btn').style.display = (noMoveViews || !isMineRow || itemProtected) ? 'none' : 'block';
                        document.getElementById('ctx-copy-btn').style.display = 'block';

                        const zipBtn = document.getElementById('ctx-zip-btn');
                        const unzipBtn = document.getElementById('ctx-unzip-btn');
                        if (zipBtn) zipBtn.style.display = (noMoveViews || !isMineRow) ? 'none' : 'flex';
                        if (unzipBtn) unzipBtn.style.display = (!isMineRow || !name || !name.toLowerCase().endsWith('.zip')) ? 'none' : 'flex';

                        document.getElementById('ctx-info-btn').style.display = 'block';

                        setCloudDeleteVisible(!(noMoveViews || !isMineRow));
                        document.getElementById('ctx-delete-text').innerText = window.t_cloud('ctx_trash', 'Mover a la papelera');
                        document.getElementById('ctx-restore-btn').style.display = 'none';
                        menu.querySelector('#ctx-creation-actions').style.display = 'none';

                        const isStarred = row.getAttribute('data-starred') === 'true';
                        const fileView = row.getAttribute('data-view');
                        const sharedWith = row.getAttribute('data-shared-with');
                        currentCloudContextItem = { name, path, isDir, starred: isStarred, view: fileView, trashId, ownerId: row.getAttribute('data-owner-id'), sharedWith: sharedWith };
                        itemActions.style.display = 'block';

                        const starText = document.getElementById('ctx-star-text');
                        starText.setAttribute('data-i18n', isStarred ? 'ctx_unstar' : 'ctx_star');
                        starText.innerText = isStarred ? window.t_cloud('ctx_unstar', 'Quitar de destacados') : window.t_cloud('ctx_star', 'Destacar');

                        setCloudDeleteVisible(!(noMoveViews || !isMineRow || itemProtected));
                        const protectText = document.getElementById('ctx-protect-text');
                        const protectIcon = document.getElementById('ctx-protect-icon');

                        if (protectText) {
                            protectText.setAttribute('data-i18n', itemProtected ? 'ctx_unprotect' : 'ctx_protect');
                            protectText.innerText = itemProtected ? window.t_cloud('ctx_unprotect', 'Desproteger') : window.t_cloud('ctx_protect', 'Bloquear eliminación');
                        }
                        if (protectIcon) protectIcon.innerHTML = protectSvgIcon(!itemProtected);
                    }
                } else {
                    currentCloudContextItem = null;
                    itemActions.style.display = 'none';
                }
            } else {
                currentCloudContextItem = null;
                itemActions.style.display = 'none';
            }

            const isAllowedView = (currentCloudView === 'drive' || (currentCloudView === 'computers' && currentCloudPath !== ''));

            if (!isAllowedView && !currentCloudContextItem) {
                menu.style.display = 'none';
                return;
            }

            const creationItems = Array.from(menu.children).filter(child => child.id !== 'ctx-item-actions');
            creationItems.forEach(item => {
                item.style.display = (isAllowedView && !currentCloudContextItem) ? '' : 'none';
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

document.getElementById('cloud-context-menu').addEventListener('click', async function (e) {
    e.stopPropagation();
    const btn = e.target.closest('.context-item');

    if (!btn || !currentCloudContextItem) return;

    // On mobile, tapping the submenu parent shouldn't close the whole menu
    if (btn.classList.contains('has-submenu')) {
        return;
    }

    this.style.display = 'none';

    const action = btn.id;
    const { name, path, isDir, trashId } = currentCloudContextItem;
    switch (action) {
        case 'ctx-download-btn':
            downloadCloudFile(name, path, true, currentCloudContextItem.ownerId || null, currentCloudContextItem.view || null);
            break;
        case 'ctx-rename-btn':
            setTimeout(() => renameCloudItem(name, path, currentCloudContextItem.view, isDir), 50);
            break;
        case 'ctx-delete-btn':
            setTimeout(() => deleteCloudItem(name, path, isDir, trashId, currentCloudContextItem.view || null), 50);
            break;
        case 'ctx-restore-btn':
            restoreCloudItem(trashId);
            break;
        case 'ctx-star-btn':
            toggleCloudStar(name, path, currentCloudContextItem.view || null, currentCloudContextItem.ownerId || null);
            break;
        case 'ctx-protect-btn':
            toggleCloudProtect(name, path, currentCloudContextItem.view || null);
            break;
        case 'ctx-share-btn':
            openCloudShare(name, path);
            break;
        case 'ctx-unshare-btn':
            handleUnshareItem(currentCloudContextItem);
            break;
        case 'ctx-info-btn':
            showCloudInfo(name, path, trashId, currentCloudContextItem?.ownerId || null);
            break;
        case 'ctx-move-btn':
            if (currentCloudContextItem.protected === true) {
                await NV_Alert(window.t_cloud('cloud_move_protected_all', window.currentLang === 'en' ? 'Protected items cannot be moved. Unprotect them first.' : 'No puedes mover los elementos protegidos. Desprotégelos primero para poder moverlos.'), window.t_cloud('confirm_action_title', 'Confirmar acción'));
                return;
            }
            setTimeout(() => openCloudMove(name, path, isDir, false), 50);
            break;
        case 'ctx-copy-btn':
            setTimeout(() => openCloudMove(name, path, isDir, true), 50);
            break;
    }
    this.style.display = 'none';
});

let moveTargetName = '';
let moveTargetOldPath = '';
let moveTargetNewPath = '';
let _cloudMoveTree = null;
let _cloudMoveViewQuery = 'drive';
let _cloudMoveExpanded = new Set();
let moveTargetIsDir = false;
let isMoveAction = true;

async function openCloudMove(name, oldPath, isDir = false, isCopy = false) {
    if (isCopy && _currentCloudUsedBytes >= _currentCloudLimitBytes) {
        await NV_Alert(window.currentLang === "en" ? "Not enough space, request more" : "No tienes suficiente espacio, solicita más");
        return;
    }
    if (currentCloudView === 'shared' || (currentCloudContextItem && currentCloudContextItem.view === 'shared')) {
        await NV_Alert(window.currentLang === "en" ? "Cannot move or copy shared files." : "No se puede mover ni copiar archivos compartidos.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }
    if (!isCopy && (currentCloudView === 'shared_by_me' || (currentCloudContextItem && currentCloudContextItem.view === 'shared_by_me'))) {
        await NV_Alert(window.currentLang === "en" ? "Cannot move files shared by you." : "No puedes mover archivos que has compartido.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }
    if (!isCopy && (currentCloudView === 'recent' || currentCloudView === 'starred' || (currentCloudContextItem && (currentCloudContextItem.view === 'recent' || currentCloudContextItem.view === 'starred')))) {
        await NV_Alert(window.currentLang === "en" ? "Move is not available in this view." : "Mover no está disponible en esta vista.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }
    isMultiMove = false;
    moveTargetName = name;
    moveTargetOldPath = oldPath;
    moveTargetNewPath = '';
    moveTargetIsDir = isDir;
    isMoveAction = !isCopy;

    const modal = document.getElementById('cloud-move-modal');
    if (!modal) {
        await NV_Alert("Error: El modal de mover/copiar no se encuentra en el HTML.");
        return;
    }

    const titleActionEl = document.getElementById('move-modal-title-action');
    if (titleActionEl) titleActionEl.innerText = isCopy ? (window.t_cloud('ctx_copy_title') || 'Copiar') : (window.t_cloud('ctx_move_title') || 'Mover');

    const btnConfirm = document.getElementById('btn-confirm-move');
    if (btnConfirm) btnConfirm.innerText = isCopy ? (window.t_cloud('btn_copy_here') || 'Copiar aquí') : (window.t_cloud('btn_move_here') || 'Mover aquí');

    const nameEl = document.getElementById('move-filename');
    if (nameEl) nameEl.innerText = name;

    const displayEl = document.getElementById('move-selected-path-display');
    if (displayEl) displayEl.innerText = '/ (' + window.t_cloud('nav_drive', 'Mi unidad') + ')';

    modal.style.display = 'flex';

    await loadCloudFoldersTree();
}

function closeCloudMoveModal() {
    document.getElementById('cloud-move-modal').style.display = 'none';
}

async function loadCloudFoldersTree() {
    const container = document.getElementById('cloud-move-tree-container');
    if (!container) {
        console.error("[Cloud Debug] Tree container not found!");
        return;
    }

    container.innerHTML = `<div style="text-align: center; opacity: 0.5; padding: 20px;">${window.t_cloud('cloud_loading_dirs')}</div>`;

    const viewQuery = (currentCloudView === 'shared') ? 'drive' : currentCloudView;

    try {
        const res = await fetch(`/api/cloud/folders?view=${viewQuery}`, { headers: HEADERS });
        if (!res.ok) {
            container.innerHTML = `<div style="text-align: center; color: #f87171; padding: 20px;">${window.t_cloud('cloud_tree_load_error', 'Error al cargar directorios')}</div>`;
            return;
        }

        const data = await _cloudJson(res);
        if (data.tree) {
            _cloudMoveTree = data.tree;
            _cloudMoveTree._loaded = true;
            _cloudMoveViewQuery = viewQuery;
            _cloudMoveExpanded = new Set(['']);
            container.innerHTML = '';
            container.appendChild(renderFolderNode(data.tree));
        } else {
            container.innerHTML = `<div style="text-align: center; opacity: 0.5; padding: 20px;">${window.t_cloud('cloud_tree_empty', 'No se encontraron carpetas')}</div>`;
        }
    } catch (err) {
        console.error("Error cargando el árbol de carpetas:", err);
        container.innerHTML = `<div style="text-align: center; color: #f87171; padding: 20px;">${window.t_cloud('cloud_tree_error', 'Error al cargar carpetas')}</div>`;
    }
}

// Carga perezosa: la primera vez que se expande una rama se pide SOLO ese
// nivel al servidor y se re-renderiza el árbol desde el nodo raíz en memoria.
// Así el modal abre al instante y se puede bajar a cualquier profundidad.
async function _cloudMoveLoadChildren(node) {
    const res = await fetch(`/api/cloud/folders?view=${_cloudMoveViewQuery}&path=` + encodeURIComponent(node.path || ''),
        { headers: HEADERS });
    if (!res.ok) throw new Error('Error al cargar');
    const data = await _cloudJson(res);
    if (!data.tree) throw new Error('Sin datos');
    node.subdirs = data.tree.subdirs || [];
    node.files = data.tree.files || [];
    node.has_subdirs = !!data.tree.has_subdirs;
    node._loaded = true;
}

function _cloudMoveRefresh() {
    const container = document.getElementById('cloud-move-tree-container');
    if (!container || !_cloudMoveTree) return;
    container.innerHTML = '';
    container.appendChild(renderFolderNode(_cloudMoveTree));
}

async function _cloudMoveToggleExpand(node, childrenContainer, arrow) {
    const isHidden = childrenContainer.style.display === 'none';
    if (isHidden && node.has_subdirs && !node._loaded) {
        arrow.innerText = '…';
        try {
            await _cloudMoveLoadChildren(node);
        } catch (e) {
            arrow.innerText = '▶';
            return;
        }
        _cloudMoveExpanded.add(node.path);
        _cloudMoveRefresh();
        return;
    }
    childrenContainer.style.display = isHidden ? 'flex' : 'none';
    arrow.innerText = isHidden ? '▼' : '▶';
    if (isHidden) _cloudMoveExpanded.add(node.path);
    else _cloudMoveExpanded.delete(node.path);
}

function renderFolderNode(node, depth = 0) {
    const li = document.createElement('div');
    li.style.display = 'flex';
    li.style.flexDirection = 'column';
    li.style.paddingLeft = '12px';
    li.style.position = 'relative';

    const folderRow = document.createElement('div');
    folderRow.className = 'folder-tree-row';
    folderRow.style.display = 'flex';
    folderRow.style.alignItems = 'center';
    folderRow.style.gap = '6px';
    folderRow.style.padding = '6px 8px';
    folderRow.style.borderRadius = '6px';
    folderRow.style.cursor = 'pointer';
    folderRow.style.transition = 'all 0.2s';
    folderRow.style.userSelect = 'none';

    if (moveTargetNewPath === node.path) {
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
    const isExpanded = _cloudMoveExpanded.has(node.path) || depth < 1;
    if (hasSubdirs) {
        arrow.innerText = isExpanded ? '▼' : '▶';
        arrow.style.cursor = 'pointer';
    } else {
        arrow.innerText = '•';
        arrow.style.opacity = '0.2';
    }

    const icon = document.createElement('span');
    icon.innerHTML = getFolderIcon();
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.fontSize = '1.05rem';

    const label = document.createElement('span');
    label.innerText = (node.path === '' && !node.name.includes('💻')) ? window.t_cloud('nav_drive', 'Mi unidad') : node.name;
    label.style.fontWeight = '500';

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
            childrenContainer.appendChild(renderFolderNode(sub, depth + 1));
        });
    }

    li.appendChild(childrenContainer);

    arrow.onclick = (e) => {
        if (!hasSubdirs) return;
        e.stopPropagation();
        _cloudMoveToggleExpand(node, childrenContainer, arrow);
    };

    folderRow.onclick = (e) => {
        document.querySelectorAll('.folder-tree-row').forEach(row => {
            row.style.background = 'transparent';
            row.style.border = '1px solid transparent';
        });

        folderRow.style.background = 'rgba(129, 140, 248, 0.2)';
        folderRow.style.border = '1px solid rgba(129, 140, 248, 0.4)';

        moveTargetNewPath = node.path;
        document.getElementById('move-selected-path-display').innerText = node.path ? `/${node.path}` : '/ (' + window.t_cloud('nav_drive', 'Mi unidad') + ')';
    };

    return li;
}

async function confirmCloudMove() {
    if (!isMoveAction) {
        if (currentCloudView !== 'shared' && moveTargetNewPath === moveTargetOldPath) {
            await NV_Alert(window.t_cloud('err_same_dest', "La carpeta de destino es igual a la carpeta actual."));
            return;
        }
        await copyCloudItem(moveTargetName, moveTargetOldPath, moveTargetNewPath);
        closeCloudMoveModal();
        return;
    }

    if (isMultiMove) {
        let movedCount = 0;
        for (const item of multiMoveItems) {
            if (moveTargetNewPath === item.path) continue;
            if (item.row && item.row.getAttribute && item.row.getAttribute('data-protected') === 'true') continue;
            if (item.isDir) {
                const targetNormalized = moveTargetNewPath ? moveTargetNewPath + '/' : '';
                const sourceNormalized = item.path ? item.path + '/' : '';
                const selfPath = sourceNormalized + item.name + '/';
                if (targetNormalized === selfPath || targetNormalized.startsWith(selfPath)) {
                    continue;
                }
            }
            try {
                const res = await fetch('/api/cloud/move', {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ name: item.name, old_path: item.path, new_path: moveTargetNewPath, view: currentCloudView })
                });
                if (res.ok) movedCount++;
            } catch (err) {
                console.error("Error al mover item en lote:", err);
            }
        }
        if (movedCount > 0) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            clearCloudSelection();
        }
        closeCloudMoveModal();
        return;
    }

    if (moveTargetNewPath === moveTargetOldPath) {
        await NV_Alert(window.t_cloud('err_same_dest', "La carpeta de destino es igual a la carpeta actual."));
        return;
    }

    if (moveTargetIsDir) {
        const targetNormalized = moveTargetNewPath ? moveTargetNewPath + '/' : '';
        const sourceNormalized = moveTargetOldPath ? moveTargetOldPath + '/' : '';
        const selfPath = sourceNormalized + moveTargetName + '/';

        if (targetNormalized === selfPath || targetNormalized.startsWith(selfPath)) {
            await NV_Alert(window.currentLang === "en" ? "Cannot move a directory into itself or a subdirectory." : "No se puede mover un directorio dentro de sí mismo o de uno de sus subdirectorios.");
            return;
        }
    }

    await moveCloudItem(moveTargetName, moveTargetOldPath, moveTargetNewPath);
    closeCloudMoveModal();
}

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
            const data = await _cloudJson(res);
            await NV_Alert(data.error || window.currentLang === "en" ? "Error moving" : "Error al mover");
        }
    } catch (err) { await NV_Alert(window.currentLang === "en" ? "Network error moving" : "Error de red al mover"); }
}

async function copyCloudItem(name, oldPath, newPath) {
    try {
        const ownerId = currentCloudContextItem ? currentCloudContextItem.ownerId : null;
        // Add " (Copia)" suffix when copying a shared file
        let copyName = name;
        if (ownerId && currentCloudView === 'shared') {
            const dotIdx = name.lastIndexOf('.');
            if (dotIdx > 0) {
                copyName = name.substring(0, dotIdx) + ' (Copia)' + name.substring(dotIdx);
            } else {
                copyName = name + ' (Copia)';
            }
        }
        const res = await fetch('/api/cloud/copy', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name, new_name: copyName, old_path: oldPath, new_path: newPath, view: currentCloudView, owner_id: ownerId })
        });
        if (res.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
            closeCloudInfoPanel();
            await NV_Alert(window.currentLang === "en" ? "Copy saved successfully." : "Copia guardada con éxito.");
        }
        else {
            const data = await _cloudJson(res);
            await NV_Alert(data.error || window.currentLang === "en" ? "Error saving copy" : "Error al guardar copia");
        }
    } catch (err) { await NV_Alert(window.currentLang === "en" ? "Network error saving copy" : "Error de red al guardar copia"); }
}

let selectedUsersToShare = [];
let _existingShares = [];

async function openCloudShare(name, path) {
    if (currentCloudView === 'shared' || (currentCloudContextItem && currentCloudContextItem.view === 'shared')) {
        await NV_Alert(window.currentLang === "en" ? "Cannot share files that were shared with you." : "No puedes compartir archivos que han sido compartidos contigo.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }
    const modal = document.getElementById('cloud-share-modal');
    document.getElementById('share-filename').innerText = name;
    document.getElementById('share-user-search').value = '';
    document.getElementById('share-search-results').style.display = 'none';
    selectedUsersToShare = [];
    _existingShares = [];
    renderSelectedUsers();

    // Load already shared users
    try {
        const res = await fetch('/api/cloud/share/status', {
            method: 'POST', headers: HEADERS,
            body: JSON.stringify({ name, path })
        });
        const data = await _cloudJson(res);
        _existingShares = data.shares || [];
    } catch (e) { }

    const isManageMode = (currentCloudView === 'shared_by_me');
    const addSection = document.getElementById('share-add-section');
    const contactsSection = document.getElementById('share-contacts-section');
    const selectedSection = document.getElementById('selected-users-container');
    const confirmBtn = document.getElementById('btn-confirm-share');
    const manageSection = document.getElementById('share-manage-section');
    const actionLabel = document.getElementById('share-modal-action');

    if (actionLabel) {
        actionLabel.innerText = isManageMode ? window.t_cloud('people_with_access', 'Personas con acceso') : window.t_cloud('share_action', 'Compartir');
    }

    if (isManageMode) {
        if (addSection) addSection.style.display = 'none';
        if (contactsSection) contactsSection.style.display = 'none';
        if (selectedSection) selectedSection.style.display = 'none';
        if (confirmBtn) confirmBtn.style.display = 'none';
        if (manageSection) manageSection.style.display = 'block';
        renderManageShares();
    } else {
        if (addSection) addSection.style.display = 'block';
        if (contactsSection) contactsSection.style.display = 'block';
        if (selectedSection) selectedSection.style.display = 'flex';
        if (confirmBtn) confirmBtn.style.display = 'inline-block';
        if (manageSection) manageSection.style.display = 'none';
        loadCloudContacts();
    }

    modal.style.display = 'flex';
}

function renderManageShares() {
    const container = document.getElementById('share-manage-list');
    if (!container) return;

    if (_existingShares.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 20px; opacity: 0.5; font-size: 0.85rem;">${window.t_cloud('no_shared_users', 'No hay usuarios con acceso')}</div>`;
        return;
    }

    container.innerHTML = _existingShares.map(s => `
        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 8px; transition: background 0.2s;" class="contact-item-row">
            <img src="/api/system/user/avatar/${escAttr(s.user_id)}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid var(--border);" onerror="window.cloudAvatarFallback(this, '${jsStr(s.username)}')">
            <div style="flex: 1;">
                <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-main);">${esc(s.username)}</div>
                <div style="font-size: 0.7rem; color: var(--text-dim); opacity: 0.8;">${window.t_cloud('guest', 'Invitado')}</div>
            </div>
            <button onclick="revokeCloudShare('${jsStr(s.user_id)}', '${jsStr(s.username)}', event)"
                style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; transition: all 0.2s;"
                onmouseover="this.style.background='rgba(239,68,68,0.25)';this.style.transform='scale(1.1)'" 
                onmouseout="this.style.background='rgba(239,68,68,0.1)';this.style.transform='scale(1)'"
                title="${window.t_cloud('ctx_unshare', 'Dejar de compartir')}">&times;</button>
        </div>
    `).join('');
}

function closeCloudShareModal() {
    document.getElementById('cloud-share-modal').style.display = 'none';
}

async function loadCloudContacts() {
    const list = document.getElementById('share-contacts-list');
    try {
        const res = await fetch('/api/cloud/contacts', { headers: HEADERS });
        const data = await _cloudJson(res);

        if (!data.contacts || data.contacts.length === 0) {
            list.innerHTML = `<div style="font-size: 0.85rem; opacity: 0.5; text-align: center; padding: 10px;">${window.t_cloud('share_no_friends', 'No tienes amigos agregados.')}</div>`;
            return;
        }

        list.innerHTML = data.contacts.map(c => {
            const already = _existingShares.some(s => s.user_id === c.user_id);
            return `
                <div class="contact-item-row" onclick="${already ? '' : "selectUserForSharing('" + jsStr(c.user_id) + "', '" + jsStr(c.username) + "')"}" 
                     style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; cursor: ${already ? 'default' : 'pointer'}; transition: background 0.2s; opacity: ${already ? 0.5 : 1};">
                    <img src="/api/system/user/avatar/${escAttr(c.user_id)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border);" onerror="window.cloudAvatarFallback(this, '${jsStr(c.username)}')">
                    <div style="flex: 1;">
                        <div style="font-size: 0.9rem; font-weight: 600;">${esc(c.username)}</div>
                    </div>
                    ${already ? '<button onclick="revokeCloudShare(\'' + c.user_id + '\', \'' + c.username.replace(/'/g, "\\'") + '\', event)" style="font-size:0.7rem;color:#ef4444;font-weight:700;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);padding:4px 8px;border-radius:4px;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background=\'rgba(239,68,68,0.2)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.1)\'">' + window.t_cloud('share_revoke', 'REVOCAR') + '</button>' : ''}
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Error cargando amigos:", err);
    }
}

async function searchUsersForSharing(query) {
    const results = document.getElementById('share-search-results');
    if (!query || query.length < 2) {
        results.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`/api/cloud/users/search?q=${encodeURIComponent(query)}`, { headers: HEADERS });
        const data = await _cloudJson(res);

        if (!data.users || data.users.length === 0) {
            results.innerHTML = `<div style="padding: 12px; font-size: 0.85rem; opacity: 0.5;">
        ${window.t_cloud('share_no_friends_found', 'No se encontraron amigos.')}
        </div>`;
        } else {
            results.innerHTML = data.users.map(u => {
                const already = _existingShares.some(s => s.user_id === u.user_id);
                return `
                <div onclick="${already ? '' : "selectUserForSharing('" + jsStr(u.user_id) + "', '" + jsStr(u.username) + "')"}" 
                     style="padding: 10px 16px; cursor: ${already ? 'default' : 'pointer'}; border-bottom: 1px solid var(--border); transition: background 0.2s; display: flex; align-items: center; gap: 10px; opacity: ${already ? 0.5 : 1};">
                    <img src="/api/system/user/avatar/${escAttr(u.user_id)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border);" onerror="window.cloudAvatarFallback(this, '${jsStr(u.username)}')">
                    <div style="flex: 1;">
                        <div style="font-size: 0.85rem; font-weight: 600;">${esc(u.username)}</div>
                    </div>
                    ${already ? '<button onclick="revokeCloudShare(\'' + jsStr(u.user_id) + '\', \'' + jsStr(u.username) + '\', event)" style="font-size:0.7rem;color:#ef4444;font-weight:700;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);padding:4px 8px;border-radius:4px;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background=\'rgba(239,68,68,0.2)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.1)\'">REVOCAR</button>' : '<div style="font-size:0.7rem;color:#4285f4;font-weight:700;">SELECCIONAR</div>'}
                </div>
            `}).join('');
        }
        results.style.display = 'block';
    } catch (err) { }
}

function selectUserForSharing(uid, username) {
    if (selectedUsersToShare.find(u => u.uid === uid)) return;
    if (_existingShares.some(s => s.user_id === uid)) return;
    selectedUsersToShare.push({ uid, username });
    renderSelectedUsers();

    // Hide search results and clear input
    const results = document.getElementById('share-search-results');
    if (results) results.style.display = 'none';
    const input = document.getElementById('share-user-search');
    if (input) input.value = '';
}

function removeSelectedUser(uid) {
    selectedUsersToShare = selectedUsersToShare.filter(u => u.uid !== uid);
    renderSelectedUsers();
}

async function revokeCloudShare(uid, username, event) {
    if (event) event.stopPropagation();
    const itemName = document.getElementById('share-filename').innerText;
    if (!await NV_Confirm(`${window.t_cloud('confirm_unshare_user', '¿Dejar de compartir con')} ${esc(username)}?`, window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;

    try {
        const res = await fetch('/api/cloud/unshare', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                name: itemName,
                path: currentCloudContextItem ? currentCloudContextItem.path : '',
                shared_with: uid
            })
        });
        const data = await _cloudJson(res);
        if (data.success) {
            _existingShares = _existingShares.filter(s => s.user_id !== uid);

            // If in manage mode, re-render the manage list
            const manageSection = document.getElementById('share-manage-section');
            if (manageSection && manageSection.style.display === 'block') {
                renderManageShares();
                // If no more shares, close modal and refresh
                if (_existingShares.length === 0) {
                    closeCloudShareModal();
                }
            } else {
                loadCloudContacts();
                const q = document.getElementById('share-user-search').value;
                if (q && q.length >= 2) searchUsersForSharing(q);
            }

            fetchCloudFiles(currentCloudPath, currentCloudView);
        } else {
            NV_Alert(data.error || window.currentLang === "en" ? "Error revoking access" : "Error al revocar acceso");
        }
    } catch (err) {
        NV_Alert(window.currentLang === "en" ? "Connection error" : "Error de conexión");
    }
}

function renderSelectedUsers() {
    const container = document.getElementById('selected-users-container');
    const btn = document.getElementById('btn-confirm-share');

    if (selectedUsersToShare.length === 0) {
        container.innerHTML = `<div style="font-size: 0.85rem; opacity: 0.4;">${window.t_cloud('share_nobody_selected', 'Nadie seleccionado')}</div>`;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        return;
    }

    btn.disabled = false;
    btn.style.opacity = '1';

    container.innerHTML = selectedUsersToShare.map(u => `
        <div style="display: flex; align-items: center; gap: 6px; background: var(--indigo-dim); color: var(--text-main); padding: 4px 10px; border-radius: 100px; font-size: 0.8rem; font-weight: 600; border: 1px solid var(--indigo);">
            <img src="/api/system/user/avatar/${escAttr(u.uid)}" style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover;" onerror="window.cloudAvatarFallback(this, '${jsStr(u.username)}')">
            ${esc(u.username)}
            <span onclick="removeSelectedUser('${jsStr(u.uid)}')" style="cursor: pointer; opacity: 0.6; font-size: 1rem; line-height: 1;">&times;</span>
        </div>
    `).join('');
}

async function confirmCloudShare() {
    if (selectedUsersToShare.length === 0 || !currentCloudContextItem) return;
    if (currentCloudView === 'shared' || currentCloudContextItem.view === 'shared') {
        return;
    }

    const { name, path } = currentCloudContextItem;
    const uids = selectedUsersToShare.map(u => u.uid);

    try {
        const res = await fetch('/api/cloud/share', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                name: name,
                path: path,
                view: currentCloudView,
                shared_with: uids
            })
        });

        if (res.ok) {
            closeCloudShareModal();
            await NV_Alert(window.currentLang === "en" ? `File shared with ${selectedUsersToShare.length} user(s).` : `Archivo compartido con ${selectedUsersToShare.length} usuario(s).`);
        } else {
            const data = await _cloudJson(res);
            await NV_Alert("Error: " + (data.error || window.currentLang === "en" ? "Could not share." : "No se pudo compartir."));
        }
    } catch (err) {
        await NV_Alert(window.currentLang === "en" ? "Connection error sharing." : "Error de conexión al compartir.");
    }
}

let linkDevicePollInterval = null;
let _currentLinkDeviceOS = 'linux';
let _linkDeviceCurrentOS = 'linux';
let _currentLinkDeviceToken = null;
let _existingDevicesAtOpen = new Set();

async function downloadClientAgent() {
    const modal = document.getElementById('cloud-link-device-modal');
    const useToast = !modal || modal.style.display === 'none';
    const btn = document.getElementById('btn-download-agent');
    const originalLabel = btn ? btn.innerHTML : '';
    const setBtnBusy = (busy) => {
        if (!btn) return;
        btn.style.pointerEvents = busy ? 'none' : '';
        btn.style.opacity = busy ? '0.7' : '';
        btn.innerHTML = busy
            ? '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;animation:cloud-spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Descargando Agente...'
            : originalLabel;
    };
    const showToast = (msg) => {
        if (useToast) showCloudProgressToast(msg);
    };
    const toastSuccess = () => {
        const toast = document.getElementById('cloud-progress-toast');
        const textEl = toast && toast.querySelector('.cloud-toast-text');
        if (toast) {
            const spinner = toast.querySelector('.cloud-toast-spinner');
            if (spinner) spinner.style.display = 'none';
            if (textEl) textEl.innerText = window.currentLang === "en" ? 'Download started ✓' : 'Descarga iniciada ✓';
            toast.style.animation = 'none';
            setTimeout(() => {
                toast.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => { toast.style.display = 'none'; }, 300);
            }, 2200);
        }
    };

    setBtnBusy(true);
    showToast(window.currentLang === "en" ? "Preparing agent download..." : "Descargando Agente Base...");

    let res = null;
    try {
        res = await fetch('/api/cloud/sync-agent/download-client', { headers: HEADERS, cache: 'no-store' });
    } catch (e) {
        console.error('downloadClientAgent fetch error', e);
        res = null;
    }
    if (!res || !res.ok) {
        let msg = res && res.status === 403 ? 'La descarga solo está disponible por HTTPS. Entra con https:// y reintenta.' : 'No se pudo preparar la descarga.';
        try {
            const data = res && await res.json();
            if (data && data.error) msg = data.error;
        } catch (e) { }
        hideCloudProgressToast();
        setBtnBusy(false);
        await NV_Alert(msg);
        return;
    }
    try {
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="?([^";]+)"?/);
        const name = m ? m[1] : (navigator.userAgent.includes('Win') ? 'Null-Void-Agent.exe' : 'Null-Void-Agent-Linux');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setBtnBusy(false);
        if (useToast) {
            toastSuccess();
        }
    } catch (e) {
        console.error('downloadClientAgent blob error', e);
        hideCloudProgressToast();
        setBtnBusy(false);
        window.location.href = '/api/cloud/sync-agent/download-client';
    }
}

async function openLinkDeviceModal() {
    const modal = document.getElementById('cloud-link-device-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('sync-command-text').innerText = 'Generando token seguro...';
        _existingDevicesAtOpen = new Set();
        try {
            const devRes = await fetch('/api/cloud/files?view=computers', { headers: HEADERS });
            if (devRes.ok) {
                const devData = await _cloudJson(devRes);
                (devData.files || []).forEach(f => _existingDevicesAtOpen.add(f.name));
            }
        } catch (e) { }
        try {
            const res = await fetch('/api/cloud/sync-agent/generate-token', {
                method: 'POST',
                headers: HEADERS
            });
            if (res.ok) {
                const data = await _cloudJson(res);
                _currentLinkDeviceToken = data.temp_token;
            }
        } catch (e) { console.error("Error al generar token del agente", e); }
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('win')) {
            _currentLinkDeviceOS = 'windows';
        } else {
            _currentLinkDeviceOS = 'linux';
        }
        _linkDeviceCurrentOS = _currentLinkDeviceOS;

        setLinkDeviceOS(_currentLinkDeviceOS);
        if (linkDevicePollInterval) clearInterval(linkDevicePollInterval);
        linkDevicePollInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/cloud/files?view=computers', { headers: HEADERS });
                if (res.ok) {
                    const data = await _cloudJson(res);
                    const files = data.files || [];
                    const newDevice = files.find(f => f.active && !_existingDevicesAtOpen.has(f.name));
                    if (newDevice) {
                        clearInterval(linkDevicePollInterval);
                        linkDevicePollInterval = null;
                        closeLinkDeviceModal();
                        await fetchCloudFiles(newDevice.name, 'computers');
                        await NV_Alert(window.currentLang === "en" ? `Computer "${esc(newDevice.name)}" linked successfully.` : `Computadora "${esc(newDevice.name)}" vinculada con éxito.`);
                    }
                }
            } catch (err) { }
        }, 5000);
    }
}

function setLinkDeviceOS(os) {
    _currentLinkDeviceOS = os;
    const btns = ['os-btn-linux', 'os-btn-windows'];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isCurrent = id === `os-btn-${os}`;
        const isAllowed = (id === 'os-btn-linux' ? 'linux' : 'windows') === _linkDeviceCurrentOS;
        btn.style.background = isCurrent ? 'var(--indigo)' : 'transparent';
        btn.style.color = isCurrent ? '#fff' : 'var(--text-muted)';
        btn.style.fontWeight = isCurrent ? '700' : '500';
        btn.disabled = !isAllowed;
        btn.style.cursor = isAllowed ? 'pointer' : 'not-allowed';
        btn.style.opacity = isAllowed ? '1' : '0.4';
    });
    generateSyncCommand();
}

function closeLinkDeviceModal() {
    const modal = document.getElementById('cloud-link-device-modal');
    if (modal) modal.style.display = 'none';
    if (linkDevicePollInterval) {
        clearInterval(linkDevicePollInterval);
        linkDevicePollInterval = null;
    }
}

function generateSyncCommand() {
    const cmdText = document.getElementById('sync-command-text');
    if (!cmdText) return;

    if (!_currentLinkDeviceToken) {
        cmdText.innerText = "Error: no se pudo obtener token de seguridad.";
        return;
    }

    cmdText.innerText = _currentLinkDeviceToken;
}

function copySyncCommand() {

    const cmdText = document.getElementById('sync-command-text');
    if (!cmdText) return;

    navigator.clipboard.writeText(cmdText.innerText).then(() => {
        NV_Alert(window.t_cloud('link_modal_token_copied', 'Token copiado al portapapeles'));
    }).catch(err => {
        console.error("Error al copiar:", err);
    });
}

function getUploadTarget() {
    let targetView = uploadDestinationOverrideView !== null ? uploadDestinationOverrideView : currentCloudView;
    let targetPath = uploadDestinationOverridePath !== null ? uploadDestinationOverridePath : currentCloudPath;

    if (uploadDestinationOverrideView === null && currentCloudView !== 'drive') {
        targetView = 'drive';
        targetPath = '';
    }

    return { targetView, targetPath };
}

function triggerNewItemAction(action) {
    const menu = document.getElementById('cloud-new-menu');
    if (menu) menu.style.display = 'none';

    // Close sidebar on mobile if it is open
    const sidebar = document.querySelector('.cloud-sidebar');
    const overlay = document.getElementById('cloud-sidebar-overlay');
    if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
    }

    if (currentCloudView !== 'drive') {
        uploadDestinationOverridePath = '';
        uploadDestinationOverrideView = 'drive';
        if (typeof fetchCloudFiles === 'function') {
            fetchCloudFiles('', 'drive');
        }
    } else {
        uploadDestinationOverridePath = null;
        uploadDestinationOverrideView = null;
    }

    executeNewItemAction(action);
}

function executeNewItemAction(action) {
    if (action === 'file') {
        document.getElementById('cloud-upload-input').click();
    } else if (action === 'folder') {
        document.getElementById('cloud-folder-upload-input').click();
    } else if (action === 'mkdir') {
        handleCreateFolder();
    }
}

let SELECTED_CLOUD_ITEMS = [];
let isMultiMove = false;
let multiMoveItems = [];

function toggleCloudFileSelection(checkbox, name, path, isDir, ownerId) {
    const row = checkbox ? (checkbox.closest('.cloud-file-row') || checkbox.closest('.cloud-folder-row') || checkbox.closest('.cloud-file-card')) : null;

    const matchingRows = Array.from(document.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card')).filter(r => {
        const rName = r.getAttribute('data-name');
        const rPath = r.getAttribute('data-path') || '';
        return rName === name && rPath === (path || '');
    });

    const isChecked = checkbox ? checkbox.checked : false;

    if (isChecked) {
        matchingRows.forEach(r => {
            r.classList.add('selected');
            const chk = r.querySelector('.cloud-file-checkbox');
            if (chk) chk.checked = true;
        });
        if (row && !row.classList.contains('selected')) row.classList.add('selected');

        if (!SELECTED_CLOUD_ITEMS.some(item => item.name === name && (item.path || '') === (path || ''))) {
            SELECTED_CLOUD_ITEMS.push({ name, path, isDir, ownerId, row: row || matchingRows[0] });
        }
    } else {
        matchingRows.forEach(r => {
            r.classList.remove('selected');
            const chk = r.querySelector('.cloud-file-checkbox');
            if (chk) chk.checked = false;
        });
        if (row) {
            row.classList.remove('selected');
            const chk = row.querySelector('.cloud-file-checkbox');
            if (chk) chk.checked = false;
        }
        SELECTED_CLOUD_ITEMS = SELECTED_CLOUD_ITEMS.filter(item => !(item.name === name && (item.path || '') === (path || '')));
    }

    updateCloudMultiSelectBar();
}

function clearCloudSelection() {

    document.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card').forEach(row => {
        row.classList.remove('selected');
        const chk = row.querySelector('.cloud-file-checkbox');
        if (chk) chk.checked = false;
    });

    SELECTED_CLOUD_ITEMS = [];

    updateCloudMultiSelectBar();
}

function updateCloudMultiSelectBar() {
    const bar = document.getElementById('cloud-multi-select-bar');
    const count = document.getElementById('cloud-multi-select-count');
    if (!bar || !count) return;

    if (SELECTED_CLOUD_ITEMS.length > 0) {
        bar.style.display = 'flex';
        count.innerText = `${SELECTED_CLOUD_ITEMS.length} ` + (SELECTED_CLOUD_ITEMS.length > 1 ? window.t_cloud('selected_plural', 'seleccionados') : window.t_cloud('selected_single', 'seleccionado'));

        const btnDownload = document.getElementById('btn-cloud-multi-download');
        const btnZip = document.getElementById('btn-cloud-multi-zip');
        const btnMove = document.getElementById('btn-cloud-multi-move');
        const btnDelete = document.getElementById('btn-cloud-multi-delete');
        const btnDeleteText = document.getElementById('btn-cloud-multi-delete-text');
        const btnRestore = document.getElementById('btn-cloud-multi-restore');
        const btnPreview = document.getElementById('btn-cloud-multi-preview');
        const btnPreviewText = document.getElementById('btn-cloud-multi-preview-text');

        // Previsualizar solo tiene sentido si TODA la selección son archivos
        // previsualizables (PDF, imágenes, texto, vídeo). Si hay cualquier
        // carpeta o archivo no compatible, el botón se oculta por completo:
        // las carpetas no se pueden renderizar en el visor multipestaña.
        const allPreviewable = SELECTED_CLOUD_ITEMS.length > 0 && SELECTED_CLOUD_ITEMS.every(it =>
            !it.isDir && PREVIEW_EXTS.includes((it.name || '').split('.').pop().toLowerCase()));
        const showPreview = allPreviewable
            && currentCloudView !== 'trash'
            && !(currentCloudView === 'computers' && currentCloudPath === '');
        if (btnPreview) {
            btnPreview.style.display = showPreview ? 'flex' : 'none';
            if (btnPreviewText) {
                const base = window.t_cloud('btn_preview_multi', 'Previsualizar');
                btnPreviewText.textContent = SELECTED_CLOUD_ITEMS.length > 1
                    ? `${base} (${SELECTED_CLOUD_ITEMS.length})`
                    : base;
            }
        }

        if (currentCloudView === 'trash') {
            if (btnDownload) btnDownload.style.display = 'none';
            if (btnZip) btnZip.style.display = 'none';
            if (btnMove) btnMove.style.display = 'none';
            if (btnRestore) btnRestore.style.display = 'block';
            if (btnDeleteText) btnDeleteText.innerText = window.t_cloud('ctx_delete_perm', 'Eliminar definitivamente');
            if (btnDelete) {
                btnDelete.style.background = 'rgba(248,113,113,0.1)';
                btnDelete.style.borderColor = 'rgba(248,113,113,0.3)';
                btnDelete.style.color = '#f87171';
            }
        } else if (currentCloudView === 'computers' && currentCloudPath === '') {
            if (btnDownload) btnDownload.style.display = 'none';
            if (btnZip) btnZip.style.display = 'none';
            if (btnMove) btnMove.style.display = 'none';
            if (btnRestore) btnRestore.style.display = 'none';
            if (btnDeleteText) btnDeleteText.innerText = window.t_cloud('btn_unlink', 'Desvincular');
            if (btnDelete) {
                btnDelete.style.background = 'rgba(248,113,113,0.1)';
                btnDelete.style.borderColor = 'rgba(248,113,113,0.3)';
                btnDelete.style.color = '#f87171';
            }
        } else if (currentCloudView === 'shared' || currentCloudView === 'shared_by_me' || currentCloudView === 'recent' || currentCloudView === 'starred') {
            if (btnDownload) btnDownload.style.display = 'block';
            if (btnZip) btnZip.style.display = 'block';
            if (btnMove) btnMove.style.display = 'none';
            if (btnRestore) btnRestore.style.display = 'none';
            if (btnDeleteText) btnDeleteText.innerText = currentCloudView === 'shared_by_me' ? window.t_cloud('ctx_unshare', 'Dejar de compartir') : window.t_cloud('btn_delete', 'Eliminar');
            if (btnDelete) {
                if (currentCloudView === 'shared' || currentCloudView === 'starred') {
                    btnDelete.style.display = 'none';
                } else {
                    btnDelete.style.display = 'block';
                    btnDelete.style.background = 'rgba(248,113,113,0.1)';
                    btnDelete.style.borderColor = 'rgba(248,113,113,0.3)';
                    btnDelete.style.color = '#f87171';
                }
            }
        } else {
            if (btnDownload) btnDownload.style.display = 'block';
            if (btnZip) btnZip.style.display = 'block';
            if (btnMove) btnMove.style.display = 'block';
            if (btnRestore) btnRestore.style.display = 'none';
            if (btnDeleteText) btnDeleteText.innerText = window.t_cloud('btn_delete', 'Eliminar');
            if (btnDelete) {
                btnDelete.style.background = 'rgba(248,113,113,0.1)';
                btnDelete.style.borderColor = 'rgba(248,113,113,0.3)';
                btnDelete.style.color = '#f87171';
            }
        }
    } else {
        bar.style.display = 'none';
    }
}

function handleCloudRowClick(event, name, path, isDir, ownerId, isTrash, defaultActionString) {

    if (event.target.classList.contains('cloud-file-checkbox')) return;
    if (event.target.closest('.cloud-file-checkbox')) return;
    if (event.target.tagName === 'BUTTON' || event.target.closest('button') || event.target.closest('.cloud-file-actions')) return;
    if (event.target.tagName === 'INPUT') return;

    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (currentCloudView === 'home') {
        new Function(defaultActionString)();
        return;
    }

    if (event.ctrlKey || event.shiftKey || event.metaKey) {
        event.stopPropagation();
        event.preventDefault();
        const row = event.currentTarget;
        const checkbox = row.querySelector('.cloud-file-checkbox');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            toggleCloudFileSelection(checkbox, name, path, isDir, ownerId);
        }
        return;
    }

    if (SELECTED_CLOUD_ITEMS.length > 0) {
        event.stopPropagation();
        event.preventDefault();
        const row = event.currentTarget;
        const checkbox = row.querySelector('.cloud-file-checkbox');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;
            toggleCloudFileSelection(checkbox, name, path, isDir, ownerId);
        }
        return;
    }

    new Function(defaultActionString)();
}

function showCloudProgressToast(message) {
    let toast = document.getElementById('cloud-progress-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cloud-progress-toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.background = 'var(--surface-hi)';
        toast.style.border = '1px solid rgba(99, 102, 241, 0.3)';
        toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
        toast.style.borderRadius = '12px';
        toast.style.padding = '16px 20px';
        toast.style.zIndex = '99999';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '15px';
        toast.style.color = 'var(--text-main)';
        toast.style.fontFamily = 'inherit';
        toast.style.fontSize = '0.85rem';
        toast.style.backdropFilter = 'blur(10px)';
        toast.style.animation = 'slideInRight 0.3s ease';

        toast.innerHTML = `
            <div class="cloud-toast-spinner" style="width: 20px; height: 20px; border: 2.5px solid rgba(99,102,241,0.2); border-top-color: var(--indigo); border-radius: 50%; animation: cloud-spin 0.8s linear infinite;"></div>
            <span class="cloud-toast-text">${message}</span>
        `;

        if (!document.getElementById('cloud-toast-style')) {
            const style = document.createElement('style');
            style.id = 'cloud-toast-style';
            style.innerHTML = `
                @keyframes cloud-spin { to { transform: rotate(360deg); } }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);
    } else {
        toast.querySelector('.cloud-toast-text').innerText = message;
        toast.style.display = 'flex';
    }
}

function hideCloudProgressToast() {
    const toast = document.getElementById('cloud-progress-toast');
    if (toast) {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 300);
    }
}

async function downloadSelectedItems() {
    if (SELECTED_CLOUD_ITEMS.length === 0) return;

    const files = SELECTED_CLOUD_ITEMS.filter(item => !item.isDir);
    const hasFolders = SELECTED_CLOUD_ITEMS.some(item => item.isDir);

    if (files.length === 0) {
        await NV_Alert(window.currentLang === "en"
            ? "Folders can only be downloaded compressed. Please use 'Download ZIP'."
            : "Las carpetas solo se pueden descargar comprimidas. Utiliza la opción 'Descargar ZIP'.");
        return;
    }

    if (hasFolders) {
        showCloudProgressToast(window.currentLang === "en"
            ? `Downloading ${files.length} file(s). Folders require 'Download ZIP'.`
            : `Descargando ${files.length} archivo(s). Las carpetas requieren 'Descargar ZIP'.`);
    } else if (files.length > 1) {
        showCloudProgressToast(window.currentLang === "en"
            ? `Downloading ${files.length} files...`
            : `Descargando ${files.length} archivos...`);
    } else {
        showCloudProgressToast(window.currentLang === "en"
            ? "Downloading file..."
            : "Descargando archivo...");
    }

    for (let i = 0; i < files.length; i++) {
        const item = files[i];
        await downloadCloudFile(item.name, item.path, true, item.ownerId, item.fileView || currentCloudView, item.trashId || null);
        if (i < files.length - 1) {
            await new Promise(r => setTimeout(r, 250));
        }
    }

    setTimeout(() => {
        hideCloudProgressToast();
        clearCloudSelection();
    }, 1200);
}

async function downloadSelectedAsZip() {
    if (SELECTED_CLOUD_ITEMS.length === 0) return;

    showCloudProgressToast(`Comprimiendo ${SELECTED_CLOUD_ITEMS.length} elementos...`);

    try {
        const items = SELECTED_CLOUD_ITEMS.map(item => ({
            name: item.name,
            path: item.path,
            owner_id: item.ownerId
        }));

        const res = await fetch('/api/cloud/get_multi_token', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                items,
                view: currentCloudView
            })
        });

        if (res.ok) {
            const data = await _cloudJson(res);
            const token = data.t;

            showCloudProgressToast("Iniciando descarga...");

            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = `/api/cloud/download?t=${token}`;
            document.body.appendChild(iframe);
            setTimeout(() => iframe.remove(), 5000);

            setTimeout(() => {
                hideCloudProgressToast();
                clearCloudSelection();
            }, 1500);
        } else {
            const data = await _cloudJson(res);
            hideCloudProgressToast();
            await NV_Alert(data.error || window.currentLang === "en" ? "Error preparing download." : "Error al preparar la descarga.");
        }
    } catch (err) {
        hideCloudProgressToast();
        await NV_Alert(window.currentLang === "en" ? "Network error zipping and downloading." : "Error de red al intentar comprimir y descargar.");
    }
}

async function moveSelectedItems() {
    if (SELECTED_CLOUD_ITEMS.length === 0) return;

    if (currentCloudView === 'shared' || currentCloudView === 'shared_by_me' || currentCloudView === 'recent' || currentCloudView === 'starred') {
        await NV_Alert(window.currentLang === "en" ? "Move is not available in this view." : "Mover no está disponible en esta vista.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }

    const isItemProtected = (it) => !!(it.row && it.row.getAttribute && it.row.getAttribute('data-protected') === 'true');
    const protectedCount = SELECTED_CLOUD_ITEMS.filter(isItemProtected).length;

    if (protectedCount === SELECTED_CLOUD_ITEMS.length) {
        await NV_Alert(window.t_cloud('cloud_move_protected_all', window.currentLang === 'en' ? 'Protected items cannot be moved. Unprotect them first.' : 'No puedes mover los elementos protegidos. Desprotégelos primero para poder moverlos.'), window.t_cloud('confirm_action_title', 'Confirmar acción'));
        return;
    }

    if (protectedCount > 0) {
        const skippedMsg = window.t_cloud('cloud_move_protected_skip', window.currentLang === 'en' ? '{0} protected item(s) will not be moved' : '{0} elemento(s) protegido(s) no se moverá(n)').replace('{0}', protectedCount);
        await NV_Alert(skippedMsg, window.t_cloud('confirm_action_title', 'Confirmar acción'));
    }

    isMultiMove = true;
    multiMoveItems = SELECTED_CLOUD_ITEMS.filter(it => !isItemProtected(it));
    moveTargetNewPath = '';

    const modal = document.getElementById('cloud-move-modal');
    if (!modal) {
        await NV_Alert("Error: El modal de mover no se encuentra.");
        return;
    }

    const titleActionEl = document.getElementById('move-modal-title-action');
    if (titleActionEl) titleActionEl.innerText = window.t_cloud('ctx_move_title', 'Mover');

    const btnConfirm = document.getElementById('btn-confirm-move');
    if (btnConfirm) btnConfirm.innerText = window.t_cloud('btn_move_here', 'Mover aquí');

    const nameEl = document.getElementById('move-filename');
    if (nameEl) {
        const count = multiMoveItems.length;
        const itemsStr = count === 1 ? window.t_cloud('selected_single', 'seleccionado') : window.t_cloud('selected_plural', 'seleccionados');
        const elementStr = count === 1 ? window.t_cloud('item_single', 'elemento') : window.t_cloud('item_plural', 'elementos');
        nameEl.innerText = `${count} ${elementStr} ${itemsStr}`;
    }

    const displayEl = document.getElementById('move-selected-path-display');
    if (displayEl) displayEl.innerText = '/ (' + window.t_cloud('nav_drive', 'Mi unidad') + ')';

    modal.style.display = 'flex';
    await loadCloudFoldersTree();
}

async function deleteSelectedItems() {
    if (SELECTED_CLOUD_ITEMS.length === 0) return;

    const isPermanent = currentCloudView === 'trash';
    const isComputer = currentCloudView === 'computers' && currentCloudPath === '';
    const isShared = currentCloudView === 'shared';
    const isSharedByMe = currentCloudView === 'shared_by_me';
    const isStarred = currentCloudView === 'starred';

    if (isShared) {
        await NV_Alert(window.currentLang === "en" ? "You cannot delete or remove items shared with you." : "No puedes eliminar ni quitar elementos compartidos contigo.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }

    if (isStarred) {
        await NV_Alert(window.t_cloud('cloud_delete_starred', window.currentLang === "en" ? "You cannot delete items from the Starred view. Go to the item's folder to delete it." : "No puedes eliminar elementos desde la vista de Destacados. Ve a la carpeta del elemento para eliminarlo."), window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }

    let msg = window.t_cloud('confirm_trash_multi', '¿Mover los') + ' ' + SELECTED_CLOUD_ITEMS.length + ' ' + window.t_cloud('items_selected_to_trash', 'elementos seleccionados a la papelera?');
    if (isSharedByMe) {
        msg = window.t_cloud('confirm_unshare_by_me_multi', window.currentLang === 'en' ? 'The selected {0} item(s) will no longer be shared. Continue?' : 'Se dejará de compartir {0} elemento(s) seleccionado(s). ¿Continuar?').replace('{0}', SELECTED_CLOUD_ITEMS.length);
    } else if (isPermanent) {
        msg = window.t_cloud('confirm_delete_permanent', '¿Eliminar PERMANENTEMENTE') + ' ' + SELECTED_CLOUD_ITEMS.length + ' ' + window.t_cloud('items_selected', 'elementos seleccionados') + '?';
    } else if (isComputer) {
        msg = SELECTED_CLOUD_ITEMS.length === 1
            ? window.t_cloud('confirm_unlink', '¿Desvincular y eliminar por completo la computadora') + ` "${SELECTED_CLOUD_ITEMS[0].name}"?`
            : window.t_cloud('confirm_unlink_multi', '¿Desvincular y eliminar por completo las') + ' ' + SELECTED_CLOUD_ITEMS.length + ' ' + window.t_cloud('computers_selected', 'computadoras seleccionadas') + '?';
    }

    if (!await NV_Confirm(msg, window.t_cloud('confirm_action_title', 'Confirmar acción'), window.t_cloud('btn_confirm_action', 'Confirmar'), window.t_cloud('btn_cancel', 'Cancelar'))) return;

    let deletedCount = 0;
    for (const item of SELECTED_CLOUD_ITEMS) {
        try {
            const itemView = item.row.getAttribute('data-view') || currentCloudView;
            let res;
            if (isShared || isSharedByMe || itemView === 'shared') {
                res = await fetch('/api/cloud/unshare', {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ name: item.name, path: item.path, owner_id: item.ownerId })
                });
            } else {
                res = await fetch('/api/cloud/delete', {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ name: item.name, path: item.path, view: currentCloudView === 'trash' ? 'trash' : itemView, id: item.row.getAttribute('data-trash-id') || null })
                });
            }
            if (res.ok) {
                deletedCount++;
            }
        } catch (err) {
            console.error("Error al eliminar item:", err);
        }
    }

    if (deletedCount > 0) {
        fetchCloudFiles(currentCloudPath, currentCloudView);
        clearCloudSelection();
        closeCloudInfoPanel();
        if (isSharedByMe) {
            await NV_Alert(window.t_cloud('unshared_success', window.currentLang === 'en' ? 'Stopped sharing.' : 'Se dejó de compartir.'), window.t_cloud('confirm_action_title', 'Confirmar acción'));
        }
    }
}

async function restoreSelectedItems() {
    if (SELECTED_CLOUD_ITEMS.length === 0) return;

    let restoredCount = 0;
    const itemsToRestore = [...SELECTED_CLOUD_ITEMS];

    for (const item of itemsToRestore) {
        const trashId = item.row.getAttribute('data-trash-id') || null;
        if (!trashId) continue;
        try {
            const res = await fetch('/api/cloud/restore', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ id: trashId })
            });
            if (res.ok) {
                restoredCount++;
            }
        } catch (err) {
            console.error("Error al restaurar elemento seleccionando:", err);
        }
    }

    if (restoredCount > 0) {
        fetchCloudFiles(currentCloudPath, currentCloudView);
        clearCloudSelection();
        closeCloudInfoPanel();
    }
}

function initMarqueeSelection() {
    const list = document.getElementById('cloud-file-list');
    if (!list) return;

    document.addEventListener('keydown', (e) => {
        const viewCloud = document.getElementById('view-cloud');
        const cloudActive = viewCloud && viewCloud.classList.contains('active');

        if (e.key === 'Escape' && cloudActive) {
            clearCloudSelection();
        }

        // Tecla Supr: con elementos seleccionados actúa como el botón
        // "Eliminar" (misma confirmación, misma lógica).
        if ((e.key === 'Delete' || e.key === 'Supr') && cloudActive) {
            if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (e.target.closest('.cloud-modal, #nv-dialog-overlay')) return;
            if (SELECTED_CLOUD_ITEMS.length > 0) {
                e.preventDefault();
                deleteSelectedItems();
            }
        }
    });

    list.addEventListener('mousedown', (e) => {

        if (e.button !== 0) return;
        if (currentCloudView === 'home') return;
        if (e.target.closest('.cloud-file-row') || e.target.closest('.cloud-folder-row') || e.target.closest('.cloud-file-card') || e.target.closest('button') || e.target.closest('.cloud-sidebar') || e.target.closest('.cloud-header') || e.target.closest('.cloud-table-header')) return;

        const initialStartX = e.clientX;
        const initialStartY = e.clientY;
        const startScrollY = list.scrollTop;

        let selectionBox = document.getElementById('cloud-drag-selection-box');
        if (!selectionBox) {
            selectionBox = document.createElement('div');
            selectionBox.id = 'cloud-drag-selection-box';
            selectionBox.style.position = 'fixed';
            selectionBox.style.border = '1.5px dashed var(--indigo)';
            selectionBox.style.background = 'rgba(99, 102, 241, 0.12)';
            selectionBox.style.borderRadius = '4px';
            selectionBox.style.pointerEvents = 'none';
            selectionBox.style.zIndex = '99999';
            selectionBox.style.display = 'none';
            document.body.appendChild(selectionBox);
        }

        let isDragging = false;

        function onMouseMove(moveEvent) {
            const currentScrollY = list.scrollTop;
            const scrollDiff = currentScrollY - startScrollY;

            const startX = initialStartX;
            const startY = initialStartY - scrollDiff;

            const currentX = moveEvent.clientX;
            const currentY = moveEvent.clientY;

            if (!isDragging && (Math.abs(currentX - startX) > 5 || Math.abs(currentY - startY) > 5)) {
                isDragging = true;
                selectionBox.style.display = 'block';

                if (!moveEvent.ctrlKey && !moveEvent.shiftKey && !moveEvent.metaKey) {
                    clearCloudSelection();
                }
            }

            if (isDragging) {
                const left = Math.min(startX, currentX);
                const top = Math.min(startY, currentY);
                const width = Math.abs(startX - currentX);
                const height = Math.abs(startY - currentY);

                selectionBox.style.left = `${left}px`;
                selectionBox.style.top = `${top}px`;
                selectionBox.style.width = `${width}px`;
                selectionBox.style.height = `${height}px`;

                list.querySelectorAll('.cloud-file-row, .cloud-folder-row, .cloud-file-card').forEach(row => {
                    const rowRect = row.getBoundingClientRect();
                    const boxRect = {
                        left: left,
                        top: top,
                        right: left + width,
                        bottom: top + height
                    };

                    const intersects = !(
                        rowRect.right < boxRect.left ||
                        rowRect.left > boxRect.right ||
                        rowRect.bottom < boxRect.top ||
                        rowRect.top > boxRect.bottom
                    );

                    const name = row.getAttribute('data-name');
                    const path = row.getAttribute('data-path');
                    const isDir = row.getAttribute('data-is-dir') === 'true';
                    const ownerId = row.getAttribute('data-owner-id');
                    const checkbox = row.querySelector('.cloud-file-checkbox');

                    if (intersects) {
                        if (checkbox && !checkbox.checked) {
                            checkbox.checked = true;
                            row.classList.add('selected');
                            if (!SELECTED_CLOUD_ITEMS.some(item => item.row === row)) {
                                SELECTED_CLOUD_ITEMS.push({ name, path, isDir, ownerId, row });
                            }
                        }
                    } else {

                        if (!moveEvent.ctrlKey && !moveEvent.shiftKey && !moveEvent.metaKey) {
                            if (checkbox && checkbox.checked) {
                                checkbox.checked = false;
                                row.classList.remove('selected');
                                SELECTED_CLOUD_ITEMS = SELECTED_CLOUD_ITEMS.filter(item => item.row !== row);
                            }
                        }
                    }
                });
                updateCloudMultiSelectBar();
            }
        }

        function onMouseUp(upEvent) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (selectionBox) {
                selectionBox.style.display = 'none';
            }

            if (!isDragging && !upEvent.ctrlKey && !upEvent.shiftKey && !upEvent.metaKey) {
                clearCloudSelection();
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// Lectura en tiempo de evaluación del módulo: en WebViews/shells con
// almacenamiento restringido localStorage puede lanzar SecurityError y
// tumbar TODO el módulo (pantalla en blanco en la carga en frío).
let currentCloudLayout = 'list';
try {
    currentCloudLayout = localStorage.getItem('nullvoid_cloud_layout') || 'list';
} catch (e) { /* storage no disponible */ }

function setCloudLayout(layout) {
    currentCloudLayout = layout;
    try { localStorage.setItem('nullvoid_cloud_layout', layout); } catch (e) { /* noop */ }

    const btnList = document.getElementById('btn-cloud-layout-list');
    const btnGrid = document.getElementById('btn-cloud-layout-grid');

    if (btnList && btnGrid) {
        if (layout === 'grid') {
            btnList.style.background = 'transparent';
            btnList.style.color = 'var(--text-muted)';
            btnGrid.style.background = 'var(--indigo)';
            btnGrid.style.color = '#fff';
        } else {
            btnList.style.background = 'var(--indigo)';
            btnList.style.color = '#fff';
            btnGrid.style.background = 'transparent';
            btnGrid.style.color = 'var(--text-muted)';
        }
    }

    updateTableHeaderVisibility(currentCloudView, currentCloudPath);

    if (typeof CLOUD_FILES !== 'undefined' && CLOUD_FILES) {
        renderCloudFiles(CLOUD_FILES, currentCloudView === 'home' || currentCloudView === 'recent');
    }
}

function initCloudLayout() {
    let layout = 'list';
    try { layout = localStorage.getItem('nullvoid_cloud_layout') || 'list'; } catch (e) { /* noop */ }
    setCloudLayout(layout);
}

function initDragAndDropUpload() {
    const viewCloud = document.getElementById('view-cloud');
    const overlay = document.getElementById('cloud-drop-overlay');
    const targetNameSpan = document.getElementById('cloud-drop-target-name');
    if (!viewCloud || !overlay) return;

    let dragTimer = null;
    let activeDropPath = '';
    let activeDropView = 'drive';

    function isDragExternalFiles(e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return false;
        for (let i = 0; i < e.dataTransfer.types.length; i++) {
            if (e.dataTransfer.types[i] === 'Files') {
                return true;
            }
        }
        return false;
    }

    function getCurrentFolderName() {
        if (!currentCloudPath) {
            if (currentCloudView === 'computers') return window.t_cloud('nav_computers', 'Computadoras');
            if (currentCloudView === 'trash') return window.t_cloud('nav_trash', 'Papelera');
            return window.t_cloud('nav_drive', 'Mi unidad');
        }
        const parts = currentCloudPath.split('/');
        return parts[parts.length - 1];
    }

    function updateOverlayTarget(name, isDir) {
        if (targetNameSpan) {
            // Iconos vectoriales que heredan el color del CSS (.cloud-drop-target-icon)
            const icon = isDir
                ? '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
                : '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>';
            targetNameSpan.innerHTML = `<span class="cloud-drop-target-icon">${icon}</span> ${name}`;
        }
    }

    window.addEventListener('dragover', (e) => {
        if (!isDragExternalFiles(e)) return;

        const viewCloudActive = document.getElementById('view-cloud');
        if (!viewCloudActive || !viewCloudActive.classList.contains('active')) return;

        const isAllowedView = (currentCloudView === 'drive' || (currentCloudView === 'computers' && currentCloudPath !== ''));
        if (!isAllowedView) return;

        e.preventDefault();

        if (!overlay.classList.contains('active')) {
            overlay.classList.add('active');
            activeDropPath = currentCloudPath;
            activeDropView = currentCloudView;
            updateOverlayTarget(getCurrentFolderName(), false);
        }

        if (dragTimer) {
            clearTimeout(dragTimer);
        }

        dragTimer = setTimeout(() => {
            overlay.classList.remove('active');
            document.querySelectorAll('.cloud-folder-row, .cloud-file-row').forEach(el => {
                el.classList.remove('external-drop-target');
            });
        }, 200);

        const folderEl = e.target.closest('.cloud-folder-row, .cloud-file-row[data-is-dir="true"]');

        document.querySelectorAll('.cloud-folder-row, .cloud-file-row').forEach(el => {
            if (el !== folderEl) el.classList.remove('external-drop-target');
        });

        if (folderEl) {
            folderEl.classList.add('external-drop-target');
            const folderName = folderEl.getAttribute('data-name');
            const folderPath = folderEl.getAttribute('data-path');

            activeDropPath = [folderPath, folderName].filter(Boolean).join('/');
            activeDropView = currentCloudView;
            updateOverlayTarget(folderName, true);
        } else {
            activeDropPath = currentCloudPath;
            activeDropView = currentCloudView;
            updateOverlayTarget(getCurrentFolderName(), false);
        }
    });

    window.addEventListener('drop', async (e) => {
        if (!isDragExternalFiles(e)) return;

        const viewCloudActive = document.getElementById('view-cloud');
        if (!viewCloudActive || !viewCloudActive.classList.contains('active')) return;

        const isAllowedView = (currentCloudView === 'drive' || (currentCloudView === 'computers' && currentCloudPath !== ''));
        if (!isAllowedView) return;

        e.preventDefault();

        if (dragTimer) {
            clearTimeout(dragTimer);
            dragTimer = null;
        }

        overlay.classList.remove('active');

        document.querySelectorAll('.cloud-folder-row, .cloud-file-row').forEach(el => {
            el.classList.remove('external-drop-target');
        });

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        if (activeDropView === 'trash') {
            NV_Alert(window.currentLang === "en" ? "Cannot upload files directly to Trash." : "No se pueden subir archivos directamente a la Papelera.", window.currentLang === "en" ? "Restriction" : "Restricción");
            return;
        }

        const targetFolderName = targetNameSpan ? targetNameSpan.textContent.trim() : getCurrentFolderName();



        await uploadFilesWithProgress(files, activeDropPath, activeDropView, false);


    });
}

function initClipboardPaste() {
    document.addEventListener('paste', async (e) => {
        // Only handle paste when cloud view is active
        const viewCloudActive = document.getElementById('view-cloud');
        if (!viewCloudActive || !viewCloudActive.classList.contains('active')) return;

        // Don't intercept paste if user is typing in an input/textarea
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;

        // Only allow paste in writable views
        const isAllowedView = (currentCloudView === 'drive' || (currentCloudView === 'computers' && currentCloudPath !== ''));
        if (!isAllowedView) return;

        const items = e.clipboardData?.items;
        if (!items || items.length === 0) return;

        const files = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    // Generate a meaningful name for clipboard images (screenshots)
                    if (file.name === 'image.png' || !file.name || file.name === 'blob') {
                        const now = new Date();
                        const timestamp = now.getFullYear().toString() +
                            String(now.getMonth() + 1).padStart(2, '0') +
                            String(now.getDate()).padStart(2, '0') + '_' +
                            String(now.getHours()).padStart(2, '0') +
                            String(now.getMinutes()).padStart(2, '0') +
                            String(now.getSeconds()).padStart(2, '0');
                        const ext = file.type.split('/')[1] || 'png';
                        const newName = `Clipboard_${timestamp}.${ext}`;
                        files.push(new File([file], newName, { type: file.type }));
                    } else {
                        files.push(file);
                    }
                }
            }
        }

        if (files.length === 0) return;

        e.preventDefault();
        await uploadFilesWithProgress(files, currentCloudPath, currentCloudView, false);
    });
}

async function handleZipItem() {
    if (!currentCloudContextItem) return;
    const item = currentCloudContextItem;
    const defaultZipName = (item.isDir ? item.name : item.name.substring(0, item.name.lastIndexOf('.')) || item.name) + '.zip';

    const zipName = await NV_Prompt(
        window.t_cloud('prompt_zip_name', 'Nombre del archivo .ZIP:'),
        defaultZipName,
        window.t_cloud('title_zip', 'Comprimir en .ZIP')
    );
    if (!zipName) return;

    try {
        const res = await fetch('/api/cloud/zip', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                view: item.view || currentCloudView,
                name: item.name,
                path: item.path || currentCloudPath,
                zip_name: zipName
            }),
            credentials: 'include'
        });
        const data = await _cloudJson(res);
        if (data.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
        } else {
            NV_Alert(data.error || 'Error al comprimir', 'Error');
        }
    } catch (e) {
        NV_Alert('Error de conexión al comprimir', 'Error');
    }
}

async function handleUnzipItem() {
    if (!currentCloudContextItem) return;
    const item = currentCloudContextItem;

    const confirm = await NV_Confirm(
        `¿Deseas descomprimir el archivo "${item.name}" en la carpeta actual?`,
        window.t_cloud('title_unzip', 'Descomprimir .ZIP')
    );
    if (!confirm) return;

    try {
        const res = await fetch('/api/cloud/unzip', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                view: item.view || currentCloudView,
                name: item.name,
                path: item.path || currentCloudPath
            }),
            credentials: 'include'
        });
        const data = await _cloudJson(res);
        if (data.ok) {
            fetchCloudFiles(currentCloudPath, currentCloudView);
        } else {
            NV_Alert(data.error || 'Error al descomprimir', 'Error');
        }
    } catch (e) {
        NV_Alert('Error de conexión al descomprimir', 'Error');
    }
}

// Menú de calidades dinámico: consulta el caché del servidor (available=1) y
// muestra ÚNICAMENTE las versiones ya generadas (+ las que se están
// transcodificando, como "Preparando…"). Las no generadas quedan ocultas:
// nada se procesa en segundo plano sin petición explícita (salvo el pre-warm
// de la calidad por defecto al abrir el vídeo).
function _renderVideoQualityMenu(token) {
    const menu = document.getElementById('video-quality-menu');
    if (!menu || !token) return;

const itemReady = (quality, label) => `
        <div onclick="window.changeVideoQuality('${jsStr(quality)}', '${jsStr(label)}', '${jsStr(token)}')" class="v-qual-item" style="padding: 8px 12px; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer; border-radius: 6px; font-weight: 500; display: flex; align-items: center; justify-content: space-between;"><span>${esc(label)}</span><span class="v-qual-check" style="display:none;">✓</span></div>`;
    const itemProcessing = (quality) => `
        <div style="padding: 8px 12px; font-size: 0.8rem; color: var(--text-muted); border-radius: 6px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; opacity: 0.7; cursor: default;"><span>${(window.t_cloud('video_preparing', 'Preparando') || 'Preparando')} ${esc(quality)}…</span></div>`;

    fetch(`/api/cloud/stream_video?t=${token}&available=1`, { cache: 'no-store' })
        .then(r => _cloudJson(r))
        .then(data => {
            const ready = data.available || [];
            const processing = data.processing || [];
            const skipped = data.skipped || [];
            const qLabel = (q) => q === '2160p' ? '2160p (4K)' : q;

            let html = `<div onclick="window.changeVideoQuality('original', 'Original', '${jsStr(token)}')" class="v-qual-item" style="padding: 8px 12px; font-size: 0.8rem; color: #fff; cursor: pointer; border-radius: 6px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;"><span>Original</span><span class="v-qual-check">✓</span></div>`;
            ready.forEach(q => { html += itemReady(q, qLabel(q)); });
            processing.forEach(q => { html += itemProcessing(q); });

            // El botón de generar solo aparece si faltan calidades que REALMENTE
            // puedan generarse (las descartadas por no-upscaling nunca lo harán).
            // Si el caché se purga (LRU), la calidad vuelve a "faltar" y el
            // botón reaparece automáticamente al re-consultar.
            const missing = VIDEO_QUALITY_ORDER.filter(q =>
                !ready.includes(q) && !processing.includes(q) && !skipped.includes(q));
            if (missing.length) {
                html += `<div style="padding: 8px 12px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.75rem; color: var(--text-secondary); cursor: pointer; border-radius: 6px; font-weight: 600; display: flex; align-items: center; gap: 6px;">${window.t_cloud('video_generate_all', 'Generar todas las calidades…')}</div>`;
            }
            menu.innerHTML = html;

            // Auto-refresh: si hay calidades transcodificándose y el menú sigue
            // abierto, se re-consulta cada 2.5s para habilitarlas en cuanto
            // estén listas, sin que el usuario tenga que cerrar y reabrir.
            if (processing.length && menu.style.display === 'block') {
                setTimeout(() => {
                    const m = document.getElementById('video-quality-menu');
                    if (m && m.style.display === 'block') {
                        _renderVideoQualityMenu(token);
                    }
                }, 2500);
            }
        })
        .catch(() => {
            menu.innerHTML = `<div onclick="window.changeVideoQuality('original', 'Original', '${jsStr(token)}')" class="v-qual-item" style="padding: 8px 12px; font-size: 0.8rem; color: #fff; cursor: pointer; border-radius: 6px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;"><span>Original</span><span class="v-qual-check">✓</span></div>`;
        });
}

// Genera bajo demanda TODAS las calidades restantes (una petición por calidad;
// el servidor las transcodifica en segundo plano y el menú las habilita al
// reabrirse). Solo se lanza si el usuario lo pide explícitamente.
window.generateVideoQualities = function (token) {
    if (!token) return;
    VIDEO_QUALITY_ORDER.forEach(q => {
        fetch(`/api/cloud/stream_video?t=${token}&quality=${q}&status=1`, { cache: 'no-store' }).catch(() => { });
    });
    _renderVideoQualityMenu(token);
};

function initCloud() {
    initMarqueeSelection();
    initCloudLayout();
    initDragAndDropUpload();
    initClipboardPaste();

    // Navegación por teclado dentro del visor múltiple (←/→ cambian de
    // documento, Esc cierra).
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('cloud-preview-modal');
        if (!modal || modal.style.display !== 'flex') return;
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            renderCloudPreviewItem(_previewIndex + 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            renderCloudPreviewItem(_previewIndex - 1);
        } else if (e.key === 'Escape') {
            closeCloudPreview();
        }
    });

    // Cierre global del menú "…" del breadcrumb (click fuera, scroll o resize)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.breadcrumb-more')) closeBreadcrumbMenus();
    });
    window.addEventListener('scroll', closeBreadcrumbMenus, true);
    window.addEventListener('resize', closeBreadcrumbMenus);

    window.addEventListener('language_changed', () => {
        if (typeof fetchCloudFiles === 'function') {
            fetchCloudFiles(currentCloudPath || '', currentCloudView || 'drive');
        }
    });

    Object.assign(window, {
        fetchCloudFiles, updateCloudQuotaInfo, filterCloudFiles, navigateCloud,
        handleCloudNavClick, renderCloudFiles, renderCloudBreadcrumbs,
        handleCloudUpload, deleteCloudItem, requestMoreCloudQuota,
        fetchAdminQuotaRequests, resolveQuotaRequest,
        setCloudLayout, handleCloudAction, handleCloudRowClick,
        triggerNewItemAction, openLinkDeviceModal, removeSelectedUser,
        emptyCloudTrash, downloadCloudFile, downloadSelectedItems,
        showCloudNewMenu, clearCloudSelection, closeCloudMoveModal,
        confirmCloudMove, closeCloudPreview,
        openCloudMultiPreview,
        downloadSelectedAsZip, deleteSelectedItems, moveSelectedItems,
        restoreSelectedItems, closeCloudInfoPanel, handleGenerateLinkToken,
        loadCloudFoldersTree, openCloudMove,
        openCloudPreview, openCloudShare, executeNewItemAction,
        renderListRow, renderFolderNode,
        closeLinkDeviceModal, setLinkDeviceOS, downloadClientAgent,
        copySyncCommand, toggleCloudInfoPanel, switchCloudInfoTab,
        confirmCloudShare, closeCloudShareModal, handleCreateFolder,
        generateSyncCommand, searchUsersForSharing,
        selectUserForSharing, refreshCloudInfoPanel, showCloudInfo,
        handleUnshareItem, revokeCloudShare,
        toggleCloudFileSelection,
        handleZipItem, handleUnzipItem,
        toggleBreadcrumbMenu, closeBreadcrumbMenus,
        toggleVideoQualityMenu: function (e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById('video-quality-menu');
            if (!menu) return;
            if (menu.style.display === 'none') {
                // Re-consulta el caché cada vez que se abre: las calidades que
                // ya se generaron aparecen listas; las que están transcodificándose
                // se muestran como "Preparando…"; el resto queda oculto.
                _renderVideoQualityMenu(_previewVideoToken);
                menu.style.display = 'block';
            } else {
                menu.style.display = 'none';
            }
        },
        changeVideoQuality: function (quality, labelText, token) {
            // Cada cambio de calidad invalida los pollings anteriores.
            const reqId = ++_videoQualReqId;

            const menu = document.getElementById('video-quality-menu');
            if (menu) menu.style.display = 'none';

            const lbl = document.getElementById('video-quality-label');

            const items = document.querySelectorAll('.v-qual-item');
            items.forEach(el => {
                const match = el.innerText.includes(labelText);
                el.style.color = match ? '#fff' : 'var(--text-secondary)';
                el.style.fontWeight = match ? '600' : '500';
                const check = el.querySelector('.v-qual-check');
                if (check) check.style.display = match ? 'inline' : 'none';
            });

            const video = document.getElementById('preview-video-player');
            if (!video) return;

            const currentTime = video.currentTime || 0;
            const isPaused = video.paused;
            const newSrc = `/api/cloud/stream_video?t=${token}&quality=${quality}`;

            const isStale = () => reqId !== _videoQualReqId;

            // Cambio de calidad SIN parpadeo: la nueva fuente se precarga en un
            // elemento oculto; cuando ya tiene datos (loadeddata) se reemplaza
            // el reproductor visible por uno nuevo con la misma posición y
            // estado de reproducción. El elemento anterior nunca se vacía.
            const applySrc = function () {
                if (isStale()) return;
                if (lbl) lbl.innerText = labelText;

                const wasPlaying = !isPaused && !video.paused;
                const time = currentTime || video.currentTime || 0;

                let swapped = false;
                const swap = function () {
                    if (isStale() || swapped) return;
                    swapped = true;
                    const parent = video.parentElement;
                    if (!parent) return;
                    const next = document.createElement('video');
                    next.id = 'preview-video-player';
                    next.controls = true;
                    next.style.cssText = 'width: 100%; height: auto; max-height: 75vh; border-radius: 8px; display: block; background: #000;';
                    next.src = newSrc;
                    next.addEventListener('loadedmetadata', function h() {
                        try {
                            if (time > 0 && time < next.duration) next.currentTime = time;
                        } catch (e) { }
                        next.removeEventListener('loadedmetadata', h);
                    });
                    if (wasPlaying) {
                        const tryPlay = () => next.play().catch(() => { });
                        next.addEventListener('canplay', tryPlay);
                        next.addEventListener('playing', () => next.removeEventListener('canplay', tryPlay));
                    }
                    parent.replaceChild(next, video);
                    _initVideoProgressTracking(_previewVideoKey, false);
                    if (next.readyState >= 2 && wasPlaying) next.play().catch(() => { });
                };

                if (quality === 'original') {
                    swap();
                    return;
                }

                const tmp = document.createElement('video');
                tmp.preload = 'auto';
                tmp.muted = true;
                const onReady = () => { swap(); cleanup(); };
                const cleanup = () => {
                    tmp.removeEventListener('loadeddata', onReady);
                    tmp.removeEventListener('canplay', onReady);
                    tmp.removeAttribute('src');
                };
                tmp.addEventListener('loadeddata', onReady);
                tmp.addEventListener('canplay', onReady);
                tmp.addEventListener('error', () => { swap(); cleanup(); });
                tmp.src = newSrc;
                tmp.load();

                setTimeout(() => {
                    if (!swapped) {
                        swap();
                        cleanup();
                    }
                }, 2500);
            };

            const pollReady = function (attempt) {
                if (isStale()) return;
                if (lbl && attempt > 0) {
                    lbl.innerText = (window.t_cloud('video_preparing', 'Preparando') || 'Preparando') + ' ' + labelText + '…';
                }
                fetch(newSrc + '&status=1', { headers: { 'Range': 'bytes=0-1024' }, cache: 'no-store' })
                    .then(res => {
                        if (isStale()) return;
                        if (res.status === 202) {
                            setTimeout(() => pollReady(attempt + 1), 1500);
                            return;
                        }
                        // Solo se aplica si el servidor responde un vídeo real
                        // (2xx); un 403/500 deja el vídeo actual intacto.
                        if (res.ok) {
                            applySrc();
                        } else if (attempt < 8) {
                            setTimeout(() => pollReady(attempt + 1), 1500);
                        } else if (lbl) {
                            lbl.innerText = labelText;
                        }
                    })
                    .catch(() => {
                        if (isStale()) return;
                        if (attempt < 60) setTimeout(() => pollReady(attempt + 1), 1500);
                        else if (lbl) lbl.innerText = labelText;
                    });
            };
            pollReady(0);
        }
    });

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('video-quality-menu');
        if (menu && !e.target.closest('#video-quality-menu') && !e.target.closest('button')) {
            menu.style.display = 'none';
        }
    });
}

let _tokenTimerInterval = null;

async function handleGenerateLinkToken() {
    try {
        if (_tokenTimerInterval) clearInterval(_tokenTimerInterval);

        const pcName = currentCloudContextItem ? currentCloudContextItem.name : '';
        const res = await fetch('/api/cloud/sync-agent/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_device: pcName })
        });
        const data = await _cloudJson(res);
        if (res.ok && data.temp_token) {
            const introText = window.currentLang === 'en'
                ? `Enter this token in the desktop app to connect <b style="color: #e8edf8;">${pcName || 'your device'}</b>:`
                : `Introduce este token en la aplicación de escritorio para conectar <b style="color: #e8edf8;">${pcName || 'tu dispositivo'}</b>:`;
            const copyToast = window.currentLang === 'en' ? 'Token copied to clipboard' : 'Token copiado al portapapeles';
            
            let secondsLeft = data.remaining_seconds !== undefined ? Math.max(0, parseInt(data.remaining_seconds)) : 300;
            const initialMins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
            const initialSecs = String(secondsLeft % 60).padStart(2, '0');

            const msg = `
                <div style="text-align: center; padding: 4px 0;">
                    <p style="margin-bottom: 14px; font-size: 0.88rem; color: var(--text-muted, #8b95b0); line-height: 1.4;">
                        ${introText}
                    </p>
                    <div id="nv-token-box" style="font-family: monospace; font-size: 1.05rem; font-weight: 700; color: #a5b4fc; background: rgba(99, 102, 241, 0.12); border: 1px dashed rgba(99, 102, 241, 0.4); border-radius: 10px; padding: 12px 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: all; cursor: pointer; transition: all 0.3s ease;"
                         onmouseover="if(!this.dataset.expired){ this.style.background='rgba(99, 102, 241, 0.25)'; this.style.borderColor='#818cf8'; }"
                         onmouseout="if(!this.dataset.expired){ this.style.background='rgba(99, 102, 241, 0.12)'; this.style.borderColor='rgba(99, 102, 241, 0.4)'; }"
                         onclick="if(!this.dataset.expired){ navigator.clipboard.writeText('${jsStr(data.temp_token)}'); const alertToast = document.getElementById('nv-copy-toast'); if(alertToast){ alertToast.style.opacity='1'; setTimeout(()=>alertToast.style.opacity='0', 2000); } }">
                        <span id="nv-token-text">${esc(data.temp_token)}</span>
                    </div>
                    <div id="nv-copy-toast" style="opacity: 0; transition: opacity 0.3s; font-size: 0.78rem; color: #34d399; font-weight: 600; margin-top: 6px; height: 18px;">
                        ${copyToast}
                    </div>
                    <div id="nv-timer-badge" style="margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); padding: 5px 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); transition: all 0.3s ease;">
                        <svg id="nv-timer-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span id="nv-token-timer" style="font-size: 0.80rem; font-weight: 700; color: #818cf8; font-family: monospace;">${initialMins}:${initialSecs}</span>
                    </div>
                    <p id="nv-token-expiry-hint" style="margin-top: 10px; font-size: 0.78rem; color: #8b95b0; font-weight: 500; transition: color 0.3s ease;">
                        ${window.currentLang === 'en' ? 'Token expires in 5 minutes (one-time use).' : 'Este token es de un solo uso y expira en 5 minutos.'}
                    </p>
                </div>
            `;

            // Iniciar temporizador regresivo y verificación de uso
            _tokenTimerInterval = setInterval(async () => {
                secondsLeft--;
                const timerEl = document.getElementById('nv-token-timer');
                const tokenBox = document.getElementById('nv-token-box');
                const expiryHint = document.getElementById('nv-token-expiry-hint');
                const timerIcon = document.getElementById('nv-timer-icon');

                const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
                const secs = String(secondsLeft % 60).padStart(2, '0');

                if (timerEl && secondsLeft >= 0) {
                    timerEl.innerText = `${mins}:${secs}`;
                }

                // Consultar si la app ya usó el token
                if ((secondsLeft % 2 === 0 && secondsLeft > 0) || secondsLeft === data.remaining_seconds) {
                    try {
                        const checkRes = await fetch('/api/cloud/sync-agent/check-token-status', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ temp_token: data.temp_token, target_device: pcName })
                        });
                        const checkData = await _cloudJson(checkRes);
                        if (checkData.used) {
                            if (_tokenTimerInterval) {
                                clearInterval(_tokenTimerInterval);
                                _tokenTimerInterval = null;
                            }

                            if (tokenBox) {
                                tokenBox.dataset.expired = 'true';
                                tokenBox.style.background = 'rgba(16, 185, 129, 0.12)';
                                tokenBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                                tokenBox.style.color = '#34d399';
                                tokenBox.style.cursor = 'default';
                            }
                            if (timerEl) {
                                timerEl.innerText = window.currentLang === 'en' ? 'Linked' : 'Vinculado';
                                timerEl.style.color = '#34d399';
                            }
                            if (timerIcon) {
                                timerIcon.setAttribute('stroke', '#34d399');
                            }
                            if (expiryHint) {
                                expiryHint.style.color = '#34d399';
                                expiryHint.style.fontWeight = '600';
                                const dName = checkData.device_name || pcName;
                                expiryHint.innerText = window.currentLang === 'en'
                                    ? `✔ Vinculado correctamente${dName ? ' (' + dName + ')' : ''}`
                                    : `✔ Vinculado correctamente${dName ? ' (' + dName + ')' : ''}`;
                            }
                            if (typeof fetchCloudFiles === 'function') {
                                fetchCloudFiles();
                            }
                            return;
                        }
                    } catch (e) {}
                }

                if (secondsLeft <= 0) {
                    clearInterval(_tokenTimerInterval);
                    _tokenTimerInterval = null;

                    if (timerEl) {
                        timerEl.innerText = '00:00';
                        timerEl.style.color = '#8b95b0';
                    }
                    if (timerIcon) {
                        timerIcon.setAttribute('stroke', '#8b95b0');
                    }
                    if (tokenBox) {
                        tokenBox.dataset.expired = 'true';
                        tokenBox.style.opacity = '0.45';
                        tokenBox.style.background = 'rgba(255, 255, 255, 0.04)';
                        tokenBox.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                        tokenBox.style.color = '#8b95b0';
                        tokenBox.style.cursor = 'default';
                    }
                    if (expiryHint) {
                        expiryHint.style.color = '#8b95b0';
                        expiryHint.style.fontWeight = '500';
                        expiryHint.innerText = window.currentLang === 'en'
                            ? 'Token expired. Generate a new one from the menu.'
                            : 'Token expirado. Genera uno nuevo desde el menú.';
                    }
                }
            }, 1000);

            await NV_Alert(msg, window.t_cloud('title_token', 'Token de Enlace Generado'));
            if (_tokenTimerInterval) {
                clearInterval(_tokenTimerInterval);
                _tokenTimerInterval = null;
            }
        } else {
            await NV_Alert(data.error || (window.currentLang === 'en' ? 'Could not generate token.' : 'No se pudo generar el token.'));
        }
    } catch (e) {
        await NV_Alert(window.currentLang === 'en' ? 'Connection error generating token.' : 'Error de conexión al generar el token.');
    }
}

export { fetchCloudFiles, updateCloudQuotaInfo, filterCloudFiles, navigateCloud, handleCloudNavClick, renderCloudFiles, renderCloudBreadcrumbs, handleCloudUpload, deleteCloudItem, initCloud, handleZipItem, handleUnzipItem };
