let currentAttachType = '';
let selectModalCloudPath = '';
let selectorAllItems = [];

export function openAttachSelectorModal(type) {
    currentAttachType = type;
    selectModalCloudPath = '';
    selectorAllItems = [];

    document.getElementById('attach-selector-search').value = '';
    document.getElementById('attach-menu').classList.remove('show');

    const titleEl = document.getElementById('attach-selector-modal-title');
    if (type === 'cloud') {
        titleEl.textContent = 'Adjuntar Archivos (Null-Void Cloud)';
        loadCloudItemsForAttach();
    } else if (type === 'notes') {
        titleEl.textContent = 'Adjuntar Notas (Notas Locales)';
        loadNotesItemsForAttach();
    } else if (type === 'knowledge') {
        titleEl.textContent = 'Adjuntar Conocimiento (Base de Conocimiento)';
        loadKnowledgeItemsForAttach();
    }

    document.getElementById('attach-selector-overlay').classList.add('show');
}

export function closeAttachSelectorModal(e) {
    if (e && e.target !== document.getElementById('attach-selector-overlay')) return;
    document.getElementById('attach-selector-overlay').classList.remove('show');
}

export function navigateSelectModalCloudUp() {
    const parts = selectModalCloudPath.split('/').filter(Boolean);
    parts.pop();
    selectModalCloudPath = parts.join('/');
    loadCloudItemsForAttach();
}

export function renderAttachSelectorItems(items) {
    const listEl = document.getElementById('attach-selector-list');
    listEl.innerHTML = '';

    if (items.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);">No se encontraron elementos.</div>';
        return;
    }

    items.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'attach-selector-item';

        let iconHtml = '';
        let title = item.name;
        let meta = '';

        if (currentAttachType === 'cloud') {
            if (item.is_dir) {
                iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
                meta = 'Carpeta';
                itemDiv.onclick = () => {
                    selectModalCloudPath = selectModalCloudPath ? `${selectModalCloudPath}/${item.name}` : item.name;
                    loadCloudItemsForAttach();
                };
            } else {
                const ext = (item.ext || '').toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
                    iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
                } else if (ext === '.pdf') {
                    iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><text x="7" y="17" font-size="7" font-weight="bold" fill="#f87171" stroke="none">PDF</text></svg>`;
                } else if (['.mp3', '.wav', '.ogg', '.webm'].includes(ext)) {
                    iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
                } else {
                    iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
                }

                const sizeStr = (item.size / 1024).toFixed(1) + ' KB';
                meta = `Archivo • ${sizeStr}`;
                itemDiv.onclick = () => selectCloudFileForAttach(item);
            }
        } else if (currentAttachType === 'notes') {
            iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
            meta = `Nota • ${new Date(item.updatedAt).toLocaleDateString()}`;
            itemDiv.onclick = () => selectNoteForAttach(item);
        } else if (currentAttachType === 'knowledge') {
            iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>`;
            meta = item.description || 'Artículo de conocimiento';
            itemDiv.onclick = () => selectKnowledgeForAttach(item);
        }

        const _et = (title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        const _em = (meta || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        itemDiv.innerHTML = `
                    <div class="attach-selector-item-icon" style="font-size: 1.2rem;">
                        ${iconHtml}
                    </div>
                    <div class="attach-selector-item-info">
                        <div class="attach-selector-item-title">${_et}</div>
                        <div class="attach-selector-item-meta">${_em}</div>
                    </div>
                `;

        listEl.appendChild(itemDiv);
    });
}

export function filterAttachSelectorItems() {
    const query = document.getElementById('attach-selector-search').value.toLowerCase().trim();
    if (!query) {
        renderAttachSelectorItems(selectorAllItems);
        return;
    }

    const filtered = selectorAllItems.filter(item => {
        const nameMatch = item.name.toLowerCase().includes(query);
        const descMatch = (item.description || '').toLowerCase().includes(query);
        return nameMatch || descMatch;
    });

    renderAttachSelectorItems(filtered);
}

