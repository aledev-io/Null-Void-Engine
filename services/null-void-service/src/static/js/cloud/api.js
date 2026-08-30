// Cloud API layer — fetch patch, retry, JSON parse, error translation.
// No dependency on cloud state or DOM.

// Garantiza que todas las peticiones fetch incluyan credenciales (cookies) para
// preservar el token de sesión durante operaciones largas de descarga/streaming.
// Además aplica un timeout automático para evitar peticiones colgadas: se
// respeta una señal externa si el llamador la proporciona y se excluyen los
// envíos de archivos (FormData/ReadableStream) y descargas/streams de vídeo.
if (!window.__nvFetchCredentialsPatched) {
    window.__nvFetchCredentialsPatched = true;
    const _origFetch = window.fetch.bind(window);
    const _FETCH_TIMEOUT_MS = 120000;
    const _noTimeout = u => /\/get_token|\/download|stream_video|\/stream\?/.test(String(u || ''));
    window.fetch = function (url, options) {
        options = Object.assign({}, options);
        if (options.credentials === undefined) {
            options.credentials = 'include';
        }
        if (options.signal || _noTimeout(url)) {
            return _origFetch(url, options);
        }
        const body = options.body;
        if (body instanceof FormData || (body && typeof body.pipe === 'function') ||
            (body && typeof body.getReader === 'function')) {
            return _origFetch(url, options);
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), _FETCH_TIMEOUT_MS);
        return _origFetch(url, Object.assign({}, options, { signal: ctrl.signal }))
            .then(res => { clearTimeout(timer); return res; })
            .catch(err => {
                clearTimeout(timer);
                if (err && err.name === 'AbortError') {
                    console.warn(`[Cloud] Petición agotada (timeout ${_FETCH_TIMEOUT_MS / 1000}s): ${url}`);
                }
                throw err;
            });
    };
}

// Traducción de errores del servidor: el backend responde en español, el
// frontend mapea a la traducción correcta según el idioma activo.
const _SERVER_ERR_TRANSLATIONS = {
    "Acceso denegado": "Access denied",
    "Datos insuficientes": "Insufficient data",
    "El archivo supera el límite de 50GB": "The file exceeds the 50GB limit",
    "El nombre no puede estar vacío": "The name cannot be empty",
    "Falta el nombre del archivo": "File name missing",
    "Falta especificar el archivo a descomprimir": "No file specified to extract",
    "Falta especificar el elemento a comprimir": "No item specified to compress",
    "Falta nombre de archivo": "File name missing",
    "Falta usuario a revocar": "No user to revoke",
    "La descarga del agente solo está disponible por HTTPS. Accede con https:// y reintenta.": "The agent download is only available over HTTPS. Access via https:// and retry.",
    "El ejecutable de Windows no está compilado. Ejecuta client_agent/build_windows_agent.bat en un PC Windows y vuelve a intentarlo.": "The Windows executable is not compiled yet. Run client_agent/build_windows_agent.bat on a Windows PC and try again.",
    "El ejecutable de macOS no está compilado. Ejecuta client_agent/compile.sh en un Mac y vuelve a intentarlo.": "The macOS executable is not compiled yet. Run client_agent/compile.sh on a Mac and try again.",
    "El ejecutable de Linux no está compilado. Ejecuta client_agent/compile.sh y vuelve a intentarlo.": "The Linux executable is not compiled yet. Run client_agent/compile.sh and try again.",
    "Error interno al preparar el cliente": "Internal error preparing the client",
    "No autorizado": "Not authorized",
    "No autorizado o archivo no encontrado": "Not authorized or file not found",
    "No autorizado o no encontrado": "Not authorized or not found",
    "No autorizado o ruta no válida": "Not authorized or invalid path",
    "No autorizado o sesión expirada": "Not authorized or session expired",
    "No existe": "Does not exist",
    "No hay archivo": "No file",
    "Ruta compartida no encontrada": "Shared path not found",
    "Ya tienes una petición pendiente": "You already have a pending request"
};

function _tServerErr(msg) {
    if (!msg) return msg;
    if (window.currentLang !== 'en') return msg;
    return _SERVER_ERR_TRANSLATIONS[msg] || msg;
}

// Parseo JSON defensivo: nunca lanza aunque el servidor responda HTML o vacío.
async function _cloudJson(res, fallback = {}) {
    if (!res) return fallback;
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : fallback;
    } catch (e) {
        return fallback;
    }
}

// Reintenta peticiones GET fallidas (reinicio del servidor) con backoff.
// Devuelve null si agota los intentos. NO usar con peticiones que mutan datos.
async function fetchCloudWithRetry(url, options, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            if (res.status === 429) {
                console.warn(`[Cloud] Límite de peticiones (429) en ${url}, sin reintentos`);
                return null;
            }
            console.warn(`[Cloud] Respuesta ${res.status} de ${url}, intento ${attempt}/${retries}`);
        } catch (error) {
            console.warn(`[Cloud] Red caída en ${url}, intento ${attempt}/${retries}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
    }
    return null;
}

export { _tServerErr, _cloudJson, fetchCloudWithRetry };
