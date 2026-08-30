import { NV_Alert } from '../dashboard/ui.js';
import { _cloudJson, _tServerErr } from './api.js';
import { esc, jsStr } from '../core/dom.js';

let linkDevicePollInterval = null;
let _currentLinkDeviceOS = 'linux';
let _linkDeviceCurrentOS = 'linux';
let _agentDownloading = false;
let _currentLinkDeviceToken = null;
let _existingDevicesAtOpen = new Set();
let _tokenTimerInterval = null;

async function downloadClientAgent() {
    if (_agentDownloading) return;
    _agentDownloading = true;
    const modal = document.getElementById('cloud-link-device-modal');
    const useToast = !modal || modal.style.display === 'none';
    const btn = document.getElementById('btn-download-agent');
    const originalLabel = btn ? btn.innerHTML : '';
    const setBtnBusy = (busy) => {
        if (!btn) return;
        btn.style.pointerEvents = busy ? 'none' : '';
        btn.style.opacity = busy ? '0.7' : '';
        btn.disabled = busy;
        btn.innerHTML = busy
            ? '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;border-radius:50%;animation:cloud-spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Descargando Agente...'
            : originalLabel;
    };
    const showToast = (msg) => {
        if (useToast) window.showCloudProgressToast(msg);
    };
    const toastSuccess = () => {
        const toast = document.getElementById('cloud-progress-toast');
        const textEl = toast && toast.querySelector('.cloud-toast-text');
        if (toast) {
            const spinner = toast.querySelector('.cloud-toast-spinner');
            if (spinner) spinner.style.display = 'none';
            if (textEl) textEl.innerText = window.currentLang === "en" ? 'Download started ✓' : 'Descarga iniciada ✓';
            toast.style.animation = 'none';
            setTimeout(() => {
                toast.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => { toast.style.display = 'none'; }, 300);
            }, 2200);
        }
    };

    setBtnBusy(true);
    showToast(window.currentLang === "en" ? "Preparing agent download..." : "Descargando Agente Base...");

    let res = null;
    try {
        res = await fetch('/api/cloud/sync-agent/download-client', { headers: window.HEADERS, cache: 'no-store' });
    } catch (e) {
        console.error('downloadClientAgent fetch error', e);
        res = null;
    }
    if (!res || !res.ok) {
        let msg = res && res.status === 403 ? (window.currentLang === 'en' ? 'The download is only available over HTTPS. Access via https:// and retry.' : 'La descarga solo está disponible por HTTPS. Entra con https:// y reintenta.') : (window.currentLang === 'en' ? 'Could not prepare the download.' : 'No se pudo preparar la descarga.');
        try {
            const data = res && await res.json();
            if (data && data.error) msg = _tServerErr(data.error);
        } catch (e) { }
        window.hideCloudProgressToast();
        setBtnBusy(false);
        _agentDownloading = false;
        await NV_Alert(msg);
        return;
    }
    try {
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="?([^";]+)"?/);
        const name = m ? m[1] : (navigator.userAgent.includes('Win') ? 'Null-Void-Agent.exe' : 'Null-Void-Agent-Linux');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setBtnBusy(false);
        _agentDownloading = false;
        if (useToast) {
            toastSuccess();
        }
    } catch (e) {
        console.error('downloadClientAgent blob error', e);
        window.hideCloudProgressToast();
        setBtnBusy(false);
        _agentDownloading = false;
        window.location.href = '/api/cloud/sync-agent/download-client';
    }
}

