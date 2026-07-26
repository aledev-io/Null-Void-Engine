import { NV_Alert, NV_Confirm } from '../dashboard/ui.js';

let currentChatContact = null;
let chatMessages = [];
let chatSocket = null;
let selectedChatFiles = [];
let _chatTypingTimeout = null;
let _chatTypingHideTimeout = null;
let _chatFriendsList = [];
let _chatConversationsList = [];
let _selectedMessages = new Set();
let _contextMsgId = null;
let _forwardDialogData = [];
let _chatSelectionMode = false;
let _lastSelectedMsgId = null;
let _chatReplyToMsg = null;

window.cancelChatReply = function () {
    _chatReplyToMsg = null;
    const prev = document.getElementById('chat-reply-preview');
    if (prev) prev.style.display = 'none';
};

/* ─── Helpers ─── */

function isImageFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext);
}

function isAudioFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return ['webm', 'ogg', 'wav', 'mp3', 'm4a', 'aac', 'opus'].includes(ext);
}

function isVideoFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv'].includes(ext);
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function getChatFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
        pdf: { bg: '#ef4444', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="16" x2="16" y2="16"/></svg>' },
        doc: { bg: '#3b82f6', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>' },
        docx: { bg: '#3b82f6', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>' },
        xls: { bg: '#22c55e', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="16" x2="16" y2="16"/></svg>' },
        xlsx: { bg: '#22c55e', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="16" x2="16" y2="16"/></svg>' },
        zip: { bg: '#f59e0b', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
        rar: { bg: '#f59e0b', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
        mp3: { bg: '#a855f7', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' },
        mp4: { bg: '#ec4899', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' },
        mov: { bg: '#ec4899', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' },
        txt: { bg: '#6b7280', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
    };
    return icons[ext] || { bg: '#6b7280', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' };
}

/* ─── Init / Stop ─── */

async function initChat() {
    initSocketConnection();
    await loadChatConversations();



    if (currentChatContact && currentChatContact.contact_id) {
        document.getElementById('chat-empty-state').style.display = 'none';
        document.getElementById('chat-active-area').style.display = 'flex';

        updateActiveChatHeader();

        await loadChatMessages(currentChatContact.contact_id);
        startChatPolling();
        document.querySelectorAll('.chat-conv-item').forEach(el => el.classList.remove('active'));
        const activeEl = document.querySelector(`.chat-conv-item[onclick*="${currentChatContact.contact_id}"]`);
        if (activeEl) activeEl.classList.add('active');
    }

    setupChatDragAndPaste();
}

let _chatEventsAttached = false;
function setupChatDragAndPaste() {
    if (_chatEventsAttached) return;
    _chatEventsAttached = true;

    // Paste event
    document.addEventListener('paste', (e) => {
        if (!currentChatContact) return; // Only if chat is active
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    selectedChatFiles.push(file);
                }
            }
        }
        if (selectedChatFiles.length > 0) attachChatFiles();
    });

    // Drag and drop events
    const viewChat = document.getElementById('view-chat');
    if (!viewChat) return;

    viewChat.addEventListener('dragover', (e) => {
        if (!currentChatContact) return;
        e.preventDefault();
        e.stopPropagation();
        viewChat.style.opacity = '0.7';
    });

    viewChat.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewChat.style.opacity = '1';
    });

    viewChat.addEventListener('drop', (e) => {
        if (!currentChatContact) return;
        e.preventDefault();
        e.stopPropagation();
        viewChat.style.opacity = '1';

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                selectedChatFiles.push(e.dataTransfer.files[i]);
            }
            attachChatFiles();
        }
    });
}

function stopChat() {
    stopChatPolling();
    hideChatTyping();
    if (_chatTypingTimeout) { clearTimeout(_chatTypingTimeout); _chatTypingTimeout = null; }
    if (_chatTypingHideTimeout) { clearTimeout(_chatTypingHideTimeout); _chatTypingHideTimeout = null; }
}

/* ─── Socket.IO ─── */

function initSocketConnection() {
    if (chatSocket && chatSocket.connected) return;

    if (chatSocket) {
        chatSocket.removeAllListeners();
        chatSocket.close();
        chatSocket = null;
    }

    chatSocket = io({
        auth: { token: TOKEN },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 10000
    });

    chatSocket.on('force_logout', () => {
        console.warn('[Session] Nueva sesión detectada, cerrando la actual...');
        window.location.href = '/';
    });

    chatSocket.on('connect', () => {
        console.log("Chat Socket conectado");
        chatSocket.emit('join_chat', { token: TOKEN });
    });

    chatSocket.on('connect_error', (err) => {
        console.warn("Chat Socket error de conexión:", err.message);
    });

    chatSocket.on('disconnect', (reason) => {
        console.log("Chat Socket desconectado:", reason);
    });

    chatSocket.on('new_message', (msg) => {
        if (currentChatContact && (msg.sender_id == currentChatContact.contact_id || msg.receiver_id == currentChatContact.contact_id)) {
            if (!chatMessages.find(m => m.id == msg.id)) {
                chatMessages.push(msg);
                renderChatMessages();
                markChatAsRead(currentChatContact.contact_id);
            }
            if (msg.sender_id == currentChatContact.contact_id) {
                hideChatTyping();
            }
        }
        loadChatConversations();
        updateChatBadge();
    });

    chatSocket.on('messages_read', (data) => {
        if (currentChatContact && currentChatContact.contact_id == data.reader_id) {
            let updated = false;
            chatMessages.forEach(m => {
                if (m.mine && !m.read) {
                    m.read = true;
                    updated = true;
                }
            });
            if (updated) renderChatMessages();
        }
    });

    chatSocket.on('typing', (data) => {
        if (currentChatContact && data.sender_id == currentChatContact.contact_id) {
            showChatTyping(currentChatContact.contact_name);
            if (_chatTypingHideTimeout) clearTimeout(_chatTypingHideTimeout);
            _chatTypingHideTimeout = setTimeout(hideChatTyping, 4000);
        }
    });

    chatSocket.on('user_offline', () => {
        loadChatConversations();
    });

    chatSocket.on('friend_removed', () => {
        if (typeof loadFriendsData === 'function') loadFriendsData();
    });

    chatSocket.on('friends_updated', () => {
        if (typeof loadFriendsData === 'function') loadFriendsData();
    });

    chatSocket.on('message_edited', (data) => {
        const msg = chatMessages.find(m => m.id === data.msg_id);
        if (msg) {
            msg.message = data.message;
            msg.edited_at = data.edited_at;
            renderChatMessages();
        }
    });

    chatSocket.on('message_deleted', (data) => {
        const idx = chatMessages.findIndex(m => m.id === data.msg_id);
        if (idx !== -1) {
            chatMessages.splice(idx, 1);
            renderChatMessages();
        }
    });

    chatSocket.on('share_removed', () => {
        if (typeof fetchCloudFiles === 'function' && typeof currentCloudView !== 'undefined') {
            if (currentCloudView === 'shared') {
                fetchCloudFiles(currentCloudPath, 'shared');
            }
        }
    });
}

/* ─── Global Event Listeners ─── */
document.addEventListener('click', (e) => {
    const isShift = e.shiftKey;
    if (_chatSelectionMode || isShift) {
        const row = e.target.closest('.msg-row');
        if (row) {
            e.preventDefault();
            e.stopPropagation();

            const clickedId = row.dataset.msgId;

            if (!_chatSelectionMode && isShift) {
                startMessageSelection(clickedId);
                _lastSelectedMsgId = clickedId;
            } else if (_chatSelectionMode && isShift && _lastSelectedMsgId) {
                selectRangeMessages(_lastSelectedMsgId, clickedId);
                _lastSelectedMsgId = clickedId;
            } else {
                toggleMessageSelection(clickedId);
                _lastSelectedMsgId = clickedId;
            }
        }
    }
}, true);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _chatSelectionMode) {
        cancelMessageSelection();
    }
});

/* ─── Typing Indicator ─── */

function handleChatTyping() {
    if (!chatSocket || !chatSocket.connected || !currentChatContact) return;
    chatSocket.emit('typing', {
        receiver_id: currentChatContact.contact_id
    });
}

function showChatTyping(name) {
    const el = document.getElementById('chat-typing');
    const nameEl = document.getElementById('chat-typing-name');
    if (el && nameEl) {
        nameEl.textContent = name;
        el.style.display = 'flex';
    }
}

function hideChatTyping() {
    const el = document.getElementById('chat-typing');
    if (el) el.style.display = 'none';
}

/* ─── Polling ─── */

let _chatPollInterval = null;

function startChatPolling() {
    if (_chatPollInterval) return;
    let lastPollTime = Date.now() / 1000;
    _chatPollInterval = setInterval(async () => {
        if (!currentChatContact) return;
        try {
            // Refresh conversation statuses
            loadChatConversations();

            const res = await fetch('/api/chat/poll', {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({
                    contact_id: currentChatContact.contact_id,
                    since: lastPollTime
                })
            });
            if (res.status === 401) {
                stopChatPolling();
                if (typeof handleLogout === 'function') handleLogout();
                else location.href = '/';
                return;
            }
            const data = await res.json();
            if (data.messages && data.messages.length > 0) {
                let newMsg = false;
                data.messages.forEach(msg => {
                    if (!chatMessages.find(m => m.id == msg.id)) {
                        chatMessages.push(msg);
                        newMsg = true;
                    }
                });
                if (newMsg) {
                    chatMessages.sort((a, b) => a.time - b.time);
                    renderChatMessages();
                    markChatAsRead(currentChatContact.contact_id);
                }
                lastPollTime = Date.now() / 1000;
            }
        } catch (err) {
            console.warn("Chat poll error:", err);
        }
    }, 5000);
}

function stopChatPolling() {
    if (_chatPollInterval) {
        clearInterval(_chatPollInterval);
        _chatPollInterval = null;
    }
}

/* ─── Conversations ─── */

async function loadChatConversations() {
    try {
        const [convRes, friendsRes] = await Promise.all([
            fetch('/api/chat/conversations', { headers: HEADERS }),
            fetch('/api/friends/list', { headers: HEADERS }).then(r => r.json()).catch(() => ({ friends: [] }))
        ]);
        const data = await convRes.json();
        _chatConversationsList = data.conversations || [];
        _chatFriendsList = friendsRes.friends || [];
        renderChatConversations(_chatConversationsList);

        // Dynamically update the active header if it's open
        if (currentChatContact) {
            updateActiveChatHeader();
        }
    } catch (err) {
        console.error("Error cargando conversaciones:", err);
    }
}

