import { NV_Alert } from './ui.js';

let _pendingAvatarFile = null;
let _offsetX = 0, _offsetY = 0;
let _isDragging = false;
let _startX, _startY;

function openAvatarPicker() {
    document.getElementById('modal-avatar-picker').classList.add('show');
}

function closeAvatarPicker() {
    document.getElementById('modal-avatar-picker').classList.remove('show');
}

function openAvatarEditor(imgSrc) {
    const img = document.getElementById('em-image');
    img.src = imgSrc;
    img.onload = () => {
        const D = 200;
        const baseScale = Math.min(460 / img.naturalWidth, 260 / img.naturalHeight);
        img.width = img.naturalWidth * baseScale;
        img.height = img.naturalHeight * baseScale;
        const minZoom = Math.max(D / img.width, D / img.height);
        const slider = document.getElementById('em-zoom');
        slider.min = minZoom;
        slider.value = minZoom;
        _offsetX = 0; _offsetY = 0;
        img.style.transform = `scale(${minZoom})`;
        document.querySelector('.em-circle').style.transform = `translate(0,0)`;
    };
    document.getElementById('modal-avatar-editor').classList.add('show');
}

function closeAvatarEditor() {
    document.getElementById('modal-avatar-editor').classList.remove('show');
}

async function _checkAvatar() {
    const userId = window.CURRENT_USER_ID || window.CURRENT_USER;
    const imgUrl = `/api/system/user/avatar/${userId}?v=${Date.now()}`;

    try {
        const res = await fetch(imgUrl);

        const avatarEl = document.getElementById('nav-avatar');
        const avatarLarge = document.getElementById('nav-avatar-large');
        const cfgAvatar = document.getElementById('cfg-avatar-display');

        const elements = [
            { el: avatarEl, size: 'small' },
            { el: avatarLarge, size: 'large' },
            { el: cfgAvatar, size: 'cfg' }
        ];

        if (res.status === 200) {
            const preload = new Image();

            preload.onload = () => {
                elements.forEach(item => {
                    if (!item.el) return;

                    if (item.size === 'cfg') {
                        item.el.innerHTML = `
                            <img src="${imgUrl}" alt="Avatar">
                            <div class="avatar-overlay">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                                    <circle cx="12" cy="13" r="4"></circle>
                                </svg>
                            </div>
                        `;
                    } else {
                        item.el.innerHTML = `<img src="${imgUrl}" alt="Avatar">`;
                    }
                });
            };

            preload.onerror = () => {
                console.warn("Failed to preload avatar image");
            };

            preload.src = imgUrl;
        } else {
            const usernameEl = document.getElementById('nav-username');
            const fallbackChar =
                usernameEl?.textContent?.charAt(0).toUpperCase() || 'U';

            elements.forEach(item => {
                if (!item.el) return;

                item.el.innerHTML = `<span>${fallbackChar}</span>`;

                if (item.size === 'cfg') {
                    item.el.innerHTML += `
                        <div class="avatar-overlay">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                                <circle cx="12" cy="13" r="4"></circle>
                            </svg>
                        </div>
                    `;
                }
            });
        }
    } catch (err) {
        console.error("Error checking avatar:", err);
    }
}


function _applyConstraints() {
    const img = document.getElementById('em-image');
    const circle = document.querySelector('.em-circle');
    if (!img) return;
    const zoom = document.getElementById('em-zoom').value;
    const D = 200;
    const W_z = (img.width || img.offsetWidth) * zoom;
    const H_z = (img.height || img.offsetHeight) * zoom;
    const limitX = Math.max(0, (W_z - D) / 2);
    const limitY = Math.max(0, (H_z - D) / 2);
    _offsetX = Math.max(-limitX, Math.min(limitX, _offsetX));
    _offsetY = Math.max(-limitY, Math.min(limitY, _offsetY));
    img.style.transform = `scale(${zoom})`;
    if (circle) circle.style.transform = `translate(${_offsetX}px, ${_offsetY}px)`;
}

function switchCfgTab(tabId) {
    document.querySelectorAll('.cfg-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cfg-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.cfg-tab').forEach(t => {
        if (t.getAttribute('onclick').includes(`'${tabId}'`)) {
            t.classList.add('active');
        }
    });
    const pane = document.getElementById('tab-' + tabId);
    if (pane) pane.classList.add('active');
}

function resetSettings() {
    _pendingAvatarFile = null;
    document.getElementById('settings-save-bar')?.classList.remove('show');
    const userEdit = document.getElementById('cfg-username-edit');
    if (userEdit) userEdit.value = window.CURRENT_USER;
    const fileInput = document.getElementById('avatar-upload-cfg');
    if (fileInput) fileInput.value = '';
    _checkAvatar();
}

