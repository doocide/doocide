// Cleaning for text and links that come from someone else.

// Direction overrides, embeddings and isolates: used to make "evil.com" read as "moc.live".
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
// Invisible characters with no legitimate use in a label. ZWNJ (U+200C) and ZWJ (U+200D) are kept:
// Persian, Indic scripts and emoji sequences need them.
const INVISIBLE = /[​⁠᠎﻿]/g;
// C0/C1 control characters except tab and newline.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Long runs of combining marks ("Zalgo" text). Real scripts rarely stack more than 3.
const MARK_RUN = /(\p{M}{4})\p{M}+/gu;

/** `trim: false` is for text being typed, so a trailing space survives until the field loses focus. */
export function cleanText(input: unknown, max: number, multiline = false, trim = true): string {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFC').replace(/\r\n?/g, '\n');
  s = s.replace(BIDI_CONTROLS, '').replace(INVISIBLE, '').replace(CONTROL, '').replace(MARK_RUN, '$1');
  s = multiline ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/[\n\t]+/g, ' ');
  if (trim) s = s.trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

export interface SafeLink {
  href: string;
  /** Hostname as the browser sees it (punycode for non-Latin domains). */
  host: string;
  /** The domain uses non-Latin letters and may imitate another site. */
  lookalike: boolean;
}

/** Only plain http/https links without embedded credentials. Returns null for anything else. */
export function checkLink(raw: unknown): SafeLink | null {
  if (typeof raw !== 'string' || raw.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // "https://bank.com@evil.com" shows one site and opens another.
  if (url.username || url.password) return null;
  const host = url.hostname;
  if (!host) return null;
  const lookalike = host.split('.').some((label) => label.startsWith('xn--'));
  return { href: url.href, host, lookalike };
}

/** Spreadsheet apps run cells that start with these characters as formulas. */
export function escapeSpreadsheetText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
