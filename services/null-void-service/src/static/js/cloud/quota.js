import { esc } from '../core/dom.js';
import { _cloudJson } from './api.js';
import { formatBytes, getCookie } from '../dashboard/utils.js';
import { NV_Alert, NV_Confirm } from '../dashboard/ui.js';

let _currentCloudLimitBytes = Infinity;
let _currentCloudUsedBytes = 0;

function getCurrentCloudLimitBytes() { return _currentCloudLimitBytes; }
function getCurrentCloudUsedBytes() { return _currentCloudUsedBytes; }

async function updateCloudQuotaInfo() {
    const bar = document.getElementById('cloud-quota-bar');
    const text = document.getElementById('cloud-quota-text');

    try {
        const token = getCookie('token') || '';
        const res = await fetch('/api/cloud/quota', {
            method: 'GET',
            headers: { 'X-Token': token, 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (!res.ok) throw new Error("Status: " + res.status);
        const data = await _cloudJson(res);

        const usedBytes = data.used_bytes || 0;
        const limitGb = data.limit_gb !== undefined ? data.limit_gb : 5;
        const freeDisk = data.disk_free || 0;

        const limitBytes = limitGb * 1024 * 1024 * 1024;
        _currentCloudLimitBytes = limitBytes;
        _currentCloudUsedBytes = usedBytes;
        let percent = 0;
        if (limitBytes === 0) {
            percent = usedBytes > 0 ? 100 : 0;
        } else {
            percent = (usedBytes / limitBytes) * 100;
        }

        if (bar) {
            bar.style.width = Math.min(percent, 100) + '%';
            bar.style.background = (percent > 90 && limitBytes > 0) ? 'var(--cpu)' : 'var(--indigo)';
        }

        if (text) {
            text.innerHTML = `
            <div class="quota-text-main" style="font-size: 0.85rem;">
                ${formatBytes(usedBytes)} ${window.t_cloud('of')} ${limitGb} GB ${window.t_cloud('used')}
            </div>
            <div class="quota-text-disk" style="font-size: 0.75rem; margin-top: 6px;">
                ${window.t_cloud('disk')}: ${formatBytes(freeDisk)} ${window.t_cloud('available')}
            </div>
        `;
        }

        const btn = document.getElementById('cloud-quota-request-btn');
        if (btn) {
            if (data.has_pending_request) {
                btn.innerHTML = window.t_cloud('cancel_quota_request', 'Cancelar petición pendiente');
                btn.style.borderColor = 'rgba(248, 113, 113, 0.3)';
                btn.style.color = 'var(--cpu)';
                btn.onclick = cancelCloudQuotaRequest;
            } else {
                btn.innerHTML = window.t_cloud('get_more_space', 'Obtener más espacio');
                btn.style.borderColor = 'var(--border)';
                btn.style.color = 'var(--text-main)';
                btn.onclick = requestMoreCloudQuota;
            }
        }
    } catch (err) {
        console.error("Error cuota cloud:", err);
    }
}

async function cancelCloudQuotaRequest() {
    if (!await NV_Confirm(window.t_cloud('cancel_quota_confirm'), window.t_cloud('cancel_quota_title'), window.t_cloud('btn_confirm'), window.t_cloud('back'))) return;
    try {
        const res = await fetch('/api/cloud/quota', {
            method: 'DELETE',
            headers: window.HEADERS
        });
        if (res.ok) {
            updateCloudQuotaInfo();
        }
    } catch (err) { }
}

async function requestMoreCloudQuota() {
    if (!await NV_Confirm(window.t_cloud('request_10gb_confirm'), window.t_cloud('request_space_title'), window.t_cloud('btn_confirm'), window.t_cloud('btn_cancel'))) return;
    try {
        const res = await fetch('/api/cloud/quota', {
            method: 'POST',
            headers: window.HEADERS
        });
        if (res.ok) {
            await NV_Alert(window.t_cloud('request_sent'));
            updateCloudQuotaInfo();
        } else {
            const errData = await _cloudJson(res);
            await NV_Alert(errData.error || 'Error.');
        }
    } catch (err) { }
}

async function fetchAdminQuotaRequests() {
    try {
        const res = await fetch('/api/cloud/admin/quota_requests', { headers: window.HEADERS });
        if (res.ok) {
            const data = await _cloudJson(res);
            renderAdminQuotaRequests(data.requests || []);
        }
    } catch (err) { console.error(err); }
}

async function resolveQuotaRequest(id, action) {
    try {
        const res = await fetch('/api/cloud/admin/quota_requests', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ id, action })
        });
        if (res.ok) {
            fetchAdminQuotaRequests();
        }
    } catch (err) { }
}

function renderAdminQuotaRequests(requests) {
    const container = document.getElementById('admin-quota-list');
    if (!container) return;
    if (requests.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 20px; opacity: 0.5;">${window.currentLang === 'en' ? 'No pending requests.' : 'No hay peticiones pendientes.'}</div>`;
        return;
    }

    let html = '';
    requests.forEach(r => {
        html += `
            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600;">${esc(r.username)}</div>
                    <div style="font-size: 0.8rem; opacity: 0.7;">+${r.requested_gb}GB - ${new Date(r.created_at * 1000).toLocaleString(window.currentLang)}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="resolveQuotaRequest(${r.id}, 'rejected')" style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">${window.currentLang === 'en' ? 'Reject' : 'Rechazar'}</button>
                    <button onclick="resolveQuotaRequest(${r.id}, 'approved')" style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">${window.currentLang === 'en' ? 'Approve' : 'Aprobar'}</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

export {
    getCurrentCloudLimitBytes,
    getCurrentCloudUsedBytes,
    updateCloudQuotaInfo,
    requestMoreCloudQuota,
    fetchAdminQuotaRequests,
    resolveQuotaRequest
};
