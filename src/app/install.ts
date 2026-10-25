// "Install Doocide as an app", where the browser offers it. Installed, it opens .doocide files: with a
// double-click on a computer, or from the share menu on a phone. The browser's offer is kept for the
// Install button instead of its own banner.

import { useSyncExternalStore } from 'react';

interface InstallOffer extends Event {
  /** The browser's own install question (not the page-blocking prompt the source rules ban). */
  readonly prompt: () => Promise<void>;
}

let offer: InstallOffer | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};

/** Starts listening for the browser's offer. Call once, early: it can come right after the page loads. */
export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallOffer;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** True while the browser offers to install Doocide (it's installable here, and not installed yet). */
export const useCanInstall = () => useSyncExternalStore(subscribe, () => offer !== null);

/** Shows the browser's own install question. Each offer can be used once. */
export async function install() {
  const o = offer;
  offer = null;
  changed();
  await o?.prompt().catch(() => {});
}
