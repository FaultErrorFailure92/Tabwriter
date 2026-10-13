// Kill switch for the old offline cache: the app used to live at this address.
// Browsers that still have the old service worker fetch this file on their next visit,
// which removes the old worker and its cache and reloads the page (the landing page then shows).
// The app's own offline cache under /app/ is left alone.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.includes('/app/')).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const wins = await self.clients.matchAll({ type: 'window' });
      for (const w of wins) w.navigate(w.url);
    })(),
  );
});
