// How wide an option's column gets for its name. A name takes up to two lines at the usual width; a
// longer one widens its column until it fits on two lines, up to a cap, and wraps further after that.

import { useLayoutEffect, useState, type RefObject } from 'react';

/** The narrowest width that fits `text` on two lines, breaking only at spaces. A single word stays on one line. */
export function twoLineWidth(text: string, measure: (s: string) => number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return measure(words.join(' '));
  let best = Infinity;
  for (let k = 1; k < words.length; k++) {
    best = Math.min(best, Math.max(measure(words.slice(0, k).join(' ')), measure(words.slice(k).join(' '))));
  }
  return best;
}

export interface NameRoom {
  /** The column's usual width, and the most it grows to. */
  base: number;
  cap: number;
  /** What the column spends besides the name's text: padding, borders, the details button. */
  chrome: number;
  /** A text's width in the names' font. */
  measure: (s: string) => number;
}

/** A column's width for a name: the usual width, unless the name needs more to fit on two lines; never past the cap. */
export function nameColumnWidth(text: string, room: NameRoom): number {
  // 2px for rounding between measuring and layout.
  const need = Math.ceil(twoLineWidth(text, room.measure) + room.chrome) + 2;
  return Math.min(room.cap, Math.max(room.base, need));
}

/** The details button beside a name can show a note count, which makes it wider than its usual 28px. */
const BUTTON_ROOM = 40;

/**
 * Measures the room option names get in a table, from the first name on screen: their font, what its
 * cell spends besides the text, and the usual and largest widths (the CSS variables `baseVar` and
 * `capVar`). Measured once a name is there, and again if the names all go and come back.
 */
export function useNameRoom(table: RefObject<HTMLTableElement | null>, baseVar: string, capVar: string, hasNames: boolean): NameRoom | null {
  const [room, setRoom] = useState<NameRoom | null>(null);
  useLayoutEffect(() => {
    const el = table.current;
    const field = el?.querySelector<HTMLTextAreaElement>('textarea.opt-name');
    const cell = field?.closest('th');
    const ctx = hasNames ? document.createElement('canvas').getContext('2d') : null;
    if (!el || !field || !cell || !ctx) return;
    const fs = getComputedStyle(field);
    ctx.font = `${fs.fontStyle} ${fs.fontWeight} ${fs.fontSize} ${fs.fontFamily}`;
    const text = field.clientWidth - parseFloat(fs.paddingLeft) - parseFloat(fs.paddingRight);
    const button = field.parentElement?.querySelector('button')?.getBoundingClientRect().width ?? 0;
    const css = getComputedStyle(el);
    const base = parseFloat(css.getPropertyValue(baseVar));
    const cap = parseFloat(css.getPropertyValue(capVar));
    const chrome = cell.getBoundingClientRect().width - text - button + Math.max(button, BUTTON_ROOM);
    if (![base, cap, chrome].every(Number.isFinite)) return;
    setRoom({ base, cap, chrome, measure: (s) => ctx.measureText(s).width });
  }, [table, baseVar, capVar, hasNames]);
  return room;
}