export async function selectCloudFileForAttach(file) {
    const listEl = document.getElementById('attach-selector-list');
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);">Descargando y adjuntando archivo...</div>';

    try {
        const tokenRes = await fetch('/api/cloud/get_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ view: 'drive', name: file.name, path: selectModalCloudPath })
        });

        if (!tokenRes.ok) throw new Error('Error al obtener token de descarga');
        const tokenData = await tokenRes.json();

        const fileRes = await fetch(`/api/cloud/download?t=${tokenData.t}`);
        if (!fileRes.ok) throw new Error('Error al descargar archivo');

        const blob = await fileRes.blob();

        const ext = (file.ext || '').toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
        const isPdf = ext === '.pdf';
        const isAudio = ['.mp3', '.wav', '.ogg', '.webm'].includes(ext);
        const isText = ['.txt', '.js', '.py', '.json', '.md', '.html', '.css', '.c', '.cpp', '.h', '.sh', '.sql'].includes(ext);

        const reader = new FileReader();
        reader.onload = (e) => {
            const entry = {
                id: Date.now() + Math.random(),
                name: file.name,
                type: blob.type,
                size: (blob.size / 1024).toFixed(1) + ' KB',
                data: e.target.result,
                isImage: isImage,
                isPdf: isPdf,
                isText: isText,
                isAudio: isAudio
            };
            window.attachedFiles.push(entry);
            fireAndForgetPersist(entry);
            renderAttachedFiles();
            document.getElementById('attach-selector-overlay').classList.remove('show');
        };

        if (isImage || isPdf || isAudio) {
            reader.readAsDataURL(blob);
        } else {
            reader.readAsText(blob);
        }
    } catch (err) {
        alert(`Error al adjuntar archivo: ${err.message}`);
        loadCloudItemsForAttach();
    }
}

export function selectNoteForAttach(note) {
    const entry = {
        id: Date.now() + Math.random(),
        name: `${note.name}.txt`,
        type: 'text/plain',
        size: (note.content.length / 1024).toFixed(1) + ' KB',
        data: note.content,
        isImage: false,
        isPdf: false,
        isText: true,
        isAudio: false
    };
    window.attachedFiles.push(entry);
    fireAndForgetPersist(entry);
    renderAttachedFiles();
    document.getElementById('attach-selector-overlay').classList.remove('show');
}

export function selectKnowledgeForAttach(item) {
    const entry = {
        id: Date.now() + Math.random(),
        name: item.name,
        type: 'text/markdown',
        size: (item.content.length / 1024).toFixed(1) + ' KB',
        data: item.content,
        isImage: false,
        isPdf: false,
        isText: true,
        isAudio: false
    };
    window.attachedFiles.push(entry);
    fireAndForgetPersist(entry);
    renderAttachedFiles();
    document.getElementById('attach-selector-overlay').classList.remove('show');
}

export function dataURLtoBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const meta = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(parts.slice(1).join(','));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: meta });
}

export function attachmentServerUrl(att) {
    if (att.fileId) return '/api/ai/attachments/' + encodeURIComponent(att.fileId);
    if (att.id && !att.data && typeof att.id === 'string') return '/api/ai/attachments/' + encodeURIComponent(att.id);
    return null;
}

export async function persistAttachment(att, blob = null) {
    try {
        let payload = blob;
        if (!payload) {
            if (att.data && att.data.startsWith('data:')) {
                payload = dataURLtoBlob(att.data);
            } else if (att.data) {
                payload = new Blob([att.data], { type: att.type || 'text/plain' });
            } else {
                return att;
            }
        }
        const fd = new FormData();
        fd.append('file', payload, att.name || 'archivo');
        const res = await fetch('/api/ai/attachments/upload', { method: 'POST', body: fd });
        if (!res.ok) return att;
        const ref = await res.json();
        if (!ref || !ref.id) return att;
        return {
            ...att,
            fileId: ref.id,
            name: ref.name,
            size: ref.sizeLabel,
            type: ref.type,
            isImage: ref.isImage,
            isText: ref.isText,
            isAudio: ref.isAudio,
            uploaded: true,
            data: att.data
        };
    } catch (err) {
        return att;
    }
}

export function fireAndForgetPersist(entry, blob = null) {
    persistAttachment(entry, blob).then(r => {
        if (r && r.uploaded) {
            const origData = entry.data;
            const origIsText = entry.isText;
            Object.assign(entry, r);
            if (origData) entry.data = origData;
            if (origIsText) entry.isText = origIsText;
        }
    });
}

export function toggleAttachMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('attach-menu');
    menu.classList.toggle('show');
}

