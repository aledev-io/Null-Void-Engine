/* System and Marketplace Logic */

let APPS = [];

async function fetchApps() {
    try {
        const res = await fetch('/api/system/apps', { headers: HEADERS });
        APPS = await res.json();
        renderAppLauncher();
    } catch (err) {
        console.error("Error cargando apps:", err);
    }
}

function renderAppLauncher() {
    const grid = document.getElementById('app-launcher-grid');
    if (!grid) return;

    // Cargar orden guardado
    try {
        const savedOrder = localStorage.getItem('app_order');
        if (savedOrder) {
            const orderArray = JSON.parse(savedOrder);
            APPS.sort((a, b) => {
                const idxA = orderArray.indexOf(a.id);
                const idxB = orderArray.indexOf(b.id);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        }
    } catch (e) {
        console.error("Error al cargar orden de apps:", e);
    }

    grid.innerHTML = APPS.map(app => `
        <div class="nav-btn" 
             onclick="handleAppAction(APPS.find(a => a.id === '${app.id}'))" 
             oncontextmenu="showContextMenu(event, '${app.id}')"
             data-app-id="${app.id}"
             id="nav-btn-${app.id}">
            <div class="nav-icon" style="position: relative;">
                ${app.icon}
                ${app.badge ? `<span id="${app.badge}" style="display: none; position: absolute; top: -5px; right: -5px; width: 10px; height: 10px; background: #f87171; border-radius: 50%; border: 2px solid var(--surface-hi); box-shadow: 0 0 8px rgba(248, 113, 113, 0.6);"></span>` : ''}
            </div>
            <div>
                <span class="nav-label">${app.name}</span>
                <span class="nav-desc">${app.desc}</span>
            </div>
        </div>
    `).join('');
}

function handleAppAction(app) {
    if (app.url) {
        if (app.url.startsWith('http')) {
            window.open(app.url, '_blank');
        } else {
            location.href = app.url;
        }
    } else {
        showView(app.id);
    }
}

let MARKETPLACE_MODULES = [];

async function fetchMarketplace() {
    try {
        const res = await fetch('/api/system/marketplace', { headers: HEADERS });
        MARKETPLACE_MODULES = await res.json();
        
        // Mantener el filtro actual si existe
        const query = document.getElementById('marketplace-search')?.value.toLowerCase() || '';
        if (query) {
            filterMarketplace();
        } else {
            renderMarketplace(MARKETPLACE_MODULES);
        }
    } catch (err) {
        console.error("Error cargando marketplace:", err);
    }
}

function filterMarketplace() {
    const query = document.getElementById('marketplace-search')?.value.toLowerCase() || '';
    const filtered = MARKETPLACE_MODULES.filter(m => 
        m.name.toLowerCase().includes(query) || 
        m.desc.toLowerCase().includes(query)
    );
    renderMarketplace(filtered);
}

function renderMarketplace(modules) {
    const grid = document.getElementById('marketplace-grid');
    if (!grid) return;

    grid.innerHTML = modules.map(m => `
        <div class="market-card">
            <div class="market-top">
                <div class="market-icon">${m.icon}</div>
                <div class="market-info">
                    <h3>${m.name}</h3>
                    <p>${m.desc}</p>
                </div>
            </div>
            <div class="market-actions">
                ${m.installed ?
                `<button class="btn-uninstall" onclick="uninstallModule('${m.id}')" ${m.core ? 'disabled' : ''}>
                        ${m.core ? 'Sistema' : 'Desinstalar'}
                    </button>` :
                `<button class="btn-install" onclick="installModule('${m.id}')">Instalar</button>`
            }
            </div>
        </div>
    `).join('');
}

async function installModule(id) {
    await fetch('/api/system/marketplace/install', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ id })
    });
    fetchApps();
    fetchMarketplace();
}

async function uninstallModule(id) {
    if (!await NV_Confirm('¿Seguro que quieres desinstalar este módulo?')) return;
    await fetch('/api/system/marketplace/uninstall', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ id })
    });
    fetchApps();
    fetchMarketplace();
}

async function reorderModules(ids) {
    try {
        await fetch('/api/system/reorder', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ modules: ids })
        });
    } catch (e) {
        console.error("Error al reordenar módulos:", e);
    }
}

