// Checks the built pages. Runs after `npm run build`; CI sets REQUIRE_BUILD=1 so a missing build fails.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineBlocks } from '../tools/csp-plugin';

const root = new URL('..', import.meta.url).pathname;
const pages = ['dist/index.html', 'dist/doocide.html'].map((p) => join(root, p));
const built = pages.every(existsSync);
if (!built && process.env.REQUIRE_BUILD) throw new Error('Build output missing: run npm run build first');

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

describe.skipIf(!built)('built pages', () => {
  for (const page of pages) {
    const name = page.slice(root.length);
    const html = built ? readFileSync(page, 'utf8') : '';
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const directive = (n: string) => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${n} `)) ?? '';

    it(`${name}: sets the security policy before any script`, () => {
      expect(policy).not.toBe('');
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    });

    it(`${name}: allows exactly the inlined scripts and styles, nothing else`, () => {
      const scripts = inlineBlocks(html, 'script');
      expect(scripts.length).toBeGreaterThan(0);
      expect(directive('script-src')).toBe(`script-src ${scripts.map(sha).join(' ')}`);
      expect(directive('style-src')).toBe(`style-src ${inlineBlocks(html, 'style').map(sha).join(' ')}`);
      expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    });

    it(`${name}: talks only to its own origin`, () => {
      expect(directive('default-src')).toBe("default-src 'none'");
      expect(directive('connect-src')).toBe("connect-src 'self'");
      expect(policy).toContain("require-trusted-types-for 'script'");
    });

    it(`${name}: loads nothing from other sites`, () => {
      expect(html).not.toMatch(/<script\b[^>]*\bsrc=/);
      expect(html).not.toMatch(/<link\b[^>]*href="https?:/);
      expect(html).not.toMatch(/url\(\s*['"]?https?:/);
      expect(html).not.toMatch(/@import\s+(url\()?\s*['"]?https?:/);
    });
  }
});
