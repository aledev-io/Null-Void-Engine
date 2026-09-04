/**
 * compat-legacy.js — Null Void Engine
 * Estrategia de degradación elegante para dispositivos Android/WebView antiguos.
 *
 * Detecta el entorno y aplica el "modo compatibilidad":
 *  - Añade data-compat="legacy" al <html> para activar CSS de fallback
 *  - Monitoriza el teclado virtual (visualViewport / resize fallback)
 *  - Añade/quita .keyboard-open en <html> cuando el teclado aparece/desaparece
 *  - Fuerza repaints en contenedores críticos para limpiar bloques negros
 *
 * CARGA: incluir con <script defer src="...compat-legacy.js"></script>
 * ANTES del resto de módulos JS pero DESPUÉS de que el DOM exista.
 */

(function () {
    'use strict';

    /* ─── Detección de entorno antiguo ───────────────────────────────────────
       Criterios combinados para identificar dispositivos problemáticos:
       1. Android WebView con UA antiguo
       2. Viewport API ausente (Chrome <61)
       3. CSS.supports confirma ausencia de backdrop-filter
       4. Pantalla pequeña (≤480px) como indicador adicional
    ─────────────────────────────────────────────────────────────────────────── */
    function isLegacyDevice() {
        var ua = navigator.userAgent || '';

        // Heurística 1: Android con versión de Chrome/WebView muy vieja
        var androidMatch = ua.match(/Android\s([\d.]+)/);
        var chromeMatch  = ua.match(/Chrome\/([\d]+)/);
        var webview      = /wv\)|WebView/.test(ua);

        if (androidMatch && chromeMatch) {
            var androidVer = parseFloat(androidMatch[1]);
            var chromeVer  = parseInt(chromeMatch[1], 10);
            // Redmi 8 / Android 9-10 con Chrome/WebView <80 son el caso crítico
            if ((androidVer < 11 && chromeVer < 90) || webview) {
                return true;
            }
        }

        // Heurística 2: visualViewport API ausente (Chrome <61)
        if (!window.visualViewport) {
            return true;
        }

        // Heurística 3: backdrop-filter no soportado
        if (window.CSS && window.CSS.supports) {
            if (!CSS.supports('backdrop-filter', 'blur(1px)') &&
                !CSS.supports('-webkit-backdrop-filter', 'blur(1px)')) {
                return true;
            }
        }

        // Heurística 4: combinación de pantalla pequeña + UA móvil sin
        //   soporte confirmado de will-change
        var smallScreen = window.innerWidth <= 480;
        var mobile = /Mobi|Android/i.test(ua);
        if (smallScreen && mobile && typeof CSS !== 'undefined' &&
            window.CSS.supports && !CSS.supports('will-change', 'transform')) {
            return true;
        }

        return false;
    }

    /* ─── Aplicar o no el modo compatibilidad ──────────────────────────────── */
    var LEGACY = isLegacyDevice();

    if (LEGACY) {
        document.documentElement.setAttribute('data-compat', 'legacy');
        console.info('[NV Compat] Modo legado activado — degradación elegante aplicada.');
    }

    /* ─── Polyfill de dvh / altura real del viewport ─────────────────────────
       En Android WebView antiguo (Redmi 8, Chrome <108), 100dvh no existe y
       100vh incluye la barra del navegador, dejando la app "corta".

       Solución: calcular la altura real con window.innerHeight y exponerla
       como variable CSS --real-vh. El CSS usa calc(var(--real-vh) * 100) como
       fallback de máxima compatibilidad cuando dvh no está disponible.
    ─────────────────────────────────────────────────────────────────────────── */
    function setRealVh() {
        // Altura real visible: visualViewport refleja el teclado (preferido),
        // fallback a innerHeight en WebViews antiguos
        var vv = window.visualViewport;
        var h = (vv && vv.height) ? vv.height : window.innerHeight;
        var vh = h * 0.01;
        document.documentElement.style.setProperty('--real-vh', vh + 'px');
        // Exponer la altura completa directamente también
        document.documentElement.style.setProperty('--app-height', Math.round(h) + 'px');
    }

    // Ejecutar siempre (no solo en legacy) — --real-vh útil en todos los dispositivos.
    setRealVh();
    window.addEventListener('resize', setRealVh, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setRealVh, { passive: true });
    }
    window.addEventListener('orientationchange', function () {
        // Pequeño delay para que el navegador termine de reajustar el viewport
        setTimeout(setRealVh, 150);
        setTimeout(setRealVh, 400); // segundo disparo por si el navegador tarda
    }, { passive: true });


    /* ─── Detección del teclado virtual ─────────────────────────────────────
       Estrategia:
       a) visualViewport.resize (Chrome ≥61): la altura del viewport se reduce
          cuando el teclado sube → diferencia > umbral = teclado abierto.
       b) window resize fallback (WebViews muy viejos que mueven window.innerHeight).

       En ambos casos: añade/quita .keyboard-open en <html>.
    ─────────────────────────────────────────────────────────────────────────── */

    // Solo monitorizar si estamos en móvil (no gastar recursos en desktop)
    var isMobile = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
    if (!isMobile) return;

    var html           = document.documentElement;
    var THRESHOLD      = 150;   // px mínimo de reducción para considerar teclado abierto
    var initialH       = 0;
    var keyboardOpen   = false;
    var repaintTimeout = null;

    /* ── Forzar repaint en contenedores críticos ─────────────────────────────
       Técnica: toggle de display en un elemento invisible para romper la caché
       de renderizado y limpiar bloques negros del compositor.                  */
    function forceRepaint() {
        var targets = [
            document.querySelector('.chat-container'),
            document.querySelector('.input-area'),
            document.querySelector('.main-chat'),
            document.querySelector('.app-container'),
        ];
        targets.forEach(function (el) {
            if (!el) return;
            // Forzar recálculo de layout leyendo offsetHeight
            // y luego haciendo un micro-toggle de transform
            void el.offsetHeight;
            el.style.webkitTransform = 'translateZ(0)';
            el.style.transform       = 'translateZ(0)';
        });
    }

    /* Debounce para no spamear el repaint */
    function scheduleRepaint() {
        clearTimeout(repaintTimeout);
        repaintTimeout = setTimeout(forceRepaint, 80);
    }

    /* ── Marcar estado del teclado ────────────────────────────────────────── */
    function setKeyboardOpen(open) {
        if (keyboardOpen === open) return;
        keyboardOpen = open;

        if (open) {
            html.classList.add('keyboard-open');
            if (LEGACY) scheduleRepaint();
        } else {
            html.classList.remove('keyboard-open');
            if (LEGACY) scheduleRepaint();
        }
    }

    /* ─── a) visualViewport.resize (preferido) ──────────────────────────── */
    if (window.visualViewport) {
        initialH = window.visualViewport.height;

        window.visualViewport.addEventListener('resize', function () {
            var currentH = window.visualViewport.height;
            var diff     = initialH - currentH;

            // Si el viewport se redujo significativamente → teclado abierto
            setKeyboardOpen(diff > THRESHOLD);

            // Actualizar referencia si el teclado está cerrado
            // (puede cambiar al rotar el dispositivo)
            if (diff <= THRESHOLD) {
                initialH = currentH;
            }
        });

    /* ─── b) window resize fallback ─────────────────────────────────────── */
    } else {
        initialH = window.innerHeight;

        window.addEventListener('resize', function () {
            var currentH = window.innerHeight;
            var diff     = initialH - currentH;
            setKeyboardOpen(diff > THRESHOLD);
            if (diff <= THRESHOLD) {
                initialH = currentH;
            }
        });
    }

    /* ─── Repaint adicional al hacer focus en inputs ─────────────────────
       Algunos WebViews de Redmi necesitan un empujón justo al enfocar
       el textarea antes de que el teclado haya terminado de aparecer.   */
    if (LEGACY) {
        document.addEventListener('focusin', function (e) {
            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                // Repaint inmediato + otro tras 300ms (cuando el teclado termina de subir)
                scheduleRepaint();
                setTimeout(scheduleRepaint, 300);
            }
        }, { passive: true });

        document.addEventListener('focusout', function (e) {
            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                setTimeout(scheduleRepaint, 200);
            }
        }, { passive: true });
    }

    /* ─── Teclado: mantener el campo enfocado visible ─────────────────────
       Con adjustResize el viewport se encoge, pero si el campo queda bajo
       el teclado (fondo del popup), lo desplazamos al área visible.       */
    function scrollFocusedIntoView() {
        var el = document.activeElement;
        if (!el) return;
        var tag = el.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) return;
        var type = (el.type || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio' || type === 'date' ||
            type === 'time' || type === 'file' || type === 'color') return;

        var vv = window.visualViewport;
        var visibleH = vv ? vv.height : window.innerHeight;

        function tryScroll() {
            var r = el.getBoundingClientRect();
            var over = r.bottom - (visibleH - 12);
            if (over <= 0 && r.top >= 0) return; // ya visible
            // Desplazar el contenedor desplazable más cercano
            var container = el.closest('.qp-body, .modal-form, .overflow-y-auto');
            if (!container) {
                try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { el.scrollIntoView(); }
                return;
            }
            // Subir el campo hasta que su borde inferior quede sobre el teclado
            container.scrollTop += Math.max(over + 8, 0);
        }
        // Varios intentos: el teclado tarda en terminar de subir
        tryScroll();
        setTimeout(tryScroll, 150);
        setTimeout(tryScroll, 350);
    }

    if (isMobile) {
        document.addEventListener('focusin', function (e) {
            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                setTimeout(scrollFocusedIntoView, 60);
            }
        }, { passive: true });
        // Re-ajustar si el viewport cambia con el teclado ya abierto
        var vv = window.visualViewport;
        (vv || window).addEventListener(vv ? 'resize' : 'resize', function () {
            if (keyboardOpen) scrollFocusedIntoView();
        }, { passive: true });
    }

})();

