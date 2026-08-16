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
                iconHtml = '📁';
                meta = 'Carpeta';
                itemDiv.onclick = () => {
                    selectModalCloudPath = selectModalCloudPath ? `${selectModalCloudPath}/${item.name}` : item.name;
                    loadCloudItemsForAttach();
                };
            } else {
                const ext = (item.ext || '').toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) iconHtml = '🖼️';
                else if (ext === '.pdf') iconHtml = '📄';
                else if (['.mp3', '.wav', '.ogg', '.webm'].includes(ext)) iconHtml = '🎵';
                else iconHtml = '📝';

                const sizeStr = (item.size / 1024).toFixed(1) + ' KB';
                meta = `Archivo • ${sizeStr}`;
                itemDiv.onclick = () => selectCloudFileForAttach(item);
            }
        } else if (currentAttachType === 'notes') {
            iconHtml = '📝';
            meta = `Nota • ${new Date(item.updatedAt).toLocaleDateString()}`;
            itemDiv.onclick = () => selectNoteForAttach(item);
        } else if (currentAttachType === 'knowledge') {
            iconHtml = '💡';
            meta = item.description || 'Artículo de conocimiento';
            itemDiv.onclick = () => selectKnowledgeForAttach(item);
        }

        itemDiv.innerHTML = `
                    <div class="attach-selector-item-icon" style="font-size: 1.2rem;">
                        ${iconHtml}
                    </div>
                    <div class="attach-selector-item-info">
                        <div class="attach-selector-item-title">${title}</div>
                        <div class="attach-selector-item-meta">${meta}</div>
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
            window.attachedFiles.push({
                id: Date.now() + Math.random(),
                name: file.name,
                type: blob.type,
                size: (blob.size / 1024).toFixed(1) + ' KB',
                data: e.target.result,
                isImage: isImage,
                isPdf: isPdf,
                isText: isText,
                isAudio: isAudio
            });
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
    window.attachedFiles.push({
        id: Date.now() + Math.random(),
        name: `${note.name}.txt`,
        type: 'text/plain',
        size: (note.content.length / 1024).toFixed(1) + ' KB',
        data: note.content,
        isImage: false,
        isPdf: false,
        isText: true,
        isAudio: false
    });
    renderAttachedFiles();
    document.getElementById('attach-selector-overlay').classList.remove('show');
}

export function selectKnowledgeForAttach(item) {
    window.attachedFiles.push({
        id: Date.now() + Math.random(),
        name: item.name,
        type: 'text/markdown',
        size: (item.content.length / 1024).toFixed(1) + ' KB',
        data: item.content,
        isImage: false,
        isPdf: false,
        isText: true,
        isAudio: false
    });
    renderAttachedFiles();
    document.getElementById('attach-selector-overlay').classList.remove('show');
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
                    window.attachedFiles.push({
                        id: Date.now() + Math.random(),
                        name: `Nota_de_voz_${dateStr}.webm`,
                        type: 'audio/webm',
                        size: (audioBlob.size / 1024).toFixed(1) + ' KB',
                        data: event.target.result,
                        isImage: false,
                        isPdf: false,
                        isText: false,
                        isAudio: true
                    });
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
            chatInput.focus();
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
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type.includes('pdf') || file.name.endsWith('.pdf');
        const isAudio = file.type.startsWith('audio/') ||
            file.name.endsWith('.mp3') ||
            file.name.endsWith('.wav') ||
            file.name.endsWith('.ogg') ||
            file.name.endsWith('.webm');
        const isText = file.type.startsWith('text/') ||
            file.name.endsWith('.js') ||
            file.name.endsWith('.ts') ||
            file.name.endsWith('.py') ||
            file.name.endsWith('.c') ||
            file.name.endsWith('.cpp') ||
            file.name.endsWith('.h') ||
            file.name.endsWith('.java') ||
            file.name.endsWith('.html') ||
            file.name.endsWith('.css') ||
            file.name.endsWith('.json') ||
            file.name.endsWith('.md') ||
            file.name.endsWith('.sql') ||
            file.name.endsWith('.sh');

        reader.onload = async (e) => {
            let fileData = e.target.result;
            let fileIsText = isText;

            if (isPdf) {
                // Extract text automatically so the AI can read it
                const extractedText = await extractTextFromPdf(fileData);
                fileData = extractedText;
                fileIsText = true; // Treat it as text now so sendMessage injects it correctly
            }

            targetArray.push({
                id: Date.now() + Math.random(),
                name: file.name,
                type: file.type,
                size: (file.size / 1024).toFixed(1) + ' KB',
                data: fileData,
                isImage: isImage,
                isPdf: isPdf,
                isText: fileIsText,
                isAudio: isAudio
            });
            if (callback) callback();
        };

        if (isImage || isPdf || isAudio) {
            reader.readAsDataURL(file);
        } else if (isText) {
            reader.readAsText(file);
        } else {
            window.attachedFiles.push({
                id: Date.now() + Math.random(),
                name: file.name,
                type: file.type,
                size: (file.size / 1024).toFixed(1) + ' KB',
                data: null,
                isImage: false,
                isPdf: false,
                isText: false,
                isAudio: false
            });
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
        return;
    }

    window.attachedFiles.forEach(attr => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';

        let thumbHTML = '';
        if (attr.isImage && attr.data) {
            thumbHTML = `<img src="${attr.data}" class="attachment-thumb" />`;
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
                            <span class="attachment-name" title="Clic para renombrar / Haz clic fuera para previsualizar" onclick="renameAttachment(event, ${attr.id})">${attr.name}</span>
                            <span class="attachment-size">${attr.size}</span>
                        </div>
                    </div>
                    <button onclick="removeAttachment(${attr.id})" title="Quitar archivo">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                `;
        container.appendChild(chip);
    });
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

    const isImage = att.isImage || att.type?.startsWith('image/');
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

    if (isAudio && att.data) {
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
        audioEl.src = att.data;
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
    } else if (isImage && att.data) {
        const img = document.createElement('img');
        img.src = att.data;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '60vh';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '8px';
        img.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
        bodyEl.appendChild(img);
    } else if (isPdf && att.data) {
        const iframe = document.createElement('iframe');
        iframe.src = att.data;
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
    } else {
        bodyEl.innerHTML = `
                    <div style="text-align:center;color:var(--text-dim);display:flex;flex-direction:column;align-items:center;gap:15px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                        </svg>
                        <div>No hay vista previa disponible para este tipo de archivo</div>
                        <div style="font-size:0.8rem;">${att.name || 'Archivo'} (${att.size || 'Desconocido'})</div>
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

