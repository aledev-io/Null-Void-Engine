import { initCloud, updateCloudQuotaInfo, fetchCloudFiles } from './cloud.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const initialView = urlParams.get('view') || 'home';
    const initialPath = urlParams.get('path') || '';

    initCloud();
    updateCloudQuotaInfo();
    setInterval(updateCloudQuotaInfo, 30000);

    try {
        await fetchCloudFiles(initialPath, initialView);
    } catch (e) {
        console.error("Error en carga inicial cloud:", e);
    }

    if (typeof io !== 'undefined') {
        const cloudSocket = io({ auth: { token: window.TOKEN }, reconnection: true });
        cloudSocket.on('force_logout', () => {
            console.warn('[Session] Nueva sesión detectada, cerrando la actual...');
            window.location.href = '/';
        });

        const handleRealTimeUpdate = () => {
            const v = window.currentCloudView;
            if (v === 'shared' || v === 'shared_by_me' || v === 'home' || v === 'recent') {
                window.fetchCloudFiles(window.currentCloudPath, v);
            }
            if (window.refreshCloudInfoPanel) {
                window.refreshCloudInfoPanel();
            }
        };

        cloudSocket.on('file_shared', handleRealTimeUpdate);
        cloudSocket.on('share_removed', handleRealTimeUpdate);

        cloudSocket.on('activity_update', (data) => {
            if (window.currentCloudInfoItem && window.currentCloudInfoItem.name === data.name) {
                const btn = document.querySelector('.info-tab.active');
                if (btn && btn.getAttribute('onclick').includes('activity')) {
                    btn.click();
                }
            }
            if (window.currentCloudView === 'recent') {
                window.fetchCloudFiles('', 'recent');
            }
        });
    }
});
