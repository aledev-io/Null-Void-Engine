/* Backup Module Logic */

async function loadBackupConfig() {
    if (USER_SETTINGS && USER_SETTINGS.backup) {
        const sourceEl = document.getElementById('bkp-source');
        const destEl = document.getElementById('bkp-dest');
        if (sourceEl) sourceEl.value = USER_SETTINGS.backup.source || "";
        if (destEl) destEl.value = USER_SETTINGS.backup.destination || "";
    }
}

async function doBackup() {
    const btn = document.getElementById('btn-backup');
    const out = document.getElementById('backup-result');
    const source = document.getElementById('bkp-source').value;
    const dest = document.getElementById('bkp-dest').value;

    if (btn) btn.disabled = true;
    if (out) {
        out.textContent = '⏳ Comprimiendo archivos... esto puede tardar un poco.';
        out.style.color = 'var(--text-muted)';
        out.style.animation = 'pulse 2s infinite';
    }

    try {
        const res = await fetch('/api/backup?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ source: source, destination: dest })
        });
        const data = await res.json();
        if (out) out.style.animation = 'none';

        if (data.ok) {
            if (out) {
                out.textContent = data.result;
                out.style.color = data.result.startsWith('✅') ? '#10b981' : '#f87171';
            }
        } else {
            if (out) {
                out.textContent = '❌ Error: ' + data.error;
                out.style.color = '#f87171';
            }
        }
    } catch (e) {
        if (out) {
            out.style.animation = 'none';
            out.textContent = '❌ Error de conexión con el servidor.';
            out.style.color = '#f87171';
        }
    }
    if (btn) btn.disabled = false;
}