async function saveSettings() {
    const userEdit = document.getElementById('cfg-username-edit');
    const t = window.t_dash || (k => k);
    try {
        const profileRes = await fetch('/api/system/user/update', {
            method: 'POST',
            headers: { ...window.HEADERS, 'X-Token': window.TOKEN },
            body: JSON.stringify({ username: userEdit.value })
        });
        const profileData = await profileRes.json();
        if (!profileData.ok) {
            await NV_Alert(profileData.error || t('err_update_profile'), t('sys_notice'));
            return;
        }
        if (_pendingAvatarFile) {
            const formData = new FormData();
            formData.append('avatar', _pendingAvatarFile);
            await fetch('/api/system/user/avatar/upload', {
                method: 'POST', headers: { 'X-Token': window.TOKEN }, body: formData
            });
            _pendingAvatarFile = null;
        }
        const userStatic = document.getElementById('cfg-username-field-static');
        if (userStatic) userStatic.value = userEdit.value;
        document.getElementById('settings-save-bar').classList.remove('show');
        _checkAvatar();
        if (userEdit.value !== window.CURRENT_USER) {
            location.reload();
        }
    } catch (err) {
        console.error("Error saving settings:", err);
        await NV_Alert(t('err_conn_save'), "Error");
    }
}

function checkPendingChanges() {
    const userEdit = document.getElementById('cfg-username-edit');
    const emailStatic = document.getElementById('cfg-email-field-static');
    if (userEdit && emailStatic) {
        const val = userEdit.value.trim() || window.CURRENT_USER;
        emailStatic.value = `${val}@nullvoid`;
    }
    const hasUserChange = userEdit && userEdit.value.trim() !== window.CURRENT_USER && userEdit.value.trim() !== '';
    if (hasUserChange || _pendingAvatarFile) {
        document.getElementById('settings-save-bar')?.classList.add('show');
    } else {
        document.getElementById('settings-save-bar')?.classList.remove('show');
    }
}

function openPasswordModal() {
    document.getElementById('modal-password-change').classList.add('show');
}

function closePasswordModal() {
    document.getElementById('modal-password-change').classList.remove('show');
}

async function confirmPasswordChange() {
    const t = window.t_dash || (k => k);
    const isModal = document.getElementById('modal-password-change').classList.contains('show');
    const prefix = isModal ? '' : 'cfg-';
    const oldPass = document.getElementById(prefix + 'old-pass').value;
    const newPass = document.getElementById(prefix + 'new-pass').value;
    const confPass = document.getElementById(prefix + 'conf-pass').value;
    const msgEl = document.getElementById(isModal ? 'modal-pass-msg' : 'cfg-pass-msg');
    const showMsg = (text, type) => {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.className = 'cfg-msg-area ' + type;
        if (type === 'success') setTimeout(() => { msgEl.textContent = ''; }, 3000);
    };
    if (!oldPass || !newPass) {
        showMsg("⚠ " + t('err_fill_fields'), "error");
        return;
    }
    if (newPass !== confPass) {
        showMsg("⚠ " + t('err_pass_match'), "error");
        return;
    }
    if (newPass.length < 8) {
        showMsg("⚠ " + t('err_pass_length'), "error");
        return;
    }
    if (newPass === oldPass) {
        showMsg("⚠ " + t('err_pass_same'), "error");
        return;
    }
    try {
        const res = await fetch('/api/system/user/password', {
            method: 'POST',
            headers: { ...window.HEADERS, 'X-Token': window.TOKEN },
            body: JSON.stringify({ old_password: oldPass, new_password: newPass })
        });
        const data = await res.json();
        if (data.ok) {
            showMsg("✓ " + t('success_pass_update'), "success");
            document.getElementById(prefix + 'old-pass').value = '';
            document.getElementById(prefix + 'new-pass').value = '';
            document.getElementById(prefix + 'conf-pass').value = '';
        } else {
            showMsg("⚠ " + (data.error || "Error"), "error");
        }
    } catch (err) {
        showMsg("⚠ " + t('err_conn'), "error");
    }
}

function togglePassword(id) {
    const el = document.getElementById(id);
    if (el) {
        el.type = el.type === 'password' ? 'text' : 'password';
    }
}

function showSessions() {
    const t = window.t_dash || (k => k);
    const ua = navigator.userAgent;
    let os = "Unknown OS";
    if (/android/i.test(ua)) os = "Android";
    else if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) os = "iOS";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Linux/.test(ua)) os = "Linux";

    let browser = "Browser";
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";

    const currentStr = `\n- ${os} / ${browser} (${t('sess_current')})`;
    NV_Alert(`${t('sess_active')}${currentStr}`, t('sess_mng'));
}