export function handleFileUpload(input) {
    const files = Array.from(input.files);
    if (files.length === 0) return;

    processFiles(files);

    input.value = '';
    document.getElementById('attach-menu').classList.remove('show');
}

export async function toggleMicRecording(source = 'main') {
    const micBtnId = source === 'workspace' ? 'workspace-mic-btn' : 'mic-btn';
    const micBtn = document.getElementById(micBtnId);
    if (!window.isRecordingAudio) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            window.mediaRecorder = new MediaRecorder(stream);
            window.audioChunks = [];

            window.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    window.audioChunks.push(e.data);
                }
            };

            window.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(window.audioChunks, { type: 'audio/webm' });
                const fileReader = new FileReader();
                fileReader.onload = (event) => {
                    const dateStr = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '_');
                    const entry = {
                        id: Date.now() + Math.random(),
                        name: `Nota_de_voz_${dateStr}.webm`,
                        type: 'audio/webm',
                        size: (audioBlob.size / 1024).toFixed(1) + ' KB',
                        data: event.target.result,
                        isImage: false,
                        isPdf: false,
                        isText: false,
                        isAudio: true
                    };
                    window.attachedFiles.push(entry);
                    fireAndForgetPersist(entry, audioBlob);
                    renderAttachedFiles();

                    // If recording was from the workspace panel, auto-navigate to chat
                    if (window._recordingSource === 'workspace' && window.startWorkspaceChat) {
                        window.startWorkspaceChat();
                    }
                };
                fileReader.readAsDataURL(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };

            window.mediaRecorder.start();
            window.isRecordingAudio = true;
            window._recordingSource = source;

            const wrapperSelector = source === 'workspace' ? '#workspace-chat-input' : '.input-wrapper';
            const wrapper = source === 'workspace' ? document.getElementById('workspace-chat-input').parentElement : document.querySelector('.input-wrapper');
            if (wrapper) {
                wrapper.style.transition = 'all 0.3s ease';
                wrapper.style.borderColor = '#ef4444';
                wrapper.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.15)';
            }
            
            const inputId = source === 'workspace' ? 'workspace-chat-input' : 'chat-input';
            const chatInput = document.getElementById(inputId);
            if (chatInput) {
                window._oldPlaceholder = chatInput.placeholder;
                chatInput.placeholder = '🔴 Escuchando...';
                chatInput.disabled = true;
            }

            micBtn.style.color = '#ef4444';
            micBtn.style.background = 'rgba(239, 68, 68, 0.15)';
            micBtn.title = 'Detener grabación';
            micBtn.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="animation: pulse 1.2s infinite;">
                            <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                        </svg>
                    `;
        } catch (err) {
            console.error('Error al acceder al micrófono:', err);
            alert('No se pudo acceder al micrófono. Asegúrate de dar los permisos necesarios.');
        }
    } else {
        if (window.mediaRecorder && window.mediaRecorder.state !== 'inactive') {
            window.mediaRecorder.stop();
        }
        window.isRecordingAudio = false;

        const source = window._recordingSource || 'main';
        const wrapper = source === 'workspace' ? document.getElementById('workspace-chat-input').parentElement : document.querySelector('.input-wrapper');
        if (wrapper) {
            wrapper.style.borderColor = '';
            wrapper.style.boxShadow = '';
        }
        const inputId = source === 'workspace' ? 'workspace-chat-input' : 'chat-input';
        const chatInput = document.getElementById(inputId);
        if (chatInput) {
            chatInput.placeholder = window._oldPlaceholder || 'Escribe un mensaje...';
            chatInput.disabled = false;
            const isMobile = window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
            if (!isMobile) chatInput.focus();
        }

        micBtn.style.color = 'var(--text-dim)';
        micBtn.style.background = 'none';
        micBtn.title = 'Grabar audio';
        micBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                `;
    }
}

export async function extractTextFromPdf(dataUrl) {
    try {
        // Initialize PDF.js worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = "{{ url_for('static', filename='js/ai/pdf.worker.min.js') }}";

        // Convert Base64 dataURL to Uint8Array
        const base64 = dataUrl.split(',')[1];
        const binary = atob(base64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);

        const pdf = await pdfjsLib.getDocument({ data: array }).promise;
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            fullText += pageText + "\\n\\n";
        }

        return fullText.trim() || "(No se pudo extraer texto. Puede que sea un PDF de imágenes escaneadas sin OCR)";
    } catch (err) {
        console.error("Error extracting PDF text:", err);
        return "(Error procesando el PDF)";
    }
}

