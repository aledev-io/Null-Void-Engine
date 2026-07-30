import { Storage } from './storage.js';
import { Events } from './events.js';
import { PushNotifications } from '../core/push_notifications.js';

export const Notifications = {
  enabled: localStorage.getItem('notifications_enabled') === 'true',

  async init() {
    console.log("Notifications system initialized. Enabled:", this.enabled);
    if (this.enabled) {
      PushNotifications.init();
    }
  },

  async requestPermission() {
    if (!('Notification' in window)) {
      alert(window.t('push_not_supported'));
      return false;
    }
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('notifications_enabled', this.enabled);
    console.log("Notifications enabled state:", this.enabled);
    if (this.enabled) {
        PushNotifications.init();
    }
    return this.enabled;
  },

  async checkUpcomingEvents() {
    // Deprecated: Delegated to the backend via Web Push
  },

  send(title, options = {}) {
    if (this.enabled && Notification.permission === 'granted') {
      return new Notification(title, {
        icon: '/static/favicon.ico',
        ...options
      });
    }
  }
};
