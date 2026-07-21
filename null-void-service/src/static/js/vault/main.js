// Vault Client Logic

const SALT_SIZE = 16;
const IV_SIZE = 16;
const ITERATIONS = 100000;

function encodeStr(str) { return new TextEncoder().encode(str); }
function decodeStr(bytes) { return new TextDecoder().decode(bytes); }

async function getMasterKey(password, salt) {
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", encodeStr(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
    );
    return await window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

async function encryptVault(dataObj, password) {
    const dataStr = JSON.stringify(dataObj);
    const dataBytes = encodeStr(dataStr);
    
    const salt = window.crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const key = await getMasterKey(password, salt);
    
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv }, key, dataBytes
    );
    
    const finalBlob = new Uint8Array(SALT_SIZE + IV_SIZE + ciphertext.byteLength);
    finalBlob.set(salt, 0);
    finalBlob.set(iv, SALT_SIZE);
    finalBlob.set(new Uint8Array(ciphertext), SALT_SIZE + IV_SIZE);
    
    const base64Blob = arrayBufferToBase64(finalBlob.buffer);
    const jsonStr = JSON.stringify({
        vault_version: "2.0",
        encryption_type: "AES-256-GCM / PBKDF2",
        datos_cifrados: base64Blob
    }, null, 4);
    
    return jsonStr;
}

async function decryptVault(jsonContent, password) {
    let base64Blob = "";
    try {
        const parsed = JSON.parse(jsonContent);
        base64Blob = parsed.datos_cifrados;
    } catch (e) {
        throw new Error("Formato de archivo inválido");
    }
    
    const buffer = base64ToArrayBuffer(base64Blob);
    const view = new Uint8Array(buffer);
    if (view.length < SALT_SIZE + IV_SIZE) throw new Error("Archivo corrupto");
    
    const salt = view.slice(0, SALT_SIZE);
    const iv = view.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
    const ciphertext = view.slice(SALT_SIZE + IV_SIZE);
    
    const key = await getMasterKey(password, salt);
    
    try {
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, key, ciphertext
        );
        const dataStr = decodeStr(decrypted);
        return JSON.parse(dataStr);
    } catch (e) {
        throw new Error("Contraseña incorrecta");
    }
}

let currentVaultFile = null;
let vaultKey = null;
let vaultData = { passwords: [], notes: [] };
let editingIndex = -1;
let editingNoteIndex = -1;

// --- Custom UI Overrides ---
function NV_Alert(msg) {
    document.getElementById('nv-alert-msg').innerText = msg;
    document.getElementById('nv-alert-modal').style.display = 'flex';
}
window.closeNVAlert = function() {
    document.getElementById('nv-alert-modal').style.display = 'none';
}

function NV_Prompt(msg, defaultVal = '') {
    return new Promise(resolve => {
        document.getElementById('nv-prompt-msg').innerText = msg;
        const input = document.getElementById('nv-prompt-input');
        input.value = defaultVal;
        document.getElementById('nv-prompt-modal').style.display = 'flex';
        input.focus();
        
        window.promptResolver = resolve;
    });
}
window.closeNVPrompt = function(val) {
    document.getElementById('nv-prompt-modal').style.display = 'none';
    if (window.promptResolver) {
        window.promptResolver(val);
        window.promptResolver = null;
    }
}
window.submitNVPrompt = function() {
    closeNVPrompt(document.getElementById('nv-prompt-input').value);
}
// ---------------------------

window.addEventListener('DOMContentLoaded', () => {
    loadVaults();
});

async function loadVaults() {
    try {
        const response = await fetch('/api/vault/list');
        const data = await response.json();
        
        if (response.ok) {
            renderExplorer(data.vaults);
        } else {
            console.error(data.error);
        }
    } catch (e) {
        console.error("Error loading vaults", e);
    }
}

function renderExplorer(vaults) {
    showExplorer();
    const list = document.getElementById('vault-explorer-list');
    list.innerHTML = '';
    
    if (vaults.length === 0) {
        list.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 40px;">No tienes archivos cifrados. Crea uno nuevo.</div>';
        return;
    }
    
    vaults.forEach(v => {
        const el = document.createElement('div');
        el.className = 'vault-explorer-item';
        el.onclick = () => selectVault(v.filename);
        el.innerHTML = `
            <svg width="64" height="64" viewBox="0 0 24 24" fill="var(--vault-border)" stroke="var(--vault-text)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.8;">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <div class="name">${escapeHtml(v.filename)}</div>
        `;
        list.appendChild(el);
    });
}

function showExplorer() {
    document.getElementById('vault-explorer').classList.remove('hidden');
    document.getElementById('vault-auth-container').classList.add('hidden');
    document.getElementById('vault-dashboard').classList.add('hidden');
    currentVaultFile = null;
    vaultKey = null;
    vaultData = { passwords: [], notes: [] };
}

