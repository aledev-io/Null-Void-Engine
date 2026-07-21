import { NV_Alert, NV_Confirm } from '../dashboard/ui.js';

let currentChatContact = null;
let chatMessages = [];
let chatSocket = null;
let selectedChatFile = null;
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

    const saved = localStorage.getItem('nv_chat_contact');
    if (saved && !currentChatContact) {
        try {
            currentChatContact = JSON.parse(saved);
        } catch (e) { }
    }

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
                    attachChatFile(file);
                    e.preventDefault();
                    break;
                }
            }
        }
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
            attachChatFile(e.dataTransfer.files[0]);
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

    document.addEventListener('click', (e) => {
        const isShift = e.shiftKey;
        if (_chatSelectionMode || isShift) {
            const bubble = e.target.closest('.chat-bubble');
            if (bubble) {
                e.preventDefault();
                e.stopPropagation();

                const clickedId = bubble.dataset.msgId;

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
}

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
                <span style="font-size: 2.5rem;">💬</span>
                <p style="margin-top: 12px; font-size: 0.85rem;">No hay conversaciones aún</p>
                <p style="font-size: 0.75rem;">Usa el botón + para iniciar una</p>
            </div>
        `;
        return;
    }

    const html = conversations.map(c => {
        const time = c.last_time ? formatChatTime(c.last_time) : '';
        let preview = c.last_message;
        if (c.last_file_name) {
            if (isAudioFile(c.last_file_name)) {
                const dur = c.last_file_name.match(/_(\d+)s\./);
                preview = '🎤 Audio' + (dur ? ' · ' + formatDuration(parseInt(dur[1])) : '');
            } else if (isVideoFile(c.last_file_name)) {
                preview = '🎬 Video';
            } else if (isImageFile(c.last_file_name)) {
                preview = '📷 Foto';
            } else {
                preview = '📎 ' + c.last_file_name;
            }
        }
        if (preview) {
            preview = preview.replace(/^\[REPLY\|.*?\|.*?\|.*?\]\s*/, '');
        }
        if (preview && preview.length > 35) preview = preview.substring(0, 35) + '...';
        const isActive = currentChatContact && currentChatContact.contact_id === c.contact_id;
        const unreadBadge = c.unread > 0 ? `<span class="chat-unread-badge">${c.unread}</span>` : '';

        const status = getStatusFromActivity(c.last_activity);
        const onlineDot = status.isOnline ? '<span class="chat-online-dot"></span>' : '';

        return `
            <div class="chat-conv-item ${isActive ? 'active' : ''}" onclick="openChatWith('${c.contact_id}', '${c.contact_name}', '${c.last_activity || ''}')" oncontextmenu="event.preventDefault();event.stopPropagation();openChatConvMenu(event,'${c.contact_id}','${c.contact_name.replace(/'/g, "\\'")}')">
                <div class="chat-conv-avatar">
                    <img src="/api/system/user/avatar/${c.contact_name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 1;" onerror="this.outerHTML = '${c.contact_name.charAt(0).toUpperCase()}'">
                    ${onlineDot}
                </div>
                <div class="chat-conv-info">
                    <div class="chat-conv-name">${c.contact_name}</div>
                    <div class="chat-conv-preview">${c.last_sender === currentChatContact?.contact_id ? '' : (c.last_message ? 'Tú: ' : '')}${preview || 'Sin mensajes'}</div>
                </div>
                <div class="chat-conv-meta">
                    <div class="chat-conv-time">${time}</div>
                    ${unreadBadge}
                </div>
            </div>
        `;
    }).join('');
    list.innerHTML = html;
}

/* ─── Open / Load Messages ─── */


async function openChatWith(contactId, contactName, lastActivityIso = '') {
    currentChatContact = { contact_id: contactId, contact_name: contactName, last_activity: lastActivityIso };
    localStorage.setItem('nv_chat_contact', JSON.stringify(currentChatContact));
    chatMessages = [];
    hideChatTyping();
    cancelMessageSelection();

    updateActiveChatHeader();

    document.getElementById('chat-empty-state').style.display = 'none';
    document.getElementById('chat-active-area').style.display = 'flex';

    await loadChatMessages(contactId);
    startChatPolling();

    markChatAsRead(contactId);
    document.querySelectorAll('.chat-conv-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.chat-conv-item[onclick*="${contactId}"]`);
    if (activeEl) activeEl.classList.add('active');

    const input = document.getElementById('chat-input');
    if (input) input.focus();
}

