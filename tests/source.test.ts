// Static checks on the source for rules that are easy to break by accident.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const sources = files(join(root, 'src')).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));

const filesMatching = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.path);

/** A file's code without its comments, for rules about what the code does rather than what the comments say. */
const codeOf = (path: string) =>
  sources
    .find((s) => s.path === path)!
    .text.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('source rules', () => {
  it('never renders HTML from strings', () => {
    expect(filesMatching(/dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/)).toEqual([]);
  });

  it('never evaluates strings as code', () => {
    expect(filesMatching(/\beval\(|new Function\(/)).toEqual([]);
  });

  it('never uses the browser’s own confirm, alert or prompt (Chrome can silently suppress them)', () => {
    expect(filesMatching(/(^|[^\w.])(window\.)?(confirm|alert|prompt)\(/m)).toEqual([]);
  });

  it('makes network requests in one place only', () => {
    expect(filesMatching(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/)).toEqual(['src/app/net.ts']);
  });

  it('uses WebCrypto in one place only, and no other crypto library', () => {
    expect(filesMatching(/crypto\.subtle/)).toEqual(['src/format/crypto.ts']);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies)).toEqual(['react', 'react-dom']);
  });

  it('derives keys only for encryption, in one place, and never in the key manager (signing keys are always generated fresh)', () => {
    expect(filesMatching(/deriveKey|deriveBits/)).toEqual(['src/format/crypto.ts']);
    expect(codeOf('src/app/keys.ts')).not.toMatch(/derive/i);
  });

  it('keeps the library passphrase out of storage and preferences', () => {
    for (const path of ['src/app/store.ts', 'src/app/prefs.ts']) expect(codeOf(path), path).not.toMatch(/passphrase/i);
  });

  it('touches folders and file handles in one place only', () => {
    expect(filesMatching(/showDirectoryPicker|FileSystem\w*Handle|webkitdirectory|getFileHandle|createWritable/)).toEqual(['src/app/folder.ts']);
  });

  it('never watches or polls a shared folder: every read and write starts with a tap', () => {
    expect(codeOf('src/app/folder.ts')).not.toMatch(/setInterval|setTimeout|FileSystemObserver|requestIdleCallback/);
  });

  it('keeps localStorage for preferences only', () => {
    expect(filesMatching(/localStorage|sessionStorage/)).toEqual(['src/app/prefs.ts']);
  });

  it('never reads data from the query string', () => {
    expect(filesMatching(/location\.search|URLSearchParams/)).toEqual([]);
  });

  it('opens external links only through the confirming component, without opener or referrer', () => {
    expect(filesMatching(/window\.open\(/)).toEqual(['src/app/ExternalLink.tsx']);
    expect(sources.find((s) => s.path === 'src/app/ExternalLink.tsx')!.text).toContain("'noopener,noreferrer'");
  });

  it('gives every target=_blank link noopener and noreferrer', () => {
    for (const s of sources) {
      for (const m of s.text.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) expect(m[0], s.path).toMatch(/rel="noopener noreferrer"/);
    }
  });
});
