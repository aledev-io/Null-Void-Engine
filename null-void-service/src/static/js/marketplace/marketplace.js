let MARKETPLACE_MODULES = [];

export async function fetchMarketplace() {
    window.fetchMarketplace = fetchMarketplace;
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

    const icons = {
        'monitor': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
        'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        'admin': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        'marketplace': '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
        'invoices': '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
        'transactions': '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
        'backups': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
        'ai': '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
        'budgets': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
        'chat': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
        'friends': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        'mail': '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
        'scraper_pcc': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        'vault': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        'server_admin': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    };

    grid.innerHTML = modules.map(m => {
        let svgPath = '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>';
        if (icons[m.id]) {
            svgPath = icons[m.id];
        }
        let customIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;

        return `
        <div class="market-card">
            <div class="market-top">
                <div class="market-icon">${customIcon}</div>
                <div class="market-info">
                    <h3>${window.t('app_name_' + m.id) === 'app_name_' + m.id ? m.name : window.t('app_name_' + m.id)}</h3>
                    <p>${window.t('app_desc_' + m.id) === 'app_desc_' + m.id ? m.desc : window.t('app_desc_' + m.id)}</p>
                </div>
            </div>
            <div class="market-actions">
                ${m.installed ?
            `<button class="btn-uninstall" onclick="window.uninstallModule('${m.id}')" ${m.core ? 'disabled' : ''}>
                        ${m.core ? (window.t('market_system') === 'market_system' ? 'Sistema' : window.t('market_system')) : (window.t('market_uninstall') === 'market_uninstall' ? 'Desinstalar' : window.t('market_uninstall'))}
                    </button>` :
            `<button class="btn-install" onclick="window.installModule('${m.id}')">${window.t('market_install') === 'market_install' ? 'Instalar' : window.t('market_install')}</button>`
        }
            </div>
        </div>
        `;
    }).join('');
}

export async function installModule(id) {
    await fetch('/api/system/marketplace/install', {
        method: 'POST',
        headers: window.HEADERS,
        body: JSON.stringify({ id })
    });
    fetchMarketplace();
    if (typeof window.fetchApps === 'function') window.fetchApps();
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
    if (typeof window.fetchApps === 'function') window.fetchApps();
}

window.filterMarketplace = filterMarketplace;
window.installModule = installModule;
window.uninstallModule = uninstallModule;
