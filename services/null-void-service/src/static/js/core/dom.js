// dom.js — Utilidades de seguridad, escape y manipulación segura del DOM para Null-Void Engine.
// Capa de infraestructura común (static/js/core/dom.js).
// Cero dependencias hacia módulos de dominio (cloud, chat, ai, mail, etc.).

/**
 * Escapa caracteres especiales HTML para inserción segura en texto visible dentro de innerHTML.
 * Neutraliza &, <, >, ", '
 * @param {*} v - Valor a escapar.
 * @returns {string} Cadena segura con entidades HTML.
 */
export function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escapa valores destinados a atributos HTML (p. ej. value="...", title="...", data-name="...").
 * Además de las entidades estándar, neutraliza backticks (`) y barras inclinadas (/)
 * para prevenir rotura de contexto y cierre anticipado de etiquetas.
 * @param {*} v - Valor a escapar para atributo.
 * @returns {string} Cadena segura para atributos HTML.
 */
export function escAttr(v) {
    return esc(v)
        .replace(/`/g, '&#96;')
        .replace(/\//g, '&#47;');
}

/**
 * Convierte un valor en un literal seguro para interpolar dentro de atributos de eventos
 * o contextos de ejecución JS en cadena (p. ej. onclick="foo('${jsStr(val)}')").
 * Neutraliza barras invertidas, comillas simples/dobles, backticks y secuencias de cierre </script>.
 * @param {*} v - Valor a convertir en string literal seguro.
 * @returns {string} Literal escapado con secuencias unicode.
 */
export function jsStr(v) {
    return String(v == null ? '' : v)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\u0027')
        .replace(/"/g, '\\u0022')
        .replace(/`/g, '\\u0060')
        .replace(/<\//g, '<\\/');
}

/**
 * Sanea nombres de archivos, carpetas o identificadores creados por el usuario.
 * Utiliza una whitelist basada en propiedades Unicode (\p{L}, \p{N}) permitiendo
 * letras en cualquier idioma, números, espacios y signos seguros (- _ . , [ ] { } @ + # % & ~ ! =).
 * Elimina caracteres de control, saltos de línea, barras de ruta (/ y \) y colapsa espacios dobles.
 * @param {*} v - Nombre original ingresado.
 * @param {number} [maxLen=150] - Longitud máxima permitida.
 * @returns {string} Nombre limpio y seguro.
 */
export function sanitizeName(v, maxLen = 150) {
    return String(v == null ? '' : v)
        .replace(/[^\p{L}\p{N}\s\-_().,\[\]{}@+#%&~!=]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '')
        .replace(/[.]+$/g, '')
        .slice(0, maxLen);
}