async function openLinkDeviceModal() {
    const modal = document.getElementById('cloud-link-device-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('sync-command-text').innerText = 'Generando token seguro...';
        _existingDevicesAtOpen = new Set();
        try {
            const devRes = await fetch('/api/cloud/files?view=computers', { headers: window.HEADERS });
            if (devRes.ok) {
                const devData = await _cloudJson(devRes);
                (devData.files || []).forEach(f => _existingDevicesAtOpen.add(f.name));
            }
        } catch (e) { }
        try {
            const res = await fetch('/api/cloud/sync-agent/generate-token', {
                method: 'POST',
                headers: window.HEADERS
            });
            if (res.ok) {
                const data = await _cloudJson(res);
                _currentLinkDeviceToken = data.temp_token;
            }
        } catch (e) { console.error("Error al generar token del agente", e); }
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('win')) {
            _currentLinkDeviceOS = 'windows';
        } else {
            _currentLinkDeviceOS = 'linux';
        }
        _linkDeviceCurrentOS = _currentLinkDeviceOS;

        setLinkDeviceOS(_currentLinkDeviceOS);
        if (linkDevicePollInterval) clearInterval(linkDevicePollInterval);
        linkDevicePollInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/cloud/files?view=computers', { headers: window.HEADERS });
                if (res.ok) {
                    const data = await _cloudJson(res);
                    const files = data.files || [];
                    const newDevice = files.find(f => f.active && !_existingDevicesAtOpen.has(f.name));
                    if (newDevice) {
                        clearInterval(linkDevicePollInterval);
                        linkDevicePollInterval = null;
                        closeLinkDeviceModal();
                        await window.fetchCloudFiles(newDevice.name, 'computers');
                        await NV_Alert(window.currentLang === "en" ? `Computer "${esc(newDevice.name)}" linked successfully.` : `Computadora "${esc(newDevice.name)}" vinculada con éxito.`);
                    }
                }
            } catch (err) { }
        }, 5000);
    }
}

function setLinkDeviceOS(os) {
    _currentLinkDeviceOS = os;
    const btns = ['os-btn-linux', 'os-btn-windows'];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isCurrent = id === `os-btn-${os}`;
        const isAllowed = (id === 'os-btn-linux' ? 'linux' : 'windows') === _linkDeviceCurrentOS;
        btn.style.background = isCurrent ? 'var(--indigo)' : 'transparent';
        btn.style.color = isCurrent ? '#fff' : 'var(--text-muted)';
        btn.style.fontWeight = isCurrent ? '700' : '500';
        btn.disabled = !isAllowed;
        btn.style.cursor = isAllowed ? 'pointer' : 'not-allowed';
        btn.style.opacity = isAllowed ? '1' : '0.4';
    });
    generateSyncCommand();
}

function closeLinkDeviceModal() {
    const modal = document.getElementById('cloud-link-device-modal');
    if (modal) modal.style.display = 'none';
    if (linkDevicePollInterval) {
        clearInterval(linkDevicePollInterval);
        linkDevicePollInterval = null;
    }
}

function generateSyncCommand() {
    const cmdText = document.getElementById('sync-command-text');
    if (!cmdText) return;

    if (!_currentLinkDeviceToken) {
        cmdText.innerText = "Error: no se pudo obtener token de seguridad.";
        return;
    }

    cmdText.innerText = _currentLinkDeviceToken;
}

function copySyncCommand() {

    const cmdText = document.getElementById('sync-command-text');
    if (!cmdText) return;

    navigator.clipboard.writeText(cmdText.innerText).then(() => {
        NV_Alert(window.t_cloud('link_modal_token_copied', 'Token copiado al portapapeles'));
    }).catch(err => {
        console.error("Error al copiar:", err);
    });
}

function copyInfoSyncCommand() {
    const cmdBox = document.getElementById('info-sync-cmd-box');
    if (!cmdBox) return;

    navigator.clipboard.writeText(cmdBox.innerText.trim()).then(() => {
        NV_Alert(window.t_cloud('link_modal_token_copied', 'Token copiado al portapapeles'));
    }).catch(err => {
        console.error("Error al copiar:", err);
    });
}

