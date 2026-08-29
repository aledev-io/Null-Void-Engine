self.addEventListener('push', function(event) {
    if (event.data) {
        try {
            const data = event.data.json();
            const options = {
                body: data.body,
                icon: data.icon || '/static/favicon.ico',
                badge: data.badge || '/static/favicon.ico',
                tag: data.tag || (data.category === 'chat' ? `chat-${data.sender_id || data.title}` : (data.category || 'general')),
                renotify: true,
                data: {
                    url: data.url || '/'
                }
            };
            if (data.image || data.photo) {
                options.image = data.image || data.photo;
            }
            event.waitUntil(
                self.registration.showNotification(data.title, options)
            );
        } catch (e) {
            console.error("Error parseando notificación push:", e);
        }
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    if (event.notification.data && event.notification.data.url) {
        event.waitUntil(
            clients.openWindow(event.notification.data.url)
        );
    }
});