function renderChatConversations(conversations) {
    const list = document.getElementById('chat-conversations-list');
    if (!list) return;

    if (conversations.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; opacity: 0.5;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; color: var(--text-muted);"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <p style="margin-top: 12px; font-size: 0.85rem;">No hay conversaciones aún</p>
                <p style="font-size: 0.75rem;">Usa el botón + para iniciar una</p>
            </div>
        `;
        return;
    }

    const html = conversations.map(c => {
        const time = c.last_time ? formatChatTime(c.last_time) : '';
        let preview = c.last_message;
        let isFile = false;
        if (c.last_file_name) {
            isFile = true;
            if (isAudioFile(c.last_file_name)) {
                const dur = c.last_file_name.match(/_(\d+)s\./);
                preview = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Audio' + (dur ? ' · ' + formatDuration(parseInt(dur[1])) : '');
            } else if (isVideoFile(c.last_file_name)) {
                preview = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg> Video';
            } else if (isImageFile(c.last_file_name)) {
                preview = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Foto';
            } else {
                preview = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> ' + c.last_file_name;
            }
        } else if (preview) {
            preview = preview.replace(/^\[REPLY\|.*?\|.*?\|.*?\]\s*/, '');
        }
        if (!isFile && preview && preview.length > 35) preview = preview.substring(0, 35) + '...';
        const isActive = currentChatContact && currentChatContact.contact_id === c.contact_id;
        const unreadBadge = c.unread > 0 ? `<span class="badge">${c.unread}</span>` : '';
        const status = getStatusFromActivity(c.last_activity);
        const onlineDot = status.isOnline ? '<div class="online-dot"></div>' : '';

        return `
            <div class="chat-item ${isActive ? 'active' : ''}" onclick="openChatWith('${c.contact_id}', '${c.contact_name}', '${c.last_activity || ''}')" oncontextmenu="event.preventDefault();event.stopPropagation();openChatConvMenu(event,'${c.contact_id}','${c.contact_name.replace(/'/g, "\\'")}', ${!!c.is_muted})">
                <div class="avatar">
                    <img src="/api/system/user/avatar/${c.contact_name}" onerror="this.outerHTML = '${c.contact_name.charAt(0).toUpperCase()}'">
                    ${onlineDot}
                </div>
                <div class="chat-meta">
                    <div class="row1">
                        <span class="name">${c.contact_name}${c.is_muted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5; margin-left:4px; vertical-align:-2px;"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>' : ''}</span>
                        <span class="time">${time}</span>
                    </div>
                    <div class="row2">
                        <span class="preview">${(c.last_sender && c.last_sender !== c.contact_id) ? 'Tú: ' : ''}${preview || 'Sin mensajes'}</span>
                        ${unreadBadge}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    list.innerHTML = html;
}

/* ─── Open / Load Messages ─── */


let _chatMessageCache = {};

async function openChatWith(contactId, contactName, lastActivityIso = '') {
    currentChatContact = { contact_id: contactId, contact_name: contactName, last_activity: lastActivityIso };
    localStorage.setItem('nv_chat_contact', JSON.stringify(currentChatContact));
    hideChatTyping();
    cancelMessageSelection();

    updateActiveChatHeader();

    document.getElementById('chat-empty-state').style.display = 'none';
    document.getElementById('chat-active-area').style.display = 'flex';
    
    // Activar vista móvil
    const viewChat = document.getElementById('view-chat');
    if (viewChat) viewChat.classList.add('mobile-chat-active');

    if (_chatMessageCache[contactId]) {
        chatMessages = _chatMessageCache[contactId];
        renderChatMessages();
    } else {
        chatMessages = [];
        const container = document.getElementById('chat-messages');
        if (container) container.innerHTML = '<div style="flex:1; display:flex; align-items:center; justify-content:center; opacity:0.5;"><div class="typing" style="background:transparent;gap:6px;"><span style="width:10px;height:10px;"></span><span style="width:10px;height:10px;"></span><span style="width:10px;height:10px;"></span></div></div>';
    }

    loadChatMessages(contactId); // No await, let it run in background
    startChatPolling();

    markChatAsRead(contactId);
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.chat-item[onclick*="${contactId}"]`);
    if (activeEl) activeEl.classList.add('active');
}

async function loadChatMessages(contactId) {
    try {
        const res = await fetch('/api/chat/messages', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ contact_id: contactId, limit: 50 })
        });
        const data = await res.json();
        
        _chatMessageCache[contactId] = data.messages || [];
        
        if (currentChatContact && currentChatContact.contact_id === contactId) {
            chatMessages = _chatMessageCache[contactId];
            renderChatMessages();
        }
    } catch (err) {
        console.error("Error cargando mensajes:", err);
    }
}

/* ─── Render Messages (WhatsApp-style) ─── */

function renderChatMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    if (chatMessages.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; opacity: 0.4;">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4; color: var(--text-muted); margin-bottom: 12px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <p style="margin-top: 12px;">Los mensajes están cifrados de extremo a extremo.</p>
                <p style="font-size: 0.8rem;">Envía un mensaje para empezar.</p>
            </div>
        `;
        return;
    }

    let lastDate = '';
    let html = '';

    let groupedMessages = [];
    let currentGroup = [];

    chatMessages.forEach(msg => {
        const isImage = msg.file_path && msg.file_name && isImageFile(msg.file_name);
        const hasText = !!msg.message;
        const hasReply = !!(msg.message && msg.message.match(/^\[REPLY\|([^\|]+)\|([^\|]+)\|([^\]]+)\]/));

        if (isImage && !hasText && !hasReply) {
            if (currentGroup.length === 0) {
                currentGroup.push(msg);
            } else {
                const lastMsg = currentGroup[currentGroup.length - 1];
                const sameSender = lastMsg.mine === msg.mine;
                const timeDiff = Math.abs(msg.time - lastMsg.time);
                
                if (sameSender && timeDiff <= 60) {
                    currentGroup.push(msg);
                } else {
                    groupedMessages.push(currentGroup);
                    currentGroup = [msg];
                }
            }
        } else {
            if (currentGroup.length > 0) {
                groupedMessages.push(currentGroup);
                currentGroup = [];
            }
            groupedMessages.push([msg]);
        }
    });
    
    if (currentGroup.length > 0) {
        groupedMessages.push(currentGroup);
    }

    groupedMessages.forEach(group => {
        const isGrouped = group.length > 1;
        const msg = isGrouped ? group[group.length - 1] : group[0];
        
        const date = new Date(msg.time * 1000);
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        if (dateStr !== lastDate) {
            html += `<div class="day-divider">${dateStr}</div>`;
            lastDate = dateStr;
        }

        if (isGrouped) {
            let gridClass = 'grid-2';
            if (group.length === 3) gridClass = 'grid-3';
            else if (group.length === 4) gridClass = 'grid-4';
            else if (group.length > 4) gridClass = 'grid-more';
            
            let groupIds = group.map(g => g.id);
            let groupIdsStr = `['${groupIds.join("','")}']`;
            let joinedIds = groupIds.join(",");
            
            let gridItemsHtml = '';
            group.forEach((gMsg, idx) => {
                gridItemsHtml += `
                    <div class="msg-image-grid-item grid-item-${idx}" onclick="openChatLightbox('/api/chat/download/${gMsg.id}', ${groupIdsStr})" oncontextmenu="event.stopPropagation();openChatContextMenu(event,'${joinedIds}',${gMsg.mine})">
                        <img src="/api/chat/download/${gMsg.id}" alt="" loading="lazy">
                    </div>
                `;
            });
            
            const isSelected = _selectedMessages.has(msg.id);
            const selClass = _chatSelectionMode ? (isSelected ? 'selection-mode selected' : 'selection-mode') : '';

            html += `
                <div class="msg-row ${msg.mine ? 'out' : 'in'} ${selClass}" data-msg-id="${msg.id}">
                    <div class="msg-checkbox"></div>
                    <div class="bubble" style="padding: 4px; background: transparent; box-shadow: none;" oncontextmenu="openChatContextMenu(event,'${joinedIds}',${msg.mine})">
                        <div class="msg-image-grid ${gridClass}">
                            ${gridItemsHtml}
                        </div>
                        <div class="meta-line" style="justify-content: flex-end; padding: 4px 8px 0; background: rgba(0,0,0,0.4); border-radius: 12px; display: inline-flex; position: absolute; bottom: 8px; right: 8px; color: white;">
                            <span>${timeStr}</span>
                            ${msg.mine ? `<span class="check" style="color: white; margin-left: 4px;">${msg.read ? '✓✓' : '✓'}</span>` : ''}
                        </div>
                        <div class="msg-actions-menu">
                            <button onclick="event.stopPropagation();openChatContextMenu(event,'${joinedIds}',${msg.mine})">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const msgText = msg.message || '';
            let safeMsg = msgText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');

            let replyHtml = '';
            const replyMatch = safeMsg.match(/^\[REPLY\|([^\|]+)\|([^\|]+)\|([^\]]+)\](?:<br>)?/);
            if (replyMatch) {
                safeMsg = safeMsg.replace(replyMatch[0], '');

                let replyName = replyMatch[2];
                if (replyMatch[2] === '0' || replyMatch[2] === '1') {
                    const isQuotedMine = replyMatch[2] === '1';
                    if (msg.mine) {
                        replyName = isQuotedMine ? 'Tú' : (currentChatContact ? currentChatContact.contact_name : 'Contacto');
                    } else {
                        replyName = isQuotedMine ? (currentChatContact ? currentChatContact.contact_name : 'Contacto') : 'Tú';
                    }
                } else {
                    const origMsg = chatMessages.find(m => m.id === replyMatch[1]);
                    if (origMsg) {
                        replyName = origMsg.mine ? 'Tú' : (currentChatContact ? currentChatContact.contact_name : 'Contacto');
                    }
                }

                replyHtml = `
                    <div class="chat-reply-box" style="background: rgba(0,0,0,0.1); border-left: 4px solid var(--indigo, #6366f1); padding: 6px 10px; border-radius: 4px 8px 8px 4px; margin-bottom: 6px; font-size: 0.8rem; cursor: pointer; transition: background 0.2s;" onclick="const b = document.querySelector('.chat-bubble[data-msg-id=\\'${replyMatch[1]}\\']'); if(b) { b.scrollIntoView({behavior: 'smooth', block: 'center'}); b.style.background = 'rgba(99,102,241,0.3)'; setTimeout(() => b.style.background='', 1000); }">
                        <div style="font-weight: bold; color: var(--indigo, #6366f1); margin-bottom: 2px;">${replyName === 'undefined' ? 'Contacto' : replyName}</div>
                        <div style="color: inherit; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${replyMatch[3].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\[REPLY\|.*?\|.*?\|.*?\]/g, '').trim() || '📎 Archivo'}</div>
                    </div>
                `;
            }

            let imgHtml = '';
            let fileHtml = '';
            let audioHtml = '';
            let videoHtml = '';

            if (msg.file_path) {
                const name = msg.file_name || 'archivo';
                if (isImageFile(name)) {
                    imgHtml = `
                        <div class="msg-image-content" onclick="openChatLightbox('/api/chat/download/${msg.id}')">
                            <img src="/api/chat/download/${msg.id}" alt="" loading="lazy" style="max-width:100%; border-radius:8px;">
                        </div>
                    `;
                } else if (isVideoFile(name)) {
                    videoHtml = `
                        <div class="msg-image-content" onclick="openChatVideo('/api/chat/download/${msg.id}')">
                            <video src="/api/chat/download/${msg.id}" preload="metadata" style="width:100%;max-height:280px;object-fit:cover;display:block;border-radius:8px;background:#000;" onloadedmetadata="this.poster=''">
                            </video>
                            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;pointer-events:none;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                            </div>
                        </div>
                    `;
                } else if (isAudioFile(name)) {
                    const durMatch = name.match(/_(\\d+)s\\./);
                    const durText = durMatch ? formatDuration(parseInt(durMatch[1])) : '0:00';
                    audioHtml = `
                        <div class="msg-audio-content" onclick="playAudio(this, '/api/chat/download/${msg.id}')">
                            <button class="chat-audio-play-btn" style="background:none; border:none; color:inherit; cursor:pointer;" onclick="event.stopPropagation();playAudio(this.parentElement,'/api/chat/download/${msg.id}')">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="audio-play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="audio-pause-icon" style="display:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                            </button>
                            <div class="chat-audio-wave" style="display:flex; gap:2px; height:14px; align-items:center; margin:0 10px;">
                                <span style="width:3px; height:100%; background:currentColor; opacity:0.6; border-radius:2px;"></span>
                                <span style="width:3px; height:60%; background:currentColor; opacity:0.6; border-radius:2px;"></span>
                                <span style="width:3px; height:80%; background:currentColor; opacity:0.6; border-radius:2px;"></span>
                                <span style="width:3px; height:40%; background:currentColor; opacity:0.6; border-radius:2px;"></span>
                            </div>
                            <span class="chat-audio-duration" data-duration="${durText}" style="font-size:11px; min-width:28px; text-align:right;">${durText}</span>
                        </div>
                    `;
                } else {
                    const fi = getChatFileIcon(name);
                    fileHtml = `
                        <div class="msg-file-content" onclick="downloadFile('/api/chat/download/${msg.id}','${name.replace(/'/g, "\\\\'")}')">
                            <div style="font-size:1.2rem;">${fi.icon}</div>
                            <div style="display:flex; flex-direction:column; line-height:1.2;">
                                <span style="font-weight:600; font-size:13px;">${name}</span>
                                <span style="font-size:11px; opacity:0.7;">${formatFileSize(msg.file_size)}</span>
                            </div>
                        </div>
                    `;
                }
            }

            const isSelected = _selectedMessages.has(msg.id);
            const selClass = _chatSelectionMode ? (isSelected ? 'selection-mode selected' : 'selection-mode') : '';

            html += `
                <div class="msg-row ${msg.mine ? 'out' : 'in'} ${selClass}" data-msg-id="${msg.id}">
                    <div class="msg-checkbox"></div>
                    <div class="bubble" oncontextmenu="openChatContextMenu(event,'${msg.id}',${msg.mine})">
                        ${replyHtml}
                        ${imgHtml}
                        ${videoHtml}
                        ${audioHtml}
                        ${safeMsg ? (safeMsg.length > 500 || (safeMsg.match(/<br>/g) || []).length > 10 ? `<div class="msg-text-collapsed" id="msg-text-${msg.id}">${safeMsg}</div><div class="msg-read-more" onclick="event.stopPropagation(); document.getElementById('msg-text-${msg.id}').classList.remove('msg-text-collapsed'); this.remove();">Leer más</div>` : `<div>${safeMsg}</div>`) : ''}
                        ${fileHtml}
                        <div class="meta-line">
                            <span>${timeStr}</span>
                            ${msg.edited_at ? '<span>editado</span>' : ''}
                            ${msg.mine ? `<span class="check">${msg.read ? '✓✓' : '✓'}</span>` : ''}
                        </div>
                        <div class="msg-actions-menu">
                            <button onclick="event.stopPropagation();openChatContextMenu(event,'${msg.id}',${msg.mine})">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
    
    const images = container.querySelectorAll('img');
    images.forEach(img => {
        img.addEventListener('load', () => {
            if (container.scrollHeight - container.scrollTop - container.clientHeight < 300) {
                container.scrollTop = container.scrollHeight;
            }
        });
    });
    
    if (typeof updateChatInfoSidebarMedia === 'function') {
        updateChatInfoSidebarMedia();
    }
}

function chatScrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
}