export function initSettings() {
    const userEl = document.getElementById('nav-username');
    const avatarEl = document.getElementById('nav-avatar');
    const userDisplay = window.CURRENT_USER || "Usuario";
    if (userEl) userEl.textContent = userDisplay;
    if (avatarEl) avatarEl.innerHTML = `<span>${userDisplay.charAt(0).toUpperCase()}</span>`;
    const avatarLarge = document.getElementById('nav-avatar-large');
    if (avatarLarge) avatarLarge.textContent = userDisplay.charAt(0).toUpperCase();
    const cfgAvatar = document.getElementById('cfg-avatar-display');
    if (cfgAvatar) {
        const overlay = cfgAvatar.querySelector('.avatar-overlay');
        cfgAvatar.innerHTML = `<span>${userDisplay.charAt(0).toUpperCase()}</span>`;
        if (overlay) cfgAvatar.appendChild(overlay);
    }

    const ua = navigator.userAgent;
    let os = "Unknown OS";
    if (/android/i.test(ua)) os = "Android";
    else if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) os = "iOS";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Linux/.test(ua)) os = "Linux";

    let browser = "Browser";
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";

    const sessInfo = document.getElementById('cfg-current-session-info');
    if (sessInfo) sessInfo.textContent = `${os} / ${browser}`;

    const saveBar = document.getElementById('settings-save-bar');
    if (saveBar) saveBar.classList.remove('show');
    const profileTrigger = document.getElementById('profile-trigger');
    const profileDropdown = document.getElementById('profile-dropdown');
    _checkAvatar();
    profileTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown?.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
        if (!profileTrigger?.contains(e.target)) {
            profileDropdown?.classList.remove('show');
        }
    });
    const avatarInput = document.getElementById('avatar-upload-cfg');
    avatarInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            closeAvatarPicker();
            openAvatarEditor(event.target.result);
        };
        reader.readAsDataURL(file);
    });
    const img = document.getElementById('em-image');
    const circle = document.querySelector('.em-circle');
    document.getElementById('em-zoom')?.addEventListener('input', _applyConstraints);
    circle?.addEventListener('mousedown', (e) => {
        _isDragging = true;
        _startX = e.clientX - _offsetX;
        _startY = e.clientY - _offsetY;
        circle.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!_isDragging) return;
        _offsetX = (e.clientX - _startX);
        _offsetY = (e.clientY - _startY);
        _applyConstraints();
    });
    window.addEventListener('mouseup', () => {
        _isDragging = false;
        circle.style.cursor = 'move';
    });
    document.getElementById('em-apply')?.addEventListener('click', async () => {
        const img = document.getElementById('em-image');
        if (!img || !img.src) return;

        const zoom = document.getElementById('em-zoom').value;
        const baseScale = img.width / img.naturalWidth;
        const scaleTotal = baseScale * zoom;

        // Calculate center and radius in original image coordinates
        const cx = (img.naturalWidth / 2) + (_offsetX / scaleTotal);
        const cy = (img.naturalHeight / 2) + (_offsetY / scaleTotal);
        const r = 100 / scaleTotal;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Draw cropped area
        ctx.drawImage(
            img,
            cx - r, cy - r, r * 2, r * 2,
            0, 0, 256, 256
        );

        canvas.toBlob((blob) => {
            if (!blob) return;
            _pendingAvatarFile = new File([blob], "avatar.png", { type: "image/png" });

            const cfgAvatar = document.getElementById('cfg-avatar-display');
            if (cfgAvatar) {
                cfgAvatar.innerHTML = `<img src="${canvas.toDataURL()}" alt=""> <div class="avatar-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg></div>`;
            }

            closeAvatarEditor();
            checkPendingChanges();
        }, "image/png");
    });
    document.getElementById('cfg-username-edit')?.addEventListener('input', checkPendingChanges);
    document.getElementById('btn-logout')?.addEventListener('click', window.handleLogout);
    document.getElementById('btn-logout-dropdown')?.addEventListener('click', window.handleLogout);
}

window.m_openAvatarPicker = openAvatarPicker;
window.m_closeAvatarPicker = closeAvatarPicker;
window.m_openAvatarEditor = openAvatarEditor;
window.m_closeAvatarEditor = closeAvatarEditor;
window.m_switchCfgTab = switchCfgTab;
window.m_closePasswordModal = closePasswordModal;

window.resetSettings = resetSettings;
window.saveSettings = saveSettings;
window.checkPendingChanges = checkPendingChanges;
window.openPasswordModal = openPasswordModal;
window.confirmPasswordChange = confirmPasswordChange;
window.togglePassword = togglePassword;
window.showSessions = showSessions;
