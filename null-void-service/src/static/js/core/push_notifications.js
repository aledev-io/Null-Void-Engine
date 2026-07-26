export const PushNotifications = {
    async init() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log("Web Push Notifications are not supported in this browser.");
            return;
        }

        try {
            // Check current permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log("Notificaciones no permitidas por el usuario.");
                return;
            }

            // Register service worker
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log("Service Worker registered with scope:", registration.scope);

            // Wait for it to be active
            await navigator.serviceWorker.ready;

            // Get VAPID public key from backend
            const vapidRes = await fetch('/api/system/webpush/vapid_public_key', { headers: window.HEADERS });
            if (!vapidRes.ok) throw new Error("Could not fetch VAPID key");
            const vapidData = await vapidRes.json();
            const applicationServerKey = this.urlBase64ToUint8Array(vapidData.public_key);

            let subscription;
            try {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: applicationServerKey
                });
            } catch (subErr) {
                if (subErr.name === 'InvalidStateError' || subErr.message.includes('different application server key')) {
                    console.log("VAPID key changed. Unsubscribing old push subscription...");
                    const oldSub = await registration.pushManager.getSubscription();
                    if (oldSub) await oldSub.unsubscribe();

                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: applicationServerKey
                    });
                } else {
                    throw subErr;
                }
            }

            // Send subscription to backend
            const subRes = await fetch('/api/system/webpush/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...window.HEADERS
                },
                body: JSON.stringify({ subscription: subscription.toJSON() })
            });

            if (subRes.ok) {
                return true;
            } else {
                const errData = await subRes.json();
                return false;
            }

        } catch (error) {
            console.error("Error inicializando Web Push:", error);
            return false;
        }
    },

    async unsubscribe() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) {
                const endpoint = subscription.endpoint;
                const unsubscribed = await subscription.unsubscribe();
                if (unsubscribed) {
                    await fetch('/api/system/webpush/unsubscribe', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...window.HEADERS
                        },
                        body: JSON.stringify({ endpoint })
                    });
                    return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    },

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
};

window.PushNotifications = PushNotifications;

document.addEventListener('DOMContentLoaded', () => {
    // Check if user already granted permission, if so, we just subscribe quietly
    // unless they explicitly disabled it in settings
    if (Notification.permission === 'granted') {
        const isDisabled = localStorage.getItem('nv_notif_push_disabled') === 'true';
        if (!isDisabled) {
            PushNotifications.init();
        }
    }
});
