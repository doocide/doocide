// Inputs shared by the desktop grid, the mobile cards and the detail panel: names and scores.

import { useEffect, useLayoutEffect, useRef } from 'react';
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
  onChange,
  onBlur,
}: {
  value: string;
  placeholder: string;
  label: string;
  lang: string;
  readOnly?: boolean;
  className?: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) fit(ref.current);
  }, [value, placeholder]);
  // Columns can get wider or narrower (window size, other names); refit when the width changes.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
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
