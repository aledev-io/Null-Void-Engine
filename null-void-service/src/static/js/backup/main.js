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

// Arranque robusto: ejecuta la inicialización de inmediato si el DOM ya está
// listo (carga desde caché o shell nativo), sin esperar DOMContentLoaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBackups);
} else {
    bootBackups();
}