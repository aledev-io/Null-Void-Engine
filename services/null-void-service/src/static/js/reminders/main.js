import { fetchAdminAlerts } from './reminders.js';

const eventsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nv_events_channel') : null;

document.addEventListener('DOMContentLoaded', () => {
    fetchAdminAlerts();
    setInterval(fetchAdminAlerts, 10000);

    window.addEventListener('calendar:changed', fetchAdminAlerts);
    window.addEventListener('calendar:synced', fetchAdminAlerts);
    window.addEventListener('storage', (e) => {
        if (e.key && e.key.startsWith('calendar_events_v1_')) {
            fetchAdminAlerts();
        }
    });

    if (eventsChannel) {
        eventsChannel.onmessage = (msg) => {
            if (msg && msg.data && msg.data.type === 'EVENT_CHANGED') {
                fetchAdminAlerts();
            }
        };
    }
});

