// Swiping between pages on phones: one factor or one option at a time. A clearly sideways swipe turns
// the page; scrolling up and down never does. Touches that start on a slider, a text field or a select
// are left alone: on many phones touching a slider's track moves its value, so the whole slider is out.

import { useRef, type TouchEvent } from 'react';

/** Where a swipe can't start. */
const NO_SWIPE = 'input[type="range"], input[type="text"], input[type="number"], input:not([type]), textarea, select, [data-noswipe]';

/** How far a finger moves before the gesture counts as sideways or up-and-down, in pixels. */
const DEAD_ZONE = 10;

export type SwipeTurn = 'next' | 'previous' | null;

/**
 * What a finished sideways drag does: a long drag (over a fifth of the page) or a quick flick turns
 * the page. Left means next, unless the page reads right to left. Pure, so it can be tested.
 */
export function swipeTurn(dx: number, dy: number, ms: number, width: number, rtl = false): SwipeTurn {
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return null;
  const far = Math.abs(dx) > width * 0.2;
  const fast = Math.abs(dx) > 40 && Math.abs(dx) / Math.max(1, ms) > 0.45;
  if (!far && !fast) return null;
  return (dx < 0) !== rtl ? 'next' : 'previous';
}

interface Drag {
  x: number;
  y: number;
  t: number;
  axis?: 'x' | 'y';
}

/**
 * Touch handlers for a pager. `onNext` / `onPrevious` are undefined when there's no page that way:
 * the page then resists the drag and springs back. `page` goes on the element that follows the finger.
 */
export function useSwipe({ onNext, onPrevious }: { onNext: (() => void) | undefined; onPrevious: (() => void) | undefined }) {
  const page = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const rtl = () => document.documentElement.dir === 'rtl';

  const settle = (animate: boolean) => {
    const el = page.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 160ms ease-out' : '';
    el.style.transform = '';
  };

  const handlers = {
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      drag.current = e.touches.length === 1 && touch && !(e.target as Element).closest(NO_SWIPE) ? { x: touch.clientX, y: touch.clientY, t: e.timeStamp } : null;
    },
    onTouchMove: (e: TouchEvent) => {
      const d = drag.current;
      const touch = e.touches[0];
      if (!d || !touch) return;
      const dx = touch.clientX - d.x;
      const dy = touch.clientY - d.y;
      if (!d.axis) {
        if (Math.hypot(dx, dy) < DEAD_ZONE) return;
        d.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
      }
      if (d.axis !== 'x' || !page.current) return;
      // Toward a page that exists, the page follows the finger; toward the end, it resists.
      const toward = (dx < 0) !== rtl() ? onNext : onPrevious;
      page.current.style.transition = '';
      page.current.style.transform = `translateX(${toward ? dx : dx * 0.25}px)`;
    },
    onTouchEnd: (e: TouchEvent) => {
      const d = drag.current;
      drag.current = null;
      const touch = e.changedTouches[0];
      if (!d || d.axis !== 'x' || !touch) return;
      const turn = swipeTurn(touch.clientX - d.x, touch.clientY - d.y, e.timeStamp - d.t, page.current?.offsetWidth ?? 320, rtl());
      const go = turn === 'next' ? onNext : turn === 'previous' ? onPrevious : undefined;
      settle(!go);
      go?.();
    },
    onTouchCancel: () => {
      drag.current = null;
      settle(true);
    },
  };

  return { page, handlers };
}