function handleChatScroll() {
    const container = document.getElementById('chat-messages');
    const btn = document.getElementById('chat-scroll-bottom-btn');
    if (!container || !btn) return;
    
    if (container.scrollHeight - container.scrollTop - container.clientHeight > 200) {
        btn.style.display = 'flex';
    } else {
        btn.style.display = 'none';
    }
}

/* ─── Message Actions (Context Menu) ─── */

function closeChatContextMenu() {
    const el = document.getElementById('chat-msg-menu');
    if (el) {
        if (el._scrollHandler && el._scrollTarget) {
            el._scrollTarget.removeEventListener('scroll', el._scrollHandler);
        }
        el.remove();
    }
    _contextMsgId = null;
}

function openChatContextMenu(e, msgId, isMine) {
    e.preventDefault();
    e.stopPropagation();
    closeChatContextMenu();
    _contextMsgId = msgId;

    const msgIdStr = String(msgId);
    const ids = msgIdStr.includes(',') ? msgIdStr.split(',') : [msgIdStr];
    const msgObj = chatMessages.find(m => m.id == ids[0]);
    const msgText = msgObj ? msgObj.message : '';

    const menu = document.createElement('div');
    menu.id = 'chat-msg-menu';
    menu.style.cssText = 'position:fixed;z-index:99999;background:var(--surface-2);color:var(--text-main);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.5);padding:6px;min-width:180px;animation:chatBubbleIn 0.12s ease-out;';

    const items = [];
    items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>', label: 'Responder', action: 'replyMsg' });
    items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>', label: 'Copiar texto', action: 'copyText', show: !!msgText });

    if (msgObj && msgObj.file_path) {
        items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="M8 17l4 4 4-4"></path></svg>', label: 'Guardar en Cloud', action: 'saveToCloud' });
    }

    items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"></polyline><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path></svg>', label: 'Reenviar', action: 'forwardMsg' });
    items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>', label: 'Seleccionar', action: 'selectMsg' });
    if (isMine) {
        items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="16 3 21 8 8 21 3 21 3 16 16 3"></polygon></svg>', label: 'Editar', action: 'editMsg', show: !!msgText });
        items.push({ icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>', label: 'Eliminar', action: 'deleteMsg', color: '#f87171' });
    }

    items.filter(i => i.show !== false).forEach((item, idx) => {
        const div = document.createElement('div');
        const color = item.color || 'var(--text-main)';
        div.innerHTML = `<div style="display:flex;align-items:center;gap:12px;color:${color}">${item.icon}<span>${item.label}</span></div>`;
        div.style.cssText = 'padding:10px 14px;border-radius:8px;cursor:pointer;font-size:0.85rem;transition:background 0.1s;';
        div.onmouseenter = () => div.style.background = item.color ? 'rgba(248,113,113,0.08)' : 'rgba(99,102,241,0.08)';
        div.onmouseleave = () => div.style.background = '';
        div.onclick = (ev) => { ev.stopPropagation(); closeChatContextMenu(); handleMsgAction(item.action, msgId, msgText); };
        menu.appendChild(div);
    });

    let x = e.clientX || 0;
    let y = e.clientY || 0;
    const mw = 200, mh = items.length * 44;

    const searchId = msgIdStr.includes(',') ? msgIdStr.split(',').pop() : msgIdStr;
    const msgRow = document.querySelector(`.msg-row[data-msg-id="${searchId}"]`);
    if (msgRow) {
        const actionBtn = msgRow.querySelector('.msg-actions-menu button');
        const menuWrap = msgRow.querySelector('.msg-actions-menu');
        if (actionBtn && menuWrap) {
            let rect = actionBtn.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                const oldDisplay = menuWrap.style.display;
                menuWrap.style.display = 'flex';
                rect = actionBtn.getBoundingClientRect();
                menuWrap.style.display = oldDisplay;
            }
            if (rect.width > 0 || rect.height > 0) {
                x = rect.right - mw;
                y = rect.bottom;
            }
        }
    }

    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 10;
    if (x < 10) x = 10;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 10;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', closeChatContextMenu, { once: true });
        
        const scrollContainer = document.getElementById('chat-messages');
        if (scrollContainer) {
            menu._scrollHandler = closeChatContextMenu;
            menu._scrollTarget = scrollContainer;
            scrollContainer.addEventListener('scroll', closeChatContextMenu, { once: true, passive: true });
        }
    }, 0);
}