function showSyncInstructionsAlert(deviceName) {
    const cleanName = deviceName.replace('', '');
    const alertHtml = `
        <div style="text-align: left; line-height: 1.5; font-size: 0.9rem; color: #e2e8f0; font-family: sans-serif;">
            <div style="font-weight: 700; color: #fbbf24; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 1.05rem;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.55.63 2.89 1.63 3.82.64.6 1.33 2.18"></path></svg> Guía de Ejecución Permanente (nohup)
            </div>
            <p style="margin-bottom: 12px; color: #94a3b8; font-size: 0.85rem;">Si deseas que el Agente de Sincronización siga ejecutándose en tu ordenador incluso si cierras la ventana de tu terminal física, ejecútalo usando <b>nohup</b> en segundo plano:</p>
            <div style="position: relative; margin-bottom: 16px;">
                <pre id="adv-sync-cmd" style="background: rgba(0,0,0,0.4); padding: 12px; border-radius: 6px; font-family: monospace; font-size: 0.78rem; color: #818cf8; word-break: break-all; white-space: pre-wrap; border: 1px solid rgba(255,255,255,0.05); margin: 0; padding-right: 70px; min-height: 50px;">nohup python3 -c "$(curl -fsSLk '${window.location.origin}/api/cloud/sync-agent/script?device=${encodeURIComponent(cleanName)}')" &amp;</pre>
                <button onclick="navigator.clipboard.writeText(document.getElementById('adv-sync-cmd').innerText.trim()); NV_Alert('¡Comando avanzado copiado!');" style="position: absolute; right: 6px; top: 6px; padding: 4px 8px; border-radius: 4px; border: none; background: var(--indigo); color: #fff; font-size: 0.7rem; font-weight: 600; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">Copiar</button>
            </div>
            <div style="font-weight: 600; color: #ffffff; margin-bottom: 6px; font-size: 0.85rem;">Instrucciones rápidas:</div>
            <ol style="margin-left: 20px; padding: 0; color: #cbd5e1; font-size: 0.82rem; line-height: 1.6;">
                <li style="margin-bottom: 4px;">Copia el comando de arriba haciendo clic en "Copiar".</li>
                <li style="margin-bottom: 4px;">Pégalo en tu terminal física y presiona <b>Enter</b>.</li>
                <li>¡Listo! El agente se ejecutará en segundo plano permanentemente y los logs se guardarán en <code style="background:rgba(255,255,255,0.1); padding:2px 4px; border-radius:3px; font-family:monospace; font-size:0.75rem;">nohup.out</code>.</li>
            </ol>
        </div>
    `;
    NV_Alert(alertHtml);
}

