/**
 * notifications.js — Browser notifications and scheduling
 */
const Notifications = {
  async init() {
    console.log("Notifications system initialized");
    if (Notification.permission === 'granted') {
      this.checkUpcomingEvents();
    }
  },

  async requestPermission() {
    if (!('Notification' in window)) {
      alert('Este navegador no soporta notificaciones de escritorio.');
      return false;
    }
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  },

  async checkUpcomingEvents() {
    // Esta función podría ser expandida para revisar eventos próximos
    // y programar notificaciones locales si se desea.
    console.log("Checking for upcoming events...");
  },

  send(title, options = {}) {
    if (Notification.permission === 'granted') {
      return new Notification(title, {
        icon: '/static/favicon.ico', // Ajustar si existe
        ...options
      });
    }
  }
};
