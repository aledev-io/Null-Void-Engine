import { App } from './app.js';
import { Storage } from './storage.js';

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  if (!window.calendarNotes) window.calendarNotes = [];
  fetch('/api/ai/notes').then(r => r.json()).then(data => {
    if (data.notes) {
      window.calendarNotes = data.notes;
      App.refresh();
    }
  }).catch(e => console.error('Error fetching calendar notes update', e));

  window.addEventListener('calendar:synced', () => App.refresh());
  window.addEventListener('language_changed', () => {
    if (App && App.state) App.state.selectedDate = null;
    App.refresh();
  });

  if (typeof io !== 'undefined') {
    const socket = io({ auth: { token: window.TOKEN }, reconnection: true });
    socket.on('events_changed', () => Storage.syncFromAPI());
  }

  // Fix Android Chrome bfcache GPU texture corruption
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      App.refresh();
    }
  });
});
