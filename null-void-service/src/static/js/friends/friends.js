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

            <div class="fr-panel-container">
                <div class="fr-panel-header">
                    <div class="fr-panel-header-left">
                        <div class="fr-panel-icon" style="background: linear-gradient(135deg, rgba(109, 91, 255, 0.15), rgba(168, 85, 247, 0.15)); color: var(--indigo);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        </div>
                        <div>
                            <h2 class="fr-panel-title">${window.t('fr_contact_list')}</h2>
                            <p class="fr-panel-subtitle">${window.t('fr_manage_friends')}</p>
                        </div>
                    </div>
                    
                    <div class="fr-panel-header-right">
                        <div class="fr-tab-container">
                            <button class="fr-tab-btn active" id="btn-tab-friends" onclick="window.switchFriendsTab('friends')">
                                ${window.t('fr_friends')} (<span id="count-friends">0</span>)
                            </button>
                            <button class="fr-tab-btn" id="btn-tab-incoming" onclick="window.switchFriendsTab('incoming')" style="position: relative;">
                                ${window.t('fr_incoming')} (<span id="count-incoming">0</span>)
                            </button>
                            <button class="fr-tab-btn" id="btn-tab-sent">
                                ${window.t('fr_sent')} (<span id="count-sent">0</span>)
                            </button>
                        </div>
                        
                        <button class="fr-btn-action accept" onclick="window.openAddFriendDialog()">
                            <span>${window.t('fr_add_friend')}</span>
                        </button>
                    </div>
                </div>

                <div style="padding: 14px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; background: var(--surface-hi);">
                    <div style="position: relative; flex: 1;">
                        <input type="text" id="fr-search-filter" oninput="window.filterFriends(this.value)" placeholder="${window.t('fr_search_name')}" style="width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px 10px 38px; color: var(--text-main); font-size: 0.85rem; outline: none; transition: border-color 0.2s;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                </div>

                <div class="fr-scroll">
                    <div id="friends-list-container" class="fr-grid">
                        <div style="padding: 40px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6; grid-column: 1 / -1;">${window.t('fr_loading')}</div>
                    </div>
                </div>

                <div class="fr-panel-footer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span id="fr-footer-text">${window.t('fr_click_to_chat')}</span>
                </div>
            </div>
        </div>

        <div class="fr-dialog-overlay" id="fr-add-dialog" onclick="if(event.target===this)window.closeAddFriendDialog()">
            <div class="fr-dialog">
                <div class="fr-dialog-header">
                    <h3>${window.t('fr_add_friend')}</h3>
                    <button class="fr-dialog-close" onclick="window.closeAddFriendDialog()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="fr-dialog-body" style="display: flex; flex-direction: column; gap: 16px;">
                    <p style="font-size: 0.78rem; color: var(--text-dim); margin: 0;">${window.t('fr_type_username')}</p>
                    <div style="position: relative;">
                        <input type="text" class="fr-dialog-input" id="fr-search-input" placeholder="${window.t('fr_search_username')}" autocomplete="off" oninput="window.searchFriendUsers(this.value)" style="padding-left: 36px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none;">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <div class="fr-search-results" id="fr-search-results">
                        <div style="padding: 30px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6;">${window.t('fr_min_chars')}</div>
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

        if (countFriends) countFriends.textContent = _friendsData.friends.length;
        if (countIncoming) countIncoming.textContent = _friendsData.incoming.length;
        if (countSent) countSent.textContent = _friendsData.sent.length;

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
            footerText.textContent = window.t('fr_click_to_chat');
        } else if (tab === 'incoming') {
            footerText.textContent = window.t('fr_respond_requests');
        } else {
            footerText.textContent = window.t('fr_cancel_unaccepted');
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
            itemsHtml = `<div style="padding: 40px 20px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6; grid-column: 1 / -1;">
                ${query ? window.t('fr_no_friends_found') : window.t('fr_no_friends_yet')}
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
                    <div class="fr-event-row" onclick="window.openChatWithFriend('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}')">
                        <div class="fr-event-indicator" style="background: ${indicatorColor};"></div>
                        <div class="fr-avatar" style="margin-left: 8px;">
                            <img src="/api/system/user/avatar/${f.friend_name}" onerror="this.style.display='none';" />
                            <span>${avatarChar}</span>
                            <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                        </div>
                        <div class="fr-event-body" style="margin-left: 12px;">
                            <div class="fr-event-meta">
                                <span class="fr-event-badge" style="background: ${status.isOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)'}; color: ${status.isOnline ? '#10b981' : '#64748b'};">
                                    ${status.text}
                                </span>
                            </div>
                            <div class="fr-event-title">${f.friend_name}</div>
                            <div class="fr-event-desc">${window.t('fr_friend_click_chat')}</div>
                        </div>
                        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; padding-right: 12px;" onclick="event.stopPropagation();">
                            <button class="fr-btn-chat" onclick="window.openChatWithFriend('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}')" title="${window.t('fr_send_message')}">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                            </button>
                            <button class="fr-btn-action reject" onclick="window.removeFriendship('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}')" title="${window.t('fr_remove_friend')}" style="padding: 8px 10px; border-radius: 50%; min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } else if (_friendsTab === 'incoming') {
        const filtered = _friendsData.incoming.filter(r => r.requester_name.toLowerCase().includes(query));

        if (filtered.length === 0) {
            itemsHtml = `<div style="padding: 40px 20px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6; grid-column: 1 / -1;">
                ${query ? window.t('fr_no_requests_found') : window.t('fr_no_pending_requests')}
            </div>`;
        } else {
            itemsHtml = filtered.map(r => {
                const status = _frStatus(r.last_activity);
                const avatarChar = r.requester_name.charAt(0).toUpperCase();

                return `
                    <div class="fr-event-row" style="cursor: default;">
                        <div class="fr-event-indicator" style="background: #f59e0b;"></div>
                        <div class="fr-avatar" style="margin-left: 8px;">
                            <img src="/api/system/user/avatar/${r.requester_name}" onerror="this.style.display='none';" />
                            <span>${avatarChar}</span>
                            <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                        </div>
                        <div class="fr-event-body" style="margin-left: 12px;">
                            <div class="fr-event-meta">
                                <span class="fr-event-badge" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                                    ${window.t('fr_received')}
                                </span>
                            </div>
                            <div class="fr-event-title">${r.requester_name}</div>
                            <div class="fr-event-desc">${window.t('fr_sent_request_desc')}</div>
                        </div>
                        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; padding-right: 12px;">
                            <button class="fr-btn-action accept" onclick="window.acceptFriendRequest(${r.id})">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                <span class="fr-btn-text">${window.t('fr_accept')}</span>
                            </button>
                            <button class="fr-btn-action reject" onclick="window.rejectFriendRequest(${r.id})">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                <span class="fr-btn-text">${window.t('fr_reject')}</span>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } else if (_friendsTab === 'sent') {
        const filtered = _friendsData.sent.filter(r => r.addressee_name.toLowerCase().includes(query));

        if (filtered.length === 0) {
            itemsHtml = `<div style="padding: 40px 20px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6; grid-column: 1 / -1;">
                ${query ? window.t('fr_no_requests_found') : window.t('fr_no_sent_recently')}
            </div>`;
        } else {
            itemsHtml = filtered.map(r => {
                const status = _frStatus(r.last_activity);
                const avatarChar = r.addressee_name.charAt(0).toUpperCase();

                return `
                    <div class="fr-event-row" style="cursor: default;">
                        <div class="fr-event-indicator" style="background: var(--indigo);"></div>
                        <div class="fr-avatar" style="margin-left: 8px;">
                            <img src="/api/system/user/avatar/${r.addressee_name}" onerror="this.style.display='none';" />
                            <span>${avatarChar}</span>
                            <span class="${status.isOnline ? 'fr-online-dot' : 'fr-offline-dot'}"></span>
                        </div>
                        <div class="fr-event-body" style="margin-left: 12px;">
                            <div class="fr-event-meta">
                                <span class="fr-event-badge" style="background: rgba(99, 102, 241, 0.1); color: var(--indigo);">
                                    ${window.t('fr_sent_badge')}
                                </span>
                            </div>
                            <div class="fr-event-title">${r.addressee_name}</div>
                            <div class="fr-event-desc">${window.t('fr_waiting_accept')}</div>
                        </div>
                        <div style="margin-left: auto; display: flex; align-items: center; padding-right: 12px;">
                            <button class="fr-btn-action reject" onclick="window.cancelFriendRequest(${r.id})">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                ${window.t('fr_cancel')}
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
        document.getElementById('fr-search-results').innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6;">${window.t('fr_min_chars')}</div>`;
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
        results.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6;">${window.t('fr_min_chars')}</div>`;
        return;
    }
    try {
        const res = await fetch('/api/friends/search?q=' + encodeURIComponent(query), { headers: window.HEADERS });
        const data = await res.json();
        if (!data.users || data.users.length === 0) {
            results.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-dim); font-size: 0.85rem; opacity: 0.6;">${window.t('fr_no_users_found')}</div>`;
            return;
        }
        results.innerHTML = data.users.map(u => {
            const status = _frStatus(u.last_activity);
            const avatarChar = u.username.charAt(0).toUpperCase();

            let actionHtml = '';
            if (u.is_friend) {
                actionHtml = `<span class="fr-status-tag fr-status-friends"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:text-bottom;"><polyline points="20 6 9 17 4 12"></polyline></svg>${window.t('fr_status_friends')}</span>`;
            } else if (u.has_pending) {
                actionHtml = `<span class="fr-status-tag fr-status-pending"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:text-bottom;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>${window.t('fr_status_pending')}</span>`;
            } else {
                actionHtml = `<button class="fr-btn-action accept" onclick="window.sendFriendRequest('${u.user_id}')">${window.t('fr_add')}</button>`;
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
                        <div style="font-size: 0.72rem; color: ${status.isOnline ? '#10b981' : 'var(--text-dim)'}; margin-top: 1px;">
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
    const confirmed = await NV_Confirm(window.t('fr_confirm_remove').replace('{0}', friendName), window.t('fr_delete_friend'));
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

window.addEventListener('languageChanged', () => {
    const containerView = document.getElementById('view-friends');
    if (containerView && containerView.querySelector('.fr-container')) {
        const oldTab = _friendsTab;
        const oldSearch = _friendsSearch;
        showFriendsView().then(() => {
            _friendsTab = oldTab;
            _friendsSearch = oldSearch;
            const searchInput = document.getElementById('fr-search-filter');
            if (searchInput) searchInput.value = oldSearch;
            switchFriendsTab(oldTab);
        });
    }
});