async function handleMsgAction(action, msgId, msgText) {
    const msgIdStr = String(msgId);
    let ids = msgIdStr.includes(',') ? msgIdStr.split(',') : [msgIdStr];
    let messages = ids.map(id => chatMessages.find(m => m.id == id)).filter(Boolean);
    if (messages.length === 0) return;
    
    const msg = messages[0];

    switch (action) {
        case 'replyMsg':
            _chatReplyToMsg = msg;
            document.getElementById('chat-reply-name').textContent = msg.mine ? 'Tú' : (currentChatContact ? currentChatContact.contact_name : 'Contacto');
            let snippet = msg.message || '';
            if (msg.file_name) {
                if (isAudioFile(msg.file_name)) {
                    const dur = msg.file_name.match(/_(\d+)s\./);
                    snippet = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Audio' + (dur ? ' · ' + formatDuration(parseInt(dur[1])) : '');
                } else if (isVideoFile(msg.file_name)) {
                    snippet = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg> Video';
                } else if (isImageFile(msg.file_name)) {
                    snippet = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Foto';
                } else {
                    const safeName = msg.file_name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    snippet = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> ${safeName}`;
                }
            } else {
                snippet = snippet.replace(/^\[REPLY\|.*?\|.*?\|.*?\]\s*/, '');
                snippet = snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            document.getElementById('chat-reply-text').innerHTML = snippet;
            document.getElementById('chat-reply-preview').style.display = 'flex';
            document.getElementById('chat-input').focus();
            break;

        case 'copyText':
            try {
                await navigator.clipboard.writeText(msgText || msg.message || '');
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = msgText || msg.message || '';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            break;

        case 'saveToCloud':
            try {
                let savedCount = 0;
                let lastName = '';
                for (let m of messages) {
                    const res = await fetch('/api/chat/save_to_cloud', {
                        method: 'POST',
                        headers: HEADERS,
                        body: JSON.stringify({ msg_id: m.id })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        savedCount++;
                        lastName = data.name;
                    }
                }
                if (savedCount === 1) {
                    await showChatAlert('Archivo guardado', `El archivo se ha guardado correctamente en tu Cloud como: "${lastName}"`);
                } else if (savedCount > 1) {
                    await showChatAlert('Archivos guardados', `Se han guardado ${savedCount} archivos correctamente en tu Cloud.`);
                } else {
                    await showChatAlert('Error al guardar', `No se pudo guardar el archivo.`);
                }
            } catch (err) {
                await showChatAlert('Error', `Ocurrió un error: ${err.message}`);
            }
            break;

        case 'forwardMsg':
            if (ids.length > 1) {
                _chatSelectionMode = true;
                _selectedMessages.clear();
                ids.forEach(id => _selectedMessages.add(id));
                showForwardDialog();
            } else {
                showForwardDialog(msgId);
            }
            break;

        case 'selectMsg':
        case 'deleteMsg':
            startMessageSelection(msgId);
            break;

        case 'editMsg':
            editMessageInline(msgId);
            break;
    }
}

function editMessageInline(msgId) {
    const msg = chatMessages.find(m => m.id === msgId);
    if (!msg) return;
    const container = document.getElementById('chat-messages');
    const bubbles = container.querySelectorAll('.chat-bubble');
    let idx = -1;
    chatMessages.forEach((m, i) => { if (m.id === msgId) idx = i; });
    if (idx === -1 || !bubbles[idx]) return;

    const bubble = bubbles[idx];
    const textDiv = bubble.querySelector('.chat-bubble-text');
    if (!textDiv) return;

    const original = msg.message;
    textDiv.innerHTML = '';
    const input = document.createElement('textarea');
    input.value = original;
    input.style.cssText = 'width:100%;background:rgba(0,0,0,0.2);border:1px solid var(--indigo);border-radius:8px;padding:8px;color:#fff;font-size:0.85rem;resize:none;outline:none;font-family:inherit;';
    input.rows = 2;
    textDiv.appendChild(input);
    input.focus();

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
    actions.innerHTML = '<button class="fr-btn fr-btn-success" style="height:28px;padding:0 12px;font-size:0.75rem;">Guardar</button>'
        + '<button class="fr-btn fr-btn-danger" style="height:28px;padding:0 12px;font-size:0.75rem;">Cancelar</button>';
    textDiv.appendChild(actions);

    actions.querySelector('.fr-btn-success').onclick = async () => {
        const newText = input.value.trim();
        if (!newText || newText === original) { textDiv.innerHTML = original; return; }
        
        if (newText.length > 65536) {
            showChatAlert('Mensaje demasiado largo', 'El límite máximo por mensaje es de 65,536 caracteres. Tu mensaje tiene ' + newText.length.toLocaleString() + ' caracteres.');
            return;
        }
        const res = await fetch('/api/chat/edit', {
            method: 'POST', headers: HEADERS,
            body: JSON.stringify({ msg_id: msgId, message: newText })
        });
        if (res.ok) {
            msg.message = newText;
            msg.edited_at = Date.now() / 1000;
            renderChatMessages();
        } else {
            textDiv.innerHTML = original;
        }
    };
    actions.querySelector('.fr-btn-danger').onclick = () => { textDiv.innerHTML = original; };
}

/* ─── Forward Dialog ─── */

function showForwardDialog(msgId) {
    if (msgId) _contextMsgId = msgId;
    const overlay = document.createElement('div');
    overlay.id = 'chat-forward-overlay';
    overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);z-index:99999;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-card);border-radius:16px;width:90%;max-width:400px;max-height:70vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:chatScaleIn 0.2s ease-out;display:flex;flex-direction:column;';

    const count = _chatSelectionMode ? _selectedMessages.size : 1;
    const title = count > 1 ? `Reenviar ${count} mensajes` : 'Reenviar mensaje';

    box.innerHTML = `
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;font-size:1rem;color:var(--text-main);font-weight:600;">${title}</h3>
            <button onclick="this.closest('#chat-forward-overlay').remove()" style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;outline:none;line-height:1;">✕</button>
        </div>
        <div style="padding:12px 16px; border-bottom:1px solid var(--border);">
            <input type="text" id="chat-forward-search" placeholder="Buscar contacto..." oninput="filterForwardContacts(this.value)" 
                style="width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: var(--text-main); font-size: 0.85rem; outline: none; transition: border-color 0.15s;" />
        </div>
        <div id="frwd-list" style="padding:8px;max-height:40vh;overflow-y:auto;flex:1;">
            <div style="padding:20px;text-align:center;opacity:0.5;font-size:0.85rem;">Cargando...</div>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    loadForwardContacts();
}

async function loadForwardContacts() {
    try {
        const res = await fetch('/api/chat/forward/contacts', { headers: HEADERS });
        const data = await res.json();
        _forwardDialogData = data.contacts || [];
        renderForwardContacts(_forwardDialogData);
    } catch (e) {
        const list = document.getElementById('frwd-list');
        if (list) list.innerHTML = '<div style="padding:20px;text-align:center;color:#f87171;font-size:0.85rem;">Error al cargar contactos</div>';
    }
}

function renderForwardContacts(contacts) {
    const list = document.getElementById('frwd-list');
    if (!list) return;

    if (contacts.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.5;font-size:0.85rem;">No se encontraron contactos</div>';
        return;
    }

    list.innerHTML = contacts.map(c => `
        <div class="fr-item" onclick="doForward('${c.contact_id}')" 
             onmouseenter="this.style.background='rgba(99,102,241,0.08)';" 
             onmouseleave="this.style.background='';"
             style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 8px; cursor: pointer; transition: background 0.15s; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="fr-avatar" style="width: 38px; height: 38px; border-radius: 50%; background: var(--indigo); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.9rem; position: relative;">
                    <img src="/api/system/user/avatar/${c.username}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 1;" onerror="this.style.display='none'">
                    <span style="z-index: 0;">${c.username.charAt(0).toUpperCase()}</span>
                </div>
                <div class="fr-info">
                    <div class="fr-name" style="font-weight: 600; font-size: 0.9rem; color: var(--text-main);">${c.username}</div>
                </div>
            </div>
            <div style="color: var(--indigo); display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(99, 102, 241, 0.08); transition: all 0.15s;" class="fr-send-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
            </div>
        </div>
    `).join('');
}

function filterForwardContacts(query) {
    const q = query.toLowerCase().trim();
    const filtered = _forwardDialogData.filter(c => c.username.toLowerCase().includes(q));
    renderForwardContacts(filtered);
}

async function doForward(targetContactId) {
    const overlay = document.getElementById('chat-forward-overlay');
    if (overlay) overlay.remove();
    const msgIds = _chatSelectionMode ? Array.from(_selectedMessages) : (_contextMsgId ? [_contextMsgId] : []);
    if (msgIds.length === 0) return;
    try {
        for (const msgId of msgIds) {
            await fetch('/api/chat/forward', {
                method: 'POST', headers: HEADERS,
                body: JSON.stringify({ msg_id: msgId, target_contact_id: targetContactId })
            });
        }
        cancelMessageSelection();
    } catch (e) { }
}

/* ─── Delete Conversation ─── */

function openChatConvMenu(e, contactId, contactName, isMuted) {
    e.preventDefault();
    e.stopPropagation();
    const existing = document.getElementById('chat-conv-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'chat-conv-menu';
    menu.style.cssText = 'position:fixed;z-index:99999;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.5);padding:6px;min-width:190px;';
    
    const muteIcon = isMuted 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
    const muteText = isMuted ? 'Dejar de silenciar' : 'Silenciar conversación';

    menu.innerHTML = `
        <div style="padding:10px 14px;border-radius:8px;cursor:pointer;font-size:0.85rem;color:var(--text-main);display:flex;align-items:center;gap:12px;" onmouseenter="this.style.background='var(--surface-3)'" onmouseleave="this.style.background=''" onclick="this.closest('#chat-conv-menu').remove();toggleChatMute('${contactId}')">${muteIcon}<span>${muteText}</span></div>
        <div style="padding:10px 14px;border-radius:8px;cursor:pointer;font-size:0.85rem;color:#f87171;display:flex;align-items:center;gap:12px;" onmouseenter="this.style.background='rgba(248,113,113,0.08)'" onmouseleave="this.style.background=''" onclick="this.closest('#chat-conv-menu').remove();deleteChatConversation('${contactId}','${contactName.replace(/'/g, "\\'")}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Eliminar conversación</span></div>
    `;
    document.body.appendChild(menu);

    let x = e.clientX || 0, y = e.clientY || 0;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    if (y + 60 > window.innerHeight) y = window.innerHeight - 70;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    setTimeout(() => document.addEventListener('click', () => { const m = document.getElementById('chat-conv-menu'); if (m) m.remove(); }, { once: true }), 0);
}

async function deleteChatConversation(contactId, contactName) {
    const confirmed = await showChatConfirm('Eliminar conversación', `¿Eliminar conversación con ${contactName}? Los mensajes se eliminarán solo para ti.`);
    if (!confirmed) return;
    try {
        await fetch('/api/chat/delete_conversation', {
            method: 'POST', headers: HEADERS,
            body: JSON.stringify({ contact_id: contactId })
        });
        if (currentChatContact && currentChatContact.contact_id === contactId) {
            currentChatContact = null;
            localStorage.removeItem('nv_chat_contact');
            chatMessages = [];
            document.getElementById('chat-header').innerHTML = '';
            document.getElementById('chat-empty-state').style.display = 'flex';
            document.getElementById('chat-active-area').style.display = 'none';
        }
        await loadChatConversations();
    } catch (e) { }
}

async function toggleChatMute(contactId) {
    try {
        await fetch('/api/chat/toggle_mute', {
            method: 'POST', headers: HEADERS,
            body: JSON.stringify({ contact_id: contactId })
        });
        await loadChatConversations();
    } catch (e) { }
}

/* ─── Message Selection ─── */

function startMessageSelection(msgId) {
    _chatSelectionMode = true;
    _selectedMessages.clear();
    const msgIdStr = String(msgId);
    let ids = msgIdStr.includes(',') ? msgIdStr.split(',') : [msgIdStr];
    ids.forEach(id => _selectedMessages.add(id));
    _lastSelectedMsgId = ids[ids.length - 1];

    const rows = document.querySelectorAll('.msg-row');
    rows.forEach(r => {
        r.classList.add('selection-mode');
        r.classList.toggle('selected', _selectedMessages.has(r.dataset.msgId));
    });

    updateSelectionBar();
}

function toggleMessageSelection(msgId) {
    if (_selectedMessages.has(msgId)) {
        _selectedMessages.delete(msgId);
    } else {
        _selectedMessages.add(msgId);
    }

    const row = document.querySelector(`.msg-row[data-msg-id="${msgId}"]`);
    if (row) {
        row.classList.toggle('selected', _selectedMessages.has(msgId));
    }

    updateSelectionBar();
}

function selectRangeMessages(id1, id2) {
    const idx1 = chatMessages.findIndex(m => m.id == id1);
    const idx2 = chatMessages.findIndex(m => m.id == id2);
    if (idx1 === -1 || idx2 === -1) return;

    const start = Math.min(idx1, idx2);
    const end = Math.max(idx1, idx2);

    for (let i = start; i <= end; i++) {
        const msgId = chatMessages[i].id;
        _selectedMessages.add(msgId);
        const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
        if (bubble) {
            bubble.classList.add('selected');
        }
    }
    updateSelectionBar();
}

function updateSelectionBar() {
    const bar = document.getElementById('chat-selection-bar');
    const inputArea = document.querySelector('.chat-input-area');
    const countSpan = document.getElementById('chat-selection-count');

    if (!bar || !countSpan) return;

    if (_chatSelectionMode) {
        bar.style.display = 'flex';
        if (inputArea) inputArea.style.display = 'none';
        countSpan.textContent = _selectedMessages.size;
    } else {
        bar.style.display = 'none';
        if (inputArea) inputArea.style.display = 'flex';
    }
}

function cancelMessageSelection() {
    _chatSelectionMode = false;
    _selectedMessages.clear();
    _lastSelectedMsgId = null;

    const rows = document.querySelectorAll('.msg-row');
    rows.forEach(r => {
        r.classList.remove('selection-mode', 'selected');
    });

    updateSelectionBar();

    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
}

async function copySelectedMessages() {
    if (_selectedMessages.size === 0) return;

    const sorted = chatMessages.filter(m => _selectedMessages.has(m.id));
    const text = sorted.map(m => {
        const sender = m.mine ? 'Tú' : (currentChatContact?.contact_name || 'Contacto');
        const time = new Date(m.time * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return `[${sender} - ${time}]: ${m.message || '[Archivo/Multimedia]'}`;
    }).join('\n');

    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }

    cancelMessageSelection();
}

function forwardSelectedMessages() {
    if (_selectedMessages.size === 0) return;
    showForwardDialog();
}

async function deleteSelectedMessages() {
    if (_selectedMessages.size === 0) return;
    
    // Comprobar si todos son míos y si hay archivos
    const ids = Array.from(_selectedMessages);
    let allMine = true;
    let hasFiles = false;
    
    for (const msgId of ids) {
        const msg = chatMessages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.mine) allMine = false;
            if (msg.file_path) hasFiles = true;
        }
    }

    const result = await showChatDeleteConfirm(ids.length, allMine, hasFiles);
    if (result.action === 'cancel') return;

    try {
        for (const msgId of ids) {
            await fetch('/api/chat/delete_message', {
                method: 'POST', headers: HEADERS,
                body: JSON.stringify({ 
                    msg_id: msgId, 
                    delete_type: result.action,
                    delete_files: result.deleteFiles
                })
            });
            const idx = chatMessages.findIndex(m => m.id == msgId);
            if (idx !== -1) { chatMessages.splice(idx, 1); }
        }
        renderChatMessages();
    } catch (e) { }
    cancelMessageSelection();
}

/* ─── Secure Download ─── */

async function downloadFile(url, filename) {
    try {
        const res = await fetch(url, { headers: { 'X-Token': TOKEN } });
        if (!res.ok) throw new Error('Error al descargar');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'descarga';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
        console.error("Error en descarga:", err);
    }
}

/* ─── Audio Player (play/pause/resume) ─── */

let _chatAudio = null;
let _chatAudioEl = null;

function playAudio(el, url) {
    const durSpan = el.querySelector('.chat-audio-duration');

    const restoreDuration = (elem) => {
        if (!elem) return;
        const span = elem.querySelector('.chat-audio-duration');
        if (span && span.dataset.duration) {
            span.textContent = span.dataset.duration;
        }
    };

    if (_chatAudio && _chatAudioEl === el && _chatAudioEl.classList.contains('playing')) {
        _chatAudio.pause();
        _chatAudioEl.classList.remove('playing');
        _chatAudioEl.classList.add('paused');
        return;
    }
    if (_chatAudio && _chatAudioEl === el && _chatAudioEl.classList.contains('paused')) {
        _chatAudio.play();
        _chatAudioEl.classList.add('playing');
        _chatAudioEl.classList.remove('paused');
        return;
    }
    if (_chatAudio) {
        _chatAudio.pause();
        restoreDuration(_chatAudioEl);
        if (_chatAudioEl) {
            _chatAudioEl.classList.remove('playing', 'paused');
        }
        _chatAudio = null;
    }
    el.classList.add('playing');
    el.classList.remove('paused');
    _chatAudioEl = el;
    
    // Fetch blob with token
    fetch(url, { headers: { 'X-Token': typeof TOKEN !== 'undefined' ? TOKEN : '' } })
        .then(res => {
            if (!res.ok) throw new Error('Error al descargar audio');
            return res.blob();
        })
        .then(blob => {
            if (_chatAudioEl !== el) return; // if user clicked another audio while loading
            const blobUrl = URL.createObjectURL(blob);
            _chatAudio = new Audio(blobUrl);

    _chatAudio.ontimeupdate = () => {
        if (!durSpan || !_chatAudio) return;

        // Parse original duration from dataset to avoid Infinity issues with WebM
        let totalSecs = 0;
        if (durSpan.dataset.duration) {
            const parts = durSpan.dataset.duration.split(':');
            if (parts.length === 2) {
                totalSecs = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            }
        }

        // If we can't parse it, default to just counting up
        if (!totalSecs) {
            const cur = Math.floor(_chatAudio.currentTime);
            const m = Math.floor(cur / 60);
            const s = Math.floor(cur % 60);
            durSpan.textContent = `${m}:${s.toString().padStart(2, '0')}`;
            return;
        }

        const remaining = Math.max(0, totalSecs - _chatAudio.currentTime);
        const mins = Math.floor(remaining / 60);
        const secs = Math.floor(remaining % 60);
        durSpan.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    _chatAudio.onended = () => {
        el.classList.remove('playing', 'paused');
        restoreDuration(el);
        _chatAudio = null;
        _chatAudioEl = null;
        URL.revokeObjectURL(blobUrl);
    };
    _chatAudio.onerror = () => {
        el.classList.remove('playing', 'paused');
        restoreDuration(el);
        _chatAudio = null;
        _chatAudioEl = null;
        URL.revokeObjectURL(blobUrl);
    };
    _chatAudio.play().catch(() => {
        el.classList.remove('playing', 'paused');
        restoreDuration(el);
        _chatAudio = null;
        _chatAudioEl = null;
        URL.revokeObjectURL(blobUrl);
    });
        })
        .catch(err => {
            console.error(err);
            el.classList.remove('playing', 'paused');
            restoreDuration(el);
            if (_chatAudioEl === el) _chatAudioEl = null;
        });
}

/* ─── Video Player (lightbox) ─── */

function openChatVideo(src) {
    const lb = document.getElementById('chat-lightbox');
    const img = document.getElementById('chat-lightbox-img');
    if (lb && img) {
        img.style.display = 'none';
        let video = lb.querySelector('video');
        if (!video) {
            video = document.createElement('video');
            video.controls = true;
            video.autoplay = true;
            video.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,0.6);';
            lb.insertBefore(video, lb.firstChild);
        }
        video.style.display = '';
        video.src = src;
        video.play();
        lb.classList.add('active');
    }
}

/* ─── Lightbox ─── */

let currentLbGroup = [];
let currentLbIndex = -1;

function openChatLightbox(src, groupIds = []) {
    const lb = document.getElementById('chat-lightbox');
    const img = document.getElementById('chat-lightbox-img');
    const video = lb.querySelector('video');
    if (video) { video.style.display = 'none'; video.pause(); }
    
    currentLbGroup = groupIds;
    currentLbIndex = -1;
    
    const prevBtn = document.getElementById('lb-prev');
    const nextBtn = document.getElementById('lb-next');
    
    if (groupIds && groupIds.length > 1) {
        const msgIdMatch = src.match(/\/api\/chat\/download\/([a-zA-Z0-9_-]+)/);
        if (msgIdMatch) {
            currentLbIndex = groupIds.indexOf(msgIdMatch[1]);
        }
        if (prevBtn) prevBtn.style.display = 'block';
        if (nextBtn) nextBtn.style.display = 'block';
    } else {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    }

    if (lb && img) {
        img.style.display = '';
        img.src = src;
        lb.classList.add('active');
    }
}

function navigateLightbox(direction) {
    if (currentLbIndex === -1 || currentLbGroup.length <= 1) return;
    
    currentLbIndex += direction;
    
    if (currentLbIndex < 0) currentLbIndex = currentLbGroup.length - 1;
    if (currentLbIndex >= currentLbGroup.length) currentLbIndex = 0;
    
    const newSrc = `/api/chat/download/${currentLbGroup[currentLbIndex]}`;
    const img = document.getElementById('chat-lightbox-img');
    if (img) img.src = newSrc;
}

function closeChatLightbox() {
    const lb = document.getElementById('chat-lightbox');
    if (!lb) return;
    lb.classList.remove('active');
    const video = lb.querySelector('video');
    if (video) { video.pause(); video.style.display = 'none'; }
    currentLbGroup = [];
    currentLbIndex = -1;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChatLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#chat-msg-menu')) closeChatContextMenu();
});

// Long-press for touch devices
let _longPressTimer = null;
document.addEventListener('touchstart', (e) => {
    const bubble = e.target.closest('.bubble');
    if (!bubble || bubble.closest('#chat-msg-menu')) return;
    _longPressTimer = setTimeout(() => {
        const msgRow = bubble.closest('.msg-row');
        if (!msgRow) return;
        const msgId = msgRow.dataset.msgId;
        const msg = chatMessages.find(m => m.id == msgId);
        if (msg) {
            const touch = e.touches[0];
            openChatContextMenu({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => { }, stopPropagation: () => { } }, msgId, msg.mine);
        }
    }, 500);
}, { passive: true });
document.addEventListener('touchend', () => { if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; } }, { passive: true });
document.addEventListener('touchmove', () => { if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; } }, { passive: true });

