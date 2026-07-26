import { App } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  window.calendarNotes = [];
  fetch('/api/ai/notes').then(r => r.json()).then(data => {
    window.calendarNotes = data.notes || [];
    App.refresh();
  }).catch(e => console.error('Error fetching calendar notes', e));

  window.addEventListener('calendar:synced', () => App.refresh());
  window.addEventListener('language_changed', () => App.refresh());

  // Fix Android Chrome bfcache GPU texture corruption
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      App.refresh();
    }
  });
});