export function processFiles(files, targetArray = window.attachedFiles, callback = renderAttachedFiles) {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        const isImage = (file.type && (file.type.startsWith('image/') || file.type.includes('image'))) ||
            /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file.name || '');
        const isPdf = file.type.includes('pdf') || file.name.endsWith('.pdf');
        const isAudio = file.type.startsWith('audio/') ||
            file.name.endsWith('.mp3') ||
            file.name.endsWith('.wav') ||
            file.name.endsWith('.ogg') ||
            file.name.endsWith('.webm');
        const isText = (file.type && (file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/javascript' || file.type === 'application/xml' || file.type === 'application/x-yaml')) ||
            /\.(txt|md|markdown|js|jsx|ts|tsx|py|pyw|c|cpp|cc|cxx|h|hpp|hh|hxx|cs|java|go|rs|php|rb|swift|kt|kts|html|htm|css|scss|sass|less|json|jsonc|xml|yaml|yml|sql|sh|bash|zsh|bat|cmd|ps1|csv|tsv|env|ini|cfg|conf|toml|log|dockerfile|makefile|r|m|dart|scala|lua)$/i.test(file.name || '');

        reader.onload = async (e) => {
            let fileData = e.target.result;
            let fileIsText = isText;
            let persistBlob = null;

            if (isPdf) {
                // Extract text automatically so the AI can read it
                const extractedText = await extractTextFromPdf(fileData);
                fileData = extractedText;
                fileIsText = true; // Treat it as text now so sendMessage injects it correctly
                persistBlob = file; // Pero el archivo real que se guarda es el PDF original
            }

            const entry = {
                id: Date.now() + Math.random(),
                name: file.name,
                type: file.type,
                size: (file.size / 1024).toFixed(1) + ' KB',
                data: fileData,
                isImage: isImage,
                isPdf: isPdf,
                isText: fileIsText,
                isAudio: isAudio
            };
            targetArray.push(entry);
            fireAndForgetPersist(entry, persistBlob);
            if (callback) callback();
        };

        if (isImage || isPdf || isAudio) {
            reader.readAsDataURL(file);
        } else if (isText) {
            reader.readAsText(file);
        } else {
            const entry = {
                id: Date.now() + Math.random(),
                name: file.name,
                type: file.type,
                size: (file.size / 1024).toFixed(1) + ' KB',
                data: null,
                isImage: false,
                isPdf: false,
                isText: false,
                isAudio: false
            };
            window.attachedFiles.push(entry);
            fireAndForgetPersist(entry, file);
            renderAttachedFiles();
        }
    });
}

export function renameAttachment(e, id) {
    if (e) e.stopPropagation();
    const att = window.attachedFiles.find(a => a.id === id);
    if (!att) return;
    showInputDialog(
        'Renombrar archivo',
        'Nombre del archivo',
        att.name,
        'Guardar',
        (newName) => {
            if (newName && newName.trim()) {
                let finalName = newName.trim();
                const oldExt = att.name.split('.').pop();
                if (!finalName.includes('.') && oldExt && oldExt !== att.name) {
                    finalName += '.' + oldExt;
                }
                att.name = finalName;
                renderAttachedFiles();
            }
        }
    );
}

export function renderAttachedFiles() {
    const container = document.getElementById('attachments-preview');
    container.innerHTML = '';
    if (window.attachedFiles.length > 0) {
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
        if (window.updateSendButtonState) window.updateSendButtonState();
        return;
    }

    window.attachedFiles.forEach(attr => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';

        let thumbHTML = '';
        const isImg = attr.isImage || attr.type?.startsWith('image/') || attr.data?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(attr.name || '');
        if (isImg && (attr.data || attr.fileId)) {
            thumbHTML = `<img src="${attr.data || attachmentServerUrl(attr)}" class="attachment-thumb" style="width:40px;height:40px;object-fit:cover;border-radius:8px;" />`;
        } else {
            let iconSVG = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                    `;
            if (attr.isPdf) {
                iconSVG = `
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f56565" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <text x="6" y="18" font-size="8" font-weight="bold" fill="#f56565" stroke="none">PDF</text>
                            </svg>
                        `;
            } else if (attr.isText) {
                iconSVG = `
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4299e1" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                        `;
            } else if (attr.isAudio) {
                iconSVG = `
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ed8936" stroke-width="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="23"></line>
                                <line x1="8" y1="23" x2="16" y2="23"></line>
                            </svg>
                        `;
            }
            thumbHTML = `<div class="attachment-thumb">${iconSVG}</div>`;
        }

        chip.innerHTML = `
                    <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer;" onclick="openFilePreview(${attr.id})">
                        ${thumbHTML}
                        <div class="attachment-info">
                            <span class="attachment-name" title="Clic para renombrar / Haz clic fuera para previsualizar" onclick="renameAttachment(event, ${attr.id})">${attr.name ? attr.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''}</span>
                            <span class="attachment-size">${attr.size}</span>
                        </div>
                    </div>
                    <button onclick="removeAttachment(${attr.id})" title="Quitar archivo">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                `;
        container.appendChild(chip);
    });
    if (window.updateSendButtonState) window.updateSendButtonState();
}

