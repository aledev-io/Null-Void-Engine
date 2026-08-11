/**
 * Null-Void Cloud — Monitor global de conectividad.
 * Detecta cuándo el servidor deja de responder (caída de red, reinicio del
 * servidor, pérdida de conexión) y muestra un banner "Intentando reconectarse…"
 * desde cualquier página de la app, ocultándolo al restablecerse la conexión.
 *
 * Se inyecta automáticamente en todas las páginas HTML vía @app.after_request
 * (ver app.py) y no depende de módulos ES: es un script clásico autocontenido.
 *
 * Criterios para mostrar el banner (evita falsos positivos):
 *  - Varios fallos consecutivos (no 2 sueltos): un servidor lento o saturado
 *    (p. ej. long-polling de socket.io ocupando conexiones) no debe
 *    considerarse caído a la primera.
 *  - Antes de mostrarlo, una comprobación final con margen de tiempo extra.
 *  - En pestañas en segundo plano no se comprueba ni se muestra: solo se
 *    reanuda cuando la pestaña vuelve a ser visible.
 */
(function () {
    if (window.__nvConnectionMonitorLoaded) return;
    window.__nvConnectionMonitorLoaded = true;

    var HEARTBEAT_INTERVAL_MS = 5000;   // cada 5 s comprobamos el servidor
    var HEARTBEAT_TIMEOUT_MS = 8000;    // tiempo máximo de respuesta de una sonda
    var FAILS_TO_SHOW = 3;              // fallos consecutivos antes de mostrar el aviso
    var VERIFY_TIMEOUT_MS = 12000;      // margen extra para la comprobación final

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

    function isPageHidden() {
        return typeof document.hidden !== 'undefined' && document.hidden;
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
        if (hidden || isPageHidden()) return;
        var b = ensureBanner();
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

    /** Una sola comprobación: resuelve true si el servidor respondió. */
    function probe(timeoutMs) {
        return new Promise(function (resolve) {
            var controller = new AbortController();
            var timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
            fetch(HEARTBEAT_URL + Date.now(), {
                method: 'GET',
                cache: 'no-store',
                credentials: 'include',
                mode: 'same-origin',
                signal: controller.signal
            }).then(function () {
                clearTimeout(timeout);
                resolve(true);
            }).catch(function () {
                clearTimeout(timeout);
                resolve(false);
            });
        });
    }

    function heartbeat() {
        if (isPageHidden()) return; // no sondear con la pestaña oculta
        probe(HEARTBEAT_TIMEOUT_MS).then(function (ok) {
            if (ok) {
                consecutiveFails = 0;
                markOnline();
                return;
            }
            consecutiveFails += 1;
            if (consecutiveFails < FAILS_TO_SHOW) return;
            if (wasOffline) return; // ya visible: la siguiente sonda decidirá

            // Comprobación final con margen: un servidor lento o saturado
            // no debe disparar el aviso a la primera.
            probe(VERIFY_TIMEOUT_MS).then(function (ok2) {
                if (ok2) {
                    consecutiveFails = 0;
                    markOnline();
                } else {
                    markOffline();
                }
            });
        });
    }

    function handleBrowserOffline() {
        if (wasOffline) return;
        // navigator.onLine da falsos negativos: que decida la verificación real.
        consecutiveFails = FAILS_TO_SHOW - 1;
        heartbeat();
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
        window.addEventListener('focus', heartbeat);
        document.addEventListener('visibilitychange', function () {
            if (!isPageHidden()) heartbeat();
        });

        // Bucle de comprobación periódica
        timer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
        heartbeat();
    }

    start();
})();
