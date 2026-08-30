import { NV_Alert, NV_Confirm } from '../dashboard/ui.js';
import { _cloudJson, _tServerErr } from './api.js';
import { esc, escAttr, jsStr } from '../core/dom.js';

let selectedUsersToShare = [];
let _existingShares = [];

async function openCloudShare(name, path) {
    if (window.currentCloudView === 'shared' || (window.currentCloudContextItem && window.currentCloudContextItem.view === 'shared')) {
        await NV_Alert(window.currentLang === "en" ? "Cannot share files that were shared with you." : "No puedes compartir archivos que han sido compartidos contigo.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }
    window._multiShareItems = null;
    const modal = document.getElementById('cloud-share-modal');
    document.getElementById('share-filename').innerText = name;
    document.getElementById('share-user-search').value = '';
    document.getElementById('share-search-results').style.display = 'none';
    selectedUsersToShare = [];
    _existingShares = [];
    renderSelectedUsers();

    try {
        const res = await fetch('/api/cloud/share/status', {
            method: 'POST', headers: window.HEADERS,
            body: JSON.stringify({ name, path })
        });
        const data = await _cloudJson(res);
        _existingShares = data.shares || [];
    } catch (e) { }

    const isManageMode = (window.currentCloudView === 'shared_by_me');
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
        const res = await fetch('/api/cloud/contacts', { headers: window.HEADERS });
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
                    ${already ? `<button onclick="revokeCloudShare('${jsStr(c.user_id)}', '${jsStr(c.username)}', event)" style="font-size:0.7rem;color:#ef4444;font-weight:700;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);padding:4px 8px;border-radius:4px;cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(239,68,68,0.1)'">${window.t_cloud('share_revoke', 'REVOCAR')}</button>` : ''}
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
        const res = await fetch(`/api/cloud/users/search?q=${encodeURIComponent(query)}`, { headers: window.HEADERS });
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
            headers: window.HEADERS,
            body: JSON.stringify({
                name: itemName,
                path: window.currentCloudContextItem ? window.currentCloudContextItem.path : '',
                shared_with: uid
            })
        });
        const data = await _cloudJson(res);
        if (data.success) {
            _existingShares = _existingShares.filter(s => s.user_id !== uid);

            const manageSection = document.getElementById('share-manage-section');
            if (manageSection && manageSection.style.display === 'block') {
                renderManageShares();
                if (_existingShares.length === 0) {
                    closeCloudShareModal();
                }
            } else {
                loadCloudContacts();
                const q = document.getElementById('share-user-search').value;
                if (q && q.length >= 2) searchUsersForSharing(q);
            }

            window.fetchCloudFiles(window.currentCloudPath, window.currentCloudView);
        } else {
            NV_Alert(_tServerErr(data.error) || (window.currentLang === "en" ? "Error revoking access" : "Error al revocar acceso"));
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

async function shareSelectedItems() {
    const items = window.SELECTED_CLOUD_ITEMS || [];
    if (items.length === 0) return;
    if (window.currentCloudView === 'shared') {
        await NV_Alert(window.currentLang === "en" ? "Cannot share files that were shared with you." : "No puedes compartir archivos que han sido compartidos contigo.", window.currentLang === "en" ? "Restriction" : "Restricción");
        return;
    }
    window._multiShareItems = items.slice();
    const first = items[0];
    openCloudShare(first.name, first.path || '');
    const nameEl = document.getElementById('share-filename');
    if (nameEl) {
        const count = items.length;
        nameEl.innerText = `${count} ` + (count === 1
            ? window.t_cloud('selected_single', 'seleccionado')
            : window.t_cloud('selected_plural', 'seleccionados'));
    }
}

async function confirmCloudShare() {
    if (selectedUsersToShare.length === 0 || !window.currentCloudContextItem) return;
    if (window.currentCloudView === 'shared' || window.currentCloudContextItem.view === 'shared') {
        return;
    }

    const { name, path } = window.currentCloudContextItem;
    const uids = selectedUsersToShare.map(u => u.uid);

    const multiItems = window._multiShareItems || null;
    if (multiItems && multiItems.length > 1) {
        window._multiShareItems = null;
        let sharedCount = 0;
        for (const it of multiItems) {
            try {
                const res = await fetch('/api/cloud/share', {
                    method: 'POST',
                    headers: window.HEADERS,
                    body: JSON.stringify({
                        name: it.name,
                        path: it.path || '',
                        view: window.currentCloudView,
                        shared_with: uids
                    })
                });
                if (res.ok) sharedCount++;
            } catch (err) { }
        }
        if (sharedCount > 0) {
            closeCloudShareModal();
            window.clearCloudSelection();
            window.fetchCloudFiles(window.currentCloudPath, window.currentCloudView);
            await NV_Alert(window.currentLang === "en"
                ? `${sharedCount} item(s) shared with ${selectedUsersToShare.length} user(s).`
                : `${sharedCount} elemento(s) compartidos con ${selectedUsersToShare.length} usuario(s).`);
        }
        return;
    }

    try {
        const shareView = (window.currentCloudContextItem && window.currentCloudContextItem.view && !['home', 'recent'].includes(window.currentCloudContextItem.view))
            ? window.currentCloudContextItem.view
            : (!['home', 'recent'].includes(window.currentCloudView) ? window.currentCloudView : 'drive');

        const res = await fetch('/api/cloud/share', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({
                name: name,
                path: path,
                view: shareView,
                shared_with: uids
            })
        });

        if (res.ok) {
            closeCloudShareModal();
            window.fetchCloudFiles(window.currentCloudPath, window.currentCloudView);
            await NV_Alert(window.currentLang === "en" ? `File shared with ${selectedUsersToShare.length} user(s).` : `Archivo compartido con ${selectedUsersToShare.length} usuario(s).`);
        } else {
            const data = await _cloudJson(res);
            await NV_Alert("Error: " + (_tServerErr(data.error) || (window.currentLang === "en" ? "Could not share." : "No se pudo compartir.")));
        }
    } catch (err) {
        await NV_Alert(window.currentLang === "en" ? "Connection error sharing." : "Error de conexión al compartir.");
    }
}

export {
    openCloudShare,
    renderManageShares,
    closeCloudShareModal,
    loadCloudContacts,
    searchUsersForSharing,
    selectUserForSharing,
    removeSelectedUser,
    revokeCloudShare,
    renderSelectedUsers,
    shareSelectedItems,
    confirmCloudShare
};
