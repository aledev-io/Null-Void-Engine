import { initExcel } from './excel.js';

document.addEventListener('DOMContentLoaded', () => {
    initExcel();

    // En standalone, cargar la hoja automáticamente
    if (typeof window.fetchSpreadsheet === 'function') {
        window.fetchSpreadsheet();
    }
});
