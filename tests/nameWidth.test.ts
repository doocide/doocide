// Option columns and long names: a name takes up to two lines at the usual width; a longer one widens
// its column until it fits on two lines, up to a cap. And the name row stays a real table row, so
// Safari grows it with the names.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nameColumnWidth, twoLineWidth, type NameRoom } from '../src/app/nameWidth';

const root = new URL('..', import.meta.url).pathname;

/** Every character 8px wide: easy to reason about. */
const measure = (s: string) => s.length * 8;
const room: NameRoom = { base: 172, cap: 260, chrome: 53, measure };

/** How many lines a browser's greedy wrapping gives `text` at `width`, breaking at spaces. */
function lines(text: string, width: number): number {
  let count = 1;
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      count++;
      line = word;
    } else {
      line = next;
    }
  }
  return count;
}

describe('the width a name needs for two lines', () => {
  it('is the best split between two lines', () => {
    // "aa bb" | "cc dd" beats "aa" | "bb cc dd" and "aa bb cc" | "dd".
    expect(twoLineWidth('aa bb cc dd', measure)).toBe(40);
  });

  it('keeps a single word on one line', () => {
    expect(twoLineWidth('Supercalifragilistic', measure)).toBe(160);
    expect(twoLineWidth('  ', measure)).toBe(0);
  });
});

describe('an option column', () => {
  it('keeps the usual width for names that fit on two lines there', () => {
    expect(nameColumnWidth('Car A', room)).toBe(172);
    expect(nameColumnWidth('Mountain cabin by the lake', room)).toBe(172);
  });

  it('grows just enough for a longer name to fit on two lines', () => {
    const name = 'Youth Coding Club Weekend Workshops';
    const width = nameColumnWidth(name, room);
    expect(width).toBeGreaterThan(172);
    expect(width).toBeLessThan(260);
    expect(lines(name, width - room.chrome)).toBe(2);
    expect(lines(name, 172 - room.chrome)).toBe(3);
  });

  it('stops at the cap, and the name wraps further', () => {
    const name = 'Street art festival with murals, workshops and a night market for the whole neighborhood';
    expect(nameColumnWidth(name, room)).toBe(260);
    expect(lines(name, 260 - room.chrome)).toBeGreaterThan(2);
  });
});

describe('the column header', () => {
  const css = readFileSync(join(root, 'src/styles.css'), 'utf8');

  it('gives names their own header row, never a percentage height inside a header cell', () => {
    // Safari sizes a percentage height inside a table cell by the cell's last height, so a taller
    // name never grows the row and gets cut off.
    expect(readFileSync(join(root, 'src/app/Grid.tsx'), 'utf8')).toContain('className="name-row"');
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...plain.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selector]) => /\.(opt-head|name-cell|col-option)\b/.test(selector!));
    expect(rules.length).toBeGreaterThan(0);
    for (const [rule, , body] of rules) expect(body, rule).not.toMatch(/height:\s*[\d.]+%/);
  });

  it('pins the name row right under the ranks and summaries', () => {
    const px = (pattern: RegExp) => Number(css.match(pattern)?.[1]);
    const height = px(/--rank-head-h:\s*(\d+)px/);
    const big = px(/\n\.opt-big \{[^}]*[\s;{]height:\s*(\d+)px/);
    const row = px(/\n\.opt-head \.opt-row \{[^}]*[\s;{]height:\s*(\d+)px/);
    expect(height).toBe(158);
    expect(height).toBe(big + 3 * row);
  });
});
