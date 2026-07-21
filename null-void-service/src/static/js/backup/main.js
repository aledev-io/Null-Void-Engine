import { initBackups, loadBackupConfig } from './backups.js';

document.addEventListener('DOMContentLoaded', () => {
    initBackups();
    loadBackupConfig();
});