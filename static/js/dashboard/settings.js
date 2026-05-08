/* Settings and User Preferences Logic */

let USER_SETTINGS = {
    ui: { theme: 'dark', brightness: 100, zoom: 100 },
    backup: { source: '', destination: '' }
};

async function initSettings() {
    try {
        // Aseguramos que TAB_ID esté disponible (debería estar en el scope global de index.html)
        const tId = typeof TAB_ID !== 'undefined' ? TAB_ID : sessionStorage.getItem('tabId');
        const res = await fetch(`/api/settings?token=${TOKEN}&tabId=${tId}`);
        const data = await res.json();
        if (data && !data.error) {
            USER_SETTINGS = data;
            applySettings();
        }
    } catch (e) {
        console.error("Error cargando ajustes:", e);
    }
}

function applySettings() {
    // Aplicar Tema
    const theme = USER_SETTINGS.ui.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeIcon(theme);

    // Aplicar Brillo
    const brightness = USER_SETTINGS.ui.brightness || 100;
    document.body.style.filter = `brightness(${brightness}%)`;
    
    // Actualizar controles en la UI si existen
    const brightSlider = document.getElementById('setting-brightness');
    if (brightSlider) brightSlider.value = brightness;
    
    const brightVal = document.getElementById('setting-brightness-val');
    if (brightVal) brightVal.textContent = brightness + '%';
}

async function saveUISettings(key, value) {
    USER_SETTINGS.ui[key] = value;
    applySettings();
    
    try {
        await fetch('/api/settings?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ ui: { [key]: value } })
        });
    } catch (e) {
        console.error("Error guardando ajustes:", e);
    }
}

// Iniciar al cargar
document.addEventListener('DOMContentLoaded', () => {
    initSettings();
});
