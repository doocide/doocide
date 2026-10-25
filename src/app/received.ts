// Files shared to the installed app from another app, through a phone's share menu. The browser posts
// the file to Doocide's address; the service worker (public/sw.js) catches it, keeps it for a moment
// on this device and opens Doocide, which takes it from here, once. Nothing travels in the address,
// and nothing is sent anywhere: there's no server to send it to.
//
// The only file that touches the service worker and its storage.

import { appBase } from '../format/codec';

const WORKER = './sw.js';
/** Must match public/sw.js. */
const STASH = 'doocide-received';
const KEY = 'received-file';
/** A shared file waits at most this long, so one left behind never opens later by surprise. */
const FRESH_MS = 5 * 60_000;

interface TrustedTypes {
  createPolicy(name: string, rules: { createScriptURL: (url: string) => string }): { createScriptURL(url: string): unknown };
}

/**
 * Registers the service worker that receives shared files: online only, since it's served next to
 * the app. The page only allows script addresses made by a named policy, so the one worker address
 * goes through one.
 */
export function registerWorker() {
  if (__OFFLINE__ || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const types = (window as { trustedTypes?: TrustedTypes }).trustedTypes;
  const url = types
    ? types
        .createPolicy('doocide-worker', {
          createScriptURL: (u) => {
            if (u !== WORKER) throw new TypeError('Not Doocide’s worker');
            return u;
          },
        })
        .createScriptURL(WORKER)
    : WORKER;
  navigator.serviceWorker.register(url as string, { scope: './' }).catch(() => {
    // Without it, sharing to Doocide doesn't work; everything else does.
  });
}

/** The file just shared to Doocide, if any. It's removed as it's taken, and ignored when it isn't fresh. */
export async function takeReceived(): Promise<Blob | null> {
  if (__OFFLINE__ || typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(STASH);
    const key = new URL(KEY, appBase(location.href)).href;
    const kept = await cache.match(key);
    if (!kept) return null;
    await cache.delete(key);
    const at = Number(kept.headers.get('x-doocide-at'));
    return Date.now() - at < FRESH_MS ? await kept.blob() : null;
  } catch {
    return null;
  }
}
