import { App } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  window.addEventListener('calendar:synced', () => App.refresh());
  window.addEventListener('language_changed', () => App.refresh());
});