/* ─── Voice Recorder ─── */

let _mediaRecorder = null;
let _audioChunks = [];
let _recordingTimer = null;
let _recordingSeconds = 0;
let _recordingStream = null;
let _isRecordingPaused = false;

async function toggleVoiceRecorder() {
    const recorder = document.getElementById('chat-voice-recorder');
    const input = document.getElementById('chat-input');
    const actionBtn = document.getElementById('chat-action-btn');
    const attachBtn = document.getElementById('chat-attach-btn');

    if (recorder && recorder.style.display !== 'none') {
        await sendVoiceRecording();
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("Grabación de voz no soportada");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _recordingStream = stream;
        _audioChunks = [];
        _recordingSeconds = 0;
        _isRecordingPaused = false;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';
        _mediaRecorder = new MediaRecorder(stream, { mimeType });

        _mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) _audioChunks.push(e.data);
        };

        _mediaRecorder.start(250);

        recorder.style.display = 'flex';
        input.style.display = 'none';
        if (actionBtn) actionBtn.classList.add('recording');
        if (attachBtn) attachBtn.style.display = 'none';

        document.getElementById('chat-voice-timer').textContent = '0:00';
        
        const pauseIcon = document.getElementById('chat-voice-pause-icon');
        const resumeIcon = document.getElementById('chat-voice-resume-icon');
        const dot = document.getElementById('chat-voice-dot');
        if (pauseIcon) pauseIcon.style.display = 'block';
        if (resumeIcon) resumeIcon.style.display = 'none';
        if (dot) dot.style.animationPlayState = 'running';

        _recordingTimer = setInterval(() => {
            _recordingSeconds++;
            document.getElementById('chat-voice-timer').textContent = formatDuration(_recordingSeconds);
        }, 1000);

    } catch (err) {
        console.warn("Micrófono no disponible:", err.message);
    }
}

function togglePauseVoiceRecording() {
    if (!_mediaRecorder) return;
    const pauseIcon = document.getElementById('chat-voice-pause-icon');
    const resumeIcon = document.getElementById('chat-voice-resume-icon');
    const dot = document.getElementById('chat-voice-dot');

    if (_mediaRecorder.state === 'recording') {
        _mediaRecorder.pause();
        _isRecordingPaused = true;
        if (pauseIcon) pauseIcon.style.display = 'none';
        if (resumeIcon) resumeIcon.style.display = 'block';
        if (dot) dot.style.animationPlayState = 'paused';
        if (_recordingTimer) { clearInterval(_recordingTimer); _recordingTimer = null; }
    } else if (_mediaRecorder.state === 'paused') {
        _mediaRecorder.resume();
        _isRecordingPaused = false;
        if (pauseIcon) pauseIcon.style.display = 'block';
        if (resumeIcon) resumeIcon.style.display = 'none';
        if (dot) dot.style.animationPlayState = 'running';
        
        _recordingTimer = setInterval(() => {
            _recordingSeconds++;
            document.getElementById('chat-voice-timer').textContent = formatDuration(_recordingSeconds);
        }, 1000);
    }
}

function cancelVoiceRecording() {
    _audioChunks = [];
    cleanupVoiceRecording();
    const recorder = document.getElementById('chat-voice-recorder');
    const input = document.getElementById('chat-input');
    const actionBtn = document.getElementById('chat-action-btn');
    const attachBtn = document.getElementById('chat-attach-btn');
    if (recorder) recorder.style.display = 'none';
    if (actionBtn) actionBtn.classList.remove('recording');
    if (attachBtn) attachBtn.style.display = '';
    if (input) { input.style.display = ''; input.disabled = false; input.style.opacity = ''; input.focus(); }
}

