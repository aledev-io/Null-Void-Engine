/* UI and Navigation Logic */

function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + name);
    if (target) target.classList.add('active');

    if (name === 'marketplace') fetchMarketplace();
    if (name === 'backups') loadBackupConfig();
    if (name === 'monitor' || name === 'menu') startMetrics(); else stopMetrics();
    if (name === 'invoices') fetchInvoices();
    if (name === 'cloud') {
        setTimeout(async () => {
            try {
                await updateCloudQuotaInfo();
                await fetchCloudFiles('', 'home');
            } catch (e) { console.error("Error en carga inicial cloud:", e); }
        }, 300);
    }

    // Layout adjustments
    const main = document.getElementById('main');
    const topbar = document.getElementById('topbar');

    if (name === 'cloud') {
        main.classList.add('cloud-active');
        if (topbar) topbar.style.display = 'none';
        main.style.display = 'none';
        main.style.maxWidth = '100%';
        main.style.padding = '0';
    } else {
        main.classList.remove('cloud-active');
        if (topbar) topbar.style.display = 'flex';
        main.style.display = 'block';
        main.style.maxWidth = '1200px';
        main.style.padding = '40px 20px 20px 20px';
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    
    // Si el módulo de ajustes está cargado, guardamos en el servidor
    if (typeof saveUISettings === 'function') {
        saveUISettings('theme', next);
    } else {
        // Fallback local
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcon(next);
    }
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon-svg');
    if (!icon) return;
    if (theme === 'light') {
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    } else {
        icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    }
}

function updateNetStatus() {
    const badge = document.getElementById('net-badge');
    const text = document.getElementById('net-text');
    const dot = document.getElementById('net-dot');
    if (!badge || !text || !dot) return;

    if (navigator.onLine) {
        text.textContent = 'Online';
        text.style.color = 'var(--text-dim)';
        badge.style.borderColor = 'rgba(99,102,241,0.38)';
        badge.style.background = 'var(--indigo-dim)';
        dot.style.background = 'var(--indigo)';
        dot.style.boxShadow = '0 0 8px rgba(99,102,241,1)';
        dot.style.animation = 'pulse 2s infinite';
    } else {
        text.textContent = 'Offline';
        text.style.color = '#f87171';
        badge.style.borderColor = 'rgba(248,113,113,0.38)';
        badge.style.background = 'rgba(248,113,113,0.1)';
        dot.style.background = '#f87171';
        dot.style.boxShadow = '0 0 8px rgba(248,113,113,0.8)';
        dot.style.animation = 'none';
    }
}

// ── CONTEXT MENU LOGIC ──
let currentContextAppId = null;

function showContextMenu(e, appId = null) {
    e.preventDefault();
    currentContextAppId = appId;
    const menu = document.getElementById('context-menu');
    const moduleActions = document.getElementById('ctx-module-actions');
    if (!menu || !moduleActions) return;

    moduleActions.style.display = appId ? 'block' : 'none';
    menu.style.display = 'block';

    let x = e.clientX;
    let y = e.clientY;
    const menuWidth = 180;
    const menuHeight = appId ? 200 : 50;

    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

async function deleteModuleContext() {
    if (currentContextAppId) {
        const app = APPS.find(a => a.id === currentContextAppId);
        if (app && app.core) {
            await NV_Alert("Los módulos del sistema no se pueden eliminar.", "Restricción");
            return;
        }
        uninstallModule(currentContextAppId);
    }
}

async function moveModule(direction) {
    if (!currentContextAppId) return;
    const idx = APPS.findIndex(a => a.id === currentContextAppId);
    if (idx === -1) return;

    const newApps = [...APPS];
    if (direction === 'up' && idx > 0) {
        [newApps[idx], newApps[idx - 1]] = [newApps[idx - 1], newApps[idx]];
    } else if (direction === 'down' && idx < newApps.length - 1) {
        [newApps[idx], newApps[idx + 1]] = [newApps[idx + 1], newApps[idx]];
    } else {
        return;
    }

    try {
        const ids = newApps.map(a => a.id);
        await reorderModules(ids);
        APPS = newApps;
        renderAppLauncher();
    } catch (e) {
        console.error("Error al reordenar módulos:", e);
    }
}

async function handleLogout() {
    await fetch('/api/logout', { method: 'POST', headers: HEADERS }).catch(() => { });
    localStorage.removeItem('theme'); // Limpiar para que el próximo login empiece de cero
    location.href = '/';
}

// ── GLOBAL DIALOG SYSTEM (Alert / Prompt) ──
let dialogResolve = null;

function NV_Alert(text, title = "Null-Void") {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-dialog');
        document.getElementById('dialog-title').textContent = title;
        document.getElementById('dialog-text').textContent = text;
        document.getElementById('dialog-input').style.display = 'none';
        document.getElementById('dialog-cancel-btn').style.display = 'none';
        
        const confirmBtn = document.getElementById('dialog-confirm-btn');
        confirmBtn.textContent = "Aceptar";
        
        dialogResolve = resolve;
        confirmBtn.onclick = () => {
            dialogResolve = null;
            NV_CloseDialog();
            resolve(true);
        };
        modal.classList.add('show');
    });
}

function NV_Prompt(text, defaultValue = "", title = "Entrada requerida") {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-dialog');
        document.getElementById('dialog-title').textContent = title;
        document.getElementById('dialog-text').textContent = text;
        const input = document.getElementById('dialog-input');
        input.style.display = 'block';
        input.value = defaultValue;
        document.getElementById('dialog-cancel-btn').style.display = 'block';
        
        const confirmBtn = document.getElementById('dialog-confirm-btn');
        confirmBtn.textContent = "Aceptar";
        
        dialogResolve = resolve;
        confirmBtn.onclick = () => {
            const val = input.value;
            dialogResolve = null;
            NV_CloseDialog();
            resolve(val);
        };
        document.getElementById('dialog-cancel-btn').onclick = () => {
            dialogResolve = null;
            NV_CloseDialog();
            resolve(null);
        };
        
        modal.classList.add('show');
        setTimeout(() => input.focus(), 200);
    });
}

function NV_Confirm(text, title = "Confirmar acción") {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-dialog');
        document.getElementById('dialog-title').textContent = title;
        document.getElementById('dialog-text').textContent = text;
        document.getElementById('dialog-input').style.display = 'none';
        document.getElementById('dialog-cancel-btn').style.display = 'block';
        
        const confirmBtn = document.getElementById('dialog-confirm-btn');
        confirmBtn.textContent = "Confirmar";
        
        dialogResolve = resolve;
        confirmBtn.onclick = () => {
            dialogResolve = null;
            NV_CloseDialog();
            resolve(true);
        };
        document.getElementById('dialog-cancel-btn').onclick = () => {
            dialogResolve = null;
            NV_CloseDialog();
            resolve(false);
        };
        
        modal.classList.add('show');
    });
}

function NV_CloseDialog() {
    document.getElementById('modal-dialog').classList.remove('show');
    if (dialogResolve) {
        dialogResolve(null);
        dialogResolve = null;
    }
}