async function loadChatMessages(contactId) {
    try {
        const res = await fetch('/api/chat/messages', {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ contact_id: contactId, limit: 50 })
        });
        const data = await res.json();
        chatMessages = data.messages || [];
        renderChatMessages();
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
                <span style="font-size: 3rem;">🔒</span>
                <p style="margin-top: 12px;">Los mensajes están cifrados de extremo a extremo.</p>
                <p style="font-size: 0.8rem;">Envía un mensaje para empezar.</p>
            </div>
        `;
        return;
    }

    let lastDate = '';
    let html = '';

    chatMessages.forEach(msg => {
        const date = new Date(msg.time * 1000);
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

        if (dateStr !== lastDate) {
            html += `<div class="chat-date-separator"><span>${dateStr}</span></div>`;
            lastDate = dateStr;
        }

        const msgText = msg.message || '';
        let safeMsg = msgText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

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
                    <div style="font-weight: bold; color: var(--indigo, #6366f1); margin-bottom: 2px;">${replyName}</div>
                    <div style="color: inherit; opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${replyMatch[3]}</div>
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
                    <div class="chat-bubble-img" onclick="openChatLightbox('/api/chat/download/${msg.id}')">
                        <img src="/api/chat/download/${msg.id}" alt="" loading="lazy">
                    </div>
                `;
            } else if (isVideoFile(name)) {
                videoHtml = `
                    <div class="chat-bubble-img" onclick="openChatVideo('/api/chat/download/${msg.id}')">
                        <video src="/api/chat/download/${msg.id}" preload="metadata" style="width:100%;max-height:280px;object-fit:cover;display:block;background:#000;" onloadedmetadata="this.poster=''" ${''}>
                        </video>
                        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:50px;height:50px;border-radius:50%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;pointer-events:none;">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                        </div>
                    </div>
                `;
            } else if (isAudioFile(name)) {
                const durMatch = name.match(/_(\d+)s\./);
                const durText = durMatch ? formatDuration(parseInt(durMatch[1])) : '0:00';
                audioHtml = `
                    <div class="chat-audio-player ${msg.mine ? 'mine' : 'theirs'}" onclick="playAudio(this, '/api/chat/download/${msg.id}')">
                        <button class="chat-audio-play-btn ${msg.mine ? 'mine' : 'theirs'}" onclick="event.stopPropagation();playAudio(this.parentElement,'/api/chat/download/${msg.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                        <div class="chat-audio-wave">
                            <span></span><span></span><span></span><span></span><span></span>
                            <span></span><span></span><span></span>
                        </div>
                        <span class="chat-audio-duration" data-duration="${durText}">${durText}</span>
                    </div>
                `;
            } else {
                const fi = getChatFileIcon(name);
                fileHtml = `
                    <div class="chat-bubble-file" onclick="downloadFile('/api/chat/download/${msg.id}','${name.replace(/'/g, "\\'")}')">
                        <div class="chat-file-icon" style="background:${fi.bg}">${fi.icon}</div>
                        <div class="chat-file-info">
                            <span class="chat-file-name">${name}</span>
                            <span class="chat-file-size">${formatFileSize(msg.file_size)}</span>
                        </div>
                    </div>
                `;
            }
        }

        const isSelected = _selectedMessages.has(msg.id);
        const selModeClass = _chatSelectionMode ? 'selection-mode' : '';
        const selClass = isSelected ? 'selected' : '';

        html += `
            <div class="chat-bubble ${msg.mine ? 'mine' : 'theirs'} ${selModeClass} ${selClass}" data-msg-id="${msg.id}" oncontextmenu="openChatContextMenu(event,'${msg.id}','${(msg.message || '').replace(/'/g, "\\'")}',${msg.mine})" style="transition: background 0.3s ease;">
                <div class="chat-bubble-checkbox"></div>
                ${replyHtml}
                ${imgHtml}
                ${videoHtml}
                ${audioHtml}
                ${safeMsg ? `<div class="chat-bubble-text">${safeMsg}</div>` : ''}
                ${fileHtml}
                <div class="chat-bubble-meta">
                    <span>${timeStr}</span>
                    ${msg.edited_at ? '<span style="font-size:0.6rem;opacity:0.5;">editado</span>' : ''}
                    ${msg.mine ? `<span class="chat-check ${msg.read ? 'read' : ''}">${msg.read ? '✓✓' : '✓'}</span>` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

/* ─── Message Actions (Context Menu) ─── */

function closeChatContextMenu() {
    const el = document.getElementById('chat-msg-menu');
    if (el) el.remove();
    _contextMsgId = null;
}

function openChatContextMenu(e, msgId, msgText, isMine) {
    e.preventDefault();
    e.stopPropagation();
    closeChatContextMenu();
    _contextMsgId = msgId;

    const menu = document.createElement('div');
    menu.id = 'chat-msg-menu';
    menu.style.cssText = 'position:fixed;z-index:99999;background:var(--bg-card);color:var(--text-main);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.5);padding:6px;min-width:180px;animation:chatBubbleIn 0.12s ease-out;';

    const items = [];
    items.push({ label: '↩ Responder', action: 'replyMsg' });
    items.push({ label: '📋 Copiar texto', action: 'copyText', show: !!msgText });

    const msgObj = chatMessages.find(m => m.id === msgId);
    if (msgObj && msgObj.file_path) {
        items.push({ label: '☁ Guardar en Cloud', action: 'saveToCloud' });
    }

    items.push({ label: '↗ Reenviar', action: 'forwardMsg' });
    items.push({ label: '☑ Seleccionar', action: 'selectMsg' });
    if (isMine) {
        items.push({ label: '✏ Editar', action: 'editMsg', show: !!msgText });
        items.push({ label: '🗑 Eliminar', action: 'deleteMsg' });
    }

    items.filter(i => i.show !== false).forEach((item, idx) => {
        const div = document.createElement('div');
        div.textContent = item.label;
        div.style.cssText = 'padding:10px 14px;border-radius:8px;cursor:pointer;font-size:0.85rem;transition:background 0.1s;';
        div.onmouseenter = () => div.style.background = 'rgba(99,102,241,0.08)';
        div.onmouseleave = () => div.style.background = '';
        div.onclick = (ev) => { ev.stopPropagation(); closeChatContextMenu(); handleMsgAction(item.action, msgId, msgText); };
        menu.appendChild(div);
    });

    document.body.appendChild(menu);

    let x = e.clientX || 0;
    let y = e.clientY || 0;
    const mw = 200, mh = items.length * 44;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 10;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 10;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    setTimeout(() => document.addEventListener('click', closeChatContextMenu, { once: true }), 0);
}

async function handleMsgAction(action, msgId, msgText) {
    const msg = chatMessages.find(m => m.id === msgId);
    if (!msg) return;

    switch (action) {
        case 'replyMsg':
            _chatReplyToMsg = msg;
            document.getElementById('chat-reply-name').textContent = msg.mine ? 'Tú' : (currentChatContact ? currentChatContact.contact_name : 'Contacto');
            let snippet = msg.message || 'Archivo adjunto';
            if (msg.file_name) snippet = '📎 ' + msg.file_name;
            // clean up snippet if it already contains a reply block
            snippet = snippet.replace(/^\[REPLY\|.*?\|.*?\|.*?\]\s*/, '');
            document.getElementById('chat-reply-text').textContent = snippet;
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
                const res = await fetch('/api/chat/save_to_cloud', {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ msg_id: msgId })
                });
                const data = await res.json();
                if (data.ok) {
                    await showChatAlert('Archivo guardado', `El archivo se ha guardado correctamente en tu Cloud como: "${data.name}"`);
                } else {
                    await showChatAlert('Error al guardar', `No se pudo guardar el archivo: ${data.error}`);
                }
            } catch (err) {
                await showChatAlert('Error', `Ocurrió un error: ${err.message}`);
            }
            break;

        case 'forwardMsg':
            showForwardDialog(msgId);
            break;

        case 'selectMsg':
            startMessageSelection(msgId);
            break;

        case 'editMsg':
            editMessageInline(msgId);
            break;

        case 'deleteMsg':
            (async () => {
                const confirmed = await showChatConfirm('Eliminar mensaje', '¿Estás seguro de que quieres eliminar este mensaje?');
                if (confirmed) {
                    await fetch('/api/chat/delete_message', {
                        method: 'POST', headers: HEADERS,
                        body: JSON.stringify({ msg_id: msgId })
                    });
                    const idx = chatMessages.findIndex(m => m.id === msgId);
                    if (idx !== -1) { chatMessages.splice(idx, 1); renderChatMessages(); }
                }
            })();
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

function openChatConvMenu(e, contactId, contactName) {
    e.preventDefault();
    e.stopPropagation();
    const existing = document.getElementById('chat-conv-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'chat-conv-menu';
    menu.style.cssText = 'position:fixed;z-index:99999;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.5);padding:6px;min-width:190px;';
    menu.innerHTML = '<div style="padding:10px 14px;border-radius:8px;cursor:pointer;font-size:0.85rem;color:#f87171;" onmouseenter="this.style.background=\'rgba(248,113,113,0.08)\'" onmouseleave="this.style.background=\'\'" onclick="this.closest(\'#chat-conv-menu\').remove();deleteChatConversation(\'' + contactId + "','" + contactName.replace(/'/g, "\\'") + '\')">🗑 Eliminar conversación</div>';
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

/* ─── Message Selection ─── */

function startMessageSelection(msgId) {
    _chatSelectionMode = true;
    _selectedMessages.clear();
    _selectedMessages.add(msgId);
    _lastSelectedMsgId = msgId;

    const bubbles = document.querySelectorAll('.chat-bubble');
    bubbles.forEach(b => {
        b.classList.add('selection-mode');
        b.classList.toggle('selected', b.dataset.msgId === msgId);
    });

    updateSelectionBar();
}

function toggleMessageSelection(msgId) {
    if (_selectedMessages.has(msgId)) {
        _selectedMessages.delete(msgId);
    } else {
        _selectedMessages.add(msgId);
    }

    const bubble = document.querySelector(`.chat-bubble[data-msg-id="${msgId}"]`);
    if (bubble) {
        bubble.classList.toggle('selected', _selectedMessages.has(msgId));
    }

    updateSelectionBar();
}

function selectRangeMessages(id1, id2) {
    const idx1 = chatMessages.findIndex(m => m.id === id1);
    const idx2 = chatMessages.findIndex(m => m.id === id2);
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

    const bubbles = document.querySelectorAll('.chat-bubble');
    bubbles.forEach(b => {
        b.classList.remove('selection-mode', 'selected');
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
    const confirmed = await showChatConfirm('Eliminar mensajes', `¿Eliminar los ${_selectedMessages.size} mensajes seleccionados?`);
    if (!confirmed) return;

    try {
        const ids = Array.from(_selectedMessages);
        for (const msgId of ids) {
            await fetch('/api/chat/delete_message', {
                method: 'POST', headers: HEADERS,
                body: JSON.stringify({ msg_id: msgId })
            });
            const idx = chatMessages.findIndex(m => m.id === msgId);
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
    _chatAudio = new Audio(url);

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
    };
    _chatAudio.onerror = () => {
        el.classList.remove('playing', 'paused');
        restoreDuration(el);
        _chatAudio = null;
        _chatAudioEl = null;
    };
    _chatAudio.play().catch(() => {
        el.classList.remove('playing', 'paused');
        restoreDuration(el);
        _chatAudio = null;
        _chatAudioEl = null;
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

function openChatLightbox(src) {
    const lb = document.getElementById('chat-lightbox');
    const img = document.getElementById('chat-lightbox-img');
    const video = lb.querySelector('video');
    if (video) { video.style.display = 'none'; video.pause(); }
    if (lb && img) {
        img.style.display = '';
        img.src = src;
        lb.classList.add('active');
    }
}

function closeChatLightbox() {
    const lb = document.getElementById('chat-lightbox');
    if (!lb) return;
    lb.classList.remove('active');
    const video = lb.querySelector('video');
    if (video) { video.pause(); video.style.display = 'none'; }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChatLightbox();
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#chat-msg-menu')) closeChatContextMenu();
});

// Long-press for touch devices
let _longPressTimer = null;
document.addEventListener('touchstart', (e) => {
    const bubble = e.target.closest('.chat-bubble');
    if (!bubble || bubble.closest('#chat-msg-menu')) return;
    _longPressTimer = setTimeout(() => {
        const msgId = bubble.dataset.msgId;
        const msg = chatMessages.find(m => m.id === msgId);
        if (msg) {
            const touch = e.touches[0];
            openChatContextMenu({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => { }, stopPropagation: () => { } }, msgId, msg.message || '', msg.mine);
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

async function toggleVoiceRecorder() {
    const recorder = document.getElementById('chat-voice-recorder');
    const micBtn = document.getElementById('chat-mic-btn');
    const input = document.getElementById('chat-input');

    if (recorder && recorder.classList.contains('active')) {
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

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';
        _mediaRecorder = new MediaRecorder(stream, { mimeType });

        _mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) _audioChunks.push(e.data);
        };

        _mediaRecorder.start(250);

        recorder.classList.add('active');
        micBtn.classList.add('recording');
        input.disabled = true;
        input.style.opacity = '0.3';

        document.getElementById('chat-voice-timer').textContent = '0:00';
        _recordingTimer = setInterval(() => {
            _recordingSeconds++;
            document.getElementById('chat-voice-timer').textContent = formatDuration(_recordingSeconds);
        }, 1000);

    } catch (err) {
        console.warn("Micrófono no disponible:", err.message);
    }
}

function cancelVoiceRecording() {
    _audioChunks = [];
    cleanupVoiceRecording();
    const recorder = document.getElementById('chat-voice-recorder');
    const micBtn = document.getElementById('chat-mic-btn');
    const input = document.getElementById('chat-input');
    if (recorder) recorder.classList.remove('active');
    if (micBtn) micBtn.classList.remove('recording');
    if (input) { input.disabled = false; input.style.opacity = ''; input.focus(); }
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
        const micBtn = document.getElementById('chat-mic-btn');
        const input = document.getElementById('chat-input');
        if (recorder) recorder.classList.remove('active');
        if (micBtn) micBtn.classList.remove('recording');
        if (input) { input.disabled = false; input.style.opacity = ''; }

        if (_audioChunks.length === 0) {
            alert("No se capturó audio (chunks vacío). Revisa los permisos o tu micrófono.");
            _recordingSeconds = 0;
            return;
        }

        const blob = new Blob(_audioChunks, { type: 'audio/webm' });
        const fileName = 'audio_' + Date.now() + '_' + duration + 's.webm';
        _audioChunks = [];
        _recordingSeconds = 0;

        selectedChatFile = new File([blob], fileName, { type: 'audio/webm' });

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

function attachChatFile(file) {
    if (!file) return;

    selectedChatFile = file;
    document.getElementById('chat-file-name').textContent = file.name || 'Archivo adjunto';
    document.getElementById('chat-file-size').textContent = formatFileSize(file.size);
    document.getElementById('chat-file-preview').style.display = 'flex';

    const thumb = document.getElementById('chat-file-thumb');
    if (isImageFile(file.name || (file.type && file.type.split('/')[1]))) {
        const reader = new FileReader();
        reader.onload = (e) => { thumb.src = e.target.result; thumb.style.display = 'block'; };
        reader.readAsDataURL(file);
    } else {
        thumb.style.display = 'none';
    }
}

function handleChatFileSelect(event) {
    const file = event.target.files[0];
    attachChatFile(file);
}

function clearChatFile() {
    selectedChatFile = null;
    const fileInput = document.getElementById('chat-file-input');
    if (fileInput) fileInput.value = '';
    document.getElementById('chat-file-preview').style.display = 'none';
}

/* ─── Send Message ─── */

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !currentChatContact) return;

    let message = input.value.trim();
    if (!message && !selectedChatFile) return;

    if (_chatReplyToMsg) {
        const isQuotedMine = _chatReplyToMsg.mine ? '1' : '0';
        let snippet = _chatReplyToMsg.message || 'Archivo adjunto';
        if (_chatReplyToMsg.file_name) snippet = '📎 ' + _chatReplyToMsg.file_name;
        // escape pipes and brackets
        snippet = snippet.replace(/\||\[|\]/g, ' ').replace(/\n/g, ' ').substring(0, 80);
        message = `[REPLY|${_chatReplyToMsg.id}|${isQuotedMine}|${snippet}]\n` + message;
        window.cancelChatReply();
    }

    input.value = '';
    input.style.height = 'auto';
    input.focus();

    const fileToSend = selectedChatFile;
    clearChatFile();

    try {
        let fetchOptions = {};
        if (fileToSend) {
            const formData = new FormData();
            formData.append('receiver_id', currentChatContact.contact_id);
            formData.append('message', message);
            formData.append('file', fileToSend);

            const headers = { 'X-Token': TOKEN };
            fetchOptions = { method: 'POST', headers: headers, body: formData };
        } else {
            fetchOptions = {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({
                    receiver_id: currentChatContact.contact_id,
                    message: message
                })
            };
        }

        const res = await fetch('/api/chat/send', fetchOptions);
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

    dialog.style.display = 'flex';
    setNewChatTab('friends');
}

function closeNewChatDialog() {
    document.getElementById('chat-new-dialog').style.display = 'none';
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
                <div class="chat-conv-item" onclick="startNewChat('${u.user_id}', '${u.username.replace(/'/g, "\\'")}', '${u.last_activity || ''}')" style="cursor: pointer;">
                    <div class="chat-conv-avatar" style="width: 36px; height: 36px; font-size: 0.85rem;">
                        <img src="/api/system/user/avatar/${u.username}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 1;" onerror="this.outerHTML = '${u.username.charAt(0).toUpperCase()}'">
                        ${status.isOnline ? '<span class="chat-online-dot"></span>' : ''}
                    </div>
                    <div class="chat-conv-info">
                        <div class="chat-conv-name">${u.username}</div>
                        <div class="chat-conv-preview" style="color: ${status.isOnline ? '#34d399' : 'var(--text-muted)'};">${status.text}</div>
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
        <div class="chat-conv-item" onclick="startNewChat('${f.friend_id}', '${f.friend_name.replace(/'/g, "\\'")}', '${f.last_activity || ''}')" style="cursor: pointer;">
            <div class="chat-conv-avatar" style="width: 36px; height: 36px; font-size: 0.85rem;">
                <img src="/api/system/user/avatar/${f.friend_name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 1;" onerror="this.outerHTML = '${f.friend_name.charAt(0).toUpperCase()}'">
                ${status.isOnline ? '<span class="chat-online-dot"></span>' : ''}
            </div>
            <div class="chat-conv-info">
                <div class="chat-conv-name">${f.friend_name}</div>
                <div class="chat-conv-preview" style="color: ${status.isOnline ? '#34d399' : 'var(--text-muted)'};">${status.text}</div>
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

function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
        return;
    }

    if (_chatTypingTimeout) clearTimeout(_chatTypingTimeout);
    handleChatTyping();
    _chatTypingTimeout = setTimeout(() => { _chatTypingTimeout = null; }, 3000);

    setTimeout(() => {
        const el = document.getElementById('chat-input');
        if (el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }
    }, 0);
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
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="chat-conv-avatar" style="width: 36px; height: 36px; font-size: 0.9rem;">
                    <img src="/api/system/user/avatar/${currentChatContact.contact_name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 1;" onerror="this.outerHTML = '${currentChatContact.contact_name.charAt(0).toUpperCase()}'">
                    ${status.isOnline ? '<span class="chat-online-dot"></span>' : ''}
                </div>
                <div>
                    <div style="font-weight: 600; font-size: 0.95rem;">${currentChatContact.contact_name}</div>
                    <div style="font-size: 0.72rem; color: ${status.isOnline ? '#34d399' : 'var(--text-muted)'};">${status.text}</div>
                </div>
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
            background: var(--bg-card, #202124);
            border: 1px solid var(--border, #3c4043);
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
            color: var(--text-muted, #9aa0a6);
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
            background: var(--bg-card, #202124);
            border: 1px solid var(--border, #3c4043);
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
            color: var(--text-muted, #9aa0a6);
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

function _exposeChatGlobals() {
    Object.assign(window, {
        initChat, stopChat, openChatWith, initSocketConnection,
        initSmartChat, sendSmartMessage, sendChatMessage, sendBotMessage,
        openChatContextMenu, closeChatContextMenu, handleMsgAction,
        editMessageInline, showForwardDialog, loadForwardContacts,
        filterForwardContacts, doForward, deleteChatConversation,
        openChatLightbox, closeChatLightbox, openChatVideo, playAudio,
        downloadFile, handleChatFileSelect, handleChatKeydown,
        handleChatTyping, showChatTyping, hideChatTyping, markChatAsRead,
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
        getStatusFromActivity, openChatConvMenu,
    });
}
_exposeChatGlobals();

export { initChat, stopChat, openChatWith, initSocketConnection, initSmartChat, sendSmartMessage, loadChatConversations, startChatPolling, stopChatPolling };
