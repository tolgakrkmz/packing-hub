/* Notifications only: no fetch handler and no private page/data/photo cache. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  // Ignore any payload: no account, production or employee content on the lock screen.
  event.waitUntil(self.registration.showNotification('Package Hub', {
    body: 'Имате ново известие / You have a new notification',
    tag: 'hub-notification', icon: '/assets/package-hub-icon-192.png'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const inbox = windows.find(client => new URL(client.url).pathname === '/notifications.html');
    if (inbox) return inbox.focus();
    return self.clients.openWindow('/notifications.html');
  })());
});
