/* ────────────────────────────────────────────────────────────
   SCRAPER MODULE · Socket
   Instancia Socket.IO y ciclo de vida de la conexión.
   Los handlers de eventos de estado (scraper_state_update,
   scraper_distance_update) viven en scraper.js porque dependen
   de funciones locales (loadDatabase, filterTable, ...).
   ──────────────────────────────────────────────────────────── */

export const socket = io();

let wasDisconnected = false;

socket.on('disconnect', () => {
    wasDisconnected = true;
});

socket.on('connect', () => {
  if (wasDisconnected) {
      window.location.reload();
      return;
  }
  socket.emit('get_scraper_tasks', {});
  socket.emit('request_scraper_state');
});