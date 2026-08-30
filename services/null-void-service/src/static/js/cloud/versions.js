import { NV_Alert, NV_Confirm } from '../dashboard/ui.js';
import { formatBytes } from '../dashboard/utils.js';
import { jsStr } from '../core/dom.js';
import { _tServerErr, _cloudJson } from './api.js';

function _versionsResolvedView() {
    const v = window.currentCloudView;
    return ['recent', 'starred', 'shared_by_me'].includes(v) ? 'drive' : v;
}

async function showCloudVersions(name, path) {
    const body = document.getElementById('info-panel-body');
    const view = _versionsResolvedView();
    body.innerHTML = `<div style="display:flex; justify-content:center; padding:20px;"><div class="loading-spinner"></div></div>`;
    try {
        const res = await fetch(`/api/cloud/versions?view=${encodeURIComponent(view)}&path=${encodeURIComponent(path || '')}&name=${encodeURIComponent(name)}`, { headers: window.HEADERS });
        const data = await _cloudJson(res);
        if (!res.ok || !data.versions) throw new Error(data.error || 'Error');
        const versions = data.versions || [];
        if (versions.length === 0) {
            body.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-dim);">${window.t_cloud('versions_empty', 'No hay versiones guardadas para este archivo.')}</div>`;
            return;
        }
        body.innerHTML = versions.map(v => `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--border);">
                <div style="min-width:0;">
                    <div style="font-weight:600; font-size:0.85rem; color:var(--text-main);">${window.t_cloud('version_label', 'Versión')} ${v.n}</div>
                    <div style="font-size:0.72rem; color:var(--text-dim);">${new Date(v.ts * 1000).toLocaleString(window.currentLang)} · ${formatBytes(v.size)}</div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    <button onclick="restoreCloudVersion('${jsStr(name)}', '${jsStr(path || '')}', '${v.vid}', '${view}')" style="padding:5px 10px; font-size:0.72rem; font-weight:600; background:var(--indigo); color:#fff; border:none; border-radius:6px; cursor:pointer;">${window.t_cloud('btn_restore', 'Restaurar')}</button>
                    <button onclick="downloadCloudVersion('${jsStr(name)}', '${jsStr(path || '')}', '${v.vid}', '${view}')" style="padding:5px 10px; font-size:0.72rem; font-weight:600; background:transparent; border:1px solid var(--border); color:var(--text-main); border-radius:6px; cursor:pointer;">${window.t_cloud('btn_download', 'Descargar')}</button>
                    <button onclick="deleteCloudVersion('${jsStr(name)}', '${jsStr(path || '')}', '${v.vid}', '${view}')" title="${window.t_cloud('btn_delete_version', 'Eliminar versión')}" style="padding:5px 8px; font-size:0.72rem; background:transparent; border:1px solid var(--border); color:#ef4444; border-radius:6px; cursor:pointer;">✕</button>
                </div>
            </div>`).join('');
    } catch (err) {
        body.innerHTML = `<div style="padding:20px; color:#f87171;">${err.message}</div>`;
    }
}

async function restoreCloudVersion(name, path, vid, view) {
    const ok = await NV_Confirm(window.t_cloud('versions_restore_confirm', `¿Restaurar la versión de "${name}"? Se guardará una copia de la versión actual.`).replace('{0}', name), window.t_cloud('btn_restore', 'Restaurar'));
    if (!ok) return;
    try {
        const res = await fetch('/api/cloud/versions/restore', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ name, path, view, v: vid })
        });
        const data = await _cloudJson(res);
        if (!res.ok) {
            await NV_Alert(_tServerErr(data.error) || window.t_cloud('versions_restore_err', 'No se pudo restaurar la versión.'));
            return;
        }
        showCloudVersions(name, path);
        await NV_Alert(window.t_cloud('versions_restored_ok', 'Versión restaurada correctamente.'));
        window.fetchCloudFiles(window.currentCloudPath, window.currentCloudView);
        window.updateCloudQuotaInfo();
    } catch (e) {
        await NV_Alert(window.t_cloud('versions_restore_err', 'No se pudo restaurar la versión.'));
    }
}

async function downloadCloudVersion(name, path, vid, view) {
    window.location.href = `/api/cloud/versions/download?view=${encodeURIComponent(view)}&path=${encodeURIComponent(path || '')}&name=${encodeURIComponent(name)}&v=${vid}`;
}

async function deleteCloudVersion(name, path, vid, view) {
    const ok = await NV_Confirm(window.t_cloud('versions_delete_confirm', '¿Eliminar esta versión?'), window.t_cloud('btn_delete_version', 'Eliminar versión'));
    if (!ok) return;
    try {
        const res = await fetch('/api/cloud/versions/delete', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ name, path, view, v: vid })
        });
        const data = await _cloudJson(res);
        if (!res.ok) {
            await NV_Alert(_tServerErr(data.error) || window.t_cloud('versions_delete_err', 'No se pudo eliminar la versión.'));
            return;
        }
        showCloudVersions(name, path);
    } catch (e) { }
}

export { showCloudVersions, restoreCloudVersion, downloadCloudVersion, deleteCloudVersion };