async function restartVoiceRecording() {
    cancelVoiceRecording();
    setTimeout(async () => {
        await toggleVoiceRecorder();
    }, 150);
}

async function sendVoiceRecording() {
    try {
        const duration = _recordingSeconds;

        if (_recordingTimer) {
            clearInterval(_recordingTimer);
            _recordingTimer = null;
        }

        if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
            await new Promise(resolve => {
                _mediaRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) _audioChunks.push(e.data);
                };
                _mediaRecorder.onstop = resolve;
                try {
                    _mediaRecorder.requestData();
                    _mediaRecorder.stop();
                } catch (e) { resolve(); }
            });
        }

        if (_recordingStream) {
            _recordingStream.getTracks().forEach(t => t.stop());
            _recordingStream = null;
        }
        _mediaRecorder = null;

        // Reset UI
        const recorder = document.getElementById('chat-voice-recorder');
        const input = document.getElementById('chat-input');
        const actionBtn = document.getElementById('chat-action-btn');
        const attachBtn = document.getElementById('chat-attach-btn');
        if (recorder) recorder.style.display = 'none';
        if (actionBtn) actionBtn.classList.remove('recording');
        if (attachBtn) attachBtn.style.display = '';
        if (input) { input.style.display = ''; input.disabled = false; input.style.opacity = ''; }

        if (_audioChunks.length === 0) {
            alert("No se capturó audio (chunks vacío). Revisa los permisos o tu micrófono.");
            _recordingSeconds = 0;
            return;
        }

        const blob = new Blob(_audioChunks, { type: 'audio/webm' });
        const fileName = 'audio_' + Date.now() + '_' + duration + 's.webm';
        _audioChunks = [];
        _recordingSeconds = 0;

        selectedChatFiles = [new File([blob], fileName, { type: 'audio/webm' })];

        try {
            await sendChatMessage();
        } catch (e) {
            alert("Error en sendChatMessage: " + e.message);
        }
    } catch (e) {
        alert("Error general en sendVoiceRecording: " + e.message);
    }
}

function cleanupVoiceRecording() {
    if (_recordingTimer) {
        clearInterval(_recordingTimer);
        _recordingTimer = null;
    }
    _recordingSeconds = 0;
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
        _mediaRecorder.ondataavailable = null;
        _mediaRecorder.onstop = null;
        try { _mediaRecorder.stop(); } catch (e) { }
    }
    if (_recordingStream) {
        _recordingStream.getTracks().forEach(t => t.stop());
        _recordingStream = null;
    }
    _mediaRecorder = null;
}


/* ─── File Selection & Drag/Paste ─── */

function attachChatFiles() {
    if (selectedChatFiles.length === 0) return;

    document.getElementById('chat-file-preview').style.display = 'flex';
    const listContainer = document.getElementById('chat-file-list');
    if (listContainer) listContainer.innerHTML = '';

    let totalSize = 0;

    selectedChatFiles.forEach((file, index) => {
        totalSize += file.size;

        if (listContainer) {
            const thumbDiv = document.createElement('div');
            thumbDiv.style.cssText = 'position:relative; flex-shrink: 0; width: 60px; height: 60px;';

            const img = document.createElement('img');
            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 1px solid var(--border);';

            if (isImageFile(file.name || (file.type && file.type.split('/')[1]))) {
                img.style.cursor = 'pointer';
                img.onclick = () => openChatLightbox(img.src);
                const reader = new FileReader();
                reader.onload = (e) => { img.src = e.target.result; };
                reader.readAsDataURL(file);
            } else {
                img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23777" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
                img.style.padding = '10px';
                img.style.background = 'var(--surface-2)';
            }

            thumbDiv.appendChild(img);
            listContainer.appendChild(thumbDiv);
        }
    });

    if (selectedChatFiles.length === 1) {
        document.getElementById('chat-file-name').textContent = selectedChatFiles[0].name || 'Archivo adjunto';
    } else {
        document.getElementById('chat-file-name').textContent = `${selectedChatFiles.length} archivos seleccionados`;
    }
    document.getElementById('chat-file-size').textContent = formatFileSize(totalSize);
}

function handleChatFileSelect(event) {
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') return;
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (files.length > 10) {
        showChatAlert('Demasiados archivos', 'Solo puedes adjuntar hasta 10 archivos a la vez.');
        event.target.value = '';
        return;
    }

    selectedChatFiles = []; // Replace selection instead of accumulating
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop().toLowerCase();
        const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/') || 
                        isImageFile(file.name) || isAudioFile(file.name) || isVideoFile(file.name);

        if (isMedia && file.size > 16 * 1024 * 1024) {
            showChatAlert('Archivo muy pesado', 'El límite para multimedia es de 16 MB. Se omitió ' + file.name);
            continue;
        }
        
        if (!isMedia && file.size > 2 * 1024 * 1024 * 1024) {
            showChatAlert('Archivo muy pesado', 'El límite para documentos es de 2 GB. Se omitió ' + file.name);
            continue;
        }
        selectedChatFiles.push(file);
    }

    event.target.value = '';
    if (selectedChatFiles.length > 0) attachChatFiles();
    if (typeof updateChatActionBtn === 'function') updateChatActionBtn();
}

function clearChatFile() {
    selectedChatFiles = [];
    const fileInput = document.getElementById('chat-file-input');
    if (fileInput) fileInput.value = '';
    document.getElementById('chat-file-preview').style.display = 'none';
    if (typeof updateChatActionBtn === 'function') updateChatActionBtn();
}

/* ─── Send Message ─── */

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !currentChatContact) return;

    let message = input.value.trim();
    if (!message && selectedChatFiles.length === 0) return;

    if (message.length > 65536) {
        showChatAlert('Mensaje demasiado largo', 'El límite máximo por mensaje es de 65,536 caracteres. Tu mensaje tiene ' + message.length.toLocaleString() + ' caracteres.');
        return;
    }

    let replySnippet = null;
    if (_chatReplyToMsg) {
        const isQuotedMine = _chatReplyToMsg.mine ? '1' : '0';
        let snippet = _chatReplyToMsg.message || 'Archivo adjunto';
        if (_chatReplyToMsg.file_name) snippet = '📎 ' + _chatReplyToMsg.file_name;
        snippet = snippet.replace(/\||\[|\]/g, ' ').replace(/\n/g, ' ').substring(0, 80);
        replySnippet = `[REPLY|${_chatReplyToMsg.id}|${isQuotedMine}|${snippet}]\n`;
        window.cancelChatReply();
    }

    input.value = '';
    input.style.height = 'auto';
    input.focus();
    const counter = document.getElementById('chat-char-counter');
    if (counter) counter.style.display = 'none';
    if (typeof updateChatActionBtn === 'function') updateChatActionBtn();

    const filesToSend = [...selectedChatFiles];
    clearChatFile();

    try {
        if (filesToSend.length > 0) {
            for (let i = 0; i < filesToSend.length; i++) {
                const formData = new FormData();
                formData.append('receiver_id', currentChatContact.contact_id);
                // Attach the text message and reply only to the first file
                if (i === 0) {
                    formData.append('message', (replySnippet ? replySnippet : '') + message);
                } else {
                    formData.append('message', '');
                }
                formData.append('file', filesToSend[i]);

                const headers = { 'X-Token': TOKEN };
                await fetch('/api/chat/send', { method: 'POST', headers: headers, body: formData });
            }
        } else {
            const fetchOptions = {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({
                    receiver_id: currentChatContact.contact_id,
                    message: (replySnippet ? replySnippet : '') + message
                })
            };
            await fetch('/api/chat/send', fetchOptions);
        }
        const data = await res.json();
        if (data.ok && data.message) {
            if (!chatMessages.find(m => m.id == data.message.id)) {
                chatMessages.push(data.message);
                renderChatMessages();
            }
            loadChatConversations();
        }
    } catch (err) {
        console.error("Error enviando mensaje:", err);
    }
}

async function markChatAsRead(contactId) {
    try {
        await fetch('/api/chat/read', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ contact_id: contactId })
        });
        loadChatConversations();
    } catch (err) { }
}

