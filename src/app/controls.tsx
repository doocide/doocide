// Inputs shared by the desktop grid, the mobile cards and the detail panel: names and scores.

import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { newId } from '../format/ids';
import type { Decision } from '../format/types';
import { t } from '../i18n';
import { Segmented } from './ui';

/** Grows a text area to fit its text, so nothing is ever hidden behind a scroll. */
function fit(el: HTMLTextAreaElement) {
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * An option or factor name that wraps onto as many lines as it needs, so the whole name always
 * shows. It's still one line of text: Enter finishes editing, and pasted line breaks become spaces.
 */
export function NameField({
  value,
  placeholder,
  label,
  lang,
  readOnly,
  className = 'name-input',
  autoFocus,
  onChange,
  onBlur,
}: {
  value: string;
  placeholder: string;
  label: string;
  lang: string;
  readOnly?: boolean;
  className?: string;
  /** Takes focus when it first appears: the name of an option or factor just added. */
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The width the field was last fitted at.
  const fitted = useRef(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    fit(ref.current);
    fitted.current = ref.current.clientWidth;
  }, [value, placeholder]);
  // Columns can get wider or narrower (window size, long names); refit when the width changes.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === fitted.current) return;
      fitted.current = el.clientWidth;
      fit(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`name-field ${className}`}
      value={value}
      placeholder={placeholder}
      dir="auto"
      lang={lang}
      maxLength={200}
      readOnly={readOnly}
      autoFocus={autoFocus}
      aria-label={label}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={onBlur}
    />
  );
}

/**
 * The id of an option or factor about to be added, so its name field takes focus when it appears, once:
 * after that it's cleared, and switching layouts doesn't pull focus back to it.
 */
export function useFocusNew(): { focusId: string | null; nextId: () => string } {
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId) setFocusId(null);
  }, [focusId]);
  return {
    focusId,
    nextId: () => {
      const id = newId();
      setFocusId(id);
      return id;
    },
  };
}

export function pughChoices(steps: 1 | 2) {
  const all = [
    { value: -2, label: '−−', title: t('pugh.muchWorse'), tone: 'bad' as const },
    { value: -1, label: '−', title: t('pugh.worse'), tone: 'bad' as const },
    { value: 0, label: 'S', title: t('pugh.same') },
    { value: 1, label: '+', title: t('pugh.better'), tone: 'good' as const },
    { value: 2, label: '++', title: t('pugh.muchBetter'), tone: 'good' as const },
  ];
  return steps === 2 ? all : all.slice(1, 4);
}

export function ScoreInput({
  d,
  value,
  onChange,
  readOnly,
  label,
}: {
  d: Decision;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  readOnly?: boolean;
  label: string;
}) {
  return (
    <input
      className="score-input"
      type="number"
      inputMode="decimal"
      min={0}
      max={d.settings.scaleMax}
      step={1}
      value={value ?? ''}
      placeholder="–"
      readOnly={readOnly}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

export function PughInput({
  d,
  value,
  onChange,
  readOnly,
  label,
}: {
  d: Decision;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  readOnly?: boolean;
  label: string;
}) {
  return (
    <Segmented
      value={value}
      options={pughChoices(d.settings.pughSteps)}
      label={label}
      readOnly={readOnly}
      onChange={(v) => onChange(v === value ? undefined : v)}
    />
  );
}

/** Background strength for a cell: 0..1 for weighted, -1..1 for pugh. */
export function heat(d: Decision, value: number | undefined): number {
  if (value === undefined) return 0;
  return d.settings.mode === 'pugh' ? value / d.settings.pughSteps : value / d.settings.scaleMax;
}

export function formatValue(d: Decision, value: number | undefined): string {
  if (value === undefined) return '–';
  if (d.settings.mode !== 'pugh') return String(value);
  return value === 0 ? 'S' : value > 0 ? '+'.repeat(value) : '−'.repeat(-value);
}

/** Where a hover tip sits: under the element, or above it when there's no room below. In viewport pixels. */
interface TipSpot {
  left: number;
  top?: number;
  bottom?: number;
}

const TIP_ROOM = 160;
const TIP_WIDTH = 320;

/**
 * A tip that shows the moment the pointer is over an element and goes as soon as it leaves: no
 * delay, unlike the browser's own. Plain text only (it may be someone else's), drawn on top of the
 * page so a scrolling table can't cut it off. Nothing is shown when there's no text. `anchor` places
 * it by another element than the one hovered.
 */
export function useHoverTip(
  text: string | undefined,
  lang?: string,
  anchor?: (hovered: HTMLElement) => Element,
): { props: { onMouseEnter?: (e: MouseEvent<HTMLElement>) => void; onMouseLeave?: () => void; 'aria-describedby'?: string }; tip: ReactNode } {
  const id = useId();
  const [spot, setSpot] = useState<TipSpot | null>(null);
  const shown = Boolean(text && spot);

  // A tip pinned to the viewport would drift from its element while the page scrolls, so it goes.
  useEffect(() => {
    if (!shown) return;
    const hide = () => setSpot(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [shown]);

  if (!text) return { props: {}, tip: null };
  const props = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      const r = (anchor ? anchor(e.currentTarget) : e.currentTarget).getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - Math.min(TIP_WIDTH, window.innerWidth - 16) - 8));
      setSpot(window.innerHeight - r.bottom >= TIP_ROOM ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
    },
    onMouseLeave: () => setSpot(null),
    ...(shown && { 'aria-describedby': id }),
  };
  const tip =
    shown && spot
      ? createPortal(
          <div id={id} className="hover-tip" role="tooltip" dir="auto" lang={lang} style={{ left: spot.left, top: spot.top, bottom: spot.bottom }}>
            {text}
          </div>,
          document.body,
        )
      : null;
  return { props, tip };
}