function selectVault(filename) {
    currentVaultFile = filename;
    document.getElementById('vault-explorer').classList.add('hidden');
    document.getElementById('vault-auth-container').classList.remove('hidden');
    document.getElementById('vault-dashboard').classList.add('hidden');
    
    document.getElementById('vault-auth-screen').dataset.isInit = 'false';
    document.getElementById('auth-title').innerText = `Desbloquear ${filename}`;
    document.getElementById('vault-master-pwd').value = '';
    document.getElementById('vault-master-pwd').focus();
}

function lockVault() {
    showExplorer();
}

function toggleSidebar() {
    const layout = document.querySelector('.app-layout');
    layout.classList.toggle('sidebar-collapsed');
}

function toggleUserMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('user-menu');
    menu.classList.toggle('show');
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    const btn = document.getElementById('sidebar-footer-btn');
    if (menu && menu.classList.contains('show') && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('show');
    }
});

async function uploadVaultFile(inputElement) {
    if (!inputElement.files || inputElement.files.length === 0) return;
    
    const file = inputElement.files[0];
    let filename = await NV_Prompt("¿Qué nombre quieres darle a este archivo en el servidor?", file.name);
    if (!filename) {
        inputElement.value = "";
        return;
    }
    if (!filename.endsWith('.enc')) filename += '.enc';
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', filename);
    
    try {
        const response = await fetch('/api/vault/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        if (response.ok) {
            NV_Alert("Archivo importado correctamente. Por favor recarga e introduce tu contraseña.");
            location.reload();
        } else {
            NV_Alert(result.error || "Error al subir el archivo.");
        }
    } catch (e) {
        console.error(e);
        NV_Alert("Error de red al subir el archivo.");
    }
    
    inputElement.value = "";
}

async function createNewVault() {
    const filename = await NV_Prompt("Introduce un nombre para tu nuevo archivo cifrado (ej: Personal.enc):");
    if (!filename) return;
    
    const pwd = await NV_Prompt(`Introduce una contraseña maestra para ${filename}:`);
    if (!pwd) return;
    
    try {
        const emptyData = { passwords: [], notes: [] };
        const fileContent = await encryptVault(emptyData, pwd);
        
        const response = await fetch('/api/vault/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename, file_content: fileContent })
        });
        
        if (response.ok) {
            NV_Alert("Nuevo archivo cifrado creado con éxito.");
            location.reload();
        } else {
            const result = await response.json();
            NV_Alert(result.error || "Error al crear el Vault.");
        }
    } catch (e) {
        console.error(e);
        NV_Alert("Error de conexión al crear.");
    }
}

async function unlockVault() {
    const pwdInput = document.getElementById('vault-master-pwd');
    const pwd = pwdInput.value.trim();
    
    if (!pwd) {
        NV_Alert("Introduce tu contraseña maestra.");
        return;
    }
    
    try {
        const isInit = document.getElementById('vault-auth-screen').dataset.isInit === "true";
        const endpoint = isInit ? '/api/vault/init' : '/api/vault/unlock';
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: currentVaultFile })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            try {
                let decryptedData = { passwords: [], notes: [] };
                if (!isInit) {
                    decryptedData = await decryptVault(result.file_content, pwd);
                }
                
                vaultKey = pwd;
                vaultData = decryptedData;
                
                document.getElementById('vault-auth-container').classList.add('hidden');
                document.getElementById('vault-dashboard').classList.remove('hidden');
                renderVault();
            } catch (decErr) {
                NV_Alert(decErr.message);
            }
        } else {
            NV_Alert(result.error || "Error al descargar el vault.");
        }
    } catch (e) {
        console.error(e);
        NV_Alert("Error de conexión.");
    }
}

async function syncVault() {
    if (!vaultKey) return;
    
    try {
        const fileContent = await encryptVault(vaultData, vaultKey);
        
        const response = await fetch('/api/vault/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: currentVaultFile, file_content: fileContent })
        });
        
        const result = await response.json();
        if (!response.ok) {
            NV_Alert(result.error || "Error al sincronizar.");
        }
    } catch (e) {
        console.error(e);
        NV_Alert("Error de conexión al sincronizar.");
    }
}