async function updateChatBadge() {
    try {
        const res = await fetch('/api/chat/unread_count', { headers: HEADERS });
        if (res.status === 401) {
            if (typeof handleLogout === 'function') handleLogout();
            else location.href = '/';
            return;
        }
        const data = await res.json();
        const badge = document.getElementById('chat-badge');
        if (badge) {
            if (data.count > 0) {
                badge.textContent = data.count > 99 ? '99+' : data.count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (err) { }
}

/* ─── New Chat Dialog ─── */

let _newChatActiveTab = 'friends';
let _searchDebounceTimeout = null;

async function showNewChatDialog() {
    const searchInput = document.getElementById('chat-new-search');
    const dialog = document.getElementById('chat-new-dialog');

    dialog.classList.add('active');
    setNewChatTab('friends');
}

function closeNewChatDialog() {
    document.getElementById('chat-new-dialog').classList.remove('active');
}

function setNewChatTab(tab) {
    _newChatActiveTab = tab;

    const tabFriends = document.getElementById('chat-new-tab-friends');
    const tabContacts = document.getElementById('chat-new-tab-contacts');
    const searchInput = document.getElementById('chat-new-search');
    const results = document.getElementById('chat-new-results');

    if (!tabFriends || !tabContacts || !searchInput || !results) return;

    searchInput.value = '';
    results.innerHTML = '';

    if (tab === 'friends') {
        tabFriends.style.borderBottomColor = 'var(--indigo)';
        tabFriends.style.color = 'var(--text-main)';
        tabContacts.style.borderBottomColor = 'transparent';
        tabContacts.style.color = 'var(--text-muted)';
        searchInput.placeholder = 'Buscar en mis amigos...';

        renderNewChatFriends();
    } else {
        tabContacts.style.borderBottomColor = 'var(--indigo)';
        tabContacts.style.color = 'var(--text-main)';
        tabFriends.style.borderBottomColor = 'transparent';
        tabFriends.style.color = 'var(--text-muted)';
        searchInput.placeholder = 'Buscar nuevos contactos en la app...';

        results.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.4; font-size: 0.85rem;">Escribe al menos 2 caracteres para buscar</div>';
    }
    searchInput.focus();
}

function onNewChatSearchInput(query) {
    if (_newChatActiveTab === 'friends') {
        renderNewChatFriends();
    } else {
        searchChatUsers(query);
    }
}

async function searchChatUsers(query) {
    const results = document.getElementById('chat-new-results');
    if (!results) return;

    const q = query.trim();
    if (q.length < 2) {
        results.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.4; font-size: 0.85rem;">Escribe al menos 2 caracteres para buscar</div>';
        return;
    }

    results.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.6; font-size: 0.85rem;">Buscando...</div>';

    if (_searchDebounceTimeout) clearTimeout(_searchDebounceTimeout);

    _searchDebounceTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/chat/users/search?q=${encodeURIComponent(q)}`, { headers: HEADERS });
            const data = await res.json();

            if (_newChatActiveTab !== 'contacts') return; // prevent race conditions

            // Filter out users who are already friends
            const nonFriends = (data.users || []).filter(u => !_chatFriendsList.some(f => f.friend_id === u.user_id));

            if (nonFriends.length === 0) {
                results.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.4; font-size: 0.85rem;">No se encontraron nuevos usuarios</div>';
                return;
            }

            results.innerHTML = nonFriends.map(u => {
                const status = getStatusFromActivity(u.last_activity);
                return `
                <div class="chat-item" onclick="startNewChat('${u.user_id}', '${u.username.replace(/'/g, "\\'")}', '${u.last_activity || ''}')">
                    <div class="avatar" style="position:relative; width:44px; height:44px;">
                        <img src="/api/system/user/avatar/${u.username}" style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0; border-radius:50%; z-index:1;" onerror="this.style.display='none'">
                        <span style="position:relative; z-index:0;">${u.username.charAt(0).toUpperCase()}</span>
                        ${status.isOnline ? '<div class="online-dot"></div>' : ''}
                    </div>
                    <div class="chat-meta">
                        <div class="row1"><span class="name">${u.username}</span></div>
                        <div class="row2"><span class="preview" style="color: ${status.isOnline ? '#34d399' : 'var(--text-dim)'};">${status.text}</span></div>
                    </div>
                </div>
                `;
            }).join('');
        } catch (err) {
            results.innerHTML = '<div style="padding: 20px; text-align: center; color: #f87171; font-size: 0.85rem;">Error al buscar usuarios</div>';
        }
    }, 300);
}

function renderNewChatFriends() {
    const results = document.getElementById('chat-new-results');
    const query = document.getElementById('chat-new-search').value.toLowerCase().trim();

    // Filter friends by query if there is one
    const filtered = _chatFriendsList.filter(f => f.friend_name.toLowerCase().includes(query));

    if (filtered.length === 0) {
        if (!query && _chatFriendsList.length === 0) {
            results.innerHTML = `
                <div style="padding: 30px 20px; text-align: center;">
                    <p style="opacity: 0.5; font-size: 0.85rem; margin-bottom: 12px;">No tienes amigos en tu lista para chatear.</p>
                    <button onclick="showView('friends'); closeNewChatDialog();" 
                            style="background: var(--indigo); color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 0.8rem; font-weight: 600; cursor: pointer;">
                        Ir a Amigos
                    </button>
                </div>
            `;
        } else {
            results.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.4; font-size: 0.85rem;">No se encontraron amigos</div>';
        }
        return;
    }

    results.innerHTML = filtered.map(f => {
        const status = getStatusFromActivity(f.last_activity);
        return `
        <div class="chat-item" onclick="startNewChat('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}', '${f.last_activity || ''}')">
            <div class="avatar" style="position:relative; width:44px; height:44px;">
                <img src="/api/system/user/avatar/${f.friend_name}" style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0; border-radius:50%; z-index:1;" onerror="this.style.display='none'">
                <span style="position:relative; z-index:0;">${f.friend_name.charAt(0).toUpperCase()}</span>
                ${status.isOnline ? '<div class="online-dot"></div>' : ''}
            </div>
            <div class="chat-meta">
                <div class="row1"><span class="name">${f.friend_name}</span></div>
                <div class="row2"><span class="preview" style="color: ${status.isOnline ? '#34d399' : 'var(--text-dim)'};">${status.text}</span></div>
            </div>
        </div>
        `;
    }).join('');
}

async function startNewChat(userId, username, lastActivityIso) {
    try {
        await fetch('/api/chat/new', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ contact_id: userId })
        });
        closeNewChatDialog();
        await loadChatConversations();
        openChatWith(userId, username, lastActivityIso);
    } catch (err) { }
}

/* ─── Formatting ─── */

function formatChatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now - date;

    if (diff < 86400000 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } else if (diff < 172800000) {
        return 'Ayer';
    } else {
        return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    }
}

function handleChatInput(e) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';

    if (typeof updateChatActionBtn === 'function') updateChatActionBtn();

    const counter = document.getElementById('chat-char-counter');
    if (!counter) return;

    const len = el.value.length;
    const limit = 65536;
    
    if (len > 60000) {
        counter.style.display = 'block';
        const remaining = limit - len;
        counter.textContent = remaining;
        
        if (remaining < 0) {
            counter.style.color = '#f87171';
        } else {
            counter.style.color = 'var(--text-dim, #b9bbbe)';
        }
    } else {
        counter.style.display = 'none';
    }
}

function updateChatActionBtn() {
    const input = document.getElementById('chat-input');
    const voiceIcon = document.getElementById('chat-voice-icon');
    const sendIcon = document.getElementById('chat-send-icon');
    
    if (!input || !voiceIcon || !sendIcon) return;

    const hasText = input.value.trim().length > 0;
    const hasFile = selectedChatFiles.length > 0;

    if (hasText || hasFile) {
        voiceIcon.style.display = 'none';
        sendIcon.style.display = 'block';
    } else {
        voiceIcon.style.display = 'block';
        sendIcon.style.display = 'none';
    }
}

function handleChatActionBtn() {
    const voiceIcon = document.getElementById('chat-voice-icon');
    if (voiceIcon && voiceIcon.style.display !== 'none') {
        if (typeof toggleVoiceRecorder === 'function') toggleVoiceRecorder();
    } else {
        if (typeof sendChatMessage === 'function') sendChatMessage();
    }
}

function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
        return;
    }

    if (_chatTypingTimeout) clearTimeout(_chatTypingTimeout);
    handleChatTyping();
    _chatTypingTimeout = setTimeout(() => { _chatTypingTimeout = null; }, 3000);
}

function getStatusFromActivity(lastActivityIso) {
    if (!lastActivityIso) return { isOnline: false, text: 'Desconectado' };
    const date = new Date(lastActivityIso);
    const now = new Date();
    const diffSeconds = (now - date) / 1000;

    if (diffSeconds < 60) return { isOnline: true, text: 'En línea' };

    let text = 'Últ. vez ';
    if (diffSeconds < 86400 && date.getDate() === now.getDate()) {
        text += 'hoy a las ' + date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } else if (diffSeconds < 172800) {
        text += 'ayer a las ' + date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } else {
        text += 'el ' + date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }
    return { isOnline: false, text };
}

function updateActiveChatHeader() {
    if (!currentChatContact) return;

    // Find latest activity from conversations or friends list
    let latestActivity = '';
    const foundConv = _chatConversationsList.find(c => c.contact_id === currentChatContact.contact_id);
    if (foundConv) {
        latestActivity = foundConv.last_activity || '';
    } else {
        const foundFriend = _chatFriendsList.find(f => f.friend_id === currentChatContact.contact_id);
        if (foundFriend) {
            latestActivity = foundFriend.last_activity || '';
        }
    }
    if (latestActivity) {
        currentChatContact.last_activity = latestActivity;
    }

    const status = getStatusFromActivity(currentChatContact.last_activity);
    const header = document.getElementById('chat-header');
    if (header) {
        header.innerHTML = `
            <button class="mobile-back-btn" onclick="document.getElementById('view-chat').classList.remove('mobile-chat-active')" style="display: none;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            </button>
            <div style="display:flex; align-items:center; gap:12px; cursor:pointer; flex:1;" onclick="openChatInfoSidebar()">
                <div class="avatar" style="width: 40px; height: 40px; font-size: 14px;">
                    <img src="/api/system/user/avatar/${currentChatContact.contact_name}" onerror="this.outerHTML = '${currentChatContact.contact_name.charAt(0).toUpperCase()}'">
                </div>
                <div class="info">
                    <span class="name">${currentChatContact.contact_name}</span>
                    <span class="status ${status.isOnline ? 'online' : ''}">${status.text}</span>
                </div>
            </div>
            <div class="conv-actions">
                <svg onclick="alert('Llamada')" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg>
                <svg onclick="alert('Videollamada')" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                <svg onclick="alert('Opciones')" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </div>
        `;
    }
}

function filterChatConversations(query) {
    const items = document.querySelectorAll('#chat-conversations-list .chat-conv-item');
    const q = query.toLowerCase();
    items.forEach(item => {
        const name = item.querySelector('.chat-conv-name')?.textContent.toLowerCase() || '';
        item.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

window.closeMobileChat = function() {
    const viewChat = document.getElementById('view-chat');
    if (viewChat) viewChat.classList.remove('mobile-chat-active');
    
    // Deseleccionar chat actual
    currentChatContact = null;
    localStorage.removeItem('nv_chat_contact');
    stopChatPolling();
    
    document.getElementById('chat-active-area').style.display = 'none';
    document.getElementById('chat-empty-state').style.display = 'flex';
    document.querySelectorAll('.chat-conv-item').forEach(el => el.classList.remove('active'));
    
    if (window.innerWidth <= 900) {
        document.querySelector('.chat-main').style.display = 'none';
    }
};
window.openChatDrawer = function() {
    const drawer = document.getElementById('chat-drawer');
    const overlay = document.getElementById('chat-drawer-overlay');
    if (drawer) drawer.classList.add('active');
    if (overlay) overlay.classList.add('active');
};

window.closeChatDrawer = function() {
    const drawer = document.getElementById('chat-drawer');
    const overlay = document.getElementById('chat-drawer-overlay');
    if (drawer) drawer.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
};

window.toggleUserMenu = function(event) {
    const menu = document.getElementById('user-menu');
    if (menu) menu.classList.toggle('active');
    if (event) event.stopPropagation();
};

document.addEventListener('click', function(e) {
    const userMenu = document.getElementById('user-menu');
    if (userMenu && userMenu.classList.contains('active') && !e.target.closest('.rail-avatar')) {
        userMenu.classList.remove('active');
    }
});

initSocketConnection();
setTimeout(() => updateChatBadge(), 2000);
setInterval(() => updateChatBadge(), 15000);

/* ─── Smart Chat (floating widget) ─── */

let _currentChatMode = 'ai';

function setSmartChat(mode) {
    _currentChatMode = mode;
    const btnAi = document.getElementById('tab-btn-ai');
    const btnGlobal = document.getElementById('tab-btn-global');
    if (btnAi) btnAi.classList.toggle('active', mode === 'ai');
    if (btnGlobal) btnGlobal.classList.toggle('active', mode === 'global');
    const welcome = document.getElementById('chat-welcome-msg');
    if (welcome) {
        welcome.textContent = mode === 'ai'
            ? "IA Null-Void activa. ¿En qué puedo ayudarte?"
            : "Conectado al canal global.";
    }
}

function sendSmartMessage() {
    const input = document.getElementById('smart-chat-input');
    const container = document.getElementById('smart-chat-log');
    if (!input || !input.value.trim()) return;
    const msg = input.value; input.value = '';
    const d = document.createElement('div'); d.className = 'chat-msg user';
    if (_currentChatMode === 'ai') {
        d.textContent = msg;
        container.appendChild(d);
        setTimeout(() => {
            const b = document.createElement('div'); b.className = 'chat-msg system';
            b.textContent = "IA: Procesando... Actualmente en mantenimiento.";
            container.appendChild(b); container.scrollTop = container.scrollHeight;
        }, 800);
    } else {
        d.innerHTML = `<strong>${CURRENT_USER.split(' ')[0]}:</strong> ${msg}`;
        container.appendChild(d);
    }
    container.scrollTop = container.scrollHeight;
}

function toggleChatWindow() {
    const win = document.getElementById('chat-window');
    if (win) win.classList.toggle('active');
}

function resetChat() {
    const container = document.getElementById('cw-messages');
    if (!container) return;
    container.innerHTML = `
        <div class="cw-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4"></path>
                <path d="M12 8h.01"></path>
            </svg>
            <h3 style="color: var(--text-main); margin: 0;">Null-Void AI</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 5px;">¿En qué puedo ayudarte hoy?</p>
        </div>
    `;
}

function sendBotMessage(input) {
    const msg = input.value.trim();
    if (!msg) return;
    const container = document.getElementById('cw-messages');
    if (!container) return;
    const empty = container.querySelector('.cw-empty');
    if (empty) empty.remove();
    const userDiv = document.createElement('div');
    userDiv.className = 'chat-msg user';
    userDiv.textContent = msg;
    container.appendChild(userDiv);
    input.value = '';
    container.scrollTop = container.scrollHeight;
    setTimeout(() => {
        const aiDiv = document.createElement('div');
        aiDiv.className = 'chat-msg system';
        aiDiv.textContent = "Soy el asistente de Null-Void. Actualmente estoy en modo de prueba.";
        container.appendChild(aiDiv);
        container.scrollTop = container.scrollHeight;
    }, 800);
}

function initSmartChat() {
    window.setSmartChat = setSmartChat;
    window.sendSmartMessage = sendSmartMessage;
    window.toggleChatWindow = toggleChatWindow;
    window.resetChat = resetChat;
    window.sendBotMessage = sendBotMessage;
}

function showChatConfirm(title, message) {
    return new Promise((resolve) => {
        if (document.getElementById('chat-custom-alert-overlay')) return resolve(false);

        const overlay = document.createElement('div');
        overlay.id = 'chat-custom-confirm-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: var(--surface-2, rgba(20, 20, 28, 0.85));
            border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-radius: 16px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            overflow: hidden;
            transform: scale(0.9);
            transition: transform 0.2s ease;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        const header = document.createElement('h3');
        header.style.cssText = `
            margin: 0;
            font-size: 1.15rem;
            color: var(--text-main, #e8eaed);
            font-weight: 600;
        `;
        header.textContent = title;

        const msgText = document.createElement('p');
        msgText.style.cssText = `
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-dim, #b9bbbe);
            line-height: 1.5;
        `;
        msgText.textContent = message;

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 8px;
        `;

        const btnCancel = document.createElement('button');
        btnCancel.style.cssText = `
            background: transparent;
            border: 1px solid var(--border, #3c4043);
            color: var(--text-main, #e8eaed);
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s;
        `;
        btnCancel.textContent = 'Cancelar';
        btnCancel.onmouseenter = () => btnCancel.style.background = 'rgba(255, 255, 255, 0.05)';
        btnCancel.onmouseleave = () => btnCancel.style.background = 'transparent';

        const btnConfirm = document.createElement('button');
        btnConfirm.style.cssText = `
            background: #ef4444;
            border: none;
            color: #fff;
            padding: 10px 18px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s;
        `;
        btnConfirm.textContent = 'Aceptar';
        btnConfirm.onmouseenter = () => btnConfirm.style.opacity = '0.9';
        btnConfirm.onmouseleave = () => btnConfirm.style.opacity = '1';

        btnContainer.appendChild(btnCancel);
        btnContainer.appendChild(btnConfirm);
        box.appendChild(header);
        box.appendChild(msgText);
        box.appendChild(btnContainer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.opacity = '1';
            box.style.transform = 'scale(1)';
        }, 10);

        const close = (result) => {
            overlay.style.opacity = '0';
            box.style.transform = 'scale(0.9)';
            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 200);
        };

        btnCancel.onclick = () => close(false);
        btnConfirm.onclick = () => close(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) close(false);
        };
    });
}

