import { initBackups, loadBackupConfig } from './backups.js';

function bootBackups() {
    try {
        initBackups();
    } catch (e) {
        console.error('[Backups] initBackups falló:', e);
    }
    loadBackupConfig().catch(e => {
        console.error('[Backups] loadBackupConfig falló:', e);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBackups);
} else {
    bootBackups();
}