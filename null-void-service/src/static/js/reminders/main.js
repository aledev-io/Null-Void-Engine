import { fetchAdminAlerts } from './reminders.js';

document.addEventListener('DOMContentLoaded', () => {
    fetchAdminAlerts();
    setInterval(fetchAdminAlerts, 60000);
});
