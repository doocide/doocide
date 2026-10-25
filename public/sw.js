// Doocide's service worker does one thing: receive a .doocide file shared to the installed app from
// another app (a phone's share menu posts it to ./share-target). It keeps the file on this device for
// a moment and opens Doocide, which takes it once (src/app/received.ts). It caches nothing, fetches
// nothing and sends nothing: every other request goes to the network as if it weren't here.

const STASH = 'doocide-received';
const KEY = 'received-file';
/** The same cap as any file Doocide opens (LIMITS.fileBytes). */
const MAX_BYTES = 2000000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const share = new URL('share-target', self.registration.scope);
  if (event.request.method !== 'POST' || url.href !== share.href) return;
  event.respondWith(receive(event.request));
});

async function receive(request) {
  try {
    const file = (await request.formData()).get('file');
    if (file instanceof File && file.size <= MAX_BYTES) {
      const cache = await caches.open(STASH);
      await cache.put(new URL(KEY, self.registration.scope).href, new Response(file, { headers: { 'x-doocide-at': String(Date.now()) } }));
    }
  } catch {
    // Not a file Doocide can take: it just opens.
  }
  return Response.redirect(self.registration.scope, 303);
}
