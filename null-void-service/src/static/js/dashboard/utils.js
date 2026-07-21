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
    const isEn = localStorage.getItem('lang') === 'en';
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

const SVG_PDF = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#ea4335"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM16.5 9h-1v1.5h1V9z"/><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z"/></svg>`;
const SVG_DOC = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#4285f4"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
const SVG_XLS = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#34a853"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-2 15.2l-2-3-2 3H6.5l2.9-4.2L6.7 9H8.2l1.8 2.8L11.8 9h1.5l-2.7 4 2.9 4.2H12zM13 9V3.5L18.5 9H13z"/></svg>`;
const SVG_IMAGE = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#ea4335"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
const SVG_ZIP = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#5f6368"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H8v-2h6v2zm2-4H6v-2h10v2zm0-4H6V6h10v2z"/></svg>`;
const SVG_VIDEO = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#ea4335"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-2z"/></svg>`;
const SVG_AUDIO = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#fbbc04"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>`;
const SVG_TEXT = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#8ab4f8"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
const SVG_CODE = `<svg width="24" height="24" viewBox="0 0 24 24" fill="#fbbc04"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`;

export function getFileIcon(ext) {
    const icons = {
        '.pdf': SVG_PDF,
        '.doc': SVG_DOC, '.docx': SVG_DOC,
        '.xls': SVG_XLS, '.xlsx': SVG_XLS, '.csv': SVG_XLS,
        '.jpg': SVG_IMAGE, '.png': SVG_IMAGE, '.gif': SVG_IMAGE, '.webp': SVG_IMAGE,
        '.zip': SVG_ZIP, '.rar': SVG_ZIP, '.7z': SVG_ZIP, '.tar': SVG_ZIP, '.gz': SVG_ZIP,
        '.mp4': SVG_VIDEO, '.mov': SVG_VIDEO, '.webm': SVG_VIDEO,
        '.mp3': SVG_AUDIO, '.wav': SVG_AUDIO,
        '.txt': SVG_TEXT, '.md': SVG_TEXT,
        '.py': SVG_CODE, '.js': SVG_CODE, '.html': SVG_CODE, '.css': SVG_CODE, '.json': SVG_CODE
    };
    return icons[ext] || SVG_TEXT;
}

export function getFolderIcon() {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="#8ab4f8"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
}

export function getComputerIcon() {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="#8ab4f8"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`;
}
