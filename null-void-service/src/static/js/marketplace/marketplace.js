let MARKETPLACE_MODULES = [];

export async function fetchMarketplace() {
    try {
        const res = await fetch('/api/system/marketplace', { headers: window.HEADERS });
        MARKETPLACE_MODULES = await res.json();
        const query = document.getElementById('marketplace-search')?.value.toLowerCase() || '';
        const typeFilter = document.getElementById('marketplace-filter-type')?.value || 'all';
        const statusFilter = document.getElementById('marketplace-filter-status')?.value || 'all';
        if (query || typeFilter !== 'all' || statusFilter !== 'all') {
            filterMarketplace();
        } else {
            const sortedModules = sortModules(MARKETPLACE_MODULES);
            renderMarketplace(sortedModules);
        }
    } catch (err) {
        console.error("Error cargando marketplace:", err);
    }
}

export function sortModules(modules) {
    return [...modules].sort((a, b) => {
        // System modules first (a.core == true)
        if (a.core && !b.core) return -1;
        if (!a.core && b.core) return 1;
        // Then sort alphabetically by name
        return a.name.localeCompare(b.name);
    });
}

export function filterMarketplace() {
    const query = document.getElementById('marketplace-search')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('marketplace-filter-type')?.value || 'all';
    const statusFilter = document.getElementById('marketplace-filter-status')?.value || 'all';

    let filtered = MARKETPLACE_MODULES.filter(m =>
        (m.name.toLowerCase().includes(query) || m.desc.toLowerCase().includes(query))
    );

    if (typeFilter === 'system') {
        filtered = filtered.filter(m => m.core === true);
    } else if (typeFilter === 'app') {
        filtered = filtered.filter(m => !m.core);
    }

    if (statusFilter === 'installed') {
        filtered = filtered.filter(m => m.installed === true);
    } else if (statusFilter === 'not_installed') {
        filtered = filtered.filter(m => !m.installed);
    }

    renderMarketplace(sortModules(filtered));
}

export function renderMarketplace(modules) {
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
            `<button class="btn-uninstall" onclick="window.uninstallModule('${m.id}')" ${m.core ? 'disabled' : ''}>
                        ${m.core ? 'Sistema' : 'Desinstalar'}
                    </button>` :
            `<button class="btn-install" onclick="window.installModule('${m.id}')">Instalar</button>`
        }
            </div>
        </div>
    `).join('');
}

export async function installModule(id) {
    await fetch('/api/system/marketplace/install', {
        method: 'POST',
        headers: window.HEADERS,
        body: JSON.stringify({ id })
    });
    fetchMarketplace();
}

export function NV_Confirm(text, title = "Confirmar acción") {
    return new Promise(resolve => {
        const overlay = document.getElementById('nv-dialog-overlay');
        if (!overlay) {
            resolve(confirm(text));
            return;
        }
        
        document.getElementById('nv-dialog-title').textContent = title;
        document.getElementById('nv-dialog-text').textContent = text;
        
        const cancelBtn = document.getElementById('nv-dialog-cancel');
        const confirmBtn = document.getElementById('nv-dialog-confirm');
        cancelBtn.style.display = 'inline-block';
        confirmBtn.textContent = 'Confirmar';

        const cleanup = () => {
            overlay.style.display = 'none';
        };

        confirmBtn.onclick = () => {
            cleanup();
            resolve(true);
        };
        cancelBtn.onclick = () => {
            cleanup();
            resolve(false);
        };

        overlay.style.display = 'flex';
    });
}

export async function uninstallModule(id) {
    if (!await NV_Confirm('¿Seguro que quieres desinstalar este módulo?')) return;
    await fetch('/api/system/marketplace/uninstall', {
        method: 'POST',
        headers: window.HEADERS,
        body: JSON.stringify({ id })
    });
    fetchMarketplace();
}

window.filterMarketplace = filterMarketplace;
window.installModule = installModule;
window.uninstallModule = uninstallModule;
