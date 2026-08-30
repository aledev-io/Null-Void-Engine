// Search helpers — regex escaping, highlight, snippet rendering.
// Imports esc from core/dom.js (no circular dependency).

import { esc } from '../core/dom.js';

function _escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text, query) {
    if (!text) return '';
    const safe = esc(text);
    if (!query) return safe;
    try {
        return safe.replace(new RegExp(_escapeRegExp(query.trim()), 'ig'),
            m => `<mark class="cloud-search-hit">${m}</mark>`);
    } catch (e) {
        return safe;
    }
}

function searchMatchLine(matchType, snippet, query) {
    // Línea sutil integrada bajo el nombre: solo el fragmento resaltado.
    // Sin pastillas ni etiquetas: la palabra clave en amarillo ya indica
    // por qué coincide, y en las coincidencias por nombre no hace falta nada
    // (el propio nombre va resaltado).
    if (matchType === 'content') {
        return `<span class="cloud-search-snippet">${highlightMatch(snippet, query)}</span>`;
    }
    return '';
}

export { _escapeRegExp, highlightMatch, searchMatchLine };
