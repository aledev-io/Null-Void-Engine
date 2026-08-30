// Avatar helpers — fallback circles, deterministic hue, badge HTML.
// No dependency on cloud state. cloudAvatarFallback is assigned to window
// for use in onerror handlers within dynamically generated innerHTML.

// Color determinista por usuario para el círculo de iniciales del badge.
function cloudNameHue(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
}

// Avatar del propietario para el badge: el círculo de inicial de color está
// SIEMPRE detrás del <img>; si la foto carga la tapa y si falla (this.remove)
// queda el círculo con la inicial. Nunca aparece una caja negra/blanca vacía.
function cloudAvatarHtml(ownerId, ownerName, size) {
    const sz = size || 20;
    const name = String(ownerName || '').trim();
    const letter = name.charAt(0).toUpperCase() || 'U';
    const hue = cloudNameHue(name);
    const id = String(ownerId || name || 'u');
    const src = `/api/system/user/avatar/${encodeURIComponent(id)}`;
    return `<span class="cloud-badge-avatar" style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:${sz}px;height:${sz}px;border-radius:50%;background:hsl(${hue}, 65%, 45%);color:#fff;font-size:${Math.max(9, Math.round(sz * 0.42))}px;font-weight:600;flex-shrink:0;overflow:hidden;line-height:1;">${letter}<img src="${src}" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.remove()"></span>`;
}

// Fallback de avatar seguro: sustituye la <img> rota por un círculo con la
// primera letra del usuario. Se construye con createElement/textContent para
// no interpolar datos del usuario en HTML/strings.
window.cloudAvatarFallback = function (img, username, hue) {
    if (!img || !img.parentNode) return;
    const style = img.getAttribute('style') || '';
    const size = (style.match(/width:\s*(\d+)px/) || [])[1] || '';
    const letter = String(username || '').trim().charAt(0).toUpperCase() || 'U';
    const div = document.createElement('div');
    const bg = (hue !== undefined && hue !== null && !isNaN(hue))
        ? `hsl(${Math.round(hue)}, 65%, 45%)`
        : 'var(--indigo, #6366f1)';
    div.style.cssText = style.replace(/width:\s*[^;]+;?/, '')
        .replace(/height:\s*[^;]+;?/, '')
        .replace(/;?\s*$/, '') +
        (size ? `; width:${size}px; height:${size}px;` : '; width:32px; height:32px;') +
        `; border-radius:50%; background:${bg}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:` + Math.max(9, Math.round(parseInt(size || '32') * 0.42)) + 'px;';
    div.textContent = letter;
    img.parentNode.replaceChild(div, img);
};

export { cloudNameHue, cloudAvatarHtml };
