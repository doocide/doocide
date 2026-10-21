import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMessage } from '../src/i18n/format';
import { UI_LANGUAGES } from '../src/i18n/languages';

const root = new URL('..', import.meta.url).pathname;
const LOCALES = join(root, 'src/i18n/locales');
const load = (code: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALES, `${code.toLowerCase()}.json`), 'utf8'));
const en = load('en');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('language packs', () => {
  it('has a pack for every listed language, with exactly the English keys', () => {
    for (const { code } of UI_LANGUAGES) {
      const pack = load(code);
      expect(Object.keys(pack).sort(), code).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(pack)) expect(value.trim(), `${code} ${key}`).not.toBe('');
    }
  });

  it('keeps every {placeholder} in translations', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const { code } of UI_LANGUAGES) {
      const pack = load(code);
      for (const key of Object.keys(en)) expect(names(pack[key]!), `${code} ${key}`).toEqual(names(en[key]!));
    }
  });

  it('defines every key the code asks for', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(root, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1]!);
    }
    const dynamic = [
      ...[1, 2, 3, 4, 5].map((n) => `weight.${n}`),
      ...[1, 2, 3, 4, 5].map((n) => `safety.${n}`),
      ...['score', 'results', 'setup'].map((n) => `tabs.${n}`),
      ...['auto', 'light', 'dark'].map((n) => `theme.${n}`),
      ...['too-big', 'too-deep', 'bad-data', 'not-doocide', 'newer-version', 'encrypted', 'invalid', 'template-missing', 'ballot-unknown'].map((n) => `error.${n}`),
    ];
    for (const key of [...used, ...dynamic]) expect(en, key).toHaveProperty([key]);
  });
});

describe('message formatting', () => {
  it('uses each language’s plural rules', () => {
    const ro = load('ro')['share.countOptions']!;
    expect(formatMessage(ro, { count: 1 }, 'ro')).toBe('1 opțiune');
    expect(formatMessage(ro, { count: 3 }, 'ro')).toBe('3 opțiuni');
    expect(formatMessage(ro, { count: 20 }, 'ro')).toBe('20 de opțiuni');
    expect(formatMessage(en['share.countOptions']!, { count: 1 }, 'en')).toBe('1 option');
  });

  it('supports exact matches and nested placeholders', () => {
    const msg = en['share.privateNotesStay']!;
    expect(formatMessage(msg, { count: 0 }, 'en')).toMatch(/none yet/);
    expect(formatMessage('{n, plural, one {# of {total}} other {# of {total}}}', { n: 2, total: 5 }, 'en')).toBe('2 of 5');
  });
});
