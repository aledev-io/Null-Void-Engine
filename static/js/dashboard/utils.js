/* Utility Functions */

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

function timeAgo(timestamp) {
    const seconds = Math.floor((new Date() - new Date(timestamp * 1000)) / 1000);
    if (isNaN(seconds)) return "hace tiempo";
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " años";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " meses";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " días";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " min";
    return "ahora";
}

function getFileIcon(ext) {
    const icons = {
        '.pdf': '📕',
        '.doc': '📘', '.docx': '📘',
        '.xls': '📗', '.xlsx': '📗',
        '.jpg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
        '.zip': '📦', '.rar': '📦', '.7z': '📦',
        '.mp4': '🎬', '.mov': '🎬',
        '.mp3': '🎵', '.wav': '🎵',
        '.txt': '📄', '.py': '🐍'
    };
    return icons[ext] || '📄';
}
