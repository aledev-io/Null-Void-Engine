import { NV_Alert, NV_Confirm } from '../dashboard/ui.js';

let _friendsData = { friends: [], incoming: [], sent: [] };
let _friendsTab = 'friends';
let _friendsSearch = '';

export function initFriends() {
    window.showFriendsView = showFriendsView;
    window.sendFriendRequest = sendFriendRequest;
    window.acceptFriendRequest = acceptFriendRequest;
    window.rejectFriendRequest = rejectFriendRequest;
    window.cancelFriendRequest = cancelFriendRequest;
    window.searchFriendUsers = searchFriendUsers;
    window.openChatWithFriend = openChatWithFriend;
    window.switchFriendsTab = switchFriendsTab;
    window.filterFriends = filterFriends;
    window.openAddFriendDialog = openAddFriendDialog;
    window.closeAddFriendDialog = closeAddFriendDialog;
    window.removeFriendship = removeFriendship;
    window.loadFriendsData = loadFriendsData;
    showFriendsView();
}

function _frStatus(lastActivity) {
    if (!lastActivity) return { isOnline: false, text: 'Desconectado' };
    const activityDate = new Date(lastActivity);
    if (isNaN(activityDate.getTime())) return { isOnline: false, text: 'Desconectado' };
    const diff = (new Date() - activityDate) / 1000;
    if (diff < 60) return { isOnline: true, text: 'En línea' };
    return { isOnline: false, text: 'Desconectado' };
}

