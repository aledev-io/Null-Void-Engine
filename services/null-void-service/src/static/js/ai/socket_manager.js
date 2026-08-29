function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return "";
}

export function initSockets() {
        const token = getCookie("token");
        window.socket = io({ query: { token: token } });
        
        // Real-time note updates
        window.socket.on('note_update', function (data) {
            if (window.handleNoteUpdate) {
                window.handleNoteUpdate(data);
            }
        });

        window.socket.on('chat_deleted', function(data) {
            // Eliminar de los tabs si está abierto
            if (window.removeChatTab) {
                window.removeChatTab(data.id);
            }
        });
        
        window.socket.on('model_pull_progress', function(data) {
            if (window.handleModelPullProgress) {
                window.handleModelPullProgress(data);
            }
        });
        
        // Active collaborators update
        window.socket.on('active_collaborators', function(data) {
            if (window.renderActiveCollaborators) {
                window.renderActiveCollaborators(data.users);
            }
        });
        
        // Real-time cursor updates
        window.socket.on('cursor_update', function (data) {
            if (window.handleCursorUpdate) {
                window.handleCursorUpdate(data);
            }
        });
        window.socket.on('note_shared', function (sharedNote) {
            sharedNote.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
            sharedNote.title = `${sharedNote.title} (de ${sharedNote.shared_by})`;

            if (!window.notes) window.notes = [];
            window.notes.unshift(sharedNote);
            window.saveNotes();

            if (document.getElementById('notes-view').classList.contains('active')) {
                window.renderNotesList();
            }
            window.showToast(`Has recibido una nota compartida de ${sharedNote.shared_by}`);
        });

        window.socket.on('chat_shared', function (data) {
            // Save the shared chat to the recipient's localStorage history
            const userId = window.currentUserId;
            if (userId && data.messages && data.messages.length > 0) {
                const historyKey = `nv_ai_history_${userId}`;
                const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
                // Tag incoming user messages with the original sender's name
                const taggedMessages = data.messages.map(m => {
                    if (m.role === 'user' && !m.author) {
                        m.author = data.shared_by;
                    }
                    return m;
                });

                // Avoid duplicates
                const exists = history.some(c => c.id === data.id);
                if (!exists) {
                    history.unshift({
                        id: data.id,
                        title: data.title,  // already includes "(de NombreRemitente)"
                        messages: taggedMessages,
                        shared_by: data.shared_by,
                    });
                    localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 20)));
                    if (window.loadHistory) window.loadHistory();
                }
            }
            window.showToast(`📨 Chat compartido por ${data.shared_by}`);
        });

        window.socket.on('ai_response_ready', function (data) {
            // La respuesta se completó en segundo plano: si el usuario no está
            // viendo esa conversación, avisar con una notificación del navegador.
            const sid = data && data.session_id;
            if (!sid) return;
            const seen = document.hasFocus()
                && window.currentChatId
                && String(window.currentChatId) === String(sid);
            if (seen) return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try {
                const n = new Notification('Nexus IA — respuesta lista', {
                    body: (data.preview || 'Tu respuesta ya está lista.'),
                    tag: 'ai-response-' + sid,
                });
                n.onclick = () => { window.focus(); };
            } catch (e) { /* permisos denegados */ }
        });

        window.socket.on('force_logout', () => {
            console.warn('[Session] Nueva sesión detectada, cerrando la actual...');
            window.location.href = '/';
        });

        // Pedir permiso de notificaciones con el primer gesto del usuario
        if ('Notification' in window && Notification.permission === 'default') {
            const reqOnce = () => {
                try { Notification.requestPermission().catch(() => {}); } catch (e) { /* sin soporte */ }
                document.removeEventListener('click', reqOnce);
                document.removeEventListener('keydown', reqOnce);
            };
            document.addEventListener('click', reqOnce);
            document.addEventListener('keydown', reqOnce);
        }

        window.init();
        window.handleRouting();
}