function showChatAlert(title, message) {
    return new Promise((resolve) => {
        if (document.getElementById('chat-custom-alert-overlay')) return resolve(false);

        const overlay = document.createElement('div');
        overlay.id = 'chat-custom-alert-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: var(--surface-2, rgba(20, 20, 28, 0.85));
            border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-radius: 16px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            overflow: hidden;
            transform: scale(0.9);
            transition: transform 0.2s ease;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        const header = document.createElement('h3');
        header.style.cssText = `
            margin: 0;
            font-size: 1.15rem;
            color: var(--text-main, #e8eaed);
            font-weight: 600;
        `;
        header.textContent = title;

        const msgText = document.createElement('p');
        msgText.style.cssText = `
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-dim, #b9bbbe);
            line-height: 1.5;
        `;
        msgText.textContent = message;

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            margin-top: 8px;
        `;

        const btnOk = document.createElement('button');
        btnOk.style.cssText = `
            background: var(--indigo, #6366f1);
            border: none;
            color: #fff;
            padding: 10px 22px;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s;
        `;
        btnOk.textContent = 'Aceptar';
        btnOk.onmouseenter = () => btnOk.style.opacity = '0.9';
        btnOk.onmouseleave = () => btnOk.style.opacity = '1';

        btnContainer.appendChild(btnOk);
        box.appendChild(header);
        box.appendChild(msgText);
        box.appendChild(btnContainer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.opacity = '1';
            box.style.transform = 'scale(1)';
        }, 10);

        const close = () => {
            overlay.style.opacity = '0';
            box.style.transform = 'scale(0.9)';
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 200);
        };

        btnOk.onclick = close;
        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };
    });
}

function showChatDeleteConfirm(count, allMine, hasFiles) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:var(--surface-1);padding:24px;border-radius:12px;width:90%;max-width:350px;border:1px solid var(--border);text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);';
        
        let html = `<h3 style="margin:0 0 10px;font-size:1.1rem;color:var(--text-main);">Eliminar ${count} mensaje${count>1?'s':''}</h3>`;
        
        if (hasFiles) {
            html += `
                <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;text-align:left;font-size:0.85rem;color:var(--text-dim);cursor:pointer;background:var(--surface-2);padding:10px;border-radius:8px;">
                    <input type="checkbox" id="chat-delete-files-chk" checked style="accent-color:var(--indigo);">
                    Eliminar también los archivos adjuntos del servidor
                </label>
            `;
        } else {
            html += `<p style="margin:0 0 20px;font-size:0.9rem;color:var(--text-dim);">¿Estás seguro de que deseas eliminar la selección?</p>`;
        }

        html += `<div style="display:flex;flex-direction:column;gap:8px;">`;

        if (allMine) {
            html += `<button id="chat-del-everyone" style="padding:10px;background:var(--indigo);color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">Borrar para todos</button>`;
        }
        html += `<button id="chat-del-me" style="padding:10px;background:#ef4444;color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">Eliminar para mí</button>`;
        html += `<button id="chat-del-cancel" style="padding:10px;background:transparent;color:var(--text-dim);border:1px solid var(--border);border-radius:8px;font-weight:bold;cursor:pointer;">Cancelar</button>`;
        
        html += `</div>`;
        modal.innerHTML = html;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const clean = () => document.body.removeChild(overlay);

        if (allMine) {
            modal.querySelector('#chat-del-everyone').onclick = () => {
                const df = hasFiles ? modal.querySelector('#chat-delete-files-chk').checked : false;
                clean(); resolve({ action: 'for_everyone', deleteFiles: df });
            };
        }
        modal.querySelector('#chat-del-me').onclick = () => {
            const df = hasFiles ? modal.querySelector('#chat-delete-files-chk').checked : false;
            clean(); resolve({ action: 'for_me', deleteFiles: df });
        };
        modal.querySelector('#chat-del-cancel').onclick = () => {
            clean(); resolve({ action: 'cancel', deleteFiles: false });
        };
    });
}

function openChatInfoSidebar() {
    if (!currentChatContact) return;
    
    const nameEl = document.getElementById('chat-info-name');
    const avatarEl = document.getElementById('chat-info-avatar');
    const statusEl = document.getElementById('chat-info-status');
    
    if (nameEl) nameEl.textContent = currentChatContact.contact_name;
    if (avatarEl) avatarEl.innerHTML = `<img src="/api/system/user/avatar/${currentChatContact.contact_name}" onerror="this.outerHTML = '${currentChatContact.contact_name.charAt(0).toUpperCase()}'">`;
    if (statusEl) {
        const status = getStatusFromActivity(currentChatContact.last_activity);
        statusEl.textContent = status.text;
    }
    
    updateChatInfoSidebarMedia();
    
    document.getElementById('chat-info-sidebar').classList.add('active');
}

function updateChatInfoSidebarMedia() {
    const mediaMsgs = chatMessages.filter(m => {
        if (!m.file_path || !m.file_name) return false;
        return isImageFile(m.file_name) || isVideoFile(m.file_name);
    });
    
    const countEl = document.getElementById('chat-info-media-count');
    if (countEl) countEl.textContent = mediaMsgs.length;
    
    const gridEl = document.getElementById('chat-info-media-grid');
    if (gridEl) {
        let gridHtml = '';
        const recent = mediaMsgs.slice(-8).reverse();
        recent.forEach(m => {
            if (isImageFile(m.file_name)) {
                gridHtml += `<img src="/api/chat/download/${m.id}" onclick="openChatLightbox('/api/chat/download/${m.id}')" loading="lazy">`;
            } else if (isVideoFile(m.file_name)) {
                gridHtml += `<video src="/api/chat/download/${m.id}#t=0.1" onclick="openChatVideo('/api/chat/download/${m.id}')" preload="metadata"></video>`;
            }
        });
        gridEl.innerHTML = gridHtml;
    }
}

function closeChatInfoSidebar() {
    document.getElementById('chat-info-sidebar').classList.remove('active');
}

function _exposeChatGlobals() {
    Object.assign(window, {
        initChat, stopChat, openChatWith, initSocketConnection,
        initSmartChat, sendSmartMessage, sendChatMessage, sendBotMessage,
        openChatContextMenu, closeChatContextMenu, handleMsgAction,
        editMessageInline, showForwardDialog, loadForwardContacts,
        filterForwardContacts, doForward, deleteChatConversation,
        openChatLightbox, closeChatLightbox, navigateLightbox, openChatVideo, playAudio,
        downloadFile, handleChatFileSelect, handleChatKeydown, handleChatInput,
        handleChatTyping, showChatTyping, hideChatTyping, markChatAsRead,
        updateChatActionBtn, handleChatActionBtn, togglePauseVoiceRecording, restartVoiceRecording,
        updateActiveChatHeader, updateChatBadge, renderChatConversations,
        renderChatMessages, renderForwardContacts, renderNewChatFriends,
        loadChatMessages, searchChatUsers, clearChatFile,
        sendVoiceRecording, toggleVoiceRecorder, cancelVoiceRecording,
        cleanupVoiceRecording, toggleChatWindow, setSmartChat,
        showNewChatDialog, closeNewChatDialog, startNewChat, setNewChatTab,
        onNewChatSearchInput, filterChatConversations,
        startMessageSelection, cancelMessageSelection, toggleMessageSelection,
        selectRangeMessages, deleteSelectedMessages, copySelectedMessages,
        forwardSelectedMessages, updateSelectionBar, showChatAlert,
        showChatConfirm, getChatFileIcon, isImageFile, isAudioFile,
        isVideoFile, formatDuration, formatFileSize, formatChatTime,
        getStatusFromActivity, openChatConvMenu, toggleChatMute,
        openChatInfoSidebar, closeChatInfoSidebar, handleChatScroll, chatScrollToBottom
    });
}
_exposeChatGlobals();

export { initChat, stopChat, openChatWith, initSocketConnection, initSmartChat, sendSmartMessage, loadChatConversations, startChatPolling, stopChatPolling };
