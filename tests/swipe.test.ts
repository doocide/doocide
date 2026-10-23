// Swiping between pages on phones: only a clearly sideways, long enough or quick enough swipe turns
// the page, and right-to-left pages turn the other way.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { swipeTurn } from '../src/app/swipe';

const root = new URL('..', import.meta.url).pathname;

describe('swiping between pages', () => {
  it('turns on a long sideways drag, left for next and right for previous', () => {
    expect(swipeTurn(-120, 10, 600, 375)).toBe('next');
    expect(swipeTurn(120, -10, 600, 375)).toBe('previous');
  });

  it('turns on a quick flick, even a short one', () => {
    expect(swipeTurn(-50, 4, 80, 375)).toBe('next');
    expect(swipeTurn(-50, 4, 400, 375)).toBeNull();
  });

  it('never turns while scrolling up and down, or on a short slow nudge', () => {
    expect(swipeTurn(-90, -120, 300, 375)).toBeNull();
    expect(swipeTurn(-30, 0, 400, 375)).toBeNull();
  });

  it('turns the other way when the page reads right to left', () => {
    expect(swipeTurn(-120, 0, 600, 375, true)).toBe('previous');
    expect(swipeTurn(120, 0, 600, 375, true)).toBe('next');
  });

  it('never starts on a slider, whose whole track moves its value on many phones', () => {
    expect(readFileSync(join(root, 'src/app/swipe.ts'), 'utf8')).toContain('input[type="range"]');
  });
});

describe('zooming', () => {
  it('stays possible: the viewport never limits it', () => {
    const viewport = readFileSync(join(root, 'index.html'), 'utf8').match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });

  it('doesn’t jump into text fields on touch screens: they use at least 16px', () => {
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8');
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*input,\s*select,\s*textarea,[^}]*font-size: 16px;/);
  });
});
