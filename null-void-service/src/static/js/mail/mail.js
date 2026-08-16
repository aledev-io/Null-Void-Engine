// State

let FOLDERS = [
    { id: 'inbox', name: 'Recibidos', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>', section: 'principal' },
    { id: 'starred', name: 'Destacados', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>', section: 'principal' },
    { id: 'important', name: 'Importantes', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>', section: 'principal' },
    { id: 'sent', name: 'Enviados', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>', section: 'principal' },
    { id: 'drafts', name: 'Borradores', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>', section: 'principal' },
    { id: 'scheduled', name: 'Programados', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><circle cx="12" cy="15" r="1"></circle></svg>', section: 'principal' },
    { id: 'all', name: 'Todos', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>', section: 'principal' },
    { id: 'spam', name: 'Spam', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>', section: 'sistema' },
    { id: 'trash', name: 'Papelera', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>', section: 'sistema' },
];

let currentFolder = 'inbox';
let folderUnreads = {};
export let mailMode = 'internal'; // 'internal' or 'google'
let googleAccounts = [];
let googleEmail = null;
let internalEmail = '';

const folderCache = {};
let currentFolderFetchId = 0;
let activeLoadingId = 0;
let currentEmailFetchId = 0;
let currentEmailData = null;
const emailCache = {};
const knownContacts = new Set();
let currentPage = 1;
let currentHasMore = false;

// Utilities

export function formatMailDate(dateStr) {
    if (!dateStr) return '';
    try {
        // Fix invalid formats like +00:00Z often produced by double-encoding timezones
        let cleanDate = dateStr.replace(/\+00:00Z$/i, 'Z').replace(/\+00:00$/i, 'Z');
        const d = new Date(cleanDate);
        if (isNaN(d.getTime())) return escapeHtml(dateStr);

        const now = new Date();
        const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
        
        const isThisYear = d.getFullYear() === now.getFullYear();

        const lang = localStorage.getItem('lang') || (navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en');
        const locale = lang === 'en' ? 'en-US' : 'es-ES';

        if (isToday) {
            return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        } else if (isYesterday) {
            return lang === 'en' ? 'Yesterday' : 'Ayer';
        } else if (isThisYear) {
            return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
        } else {
            return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
        }
    } catch (e) {
        return escapeHtml(dateStr);
    }
}

export function escapeHtml(s) {
    if (!s) return '';
    return s.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function extractEmail(str) {
    if (!str) return '';
    const match = str.match(/<([^>]+)>/);
    return match ? match[1] : str;
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fadeout');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Theme

export function toggleTheme() {
    const html = document.documentElement;
    const newTheme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon();
}

function updateThemeIcon() {
    const icon = document.getElementById('theme-icon-svg');
    if (!icon) return;
    const theme = document.documentElement.getAttribute('data-theme');
    icon.innerHTML = theme === 'dark'
        ? '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
}

// Mode toggle

export async function setMailMode(targetMode, targetEmail = null) {
    if (targetMode === 'google') {
        if (!targetEmail && googleAccounts.length === 0) {
            const res = await fetch('/api/mail/config');
            const data = await res.json();
            if (!data.configured) { openGoogleConfigModal(); return; }
        }
        if (targetEmail) {
            googleEmail = targetEmail;
        } else if (!googleEmail && googleAccounts.length > 0) {
            googleEmail = googleAccounts[0].email;
        }
    }

    mailMode = targetMode;
    
    // Update active state in UI
    const btnInternal = document.getElementById('btn-toggle-mode');
    if (btnInternal) {
        btnInternal.style.background = mailMode === 'internal' ? 'var(--surface-hi)' : 'transparent';
        mailMode === 'internal' ? btnInternal.classList.add('active') : btnInternal.classList.remove('active');
    }
    
    if (googleAccounts.length > 0) {
        renderGoogleAccounts();
    }

    const msg = mailMode === 'google' 
        ? (window.t ? window.t('mail_switching_google') : 'Cambiando a modo Google...') 
        : (window.t ? window.t('mail_switching_internal') : 'Cambiando a modo Interno...');
    showToast(msg);

    document.getElementById('email-list').innerHTML = '';
    document.getElementById('reader-panel').style.display = 'none';
    document.getElementById('inbox-panel').style.display = 'flex';
    document.getElementById('compose-from').value = mailMode === 'google' ? googleEmail : internalEmail;

    loadFolders();
    loadCurrentFolder();
}

// Google config

export async function checkGoogleConfig() {
    try {
        const res = await fetch('/api/mail/config');
        const data = await res.json();
        
        if (data.accounts) {
            googleAccounts = data.accounts;
        }
        if (data.email && !googleEmail) googleEmail = data.email;
        if (data.internal_email) internalEmail = data.internal_email;
        
        renderGoogleAccounts();
    } catch (err) {
        console.error(err);
    }
}

function renderGoogleAccounts() {
    const container = document.getElementById('google-accounts-container');
    if (!container) return;
    
    let html = '';
    for (const acc of googleAccounts) {
        const firstLetter = acc.email.charAt(0).toUpperCase();
        const isActive = mailMode === 'google' && googleEmail === acc.email;
        
        html += `
            <div class="nav-link${isActive ? ' active' : ''}" onclick="setMailMode('google', '${acc.email}')">
                <div style="width:18px;height:18px;border-radius:50%;background:var(--indigo);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;flex-shrink:0;">${firstLetter}</div>
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${escapeHtml(acc.email)}</span>
                <div onclick="removeGoogleAccount('${acc.email}'); event.stopPropagation();" style="display:flex;align-items:center;justify-content:center;padding:4px;margin:-4px;border-radius:4px;color:var(--text-muted);transition:color 0.2s;" onmouseover="this.style.color='var(--red-400)'" onmouseout="this.style.color='var(--text-muted)'" title="Eliminar cuenta">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

export async function removeGoogleAccount(email) {
    if (!confirm('¿Estás seguro de que quieres desvincular esta cuenta de Google?')) return;
    try {
        const res = await fetch('/api/mail/config', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.ok) {
            if (googleEmail === email) {
                googleEmail = null;
                if (mailMode === 'google') setMailMode('internal');
            }
            showToast('Cuenta desvinculada correctamente.');
            await checkGoogleConfig();
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (e) {
        showToast(window.t('conn_error'), 'error');
    }
}

export function openGoogleConfigModal() {
    document.getElementById('google-email').value = '';
    document.getElementById('google-app-pass').value = '';
    document.getElementById('google-config-modal').classList.add('show');
}

export async function saveGoogleConfig() {
    const email = document.getElementById('google-email').value;
    const password = document.getElementById('google-app-pass').value;
    if (!email || !password) return showToast('Debes rellenar ambos campos.', 'error');

    const btn = document.querySelector('#google-config-modal .btn-send');
    const orig = btn.innerHTML;
    btn.innerHTML = 'Guardando...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/mail/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            document.getElementById('google-config-modal').classList.remove('show');
            showToast('Google configurado correctamente.');
            await checkGoogleConfig();
            if (mailMode === 'internal') setMailMode('google', email);
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch {
        showToast(window.t('conn_error') + '.', 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// Folders

export async function loadFolders(forceRefresh = false) {
    try {
        let url = `/api/mail/folders?mode=${mailMode}${forceRefresh ? '&refresh=true' : ''}`;
        if (mailMode === 'google' && googleEmail) url += `&google_email=${encodeURIComponent(googleEmail)}`;
        const res = await fetch(url);
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse folders JSON. Response was:', text);
            throw e;
        }
        if (!data.folders) return;

        folderUnreads = {};
        const newFolders = [];
        const defaultIds = new Set(FOLDERS.map(f => f.id));
        const ignoreNames = new Set(['INBOX', '[Gmail]', 'Gmail', 'inbox']);

        data.folders.forEach(f => {
            folderUnreads[f.id] = f.unread;
            if (!defaultIds.has(f.id) && !ignoreNames.has(f.name)) {
                const tagSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
                newFolders.push({ id: f.id, name: f.name, icon: tagSvg, section: 'carpetas' });
            }
        });

        FOLDERS = [...FOLDERS.filter(f => data.folders.find(df => df.id === f.id)), ...newFolders];
        buildFolderNav();
    } catch (err) {
        console.error('Error loading folders:', err);
    }
}

function buildFolderNav() {
    const nav = document.getElementById('folder-nav');
    let html = '';
    let lastSection = '';
    const sectionLabels = { principal: '', carpetas: window.t ? window.t('mail_sec_folders') : 'Etiquetas', sistema: window.t ? window.t('mail_sec_system') : 'Sistema' };

    for (const f of FOLDERS) {
        if (f.section !== lastSection) {
            lastSection = f.section;
            if (sectionLabels[f.section]) {
                const i18nKey = f.section === 'carpetas' ? 'mail_sec_folders' : 'mail_sec_system';
                html += `<div class="nav-section" data-i18n="${i18nKey}">${sectionLabels[f.section]}</div>`;
            }
        }
        const unread = folderUnreads[f.id] || 0;
        let badgeHtml = '';
        if (!['trash', 'spam', 'sent', 'all'].includes(f.id)) {
            const badgeClass = unread > 0 ? 'badge-count' : 'badge-count zero';
            badgeHtml = `<span class="${badgeClass}" id="badge-${f.id}">${unread}</span>`;
        }
        
        let translatedName = window.t ? window.t('mail_folder_' + f.id) : f.name;
        if (translatedName === 'mail_folder_' + f.id) translatedName = f.name;

        html += `<div class="nav-link${currentFolder === f.id ? ' active' : ''}" data-folder="${f.id}" onclick="switchFolder('${f.id}')">
            <span style="font-size:1rem;width:22px;text-align:center;">${f.icon}</span>
            <span data-i18n="mail_folder_${f.id}">${translatedName}</span>
            ${badgeHtml}
        </div>`;
    }
    nav.innerHTML = html;
}

export function switchFolder(folderId) {
    if (folderId === currentFolder) { backToList(); return; }
    currentFolder = folderId;
    currentPage = 1;
    backToList();
    document.querySelectorAll('#folder-nav .nav-link').forEach(el => {
        el.classList.toggle('active', el.dataset.folder === folderId);
    });
    const folderTitleEl = document.getElementById('topbar-folder-title');
    if (folderTitleEl) {
        const folderInfo = FOLDERS.find(f => f.id === folderId);
        folderTitleEl.textContent = folderInfo ? folderInfo.name : folderId;
        folderTitleEl.setAttribute('data-i18n', `mail_folder_${folderId}`);
    }
    loadCurrentFolder();
}

// Loading helpers

function setFolderLoading(state) {
    document.getElementById('btn-refresh').classList.toggle('spinning', state);
}

function setAppLock(locked) {
    if (mailMode !== 'google') return;
    const mailApp = document.getElementById('mail-app');
    const topbar = document.getElementById('topbar');
    mailApp.style.pointerEvents = locked ? 'none' : 'auto';
    mailApp.style.opacity = locked ? '0.7' : '1';
    topbar.style.pointerEvents = locked ? 'none' : 'auto';
    document.body.style.cursor = locked ? 'wait' : 'default';
}

// Email list

export async function loadCurrentFolder(silent = false, forceRefresh = false, loadMore = false) {
    if (loadMore) currentPage++;
    else currentPage = 1;

    const fetchId = ++currentFolderFetchId;
    let loadingId = 0;
    const list = document.getElementById('email-list');
    const folderInfo = FOLDERS.find(f => f.id === currentFolder);

    const trashBanner = document.getElementById('trash-banner');
    if (trashBanner) {
        trashBanner.style.display = currentFolder === 'trash' ? 'block' : 'none';
    }

    if (!silent) {
        loadingId = ++activeLoadingId;
        if (folderCache[currentFolder] && !forceRefresh && !loadMore) {
            renderEmailList(folderCache[currentFolder]);
        } else if (!loadMore) {
            list.innerHTML = `<div style="padding:20px;text-align:center;"><div class="loader"></div><p style="margin-top:10px;color:var(--text-muted);font-size:0.85rem;">Cargando ${folderInfo ? folderInfo.name.toLowerCase() : ''}...</p></div>`;
        }
        setFolderLoading(true);
        if (!loadMore) setAppLock(true);
    }

    try {
        let url = `/api/mail/emails?folder=${currentFolder}&mode=${mailMode}&page=${currentPage}${forceRefresh ? '&refresh=true' : ''}`;
        if (mailMode === 'google' && googleEmail) url += `&google_email=${encodeURIComponent(googleEmail)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (fetchId !== currentFolderFetchId) return;

        if (data.total_raw !== undefined) {
            console.log(`Debug: Total correos individuales en el servidor IMAP para esta carpeta: ${data.total_raw}`);
        }
        if (data.error) {
            if (!silent) list.innerHTML = `<div style="padding:20px;color:#f87171;text-align:center;font-size:0.85rem;">${data.error}</div>`;
            return;
        }

        if (loadMore) {
            const existing = folderCache[currentFolder] || [];
            const existingIds = new Set(existing.map(e => e.id));
            const newEmails = data.emails.filter(e => !existingIds.has(e.id));
            folderCache[currentFolder] = existing.concat(newEmails);
            // Si no se añadió ninguno nuevo, no hay más páginas reales
            if (newEmails.length === 0) currentHasMore = false;
            else currentHasMore = data.has_more;
        } else {
            folderCache[currentFolder] = data.emails;
            currentHasMore = data.has_more;
        }
        updateContactsFromEmails(data.emails);

        if (silent && !loadMore) {
            if (document.getElementById('inbox-panel').style.display === 'none') return;
            if (document.querySelectorAll('.row-checkbox:checked').length > 0) return;
            const currentTopId = list.querySelector('.email-item')?.dataset.id;
            const newTopId = data.emails[0]?.id;
            const countDiff = list.querySelectorAll('.email-item').length !== data.emails.length;
            if (currentTopId === newTopId && !countDiff) return;
        }

        renderEmailList(folderCache[currentFolder]);
    } catch {
        if (fetchId === currentFolderFetchId && !folderCache[currentFolder] && !silent) {
            list.innerHTML = `<div style="padding:20px;color:#f87171;text-align:center;">${window.t('conn_error')}.</div>`;
        }
    } finally {
        if (!silent && loadingId === activeLoadingId) {
            setFolderLoading(false);
            setAppLock(false);
        }
    }
}

function renderEmailList(emails) {
    const list = document.getElementById('email-list');
    const selectAll = document.getElementById('selectAllCheckbox');
    if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
    updateBulkActions();

    let html = '';
    if (mailMode === 'google' && currentFolder === 'scheduled') {
        html += `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px;margin:16px;display:flex;align-items:start;gap:12px;">
            <div style="color:#f59e0b;margin-top:2px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
            <div>
                <strong style="color:#f59e0b;font-size:0.9rem;display:block;margin-bottom:4px;">Limitación de Google IMAP</strong>
                <p style="margin:0;font-size:0.85rem;color:var(--text-muted);line-height:1.4;">Gmail no sincroniza su carpeta nativa de "Programados" mediante IMAP.</p>
            </div>
        </div>`;
    }

    if (!emails || emails.length === 0) {
        let noEmailsText = window.t ? window.t('mail_no_emails') : 'Sin correos en esta carpeta';
        if (noEmailsText === 'mail_no_emails') noEmailsText = 'Sin correos en esta carpeta';
        list.innerHTML = html + `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:8px;"><path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
            <p style="font-size:0.85rem;" data-i18n="mail_no_emails">${noEmailsText}</p></div>`;
        return;
    }

    let finalHtml = html + emails.map(e => {
        const unreadClass = e.read === false ? ' unread' : '';
        const displayName = currentFolder === 'sent' || currentFolder === 'drafts'
            ? `Para: ${escapeHtml(e.to || '')}` : escapeHtml(e.from);
        const snippet = e.body_plain ? escapeHtml(e.body_plain.substring(0, 100).replace(/\s+/g, ' ')) : '';
        const starFill = e.starred ? 'currentColor' : 'none';
        const threadBadge = e.thread_count > 1 ? `<span class="thread-count">${e.thread_count}</span>` : '';
        
        return `<div class="email-item${unreadClass}${e.starred ? ' starred' : ''}" data-id="${e.id}" onclick="readEmail('${currentFolder}','${e.id}',this)">
            <div class="email-checkbox" onclick="event.stopPropagation();"><input type="checkbox" class="row-checkbox" onchange="checkSelectAllState()"></div>
            <div class="email-star${e.starred ? ' starred' : ''}" onclick="event.stopPropagation();toggleStar('${currentFolder}','${e.id}',this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="${starFill}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></div>
            <div class="email-sender">${displayName} ${threadBadge}</div>
            <div class="email-subject"><span class="email-subject-text">${escapeHtml(e.subject) || '(Sin Asunto)'}</span> <span class="email-snippet">- ${snippet}</span></div>
            <div class="email-date">${formatMailDate(e.date)}</div>
        </div>`;
    }).join('');

    if (currentHasMore) {
        finalHtml += `<div style="text-align:center; padding: 20px;">
            <button onclick="loadMoreEmails(this)" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; font-size: 0.9rem;">Cargar más mensajes...</button>
        </div>`;
    }

    list.innerHTML = finalHtml;
}

export function loadMoreEmails(btn) {
    if (btn) {
        btn.innerHTML = '<div class="loader" style="width:16px; height:16px; border-width:2px; display:inline-block; margin-right:8px; vertical-align:middle;"></div> Cargando...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.7';
    }
    loadCurrentFolder(false, false, true);
}

// Selection / Bulk

export function markAllAsRead() {
    const unreadItems = Array.from(document.querySelectorAll('.email-item.unread'));
    if (unreadItems.length === 0) {
        showToast('Todos los correos de esta página ya están leídos.', 'success');
        return;
    }
    
    // Select all unread items
    document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = cb.closest('.email-item').classList.contains('unread');
    });
    
    // Trigger bulk action
    bulkAction('read');
}

export function toggleSelectAll() {
    const selectAll = document.getElementById('selectAllCheckbox');
    document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = selectAll.checked;
        cb.closest('.email-item').classList.toggle('selected', selectAll.checked);
    });
    updateBulkActions();
}

export function checkSelectAllState() {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    const selectAll = document.getElementById('selectAllCheckbox');
    if (!checkboxes.length) return;

    let checkedCount = 0;
    checkboxes.forEach(cb => {
        const row = cb.closest('.email-item');
        if (cb.checked) { checkedCount++; row.classList.add('selected'); }
        else row.classList.remove('selected');
    });
    selectAll.checked = checkedCount === checkboxes.length;
    selectAll.indeterminate = checkedCount > 0 && !selectAll.checked;
    updateBulkActions();
}

function updateBulkActions() {
    const checkedRows = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.closest('.email-item'));
    const someChecked = checkedRows.length > 0;
    const defaultActions = document.getElementById('default-actions');
    const bulkActions = document.getElementById('bulk-actions');
    const btnArchive = document.getElementById('btn-bulk-archive');
    const btnUnarchive = document.getElementById('btn-bulk-unarchive');
    const btnReadToggle = document.getElementById('btn-bulk-read-toggle');

    if (!defaultActions || !bulkActions) return;

    defaultActions.style.display = someChecked ? 'none' : 'flex';
    bulkActions.style.display = someChecked ? 'flex' : 'none';

    if (!someChecked) return;
    
    const countSpan = document.getElementById('bulk-selected-count');
    if (countSpan) {
        countSpan.textContent = checkedRows.length + ' seleccionado' + (checkedRows.length > 1 ? 's' : '');
    }

    if (btnArchive) btnArchive.style.display = currentFolder === 'inbox' ? 'block' : 'none';
    if (btnUnarchive) btnUnarchive.style.display = currentFolder === 'inbox' ? 'none' : 'block';

    if (btnReadToggle) {
        const hasUnread = checkedRows.some(r => r.classList.contains('unread'));
        btnReadToggle.title = hasUnread ? 'Marcar como leído' : 'Marcar como no leído';
        btnReadToggle.setAttribute('onclick', hasUnread ? "bulkAction('read')" : "bulkAction('unread')");
        btnReadToggle.innerHTML = hasUnread
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6z"></path><polyline points="22.2 10 12 17.66 1.8 10"></polyline></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>';
    }
}

export function deleteEmails() {
    bulkAction(currentFolder === 'trash' ? 'delete' : 'trash');
}

export function deleteSingleEmail() {
    singleAction(currentFolder === 'trash' ? 'delete' : 'trash');
}

export async function emptyTrash() {
    if (!confirm('¿Estás seguro de que quieres vaciar la papelera? Esta acción no se puede deshacer.')) return;
    showToast('Vaciando papelera...');
    const body = { mode: mailMode };
    if (mailMode === 'google' && googleEmail) body.google_email = googleEmail;
    
    try {
        const res = await fetch('/api/mail/empty_trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error al vaciar la papelera');
        showToast('Papelera vaciada.');
        loadCurrentFolder(false, true);
    } catch (err) {
        showToast(err.message, true);
    }
}

export async function bulkAction(action) {
    const selectedIds = Array.from(document.querySelectorAll('.row-checkbox:checked')).map(cb => cb.closest('.email-item').dataset.id);
    if (!selectedIds.length) return;
    if (mailMode !== 'internal') showToast('Procesando...');
    const body = { folder: currentFolder, action, ids: selectedIds, mode: mailMode };
    if (mailMode === 'google' && googleEmail) body.google_email = googleEmail;

    try {
        const res = await fetch('/api/mail/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error al procesar la acción');
        showToast(action === 'delete' ? 'Correo eliminado definitivamente.' : 'Acción completada.');
        if (action === 'unarchive' && currentFolder === 'all') {
            const selectAll = document.getElementById('selectAllCheckbox');
            if (selectAll) { selectAll.checked = false; toggleSelectAll(); }
        } else {
            loadCurrentFolder();
        }
    } catch (err) {
        showToast(err.message, true);
    }
}

export async function singleAction(action) {
    if (!currentEmailData) return;
    if (mailMode !== 'internal') showToast('Procesando...');
    const body = { folder: currentFolder, action, ids: [currentEmailData.id], mode: mailMode };
    if (mailMode === 'google' && googleEmail) body.google_email = googleEmail;

    try {
        const res = await fetch('/api/mail/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error al procesar la acción');
        showToast(action === 'delete' ? 'Correo eliminado definitivamente.' : 'Acción completada.');
        backToList();
        loadCurrentFolder();
    } catch (err) {
        showToast(err.message, true);
    }
}

// Star

export async function toggleStar(folder, id, element) {
    const newStarred = !element.classList.contains('starred');
    element.classList.toggle('starred', newStarred);
    element.querySelector('svg').setAttribute('fill', newStarred ? 'currentColor' : 'none');
    showToast(newStarred ? 'Añadiendo a Destacados...' : 'Eliminando de Destacados...');
    
    const body = { folder: currentFolder, id, star: newStarred, mode: mailMode };
    if (mailMode === 'google' && googleEmail) body.google_email = googleEmail;

    try {
        const res = await fetch('/api/mail/star', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || window.t('conn_error'));
    } catch (err) {
        showToast('Error: ' + err.message, true);
        element.classList.toggle('starred', !newStarred);
        element.querySelector('svg').setAttribute('fill', !newStarred ? 'currentColor' : 'none');
    }
}

// Reader

export function backToList() {
    document.getElementById('reader-panel').style.display = 'none';
    document.getElementById('inbox-panel').style.display = 'flex';
}

export async function readEmail(folder, id, element) {
    try {
        const fetchId = ++currentEmailFetchId;
        document.querySelectorAll('.email-item').forEach(el => el.classList.remove('active'));
        if (element) element.classList.add('active');

        document.getElementById('inbox-panel').style.display = 'none';
        document.getElementById('reader-panel').style.display = 'flex';
        document.getElementById('reader-actions').style.display = 'none';

        if (emailCache[id]) { renderEmailBody(emailCache[id]); return; }

        const bodyEl = document.getElementById('read-body');
        if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:40px;"><div class="loader"></div><p style="margin-top:10px;color:var(--text-muted);">Descargando correo...</p></div>';

        setAppLock(true);
        try {
            let url = `/api/mail/read?folder=${folder}&id=${id}&mode=${mailMode}`;
            if (mailMode === 'google' && googleEmail) url += `&google_email=${encodeURIComponent(googleEmail)}`;
            const res = await fetch(url);
            let data;
            try { data = await res.json(); } catch { throw new Error('Respuesta inválida del servidor'); }

            if (fetchId !== currentEmailFetchId) return;
            if (!data || data.error) {
                if (bodyEl) bodyEl.innerHTML = `<div style="color:#f87171;padding:20px;">${(data && data.error) || 'Error desconocido'}</div>`;
                return;
            }
            emailCache[id] = data;
            renderEmailBody(data);
        } catch (e) {
            console.error('Error en readEmail:', e);
            if (fetchId === currentEmailFetchId && bodyEl)
                bodyEl.innerHTML = `<div style="color:#f87171;padding:20px;">Error al cargar correo.</div>`;
        } finally {
            if (fetchId === currentEmailFetchId) setAppLock(false);
        }
    } catch (globalErr) {
        console.error('Error fatal en readEmail:', globalErr);
    }
}

export function toggleMetaDropdown() {
    const dropdown = document.getElementById('email-meta-dropdown');
    if (dropdown) dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

function renderEmailBody(data) {
    try {
        currentEmailData = data || {};
        const dropdown = document.getElementById('email-meta-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
        set('read-subject', data.subject || '(Sin Asunto)');
        set('read-from', data.from || '');
        set('read-date', formatMailDate(data.date) || '');
        set('meta-from', data.from || '');
        set('meta-to', data.to || '(Desconocido)');
        set('meta-date', formatMailDate(data.date) || '');
        set('meta-subject', data.subject || '(Sin Asunto)');
        set('meta-security', data.security || 'Desconocida');

        const avatarEl = document.getElementById('read-avatar');
        if (avatarEl) {
            const rawSender = data.from || 'U';
            const emailMatch = rawSender.match(/<([^>]+)>/);
            const pureEmail = emailMatch ? emailMatch[1].trim() : rawSender.trim();
            const nameMatch = rawSender.match(/^"?([^"<]+)"?/);
            const name = nameMatch ? nameMatch[1].trim() : pureEmail.split('@')[0];
            const initial = (name[0] || 'U').toUpperCase();

            const colors = ['#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5', '#039be5', '#00acc1', '#00897b', '#43a047', '#7cb342', '#f4511e', '#6d4c41'];
            let hash = 0;
            for (let i = 0; i < pureEmail.length; i++) {
                hash = pureEmail.charCodeAt(i) + ((hash << 5) - hash);
            }
            const color = colors[Math.abs(hash) % colors.length];

            if (rawSender.includes('@nullvoid')) {
                const username = pureEmail.split('@')[0];
                avatarEl.style.background = 'transparent';
                avatarEl.innerHTML = `<img src="/api/system/user/avatar/${username}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.outerHTML='<span style=\\'display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:${color};border-radius:50%;\\'>${initial}</span>'">`;
            } else {
                avatarEl.style.background = color;
                avatarEl.innerHTML = initial;
            }
        }

        document.getElementById('reader-actions').style.display = 'flex';

        const toggleRow = (rowId, valId, val) => {
            const row = document.getElementById(rowId);
            const el = document.getElementById(valId);
            if (val) { if (el) el.textContent = val; if (row) row.style.display = 'table-row'; }
            else { if (row) row.style.display = 'none'; }
        };
        toggleRow('meta-row-sent', 'meta-sent-by', data.sent_by);
        toggleRow('meta-row-signed', 'meta-signed-by', data.signed_by);

        const bodyContainer = document.getElementById('read-body');
        if (!bodyContainer) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'mail-content-wrapper';

        // Treat identical plain/html as plain text (fixes older internal emails)
        if (data.body_html && data.body_html !== data.body_plain) {
            const htmlCard = document.createElement('div');
            htmlCard.className = 'html-mail-card';

            const iframe = document.createElement('iframe');
            iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
            iframe.style.width = '100%';
            iframe.style.border = 'none';
            iframe.style.background = '#ffffff';
            iframe.style.minHeight = '700px';
            
            const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https: http: data:; font-src https: http: data:; img-src https: http: data: cid: blob:; media-src https: http: data: blob:;">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                html, body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    margin: 0;
                    padding: 16px;
                    background-color: #ffffff !important;
                    color: #202124 !important;
                    font-size: 14px;
                    line-height: 1.5;
                    word-break: break-word;
                    box-sizing: border-box;
                    border-radius: 12px;
                    width: 100% !important;
                    overflow-x: hidden !important;
                }
                @media (max-width: 600px) {
                    html, body { padding: 8px !important; font-size: 13px !important; }
                }
                img { max-width: 100% !important; height: auto !important; }
                a { color: #1a73e8; }
                table { max-width: 100% !important; width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; margin: 0 auto !important; }
                td, tr, tbody, table { max-width: 100% !important; box-sizing: border-box !important; }
                div, p { max-width: 100% !important; box-sizing: border-box !important; }
            </style>`;
            
            iframe.srcdoc = csp + data.body_html;
            
            const updateHeight = () => {
                try {
                    const win = iframe.contentWindow;
                    if (win && win.document) {
                        const body = win.document.body;
                        const doc = win.document.documentElement;
                        if (body && doc) {
                            let maxH = 700;
                            if (body.children) {
                                for (let i = 0; i < body.children.length; i++) {
                                    const c = body.children[i];
                                    maxH = Math.max(maxH, c.scrollHeight || 0, c.offsetHeight || 0);
                                }
                            }
                            const h = Math.max(
                                maxH,
                                body.scrollHeight || 0,
                                body.offsetHeight || 0,
                                doc.scrollHeight || 0,
                                doc.offsetHeight || 0
                            );
                            iframe.style.height = (h + 80) + 'px';
                        }
                    }
                } catch(e) {}
            };

            iframe.onload = () => {
                updateHeight();
                const interval = setInterval(updateHeight, 300);
                setTimeout(() => clearInterval(interval), 4000);
                try {
                    const ro = new ResizeObserver(updateHeight);
                    ro.observe(iframe.contentWindow.document.body);
                } catch(e) {}
            };
            
            htmlCard.appendChild(iframe);
            wrapper.appendChild(htmlCard);
        } else if (data.body_plain || data.body_html) {
            const plainDiv = document.createElement('div');
            plainDiv.className = 'plain-text-mail';
            plainDiv.innerHTML = escapeHtml(data.body_plain || data.body_html);
            wrapper.appendChild(plainDiv);
        } else {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'plain-text-mail';
            Object.assign(emptyDiv.style, { color: '#6b7280', fontStyle: 'italic' });
            emptyDiv.innerText = 'Este correo no tiene cuerpo de texto.';
            wrapper.appendChild(emptyDiv);
        }

        bodyContainer.innerHTML = '';

        if (data.attachments && data.attachments.length > 0) {
            const attachContainer = document.createElement('div');
            Object.assign(attachContainer.style, { marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' });
            attachContainer.innerHTML = `<h3 style="font-size:0.85rem;font-weight:600;margin-bottom:12px;color:var(--text-muted);">${data.attachments.length} Archivo(s) adjunto(s)</h3>`;

            const grid = document.createElement('div');
            Object.assign(grid.style, { display: 'flex', gap: '12px', flexWrap: 'wrap' });

            data.attachments.forEach(att => {
                const a = document.createElement('a');
                a.href = `/api/mail/attachment/${att.id}?filename=${encodeURIComponent(att.filename)}`;
                a.download = att.filename;
                Object.assign(a.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--surface-hi)', border: '1px solid var(--border)', borderRadius: '8px', textDecoration: 'none', color: 'var(--text-main)', fontSize: '0.85rem' });
                a.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                    <span style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(att.filename)}</span>
                    <span style="color:var(--text-muted);font-size:0.75rem;">(${Math.round(att.size / 1024)} KB)</span>`;
                grid.appendChild(a);
            });

            attachContainer.appendChild(grid);
            wrapper.appendChild(attachContainer);
        }

        bodyContainer.appendChild(wrapper);
    } catch (err) {
        console.error('Error en renderEmailBody:', err);
        const bodyContainer = document.getElementById('read-body');
        if (bodyContainer) bodyContainer.innerHTML = `<div style="color:#f87171;padding:20px;">Error interno al renderizar el correo.</div>`;
    }
}

// Reply / Forward

export function replyEmail() {
    if (!currentEmailData) return;
    const toEmail = extractEmail(currentEmailData.from);
    const subject = currentEmailData.subject.toLowerCase().startsWith('re:')
        ? currentEmailData.subject : 'Re: ' + currentEmailData.subject;

    document.getElementById('compose-from').value = mailMode === 'google' ? googleEmail : internalEmail;
    document.getElementById('compose-to').value = toEmail;
    document.getElementById('compose-subject').value = subject;
    document.getElementById('compose-body').value = `\n\n\n--- En ${currentEmailData.date}, ${currentEmailData.from} escribió:\n> ${currentEmailData.body_plain ? currentEmailData.body_plain.replace(/\n/g, '\n> ') : '(Correo HTML)'}`;

    document.getElementById('compose-modal').classList.add('show');
    const bodyEl = document.getElementById('compose-body');
    bodyEl.focus();
    bodyEl.setSelectionRange(0, 0);
}

export function forwardEmail() {
    if (!currentEmailData) return;
    const subject = currentEmailData.subject.toLowerCase().startsWith('fwd:')
        ? currentEmailData.subject : 'Fwd: ' + currentEmailData.subject;

    document.getElementById('compose-from').value = mailMode === 'google' ? googleEmail : internalEmail;
    document.getElementById('compose-to').value = '';
    document.getElementById('compose-subject').value = subject;
    document.getElementById('compose-body').value = `\n\n\n--- Mensaje reenviado ---\nDe: ${currentEmailData.from}\nFecha: ${currentEmailData.date}\nAsunto: ${currentEmailData.subject}\n\n${currentEmailData.body_plain || '(Correo HTML)'}`;

    document.getElementById('compose-modal').classList.add('show');
    document.getElementById('compose-to').focus();
}

// Compose

let composeSelectedFiles = [];

export function openCompose() {
    document.getElementById('compose-from').value = mailMode === 'google' ? googleEmail : internalEmail;
    document.getElementById('compose-to').value = '';
    document.getElementById('compose-subject').value = '';
    document.getElementById('compose-body').value = '';
    document.getElementById('compose-modal').classList.remove('minimized');
    document.getElementById('compose-modal').classList.add('show');
}

export function closeCompose() {
    document.getElementById('compose-modal').classList.remove('show');
    ['compose-to', 'compose-cc', 'compose-bcc', 'compose-subject', 'compose-body'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('cc-fields').classList.remove('show');
    composeSelectedFiles = [];
    renderComposeAttachments();
}

export function toggleMinimize() { document.getElementById('compose-modal').classList.toggle('minimized'); }
export function toggleExpand() { document.getElementById('compose-modal').classList.toggle('expanded'); }
export function toggleCc() { document.getElementById('cc-fields').classList.toggle('show'); }

export function updateAttachmentsList() {
    const input = document.getElementById('compose-attachments');
    for (const file of input.files) composeSelectedFiles.push(file);
    input.value = '';
    renderComposeAttachments();
}

function renderComposeAttachments() {
    const list = document.getElementById('compose-attachments-list');
    list.innerHTML = '';
    composeSelectedFiles.forEach((file, index) => {
        const badge = document.createElement('div');
        Object.assign(badge.style, { display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface-hi)', padding: '4px 8px', borderRadius: '16px', fontSize: '0.75rem', color: 'var(--text-main)', border: '1px solid var(--border)' });
        const closeBtn = document.createElement('div');
        closeBtn.innerHTML = '×';
        Object.assign(closeBtn.style, { cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', lineHeight: '1' });
        closeBtn.onclick = () => { composeSelectedFiles.splice(index, 1); renderComposeAttachments(); };
        badge.innerHTML = `<span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(file.name)}</span> <span style="color:var(--text-muted);">(${Math.round(file.size / 1024)}KB)</span>`;
        badge.appendChild(closeBtn);
        list.appendChild(badge);
    });
}

export function openScheduleModal() {
    const to = document.getElementById('compose-to').value;
    if (!to) return showToast('Especifica un destinatario antes de programar.', 'error');

    const now = new Date();
    const nowLocal = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    const dtInput = document.getElementById('schedule-datetime');
    dtInput.min = nowLocal.toISOString().slice(0, 16);

    now.setMinutes(now.getMinutes() + 5 - now.getTimezoneOffset());
    dtInput.value = now.toISOString().slice(0, 16);
    document.getElementById('schedule-modal').classList.add('show');
}

export async function executeScheduledSend() {
    const scheduledAtInput = document.getElementById('schedule-datetime').value;
    if (!scheduledAtInput) return showToast('Selecciona una fecha y hora.', 'error');
    const selectedDate = new Date(scheduledAtInput);
    if (selectedDate <= new Date()) return showToast('La fecha debe ser en el futuro.', 'error');
    document.getElementById('schedule-modal').classList.remove('show');
    await sendEmail(true, selectedDate.toISOString());
}

export async function sendEmail(isScheduled = false, scheduledAt = null) {
    const to = document.getElementById('compose-to').value;
    if (!to) return showToast('Especifica un destinatario', 'error');

    const btn = document.querySelector('.compose-footer .btn-send');
    const orig = btn.innerHTML;
    btn.innerHTML = '<div class="loader" style="width:16px;height:16px;border-width:2px;"></div>';
    document.querySelectorAll('.compose-footer .btn-send').forEach(b => b.disabled = true);

    try {
        const formData = new FormData();
        formData.append('to', to);
        formData.append('subject', document.getElementById('compose-subject').value);
        formData.append('body', document.getElementById('compose-body').value);
        formData.append('mode', mailMode);
        if (mailMode === 'google' && googleEmail) formData.append('google_email', googleEmail);
        formData.append('is_scheduled', isScheduled);
        if (scheduledAt) formData.append('scheduled_at', scheduledAt);
        composeSelectedFiles.forEach(file => formData.append('attachments', file));

        const res = await fetch('/api/mail/send', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) {
            if (to) {
                to.split(',').forEach(addr => knownContacts.add(extractEmail(addr.trim())));
                updateContactsFromEmails([]); // Trigger UI datalist update
            }
            showToast(isScheduled ? 'Mensaje programado con éxito.' : 'Mensaje enviado con éxito.', 'success');
            closeCompose();
            loadFolders();
            loadCurrentFolder(true);
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch {
        showToast(window.t('conn_error') + '.', 'error');
    } finally {
        btn.innerHTML = orig;
        document.querySelectorAll('.compose-footer .btn-send').forEach(b => b.disabled = false);
    }
}

// Contacts

function updateContactsFromEmails(emails) {
    if (!emails) return;
    emails.forEach(e => {
        if (e.from) knownContacts.add(extractEmail(e.from));
        if (e.to) e.to.split(',').forEach(addr => knownContacts.add(extractEmail(addr.trim())));
    });
    const datalist = document.getElementById('contact-suggestions');
    if (datalist) {
        datalist.innerHTML = Array.from(knownContacts)
            .filter(addr => addr && addr.includes('@'))
            .map(addr => `<option value="${addr}">`)
            .join('');
    }
}

export function toggleMailSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    sidebar.classList.toggle('mobile-open');
    if (overlay) {
        if (sidebar.classList.contains('mobile-open')) {
            overlay.classList.add('show');
        } else {
            overlay.classList.remove('show');
        }
    }
}

// Init (called from main.js)

export function init() {
    updateThemeIcon();
    loadFolders();
    buildFolderNav();
    loadCurrentFolder();
    checkGoogleConfig();

    // Auto-refresh via Socket.IO and fallback
    if (typeof io !== 'undefined') {
        const mailSocket = io({ reconnection: true });
        mailSocket.on('mail_updated', () => {
            loadFolders(true);
            loadCurrentFolder(true, true);
        });
    }
    
    // Background polling fallback in case socket disconnects or Google Mode IMAP doesn't trigger a push
    setInterval(() => { loadFolders(true); loadCurrentFolder(true, true); }, 15000);

    // Expose functions needed by inline onclick attributes in the HTML
    const expose = {
        toggleTheme, setMailMode, openGoogleConfigModal, saveGoogleConfig,
        removeGoogleAccount, loadMoreEmails,
        openCompose, closeCompose, toggleMinimize, toggleExpand, toggleCc,
        updateAttachmentsList, openScheduleModal, executeScheduledSend, sendEmail,
        switchFolder, loadCurrentFolder, loadFolders, toggleSelectAll, checkSelectAllState,
        bulkAction, singleAction, toggleStar, backToList, readEmail, deleteEmails, deleteSingleEmail, emptyTrash,
        toggleMetaDropdown, replyEmail, forwardEmail, toggleMailSidebar, markAllAsRead
    };
    Object.assign(window, expose);
}