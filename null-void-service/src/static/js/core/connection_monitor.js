/**
 * Null-Void Cloud — Monitor global de conectividad.
 * Detecta cuándo el servidor deja de responder (caída de red, reinicio del
 * servidor, pérdida de conexión) y muestra un banner "Intentando reconectarse…"
 * desde cualquier página de la app, ocultándolo al restablecerse la conexión.
 *
 * Se inyecta automáticamente en todas las páginas HTML vía @app.after_request
 * (ver app.py) y no depende de módulos ES: es un script clásico autocontenido.
 */
(function () {
    if (window.__nvConnectionMonitorLoaded) return;
    window.__nvConnectionMonitorLoaded = true;

    var HEARTBEAT_INTERVAL_MS = 5000;   // cada 5 s comprobamos el servidor
    var HEARTBEAT_TIMEOUT_MS = 4000;    // si no responde en 4 s, se considera caído
    var FAILS_TO_SHOW = 2;              // 2 fallos consecutivos antes de mostrar el banner

    // Ruta estática ligera: siempre existe y su respuesta confirma que el
    // servidor está vivo. El query param evita que la caché la sirva sin red.
    var HEARTBEAT_URL = '/static/css/core/tokens.css?_=';

    var banner = null;
    var consecutiveFails = 0;
    var wasOffline = false;
    var hidden = false;
    var timer = null;

    function t(key, fallback) {
        try {
            if (window.t && window.I18n) return window.t(key) || fallback;
        } catch (e) { /* i18n no disponible en esta página */ }
        return fallback;
    }

    function buildBanner() {
        var b = document.createElement('div');
        b.id = 'nv-conn-banner';
        b.setAttribute('role', 'status');
        b.setAttribute('aria-live', 'polite');
        b.style.cssText = [
            'position: fixed; top: 0; left: 0; right: 0; z-index: 999999;',
            'display: none; align-items: center; justify-content: center; gap: 10px;',
            'padding: 10px 18px;',
            'background: var(--surface-hi, rgba(15, 23, 42, 0.92));',
            'border-bottom: 1px solid var(--indigo, #6366f1);',
            'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
            'color: var(--text-main, #f8fafc); font-family: inherit; font-size: 0.85rem; font-weight: 600;',
            'text-align: center; letter-spacing: 0.02em; box-shadow: 0 4px 20px rgba(0,0,0,0.3);',
            'transition: all 0.3s ease;'
        ].join('');

        var spinner = document.createElement('span');
        spinner.style.cssText = [
            'width: 14px; height: 14px; flex-shrink: 0;',
            'border: 2px solid var(--border, rgba(99, 102, 241, 0.3));',
            'border-top-color: var(--indigo, #6366f1); border-radius: 50%;',
            'display: inline-block; animation: nvConnSpin 0.8s linear infinite;'
        ].join('');

        var text = document.createElement('span');
        text.id = 'nv-conn-banner-text';

        b.appendChild(spinner);
        b.appendChild(text);
        document.body.appendChild(b);

        // Animación del spinner (autocontenida, no depende de hojas de estilos)
        if (!document.getElementById('nv-conn-spinner-style')) {
            var style = document.createElement('style');
            style.id = 'nv-conn-spinner-style';
            style.textContent = '@keyframes nvConnSpin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
        return b;
    }

    function ensureBanner() {
        if (banner) return banner;
        banner = buildBanner();
        return banner;
    }

    function setText() {
        var el = document.getElementById('nv-conn-banner-text');
        if (el) el.textContent = t('conn_trying_reconnect', 'Intentando reconectarse…');
    }

    function showReconnecting() {
        var b = ensureBanner();
        if (hidden) return;
        setText();
        b.style.display = 'flex';
    }

    function hideReconnecting() {
        if (!banner) return;
        banner.style.display = 'none';
    }

    function showRestoredToast() {
        try {
            if (window.UI && typeof window.UI.showToast === 'function') {
                window.UI.showToast(t('conn_reconnected', 'Conexión restablecida'));
                return;
            }
        } catch (e) { /* noop */ }
        // Toast adaptado al tema activo del usuario
        var toast = document.createElement('div');
        toast.textContent = t('conn_reconnected', 'Conexión restablecida');
        toast.style.cssText = [
            'position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);',
            'z-index: 999999; padding: 10px 20px; border-radius: 12px;',
            'background: var(--surface-hi, rgba(15, 23, 42, 0.95)); border: 1px solid var(--indigo, #6366f1);',
            'color: var(--text-main, #f8fafc); font-weight: 600; font-size: 0.85rem;',
            'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
            'box-shadow: 0 8px 32px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 8px;'
        ].join('');
        document.body.appendChild(toast);
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 2500);
    }

    function markOffline() {
        if (!wasOffline) {
            wasOffline = true;
            showReconnecting();
        }
    }

    function markOnline() {
        if (wasOffline) {
            wasOffline = false;
            hideReconnecting();
            showRestoredToast();

            // Al restablecer la conexión, refrescar automáticamente la vista y archivos
            try {
                if (typeof window.loadCloudFiles === 'function') {
                    window.loadCloudFiles();
                } else if (typeof window.fetchCloudFiles === 'function') {
                    window.fetchCloudFiles(window.currentCloudPath || '', window.currentCloudView || 'drive');
                } else {
                    window.location.reload();
                }
            } catch (e) {
                window.location.reload();
            }
        }
    }

    function heartbeat() {
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, HEARTBEAT_TIMEOUT_MS);

        fetch(HEARTBEAT_URL + Date.now(), {
            method: 'GET',
            cache: 'no-store',
            credentials: 'include',
            mode: 'same-origin',
            signal: controller.signal
        }).then(function (res) {
            clearTimeout(timeout);
            consecutiveFails = 0;
            markOnline();
        }).catch(function () {
            clearTimeout(timeout);
            consecutiveFails += 1;
            if (consecutiveFails >= FAILS_TO_SHOW) {
                markOffline();
            }
        });
    }

    function handleBrowserOffline() {
        consecutiveFails = FAILS_TO_SHOW; // sin red del navegador: fuera inmediatamente
        markOffline();
    }

    function handleBrowserOnline() {
        heartbeat(); // verificar contra el servidor antes de ocultar
    }

    function start() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
            return;
        }
        if (timer) return;

        // Estado inicial
        if (typeof navigator.onLine !== 'undefined' && !navigator.onLine) {
            handleBrowserOffline();
        }

        window.addEventListener('online', handleBrowserOnline);
        window.addEventListener('offline', handleBrowserOffline);
        window.addEventListener('languageChanged', setText);

        // Bucle de comprobación periódica
        timer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
        heartbeat();
    }

    start();
})();
