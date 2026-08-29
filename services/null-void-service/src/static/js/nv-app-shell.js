(function() {
    // NV App Shell — Versión Nativa (Puente)
    // Se han eliminado todos los elementos visuales (barra, espaciadores).
    // Ahora la aplicación Android gestiona la interfaz superior de forma física.

    console.log("NV App Shell: Modo Nativo Activo");

    function vibrate() {
        if (navigator.vibrate) navigator.vibrate(10);
    }
})();
