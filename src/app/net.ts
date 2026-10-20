// The only place the app makes network requests: language packs and templates, by fixed path,
// from its own origin. Nothing from a link or a file ever becomes an address here.

import { LIMITS } from '../format/limits';

const PACK_PATH = /^(locales|templates)\/[a-z0-9-]+\.json$/;

export async function fetchPack(path: string): Promise<string | null> {
  if (!PACK_PATH.test(path)) return null;
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return null;
  const url = new URL(path, document.baseURI);
  if (url.origin !== location.origin) return null;
  try {
    const res = await fetch(url, { credentials: 'omit', redirect: 'error' });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > LIMITS.fileBytes ? null : text;
  } catch {
    return null;
  }
}