async function handleGenerateLinkToken() {
    try {
        if (_tokenTimerInterval) clearInterval(_tokenTimerInterval);

        const pcName = window.currentCloudContextItem ? window.currentCloudContextItem.name : '';
        const res = await fetch('/api/cloud/sync-agent/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_device: pcName })
        });
        const data = await _cloudJson(res);
        if (res.ok && data.temp_token) {
            const introText = window.currentLang === 'en'
                ? `Enter this token in the desktop app to connect <b style="color: #e8edf8;">${pcName || 'your device'}</b>:`
                : `Introduce este token en la aplicación de escritorio para conectar <b style="color: #e8edf8;">${pcName || 'tu dispositivo'}</b>:`;
            const copyToast = window.currentLang === 'en' ? 'Token copied to clipboard' : 'Token copiado al portapapeles';

            let secondsLeft = data.remaining_seconds !== undefined ? Math.max(0, parseInt(data.remaining_seconds)) : 300;
            const initialMins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
            const initialSecs = String(secondsLeft % 60).padStart(2, '0');

            const msg = `
                <div style="text-align: center; padding: 4px 0;">
                    <p style="margin-bottom: 14px; font-size: 0.88rem; color: var(--text-muted, #8b95b0); line-height: 1.4;">
                        ${introText}
                    </p>
                    <div id="nv-token-box" style="font-family: monospace; font-size: 1.05rem; font-weight: 700; color: #a5b4fc; background: rgba(99, 102, 241, 0.12); border: 1px dashed rgba(99, 102, 241, 0.4); border-radius: 10px; padding: 12px 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: all; cursor: pointer; transition: all 0.3s ease;"
                         onmouseover="if(!this.dataset.expired){ this.style.background='rgba(99, 102, 241, 0.25)'; this.style.borderColor='#818cf8'; }"
                         onmouseout="if(!this.dataset.expired){ this.style.background='rgba(99, 102, 241, 0.12)'; this.style.borderColor='rgba(99, 102, 241, 0.4)'; }"
                         onclick="if(!this.dataset.expired){ navigator.clipboard.writeText('${jsStr(data.temp_token)}'); const alertToast = document.getElementById('nv-copy-toast'); if(alertToast){ alertToast.style.opacity='1'; setTimeout(()=>alertToast.style.opacity='0', 2000); } }">
                        <span id="nv-token-text">${esc(data.temp_token)}</span>
                    </div>
                    <div id="nv-copy-toast" style="opacity: 0; transition: opacity 0.3s; font-size: 0.78rem; color: #34d399; font-weight: 600; margin-top: 6px; height: 18px;">
                        ${copyToast}
                    </div>
                    <div id="nv-timer-badge" style="margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); padding: 5px 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); transition: all 0.3s ease;">
                        <svg id="nv-timer-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span id="nv-token-timer" style="font-size: 0.80rem; font-weight: 700; color: #818cf8; font-family: monospace;">${initialMins}:${initialSecs}</span>
                    </div>
                    <p id="nv-token-expiry-hint" style="margin-top: 10px; font-size: 0.78rem; color: #8b95b0; font-weight: 500; transition: color 0.3s ease;">
                        ${window.currentLang === 'en' ? 'Token expires in 5 minutes (one-time use).' : 'Este token es de un solo uso y expira en 5 minutos.'}
                    </p>
                </div>
            `;

            _tokenTimerInterval = setInterval(async () => {
                secondsLeft--;
                const timerEl = document.getElementById('nv-token-timer');
                const tokenBox = document.getElementById('nv-token-box');
                const expiryHint = document.getElementById('nv-token-expiry-hint');
                const timerIcon = document.getElementById('nv-timer-icon');

                const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
                const secs = String(secondsLeft % 60).padStart(2, '0');

                if (timerEl && secondsLeft >= 0) {
                    timerEl.innerText = `${mins}:${secs}`;
                }

                if ((secondsLeft % 2 === 0 && secondsLeft > 0) || secondsLeft === data.remaining_seconds) {
                    try {
                        const checkRes = await fetch('/api/cloud/sync-agent/check-token-status', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ temp_token: data.temp_token, target_device: pcName })
                        });
                        const checkData = await _cloudJson(checkRes);
                        if (checkData.used) {
                            if (_tokenTimerInterval) {
                                clearInterval(_tokenTimerInterval);
                                _tokenTimerInterval = null;
                            }

                            if (tokenBox) {
                                tokenBox.dataset.expired = 'true';
                                tokenBox.style.background = 'rgba(16, 185, 129, 0.12)';
                                tokenBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                                tokenBox.style.color = '#34d399';
                                tokenBox.style.cursor = 'default';
                            }
                            if (timerEl) {
                                timerEl.innerText = window.currentLang === 'en' ? 'Linked' : 'Vinculado';
                                timerEl.style.color = '#34d399';
                            }
                            if (timerIcon) {
                                timerIcon.setAttribute('stroke', '#34d399');
                            }
                            if (expiryHint) {
                                expiryHint.style.color = '#34d399';
                                expiryHint.style.fontWeight = '600';
                                const dName = checkData.device_name || pcName;
                                expiryHint.innerText = window.currentLang === 'en'
                                    ? `✔ Vinculado correctamente${dName ? ' (' + dName + ')' : ''}`
                                    : `✔ Vinculado correctamente${dName ? ' (' + dName + ')' : ''}`;
                            }
                            if (typeof window.fetchCloudFiles === 'function') {
                                window.fetchCloudFiles();
                            }
                            return;
                        }
                    } catch (e) { }
                }

                if (secondsLeft <= 0) {
                    clearInterval(_tokenTimerInterval);
                    _tokenTimerInterval = null;

                    if (timerEl) {
                        timerEl.innerText = '00:00';
                        timerEl.style.color = '#8b95b0';
                    }
                    if (timerIcon) {
                        timerIcon.setAttribute('stroke', '#8b95b0');
                    }
                    if (tokenBox) {
                        tokenBox.dataset.expired = 'true';
                        tokenBox.style.opacity = '0.45';
                        tokenBox.style.background = 'rgba(255, 255, 255, 0.04)';
                        tokenBox.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                        tokenBox.style.color = '#8b95b0';
                        tokenBox.style.cursor = 'default';
                    }
                    if (expiryHint) {
                        expiryHint.style.color = '#8b95b0';
                        expiryHint.style.fontWeight = '500';
                        expiryHint.innerText = window.currentLang === 'en'
                            ? 'Token expired. Generate a new one from the menu.'
                            : 'Token expirado. Genera uno nuevo desde el menú.';
                    }
                }
            }, 1000);

            await NV_Alert(msg, window.t_cloud('title_token', 'Token de Enlace Generado'));
            if (_tokenTimerInterval) {
                clearInterval(_tokenTimerInterval);
                _tokenTimerInterval = null;
            }
        } else {
            await NV_Alert(data.error || (window.currentLang === 'en' ? 'Could not generate token.' : 'No se pudo generar el token.'));
        }
    } catch (e) {
        await NV_Alert(window.currentLang === 'en' ? 'Connection error generating token.' : 'Error de conexión al generar el token.');
    }
}

export {
    openLinkDeviceModal,
    setLinkDeviceOS,
    closeLinkDeviceModal,
    generateSyncCommand,
    copySyncCommand,
    downloadClientAgent,
    showSyncInstructionsAlert,
    copyInfoSyncCommand,
    handleGenerateLinkToken
};