function renderVault() {
    const list = document.getElementById('vault-list');
    list.innerHTML = '';
    
    const hasPasswords = vaultData.passwords && vaultData.passwords.length > 0;
    const hasNotes = vaultData.notes && vaultData.notes.length > 0;
    
    if (!hasPasswords && !hasNotes) {
        list.innerHTML = '<div style="text-align: center; color: var(--vault-text-dim); padding: 40px;">El Vault está vacío.</div>';
        return;
    }
    
    if (hasPasswords) {
        // Group by category/site
        const groups = {};
        vaultData.passwords.forEach((item, index) => {
            const cat = item.category || 'General';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({ item, index });
        });
        
        // Render groups
        Object.keys(groups).sort().forEach(cat => {
            const catHeader = document.createElement('h3');
            catHeader.style.marginTop = '24px';
            catHeader.style.marginBottom = '12px';
            catHeader.style.color = 'var(--vault-primary)';
            catHeader.innerText = cat;
            list.appendChild(catHeader);
            
            groups[cat].forEach(entry => {
                const { item, index } = entry;
                const el = document.createElement('div');
                el.className = 'vault-item';
                
                // Migration logic for old structure
                let fields = item.fields;
                if (!fields) {
                    fields = [];
                    if (item.username) {
                        fields.push({ name: 'Usuario', value: item.username, isSecret: false });
                        delete item.username;
                    }
                    if (item.password) {
                        fields.push({ name: 'Contraseña', value: item.password, isSecret: true });
                        delete item.password;
                    }
                    item.fields = fields;
                }
                
                let fieldsHtml = fields.map((f, fIdx) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-top: 1px solid var(--border); margin-top: 6px;">
                        <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden;">
                            <span style="font-size: 0.75rem; color: var(--vault-text-dim); text-transform: uppercase; font-weight: bold;">${escapeHtml(f.name)}</span>
                            <span style="font-size: 0.9rem; color: var(--text); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                ${f.isSecret ? '••••••••' : escapeHtml(f.value)}
                            </span>
                        </div>
                        <button class="vault-btn" onclick="copyField(${index}, ${fIdx})" title="Copiar" style="padding: 4px 8px; flex-shrink: 0; margin-left: 12px; font-size: 0.8rem;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Copiar
                        </button>
                    </div>
                `).join('');
                
                el.innerHTML = `
                    <div class="vault-item-info" style="width: 100%;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div class="vault-item-actions">
                                <button class="vault-btn" onclick="openModal(${index})" title="Editar">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                </button>
                                <button class="vault-btn danger" onclick="deleteEntry(${index})" title="Borrar">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                            </div>
                        </div>
                        ${fieldsHtml}
                    </div>
                `;
                list.appendChild(el);
            });
        });
    }
    
    // Add legacy notes if any
    if (vaultData.notes && vaultData.notes.length > 0) {
        const notesHeader = document.createElement('h3');
        notesHeader.style.marginTop = '24px';
        notesHeader.style.marginBottom = '12px';
        notesHeader.innerText = 'Notas / Archivo Original';
        list.appendChild(notesHeader);
        
        vaultData.notes.forEach((note, index) => {
            const el = document.createElement('div');
            el.className = 'vault-item';
            el.style.flexDirection = 'column';
            el.style.alignItems = 'flex-start';
            
            el.innerHTML = `
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; margin-bottom: 8px;">
                    <div class="vault-item-title">${escapeHtml(note.title)}</div>
                    <div class="vault-item-actions">
                        <button class="vault-btn" onclick="openNoteModal(${index})" title="Editar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="vault-btn danger" onclick="deleteNote(${index})" title="Borrar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
                <pre style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; width: 100%; white-space: pre-wrap; font-size: 0.9rem; margin: 0; color: var(--vault-text-dim);">${escapeHtml(note.content)}</pre>
            `;
            list.appendChild(el);
        });
    }
}

function copyField(entryIndex, fieldIndex) {
    const item = vaultData.passwords[entryIndex];
    if (!item || !item.fields || !item.fields[fieldIndex]) return;
    
    navigator.clipboard.writeText(item.fields[fieldIndex].value).then(() => {
        // feedback visual
    }).catch(err => {
        console.error('Error al copiar', err);
        NV_Alert("No se pudo copiar al portapapeles.");
    });
}

function updateCategorySelect() {
    const sel = document.getElementById('entry-category');
    if (!sel) return;
    sel.innerHTML = '';
    const cats = vaultData.categories || ['General'];
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        sel.appendChild(opt);
    });
}

async function createNewCategory() {
    const cat = await NV_Prompt("Nombre del nuevo sitio/categoría (ej. Amazon):");
    if (cat && cat.trim()) {
        const cleanCat = cat.trim();
        if (!vaultData.categories) vaultData.categories = ['General'];
        if (!vaultData.categories.includes(cleanCat)) {
            vaultData.categories.push(cleanCat);
            syncVault(); // save it
        }
        updateCategorySelect();
        document.getElementById('entry-category').value = cleanCat;
    }
}

function openModal(index = -1) {
    editingIndex = index;
    const modal = document.getElementById('vault-modal');
    
    updateCategorySelect();
    
    const catObj = document.getElementById('entry-category');
    const uObj = document.getElementById('entry-usuario');
    const cObj = document.getElementById('entry-correo');
    const pObj = document.getElementById('entry-pwd');
    
    // reset
    uObj.value = '';
    cObj.value = '';
    pObj.value = '';
    document.getElementById('eye-btn').innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    pObj.type = 'password';
    
    if (index >= 0) {
        document.getElementById('modal-title').innerText = 'Editar Registro';
        const item = vaultData.passwords[index];
        catObj.value = item.category || 'General';
        
        const fields = item.fields || [];
        fields.forEach(f => {
            if (f.name.toLowerCase() === 'usuario') uObj.value = f.value;
            else if (f.name.toLowerCase() === 'correo') cObj.value = f.value;
            else if (f.name.toLowerCase() === 'contraseña') pObj.value = f.value;
        });
    } else {
        document.getElementById('modal-title').innerText = 'Nuevo Registro';
        if (vaultData.categories && vaultData.categories.length > 0) {
            catObj.value = vaultData.categories[0];
        }
    }
    
    modal.style.display = 'flex';
}

function togglePwdEye() {
    const input = document.getElementById('entry-pwd');
    const btn = document.getElementById('eye-btn');
    const isSecret = input.type === 'password';
    
    input.type = isSecret ? 'text' : 'password';
    
    const eyeIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeOffIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    
    btn.innerHTML = isSecret ? eyeOffIcon : eyeIcon;
}

function closeModal() {
    document.getElementById('vault-modal').style.display = 'none';
}

function saveEntry() {
    const cat = document.getElementById('entry-category').value;
    
    const u = document.getElementById('entry-usuario').value.trim();
    const c = document.getElementById('entry-correo').value.trim();
    const p = document.getElementById('entry-pwd').value.trim();
    
    if (!u && !c && !p) {
        NV_Alert("Debes rellenar al menos un campo.");
        return;
    }
    
    const fields = [];
    if (u) fields.push({ name: 'Usuario', value: u, isSecret: false });
    if (c) fields.push({ name: 'Correo', value: c, isSecret: false });
    if (p) fields.push({ name: 'Contraseña', value: p, isSecret: true });
    
    const newItem = {
        category: cat,
        fields: fields
    };
    
    if (editingIndex >= 0) {
        vaultData.passwords[editingIndex] = newItem;
    } else {
        vaultData.passwords.push(newItem);
    }
    
    closeModal();
    renderVault();
    syncVault();
}

// -- Notes Logic --

function openNoteModal(index = -1) {
    editingIndex = index;
    const modal = document.getElementById('note-modal');
    
    if (index >= 0) {
        const item = vaultData.notes[index];
        document.getElementById('note-title').value = item.title || '';
        document.getElementById('note-content').value = item.content || '';
        document.getElementById('note-modal-title').innerText = 'Editar Nota';
    } else {
        document.getElementById('note-title').value = '';
        document.getElementById('note-content').value = '';
        document.getElementById('note-modal-title').innerText = 'Nueva Nota';
    }
    
    modal.style.display = 'flex';
}

function closeNoteModal() {
    document.getElementById('note-modal').style.display = 'none';
}

async function saveNote() {
    const title = document.getElementById('note-title').value.trim();
    const content = document.getElementById('note-content').value;
    
    if (!title) {
        NV_Alert("El título de la nota es obligatorio.");
        return;
    }
    
    if (editingIndex >= 0) {
        vaultData.notes[editingIndex] = { title, content };
    } else {
        if (!vaultData.notes) vaultData.notes = [];
        vaultData.notes.push({ title, content });
    }
    
    closeNoteModal();
    renderVault();
    syncVault();
}

function deleteNote(index) {
    if(!confirm("¿Estás seguro de que deseas borrar esta nota?")) return;
    vaultData.notes.splice(index, 1);
    renderVault();
    syncVault();
}

async function deleteEntry(index) {
    if (confirm("¿Estás seguro de que quieres borrar esta contraseña?")) {
        vaultData.passwords.splice(index, 1);
        renderVault();
        await syncVault();
    }
}

function lockVault() {
    vaultKey = null;
    vaultData = { passwords: [], notes: [] };
    document.getElementById('vault-master-pwd').value = '';
    document.getElementById('vault-dashboard').classList.add('hidden');
    document.getElementById('vault-auth-screen').classList.remove('hidden');
}

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Handle enter key on auth
document.addEventListener('DOMContentLoaded', () => {
    const pwdInput = document.getElementById('vault-master-pwd');
    if (pwdInput) {
        pwdInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                unlockVault();
            }
        });
    }
});
