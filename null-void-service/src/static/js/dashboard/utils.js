export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

export function timeAgo(timestamp) {
    let isEn = false;
    try { isEn = localStorage.getItem('lang') === 'en'; } catch (e) { /* noop */ }
    const seconds = Math.floor((new Date() - new Date(timestamp * 1000)) / 1000);
    if (isNaN(seconds)) return isEn ? "a while ago" : "hace tiempo";
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + (isEn ? " yrs" : " años");
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + (isEn ? " mos" : " meses");
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + (isEn ? " days" : " días");
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + (isEn ? " hrs" : " h");
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + (isEn ? " mins" : " min");
    return isEn ? "just now" : "ahora";
}

// Sistema de iconos vectoriales (SVG) estilo feather, familia coherente en
// toda la app. Tamaño 1em: se escala nítidamente (HiDPI) con el font-size del
// contenedor (filas, tarjetas 2.5-3rem, panel de info). Color por tipo.
const _bkp_ico = (c, p) => `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

const _P_ICON_PDF = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>';
const _P_ICON_FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>';
const _P_ICON_TEXT = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>';
const _P_ICON_XLS = '<rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line>';
const _P_ICON_PPT = '<path d="M2 3h20"></path><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"></path><line x1="12" y1="16" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line>';
const _P_ICON_IMG = '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>';
const _P_ICON_ZIP = '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>';
const _P_ICON_VID = '<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect>';
const _P_ICON_AUD = '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>';
const _P_ICON_CODE = '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>';
const _P_ICON_DISC = '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle>';
const _P_ICON_DB = '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>';

const SVG_PDF = _bkp_ico('#f87171', _P_ICON_PDF);
const SVG_DOC = _bkp_ico('#60a5fa', _P_ICON_FILE);
const SVG_XLS = _bkp_ico('#34d399', _P_ICON_XLS);
const SVG_PPT = _bkp_ico('#fbbf24', _P_ICON_PPT);
const SVG_IMAGE = _bkp_ico('#a78bfa', _P_ICON_IMG);
const SVG_ZIP = _bkp_ico('#f59e0b', _P_ICON_ZIP);
const SVG_VIDEO = _bkp_ico('#fb7185', _P_ICON_VID);
const SVG_AUDIO = _bkp_ico('#f472b6', _P_ICON_AUD);
const SVG_TEXT = _bkp_ico('#94a3b8', _P_ICON_TEXT);
const SVG_CODE = _bkp_ico('#eab308', _P_ICON_CODE);
const SVG_DISC = _bkp_ico('#94a3b8', _P_ICON_DISC);
const SVG_DB = _bkp_ico('#818cf8', _P_ICON_DB);

export function getFileIcon(ext) {
    const icons = {
        '.pdf': SVG_PDF,
        '.doc': SVG_DOC, '.docx': SVG_DOC,
        '.xls': SVG_XLS, '.xlsx': SVG_XLS, '.csv': SVG_XLS,
        '.ppt': SVG_PPT, '.pptx': SVG_PPT,
        '.jpg': SVG_IMAGE, '.jpeg': SVG_IMAGE, '.png': SVG_IMAGE, '.gif': SVG_IMAGE, '.webp': SVG_IMAGE, '.svg': SVG_IMAGE,
        '.zip': SVG_ZIP, '.rar': SVG_ZIP, '.7z': SVG_ZIP, '.tar': SVG_ZIP, '.gz': SVG_ZIP, '.bz2': SVG_ZIP, '.xz': SVG_ZIP,
        '.mp4': SVG_VIDEO, '.mov': SVG_VIDEO, '.webm': SVG_VIDEO, '.mkv': SVG_VIDEO, '.avi': SVG_VIDEO,
        '.mp3': SVG_AUDIO, '.wav': SVG_AUDIO, '.flac': SVG_AUDIO, '.ogg': SVG_AUDIO,
        '.txt': SVG_TEXT, '.md': SVG_TEXT, '.json': SVG_TEXT,
        '.py': SVG_CODE, '.js': SVG_CODE, '.html': SVG_CODE, '.css': SVG_CODE, '.cpp': SVG_CODE,
        '.exe': SVG_DISC, '.iso': SVG_DISC,
        '.db': SVG_DB, '.sql': SVG_DB
    };
    return icons[ext] || SVG_TEXT;
}

export function getFolderIcon() {
    return _bkp_ico('#8ab4f8', '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>');
}

export function getComputerIcon() {
    return _bkp_ico('#8ab4f8', '<rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>');
}