export function openFilePreview(id) {
    const att = window.attachedFiles.find(a => a.id === id);
    if (!att) return;
    openAttachmentPreview(att);
}

export function openAttachmentPreview(att) {
    const titleEl = document.getElementById('preview-modal-title');
    const bodyEl = document.getElementById('preview-modal-body');

    titleEl.textContent = att.name || 'Visualización de archivo';
    bodyEl.innerHTML = '';

    const serverUrl = attachmentServerUrl(att);

    const isImage = att.isImage || att.type?.startsWith('image/') || att.data?.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att.name || '');
    const isPdf = att.isPdf || att.type?.includes('pdf') || att.name?.endsWith('.pdf');
    const isText = att.isText || att.type?.startsWith('text/') ||
        (att.name && (
            att.name.endsWith('.js') ||
            att.name.endsWith('.ts') ||
            att.name.endsWith('.py') ||
            att.name.endsWith('.c') ||
            att.name.endsWith('.cpp') ||
            att.name.endsWith('.h') ||
            att.name.endsWith('.java') ||
            att.name.endsWith('.html') ||
            att.name.endsWith('.css') ||
            att.name.endsWith('.json') ||
            att.name.endsWith('.md') ||
            att.name.endsWith('.sql') ||
            att.name.endsWith('.sh')
        ));

    const isAudio = att.isAudio || att.type?.startsWith('audio/') || att.name?.endsWith('.webm');

    if (isAudio && (att.data || serverUrl)) {
        const audioContainer = document.createElement('div');
        audioContainer.style.display = 'flex';
        audioContainer.style.flexDirection = 'column';
        audioContainer.style.alignItems = 'center';
        audioContainer.style.justifyContent = 'center';
        audioContainer.style.gap = '20px';
        audioContainer.style.padding = '30px 10px';
        audioContainer.style.width = '100%';

        const audioIcon = document.createElement('div');
        audioIcon.innerHTML = `
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ed8936" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                `;

        const audioEl = document.createElement('audio');
        audioEl.src = att.data || serverUrl;
        audioEl.controls = true;
        audioEl.style.width = '100%';
        audioEl.style.maxWidth = '400px';

        const nameInfo = document.createElement('div');
        nameInfo.style.fontSize = '0.9rem';
        nameInfo.style.color = 'var(--text-main)';
        nameInfo.style.fontWeight = '500';
        nameInfo.textContent = att.name;

        audioContainer.appendChild(audioIcon);
        audioContainer.appendChild(nameInfo);
        audioContainer.appendChild(audioEl);
        bodyEl.appendChild(audioContainer);
    } else if (isImage && (att.data || serverUrl)) {
        const img = document.createElement('img');
        img.src = att.data || serverUrl;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '60vh';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '8px';
        img.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
        bodyEl.appendChild(img);
    } else if (isPdf && (att.data || serverUrl)) {
        const iframe = document.createElement('iframe');
        iframe.src = att.data || serverUrl;
        iframe.style.width = '100%';
        iframe.style.height = '60vh';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '8px';
        bodyEl.appendChild(iframe);
    } else if (isText && att.data) {
        const pre = document.createElement('pre');
        pre.style.width = '100%';
        pre.style.maxHeight = '60vh';
        pre.style.margin = '0';
        pre.style.padding = '15px';
        pre.style.background = '#0d1117';
        pre.style.color = '#c9d1d9';
        pre.style.borderRadius = '8px';
        pre.style.overflow = 'auto';
        pre.style.textAlign = 'left';
        pre.style.fontFamily = 'monospace';
        pre.style.fontSize = '0.85rem';
        pre.style.border = '1px solid var(--border)';

        const code = document.createElement('code');
        code.className = 'hljs';
        code.textContent = att.data;
        pre.appendChild(code);
        bodyEl.appendChild(pre);

        if (window.hljs) {
            hljs.highlightElement(code);
        }
    } else if (isText && serverUrl) {
        const pre = document.createElement('pre');
        pre.style.width = '100%';
        pre.style.maxHeight = '60vh';
        pre.style.margin = '0';
        pre.style.padding = '15px';
        pre.style.background = '#0d1117';
        pre.style.color = '#c9d1d9';
        pre.style.borderRadius = '8px';
        pre.style.overflow = 'auto';
        pre.style.textAlign = 'left';
        pre.style.fontFamily = 'monospace';
        pre.style.fontSize = '0.85rem';
        pre.style.border = '1px solid var(--border)';

        const code = document.createElement('code');
        code.className = 'hljs';
        pre.appendChild(code);
        bodyEl.appendChild(pre);

        fetch(serverUrl)
            .then(r => {
                if (!r.ok) throw new Error();
                return r.text();
            })
            .then(t => {
                code.textContent = t;
                if (window.hljs) hljs.highlightElement(code);
            })
            .catch(() => {
                code.textContent = '(No se pudo cargar el contenido del archivo)';
            });
    } else if (isImage) {
        bodyEl.innerHTML = `
            <div style="text-align:center;color:var(--text-dim);display:flex;flex-direction:column;align-items:center;gap:14px;padding:30px 20px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                <div style="font-weight:600;color:var(--text-main);font-size:1.05rem;">${att.name || 'Captura de pantalla'}</div>
                <div style="font-size:0.82rem;color:var(--primary);font-weight:500;">Imagen adjunta en la conversación</div>
                <div style="font-size:0.75rem;color:var(--text-dim);max-width:340px;line-height:1.4;margin-top:4px;">
                    La imagen fue procesada por la IA durante la consulta. La vista previa binaria Base64 no se conserva en el historial de texto para optimizar el almacenamiento.
                </div>
            </div>
        `;
    } else {
        const fileIconSVG = isPdf
            ? `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><text x="7" y="17" font-size="7" font-weight="bold" fill="#f87171" stroke="none">PDF</text></svg>`
            : isAudio
            ? `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`
            : isText
            ? `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`
            : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.8"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
        bodyEl.innerHTML = `
            <div style="text-align:center;color:var(--text-dim);display:flex;flex-direction:column;align-items:center;gap:12px;padding:30px 20px;">
                ${fileIconSVG}
                <div style="font-weight:600;color:var(--text-main);font-size:1.05rem;">${att.name ? att.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : 'Archivo adjunto'}</div>
                <div style="font-size:0.82rem;color:var(--text-dim);">Archivo de contexto (${att.size || 'Historial'})</div>
            </div>
        `;
    }

    document.getElementById('file-preview-overlay').classList.add('show');
}

