// Links: https://<app>/#d=<chat-safe base64url(deflate-raw(JSON envelope))>
// The data sits after "#", which browsers never send to the server.
//
// Chat-safe: base64url, with "_" written as "-1" and "-" as "-0", so the data is letters, digits and
// "-" only. Chat apps read "_like this_" as formatting and can break a link that has underscores.
// Links from Doocide 0.5.1 and earlier carried plain base64url; they still open (see readFragment).

import { LIMITS } from './limits';
import { assertShareable } from './share';
import type { AnyEnvelope, EncryptedEnvelope } from './types';
import { FormatError, parseAnyEnvelopeText, parseIncomingText, type Incoming } from './validate';

export const LINK_KEY = 'd';
export const TEMPLATE_KEY = 't';

const B64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!B64URL.test(text)) throw new FormatError('bad-data');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    throw new FormatError('bad-data');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Base64url with nothing a chat app could take for formatting: "_" becomes "-1", "-" becomes "-0". Never ends in "-". */
export const toLinkText = (bytes: Uint8Array): string => toBase64Url(bytes).replace(/-/g, '-0').replace(/_/g, '-1');

const LINK_TEXT = /^(?:[A-Za-z0-9]|-[01])*$/;

/** The base64url that toLinkText wrote. Anything else in the text means the link was damaged. */
export function fromLinkText(text: string): string {
  if (!LINK_TEXT.test(text)) throw new FormatError('bad-data');
  return text.replace(/-([01])/g, (_m, d: string) => (d === '0' ? '-' : '_'));
}

export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates, stopping as soon as the output passes `max` bytes (zip-bomb guard). */
export async function inflateCapped(bytes: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new FormatError('too-big');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError('bad-data');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** The app address with no query and no fragment, so nothing but "#d=" ever carries data. */
export function appBase(href: string): string {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  return url.href;
}

/** The base64url payload of a link (before it's made chat-safe). */
export async function encodePayload(env: AnyEnvelope): Promise<string> {
  assertShareable(env);
  const json = JSON.stringify(env);
  return toBase64Url(await deflate(new TextEncoder().encode(json)));
}

export async function makeLink(env: AnyEnvelope, href: string): Promise<string> {
  assertShareable(env);
  return `${appBase(href)}#${LINK_KEY}=${toLinkText(await deflate(new TextEncoder().encode(JSON.stringify(env))))}`;
}

/** Any shared kind: a decision, template, invite or ballot. Never a backup. */
export async function decodePayload(payload: string): Promise<AnyEnvelope> {
  if (payload.length > LIMITS.linkChars) throw new FormatError('too-big');
  const bytes = await inflateCapped(fromBase64Url(payload), LIMITS.unpackedBytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FormatError('bad-data');
  }
  const env = parseAnyEnvelopeText(text);
  // A link is always someone else's share; it can never install a backup.
  if (env.kind === 'backup') throw new FormatError('invalid', 'Backups cannot travel in links');
  return env;
}

export type FragmentRequest =
  | { type: 'none' }
  | { type: 'data'; payload: string }
  | { type: 'template'; name: string }
  | { type: 'unknown' };

const TEMPLATE_NAME = /^[a-z0-9-]{1,64}$/;

/**
 * Reads "#d=..." or "#t=name". Fragments carry data only, never commands. A data payload comes back as
 * plain base64url. Chat-safe data has no "_" and a 0 or 1 after every "-"; anything else is a link
 * from Doocide 0.5.1 or earlier, already plain base64url.
 */
export function readFragment(hash: string): FragmentRequest {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h) return { type: 'none' };
  const eq = h.indexOf('=');
  if (eq < 0) return { type: 'unknown' };
  const key = h.slice(0, eq);
  const value = h.slice(eq + 1);
  if (key === LINK_KEY) {
    // Too long to be a real link: the decoder refuses it by length, without reading it first.
    if (value.length > LIMITS.linkChars || !LINK_TEXT.test(value)) return { type: 'data', payload: value };
    return { type: 'data', payload: fromLinkText(value) };
  }
  if (key === TEMPLATE_KEY && TEMPLATE_NAME.test(value)) return { type: 'template', name: value };
  return { type: 'unknown' };
}

/** A link to an encrypted envelope. Its contents were checked before they were encrypted; locked backups never go in links. */
export async function makeEncryptedLink(box: EncryptedEnvelope, href: string): Promise<string> {
  if (box.enc === 'passphrase' && box.wrappedKey) throw new Error('Backups never travel in links');
  return `${appBase(href)}#${LINK_KEY}=${toLinkText(await deflate(new TextEncoder().encode(JSON.stringify(box))))}`;
}

/** Like decodePayload, but an encrypted envelope comes back unopened instead of being refused. */
export async function decodeIncoming(payload: string): Promise<Incoming> {
  if (payload.length > LIMITS.linkChars) throw new FormatError('too-big');
  const bytes = await inflateCapped(fromBase64Url(payload), LIMITS.unpackedBytes);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FormatError('bad-data');
  }
  const incoming = parseIncomingText(text);
  if (incoming.type === 'plain' && incoming.env.kind === 'backup') throw new FormatError('invalid', 'Backups cannot travel in links');
  if (incoming.type === 'encrypted' && incoming.box.enc === 'passphrase' && incoming.box.wrappedKey) {
    throw new FormatError('invalid', 'Backups cannot travel in links');
  }
  return incoming;
}
