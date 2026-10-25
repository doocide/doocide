// Long descriptions don't take over the screen: the decision's description, factor descriptions and
// cell facts are cut to two lines (Clamp.tsx), and tooltips stop at 14 lines; the details dialog
// always has the full text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const rule = (css: string, selector: string) => css.match(new RegExp(`\\n${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';

describe('long descriptions', () => {
  const css = read('src/styles.css');

  it('are cut to two lines, and tooltips to fourteen', () => {
    expect(rule(css, '.clamp')).toMatch(/-webkit-line-clamp:\s*2;/);
    expect(rule(css, '.clamp')).toMatch(/overflow:\s*hidden;/);
    expect(rule(css, '.hover-tip')).toMatch(/-webkit-line-clamp:\s*14;/);
  });

  it('are cut wherever the grid and the decision page show them', () => {
    const grid = read('src/app/Grid.tsx');
    expect(grid).toContain('<ClampedText className="guide" text={guide}');
    expect(grid).toContain('<ClampedText text={fact.text}');
    expect(read('src/app/DecisionView.tsx')).toContain('<DescriptionText text={d.description}');
  });
});