export async function showFriendsView() {
    const containerView = document.getElementById('view-friends');
    if (!containerView) return;

    containerView.innerHTML = `
        <div class="fr-container">
            <button class="btn-back" onclick="window.location.href='/app'" style="align-self: flex-start; gap: 6px; display: inline-flex; align-items: center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
                Volver al Sistema
            </button>

            <div class="admin-panel-container" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                <div class="admin-panel-header" style="flex-wrap: wrap; gap: 16px;">
                    <div class="admin-panel-header-left">
                        <div class="admin-panel-icon" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15)); color: var(--indigo);">
                            👥
                        </div>
                        <div>
                            <h2 class="admin-panel-title">Lista de Contactos</h2>
                            <p class="admin-panel-subtitle">Gestiona tus amigos y solicitudes de amistad</p>
                        </div>
                    </div>
                    
                    <div class="admin-panel-header-right" style="display: flex; align-items: center; gap: 12px; margin-left: auto;">
                        <div style="display: flex; background: rgba(255,255,255,0.05); padding: 4px; border-radius: 10px; border: 1px solid var(--border);">
                            <button class="fr-tab-btn active" id="btn-tab-friends" onclick="window.switchFriendsTab('friends')">
                                Amigos (<span id="count-friends">0</span>)
                            </button>
                            <button class="fr-tab-btn" id="btn-tab-incoming" onclick="window.switchFriendsTab('incoming')" style="position: relative;">
                                Recibidas (<span id="count-incoming">0</span>)
                                <span id="badge-incoming" style="position: absolute; top: -6px; right: -6px; background: #ff4757; color: white; font-size: 0.6rem; padding: 2px 6px; border-radius: 10px; font-weight: 700; display: none;"></span>
                            </button>
                            <button class="fr-tab-btn" id="btn-tab-sent">
                                Enviadas (<span id="count-sent">0</span>)
                            </button>
                        </div>
                        
                        <button class="fr-btn-action accept" onclick="window.openAddFriendDialog()">
                            <span>+ Añadir Amigo</span>
                        </button>
                    </div>
                </div>

                <div style="padding: 14px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; background: var(--surface-hi);">
                    <div style="position: relative; flex: 1;">
                        <input type="text" id="fr-search-filter" oninput="window.filterFriends(this.value)" placeholder="Buscar por nombre..." style="width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px 10px 38px; color: var(--text-main); font-size: 0.85rem; outline: none; transition: border-color 0.2s;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                </div>

                <div class="admin-alerts-scroll" style="flex: 1; overflow-y: auto;">
                    <div id="friends-list-container" class="admin-alerts-grid">
                        <div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">Cargando...</div>
                    </div>
                </div>

                <div class="admin-panel-footer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span id="fr-footer-text">Haz clic en un amigo para abrir el chat.</span>
                </div>
            </div>
        </div>

        <div class="fr-dialog-overlay" id="fr-add-dialog" onclick="if(event.target===this)window.closeAddFriendDialog()">
            <div class="fr-dialog">
                <div class="fr-dialog-header">
                    <h3>Añadir Amigo</h3>
                    <button class="fr-dialog-close" onclick="window.closeAddFriendDialog()">✕</button>
                </div>
                <div class="fr-dialog-body" style="display: flex; flex-direction: column; gap: 16px;">
                    <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">Escribe el nombre de usuario de la persona que deseas agregar:</p>
                    <div style="position: relative;">
                        <input type="text" class="fr-dialog-input" id="fr-search-input" placeholder="Buscar por nombre de usuario..." autocomplete="off" oninput="window.searchFriendUsers(this.value)" style="padding-left: 36px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <div class="fr-search-results" id="fr-search-results">
                        <div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">Escribe al menos 2 caracteres</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const btnSent = document.getElementById('btn-tab-sent');
    if (btnSent) {
        btnSent.onclick = () => switchFriendsTab('sent');
    }

    _friendsTab = 'friends';
    _friendsSearch = '';
    await loadFriendsData();
}

async function loadFriendsData() {
    try {
        const [listRes, reqRes] = await Promise.all([
            fetch('/api/friends/list', { headers: window.HEADERS }),
            fetch('/api/friends/requests', { headers: window.HEADERS })
        ]);
        const list = await listRes.json();
        const req = await reqRes.json();

        _friendsData.friends = list.friends || [];
        _friendsData.incoming = req.incoming || [];
        _friendsData.sent = req.sent || [];

        const countFriends = document.getElementById('count-friends');
        const countIncoming = document.getElementById('count-incoming');
        const countSent = document.getElementById('count-sent');
        const badgeIncoming = document.getElementById('badge-incoming');

        if (countFriends) countFriends.textContent = _friendsData.friends.length;
        if (countIncoming) countIncoming.textContent = _friendsData.incoming.length;
        if (countSent) countSent.textContent = _friendsData.sent.length;

        if (badgeIncoming) {
            if (_friendsData.incoming.length > 0) {
                badgeIncoming.textContent = _friendsData.incoming.length;
                badgeIncoming.style.display = 'inline-block';
            } else {
                badgeIncoming.style.display = 'none';
            }
        }

        renderFriends();
    } catch (e) {
        console.error("Error cargando amigos:", e);
    }
}

export function switchFriendsTab(tab) {
    _friendsTab = tab;
    document.querySelectorAll('.fr-tab-btn').forEach(btn => btn.classList.remove('active'));

    const activeBtn = document.getElementById('btn-tab-' + tab);
    if (activeBtn) activeBtn.classList.add('active');

    const footerText = document.getElementById('fr-footer-text');
    if (footerText) {
        if (tab === 'friends') {
            footerText.textContent = 'Haz clic en un amigo para abrir el chat.';
        } else if (tab === 'incoming') {
            footerText.textContent = 'Responde a las solicitudes de amistad pendientes.';
        } else {
            footerText.textContent = 'Puedes cancelar solicitudes enviadas que aún no han sido aceptadas.';
        }
    }
    renderFriends();
}

export function filterFriends(query) {
    _friendsSearch = query.toLowerCase().trim();
    renderFriends();
}

function renderFriends() {
    const container = document.getElementById('friends-list-container');
    if (!container) return;

    let itemsHtml = '';
    const query = _friendsSearch;

    if (_friendsTab === 'friends') {
        const filtered = _friendsData.friends.filter(f => f.friend_name.toLowerCase().includes(query));

        if (filtered.length === 0) {
            itemsHtml = `<div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">
                ${query ? 'No se encontraron amigos con ese nombre.' : 'Aún no tienes amigos agregados. Usa el botón superior para añadir.'}
            </div>`;
        } else {
            const sorted = [...filtered].sort((a, b) => {
                const aOnline = _frStatus(a.last_activity).isOnline;
                const bOnline = _frStatus(b.last_activity).isOnline;
                return bOnline - aOnline;
            });

            itemsHtml = sorted.map(f => {
                const status = _frStatus(f.last_activity);
                const indicatorColor = status.isOnline ? '#10b981' : '#64748b';
                const avatarChar = f.friend_name.charAt(0).toUpperCase();

                return `
                    <div class="admin-event-row" onclick="window.openChatWithFriend('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}')">
                        <div class="admin-event-indicator" style="background: ${indicatorColor};"></div>
                        <div class="fr-avatar" style="margin-left: 8px;">
                            <img src="/api/system/user/avatar/${f.friend_name}" onerror="this.style.display='none';" />
                            <span>${avatarChar}</span>
                            <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                        </div>
                        <div class="admin-event-body" style="margin-left: 12px;">
                            <div class="admin-event-meta">
                                <span class="admin-event-badge" style="background: ${status.isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)'}; color: ${status.isOnline ? '#10b981' : '#64748b'};">
                                    ${status.text}
                                </span>
                            </div>
                            <div class="admin-event-title">${f.friend_name}</div>
                            <div class="admin-event-desc">Amigo · Haz clic para abrir el chat</div>
                        </div>
                        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; padding-right: 12px;" onclick="event.stopPropagation();">
                            <button class="fr-btn-chat" onclick="window.openChatWithFriend('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}')" title="Enviar mensaje">
                                💬
                            </button>
                            <button class="fr-btn-action reject" onclick="window.removeFriendship('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}')" title="Eliminar amigo" style="padding: 8px 10px; border-radius: 50%; min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                                🗑️
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } else if (_friendsTab === 'incoming') {
        const filtered = _friendsData.incoming.filter(r => r.requester_name.toLowerCase().includes(query));

        if (filtered.length === 0) {
            itemsHtml = `<div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">
                ${query ? 'No se encontraron solicitudes con ese nombre.' : 'No tienes solicitudes de amistad pendientes.'}
            </div>`;
        } else {
            itemsHtml = filtered.map(r => {
                const status = _frStatus(r.last_activity);
                const avatarChar = r.requester_name.charAt(0).toUpperCase();

                return `
                    <div class="admin-event-row" style="cursor: default;">
                        <div class="admin-event-indicator" style="background: #f59e0b;"></div>
                        <div class="fr-avatar" style="margin-left: 8px;">
                            <img src="/api/system/user/avatar/${r.requester_name}" onerror="this.style.display='none';" />
                            <span>${avatarChar}</span>
                            <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                        </div>
                        <div class="admin-event-body" style="margin-left: 12px;">
                            <div class="admin-event-meta">
                                <span class="admin-event-badge" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                                    Solicitud
                                </span>
                            </div>
                            <div class="admin-event-title">${r.requester_name}</div>
                            <div class="admin-event-desc">Te ha enviado una solicitud de amistad</div>
                        </div>
                        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; padding-right: 12px;">
                            <button class="fr-btn-action accept" onclick="window.acceptFriendRequest(${r.id})">
                                ✓ Aceptar
                            </button>
                            <button class="fr-btn-action reject" onclick="window.rejectFriendRequest(${r.id})">
                                ✕ Rechazar
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } else if (_friendsTab === 'sent') {
        const filtered = _friendsData.sent.filter(r => r.addressee_name.toLowerCase().includes(query));

        if (filtered.length === 0) {
            itemsHtml = `<div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">
                ${query ? 'No se encontraron solicitudes con ese nombre.' : 'No has enviado ninguna solicitud recientemente.'}
            </div>`;
        } else {
            itemsHtml = filtered.map(r => {
                const status = _frStatus(r.last_activity);
                const avatarChar = r.addressee_name.charAt(0).toUpperCase();

                return `
                    <div class="admin-event-row" style="cursor: default;">
                        <div class="admin-event-indicator" style="background: var(--indigo);"></div>
                        <div class="fr-avatar" style="margin-left: 8px;">
                            <img src="/api/system/user/avatar/${r.addressee_name}" onerror="this.style.display='none';" />
                            <span>${avatarChar}</span>
                            <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                        </div>
                        <div class="admin-event-body" style="margin-left: 12px;">
                            <div class="admin-event-meta">
                                <span class="admin-event-badge" style="background: rgba(99, 102, 241, 0.1); color: var(--indigo);">
                                    Enviada
                                </span>
                            </div>
                            <div class="admin-event-title">${r.addressee_name}</div>
                            <div class="admin-event-desc">Esperando que acepte tu solicitud...</div>
                        </div>
                        <div style="margin-left: auto; display: flex; align-items: center; padding-right: 12px;">
                            <button class="fr-btn-action reject" onclick="window.cancelFriendRequest(${r.id})">
                                ✕ Cancelar
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    container.innerHTML = itemsHtml;
}

export function openAddFriendDialog() {
    const d = document.getElementById('fr-add-dialog');
    if (d) {
        d.classList.add('active');
        const input = document.getElementById('fr-search-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        document.getElementById('fr-search-results').innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">Escribe al menos 2 caracteres</div>';
    }
}

export function closeAddFriendDialog() {
    const d = document.getElementById('fr-add-dialog');
    if (d) d.classList.remove('active');
}

export async function searchFriendUsers(query) {
    const results = document.getElementById('fr-search-results');
    if (!results) return;
    if (!query || query.length < 2) {
        results.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">Escribe al menos 2 caracteres</div>';
        return;
    }
    try {
        const res = await fetch('/api/friends/search?q=' + encodeURIComponent(query), { headers: window.HEADERS });
        const data = await res.json();
        if (!data.users || data.users.length === 0) {
            results.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 0.85rem; opacity: 0.6;">No se encontraron usuarios</div>';
            return;
        }
        results.innerHTML = data.users.map(u => {
            const status = _frStatus(u.last_activity);
            const avatarChar = u.username.charAt(0).toUpperCase();

            let actionHtml = '';
            if (u.is_friend) {
                actionHtml = '<span class="fr-status-tag fr-status-friends">✔ Amigos</span>';
            } else if (u.has_pending) {
                actionHtml = '<span class="fr-status-tag fr-status-pending">⏳ Pendiente</span>';
            } else {
                actionHtml = `<button class="fr-btn-action accept" onclick="window.sendFriendRequest('${u.user_id}')">+ Añadir</button>`;
            }

            return `
                <div class="fr-result-item" style="border-bottom: 1px solid rgba(148, 163, 184, 0.05); padding: 12px 6px;">
                    <div class="fr-avatar">
                        <img src="/api/system/user/avatar/${u.username}" onerror="this.style.display='none';" />
                        <span>${avatarChar}</span>
                        <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                    </div>
                    <div class="fr-info" style="margin-left: 12px;">
                        <div class="fr-name" style="font-size: 0.85rem; font-weight: 700; color: var(--text-main);">${u.username}</div>
                        <div style="font-size: 0.72rem; color: ${status.isOnline ? '#10b981' : 'var(--text-muted)'}; margin-top: 1px;">
                            ${status.text}
                        </div>
                    </div>
                    <div style="margin-left: auto;">
                        ${actionHtml}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error("Error buscando usuarios:", e);
    }
}

export async function sendFriendRequest(userId) {
    try {
        const res = await fetch('/api/friends/send', {
            method: 'POST', headers: window.HEADERS,
            body: JSON.stringify({ user_id: userId })
        });
        const data = await res.json();
        if (data.ok) {
            closeAddFriendDialog();
            await loadFriendsData();
        } else {
            NV_Alert(data.error || 'Error');
        }
    } catch (e) {
        console.error(e);
    }
}

export async function acceptFriendRequest(requestId) {
    try {
        await fetch('/api/friends/accept', {
            method: 'POST', headers: window.HEADERS,
            body: JSON.stringify({ request_id: requestId })
        });
        await loadFriendsData();
    } catch (e) {
        console.error(e);
    }
}

export async function rejectFriendRequest(requestId) {
    try {
        await fetch('/api/friends/reject', {
            method: 'POST', headers: window.HEADERS,
            body: JSON.stringify({ request_id: requestId })
        });
        await loadFriendsData();
    } catch (e) {
        console.error(e);
    }
}

export async function cancelFriendRequest(requestId) {
    try {
        await fetch('/api/friends/cancel', {
            method: 'POST', headers: window.HEADERS,
            body: JSON.stringify({ request_id: requestId })
        });
        await loadFriendsData();
    } catch (e) {
        console.error(e);
    }
}

export async function removeFriendship(friendId, friendName) {
    const confirmed = await NV_Confirm(`¿Estás seguro de que quieres eliminar a ${friendName} de tu lista de amigos?`, "Eliminar amigo");
    if (!confirmed) return;

    try {
        const res = await fetch('/api/friends/remove', {
            method: 'POST', headers: window.HEADERS,
            body: JSON.stringify({ friend_id: friendId })
        });
        const data = await res.json();
        if (data.ok) {
            await loadFriendsData();
        } else {
            NV_Alert(data.error || 'Error al eliminar amigo');
        }
    } catch (e) {
        console.error("Error al eliminar amigo:", e);
    }
}

export function openChatWithFriend(friendId, friendName) {
    localStorage.setItem('nv_chat_contact', JSON.stringify({
        contact_id: friendId,
        contact_name: friendName
    }));
    window.location.href = '/chat';
}