/* ─── Navegación global: botón "Volver" estandarizado ─────────────────────
   Función única para todos los módulos. Prefiere history.back() cuando la
   página proviene de otro punto del mismo origen (p. ej. el menú /app) y
   cae a /app si se llegó por URL directa (no hay nada a lo que volver). */
function nvGoBack() {
    try {
        if (document.referrer) {
            var ref = new URL(document.referrer);
            if (ref.origin === window.location.origin && window.history.length > 1) {
                window.history.back();
                return;
            }
        }
    } catch (e) { /* referrer inválido: caer a /app */ }
    window.location.href = '/app';
}

// La foto de perfil solo abre el menú de usuario en el dashboard (/app).
// En el resto de módulos el clic sobre el avatar no hace nada: se intercepta
// en fase de captura para que nunca se abra el panel de usuario.
(function () {
    const path = window.location.pathname.replace(/\/+$/, '');
    if (path === '/app') return;
    const TRIGGERS = '#profile-trigger, .sidebar-footer, .sidebar-user, .rail-avatar';
    document.addEventListener('click', function (e) {
        const t = e.target;
        if (t && t.closest && t.closest(TRIGGERS)) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
})();

// ─── Gestos de cajón (móvil): deslizar desde el borde izquierdo abre el
// menú lateral; con el cajón abierto, deslizar hacia la izquierda lo cierra.
// Estándar de apps profesionales (Gmail, Google Drive). No interfiere con
// scrolls verticales (exige dominancia horizontal) ni con toques lejos del
// borde. Cada módulo usa su propio mecanismo de drawer; aquí se detecta.
(function () {
    'use strict';
    if (!('ontouchstart' in window)) return;

    const EDGE = 26;          // px desde el borde izquierdo para activar
    const MIN_DX = 70;        // distancia horizontal mínima del gesto
    const MAX_DURATION = 600; // ms máximos para considerar swipe
    const RATIO = 1.5;        // dominancia horizontal vs vertical

    function isMobileViewport() {
        return window.innerWidth <= 768 ||
            (window.innerHeight <= 500 && window.innerWidth > window.innerHeight);
    }

    // Devuelve la API de apertura/cierre del cajón del módulo actual,
    // o null si el módulo no tiene cajón lateral.
    function drawerAPI() {
        const cloud = document.querySelector('.cloud-sidebar');
        if (cloud) {
            return {
                isOpen: () => cloud.classList.contains('mobile-open'),
                open: () => cloud.classList.add('mobile-open'),
                close: () => cloud.classList.remove('mobile-open')
            };
        }
        const gs = document.getElementById('global-sidebar');
        if (gs) {
            return {
                isOpen: () => gs.classList.contains('expanded'),
                open: () => {
                    gs.classList.add('expanded');
                    const o = document.getElementById('sidebar-overlay');
                    if (o) o.classList.add('show');
                },
                close: () => {
                    gs.classList.remove('expanded');
                    const o = document.getElementById('sidebar-overlay');
                    if (o) o.classList.remove('show');
                }
            };
        }
        const sb = document.getElementById('sidebar');
        if (sb) {
            // Mecanismo fijo por página (memorizado):
            //  - .mobile-hidden            → scraper (quitar/añadir clase)
            //  - <div id="sidebar">        → mail (mobile-open + overlay.show)
            //  - <aside id="sidebar">      → estándar .open (ai/reminders/calendar)
            if (sidebarMode === null) {
                if (sb.classList.contains('mobile-hidden')) {
                    sidebarMode = 'scraper';
                } else if (sb.tagName === 'DIV') {
                    sidebarMode = 'mail';
                } else {
                    sidebarMode = 'open';
                }
            }
            const mode = sidebarMode;
            if (mode === 'scraper') {
                return {
                    isOpen: () => !sb.classList.contains('mobile-hidden'),
                    open: () => sb.classList.remove('mobile-hidden'),
                    close: () => sb.classList.add('mobile-hidden')
                };
            }
            if (mode === 'mail') {
                return {
                    isOpen: () => sb.classList.contains('mobile-open'),
                    open: () => {
                        sb.classList.add('mobile-open');
                        const o = document.getElementById('sidebar-overlay');
                        if (o) o.classList.add('show');
                    },
                    close: () => {
                        sb.classList.remove('mobile-open');
                        const o = document.getElementById('sidebar-overlay');
                        if (o) o.classList.remove('show');
                    }
                };
            }
            return {
                isOpen: () => sb.classList.contains('open'),
                open: () => {
                    sb.classList.add('open');
                    const o = document.getElementById('sidebar-overlay');
                    if (o) o.style.display = 'block';
                    const bd = document.getElementById('sidebar-backdrop');
                    if (bd) { bd.classList.add('active'); document.body.classList.add('sidebar-locked'); }
                },
                close: () => {
                    sb.classList.remove('open');
                    const o = document.getElementById('sidebar-overlay');
                    if (o) o.style.display = 'none';
                    const bd = document.getElementById('sidebar-backdrop');
                    if (bd) { bd.classList.remove('active'); document.body.classList.remove('sidebar-locked'); }
                }
            };
        }
        return null;
    }

    let startX = null, startY = null, startT = 0;
    let sidebarMode = null;

    document.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { startX = null; return; }
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
        if (startX === null) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const sx = startX, sy = startY;
        const dt = Date.now() - startT;
        startX = null; startY = null;

        if (!isMobileViewport()) return;
        const api = drawerAPI();
        if (!api) return;
        if (Math.abs(dx) < MIN_DX || Math.abs(dx) <= Math.abs(dy) * RATIO || dt > MAX_DURATION) return;

        if (dx > 0 && sx <= EDGE && !api.isOpen()) {
            api.open();
        } else if (dx < 0 && api.isOpen()) {
            api.close();
        }
    }, { passive: true });
})();
