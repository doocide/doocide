// Keeps the README honest: its example link matches the example file, and every template link exists.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseEnvelopeText } from '../src/format/validate';

const root = new URL('..', import.meta.url).pathname;
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const exampleText = readFileSync(join(root, 'docs/assets/summer-trip.doocide'), 'utf8');

const decode = (payload: string) => JSON.parse(inflateRawSync(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString());

describe('README', () => {
  it('links to the example exactly as stored in docs/assets/summer-trip.doocide', () => {
    const payloads = [...readme.matchAll(/doocide\.github\.io\/#d=([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(decode(p), 'run: node tools/demo-link.mjs --update-readme').toEqual(JSON.parse(exampleText));
  });

  it('keeps the example a valid, shareable decision', () => {
    const env = parseEnvelopeText(exampleText);
    expect(env.kind).toBe('decision');
    expect(env.data.notes.every((n) => n.visibility === 'shared')).toBe(true);
  });

  it('links only to templates that exist', () => {
    const names = [...readme.matchAll(/doocide\.github\.io\/#t=([a-z0-9-]+)/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(existsSync(join(root, 'templates', `${name}.json`)), name).toBe(true);
  });

  it('points to images that exist', () => {
    for (const m of readme.matchAll(/(?:src|srcset)="(docs\/assets\/[^"]+)"/g)) expect(existsSync(join(root, m[1]!)), m[1]).toBe(true);
  });
});
