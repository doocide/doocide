// Doocide as an installed app: it opens .doocide files (a double-click on a computer) and receives
// them from a phone's share menu, through a service worker that only catches the shared file. Files
// keep the same checks as any picked file, nothing travels in the address, and nothing is sent.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/format/limits';

const root = new URL('..', import.meta.url).pathname;
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const worker = read('public/sw.js');
const received = read('src/app/received.ts');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A PNG's width and height, from its header. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(join(root, file));
  expect(bytes.subarray(1, 4).toString('ascii'), file).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('the app manifest', () => {
  it('stays inside the app and names only Doocide', () => {
    expect(manifest).toMatchObject({ id: './', start_url: './', scope: './', name: 'Doocide', short_name: 'Doocide' });
  });

  it('lists icons that exist, at the sizes it says', () => {
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(`public/${icon.src}`);
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    expect(pngSize('public/apple-touch-icon.png')).toEqual([180, 180]);
  });

  it('opens .doocide files, at the app itself', () => {
    expect(manifest.file_handlers).toEqual([{ action: './', accept: { 'application/json': ['.doocide'] } }]);
  });

  it('receives shared files by POST to the address the worker catches, never in the address', () => {
    expect(manifest.share_target).toMatchObject({ action: './share-target', method: 'POST', enctype: 'multipart/form-data' });
    expect(manifest.share_target.params.files[0].accept).toContain('.doocide');
    expect(Object.keys(manifest.share_target.params)).toEqual(['files']);
    expect(worker).toContain("'share-target'");
  });
});

describe('the service worker', () => {
  it('caches, fetches and sends nothing, and loads no other code', () => {
    expect(code(worker)).not.toMatch(/\bfetch\(|importScripts|XMLHttpRequest|WebSocket|sendBeacon|postMessage|addAll|cache\.add\b/);
  });

  it('answers only a POST to the share address, and lets every other request through untouched', () => {
    expect(code(worker)).toMatch(/method !== 'POST' \|\| url\.href !== share\.href\) return;/);
    expect(code(worker).match(/respondWith/g)).toHaveLength(1);
  });

  it('keeps no file larger than any file Doocide opens', () => {
    expect(Number(/MAX_BYTES = (\d+)/.exec(worker)?.[1])).toBe(LIMITS.fileBytes);
  });

  it('keeps the file where the app takes it, and opens the app with a plain address', () => {
    for (const name of ['STASH', 'KEY']) {
      const inWorker = new RegExp(`const ${name} = ('[^']+')`).exec(worker)?.[1];
      expect(inWorker, name).toBeTruthy();
      expect(received, name).toContain(`const ${name} = ${inWorker}`);
    }
    expect(worker).toContain('Response.redirect(self.registration.scope, 303)');
  });

  it('is taken once, and only while fresh', () => {
    expect(code(received)).toMatch(/await cache\.delete\(key\)/);
    expect(Number(/FRESH_MS = (\d+) \* 60_000/.exec(received)?.[1])).toBeLessThanOrEqual(10);
  });
});