export function closeFilePreviewModal(e) {
    if (e && e.target !== document.getElementById('file-preview-overlay')) return;
    document.getElementById('file-preview-overlay').classList.remove('show');
}

export function removeAttachment(id) {
    window.attachedFiles = window.attachedFiles.filter(a => a.id !== id);
    renderAttachedFiles();
}

export function detectSnippetExtension(text) {
    if (!text || typeof text !== 'string') return 'txt';
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch (e) {}
    }
    if (/^<!DOCTYPE html|<html[\s>]|<div[\s>]|<head[\s>]|<body[\s>]/i.test(trimmed)) return 'html';
    if (/(def\s+[a-zA-Z_]|import\s+[a-zA-Z_]|from\s+[a-zA-Z_]|class\s+[a-zA-Z_].*:|elif\s+|if\s+__name__\s*==)/.test(text)) return 'py';
    if (/(function\s+[a-zA-Z_]|const\s+[a-zA-Z_]|let\s+[a-zA-Z_]|console\.log|export\s+default|export\s+function|import\s+.*\s+from)/.test(text)) return 'js';
    if (/(SELECT\s+.*\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|UPDATE\s+.*\s+SET|ALTER\s+TABLE)/i.test(text)) return 'sql';
    if (/(#include\s+<|int\s+main\(|std::cout|std::vector|nullptr)/.test(text)) return 'cpp';
    if (/[a-zA-Z0-9_\-\.#]+\s*\{\s*[\w\-]+:/i.test(text)) return 'css';
    if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || /\[.*\]\(http.*\)/.test(text) || /```[\s\S]*```/.test(text)) return 'md';
    return 'txt';
}

export function isCodeOrLargeSnippet(text) {
    if (!text || typeof text !== 'string') return false;
    const len = text.length;
    const lines = text.split('\n').length;
    // Umbral de texto largo tipo Claude: >= 800 caracteres, o >= 12 líneas y >= 300 caracteres, o código detectado >= 350 caracteres
    if (len >= 800) return true;
    if (lines >= 12 && len >= 300) return true;
    const ext = detectSnippetExtension(text);
    if (ext !== 'txt' && (len >= 350 || lines >= 8)) return true;
    return false;
}

export function attachPastedText(text, targetArray = window.attachedFiles, callback = renderAttachedFiles) {
    const ext = detectSnippetExtension(text);
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
    let prefix = 'texto_pegado';
    if (ext === 'py') prefix = 'script';
    else if (ext === 'js') prefix = 'codigo';
    else if (ext === 'json') prefix = 'datos';
    else if (ext === 'html') prefix = 'documento';
    else if (ext === 'sql') prefix = 'consulta';
    else if (ext === 'css') prefix = 'estilos';

    const fileName = `${prefix}_${dateStr}.${ext}`;
    const sizeKb = (new Blob([text]).size / 1024).toFixed(1) + ' KB';

    const entry = {
        id: Date.now() + Math.random(),
        name: fileName,
        type: ext === 'json' ? 'application/json' : (ext === 'html' ? 'text/html' : 'text/plain'),
        size: sizeKb,
        data: text,
        isImage: false,
        isPdf: false,
        isText: true,
        isAudio: false
    };

    targetArray.push(entry);
    fireAndForgetPersist(entry);
    if (callback) callback();

    if (window.showToast) {
        window.showToast(`Texto largo (${sizeKb}) convertido en archivo adjunto: ${fileName}`, 'info');
    }
}

export function handleSmartPaste(e, targetArray = window.attachedFiles, callback = renderAttachedFiles) {
    if (!e || !e.clipboardData) return;

    // 1. Imágenes pegadas desde el portapapeles (screenshots)
    if (e.clipboardData.items) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) {
                    e.preventDefault();
                    const name = `Captura_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.png`;
                    const fileType = file.type || 'image/png';
                    const renamedFile = new File([file], name, { type: fileType });
                    processFiles([renamedFile], targetArray, callback);
                    if (window.showToast) {
                        window.showToast('Imagen del portapapeles adjuntada', 'info');
                    }
                    return;
                }
            }
        }
    }

    // 2. Texto largo o código pegado (tipo Claude)
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && isCodeOrLargeSnippet(pastedText)) {
        e.preventDefault();
        attachPastedText(pastedText, targetArray, callback);
    }
}

export function initDragAndDropHandlers() {
    const dropZones = [
        document.querySelector('.input-area'),
        document.querySelector('.input-wrapper'),
        document.getElementById('chat-area'),
        document.querySelector('.workspace-input-wrapper')
    ].filter(Boolean);

    dropZones.forEach(zone => {
        if (zone._dropHandlerBound) return;
        zone._dropHandlerBound = true;

        ['dragenter', 'dragover'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('drag-over-active');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('drag-over-active');
            }, false);
        });

        zone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                processFiles(dt.files);
            }
        }, false);
    });
}

export function initPasteHandlers() {
    const chatInput = document.getElementById('chat-input');
    if (chatInput && !chatInput._pasteHandlerBound) {
        chatInput.addEventListener('paste', (e) => handleSmartPaste(e, window.attachedFiles, renderAttachedFiles));
        chatInput._pasteHandlerBound = true;
    }

    const wsInput = document.getElementById('workspace-chat-input');
    if (wsInput && !wsInput._pasteHandlerBound) {
        wsInput.addEventListener('paste', (e) => handleSmartPaste(e, window.attachedFiles, renderAttachedFiles));
        wsInput._pasteHandlerBound = true;
    }

    initDragAndDropHandlers();
}

