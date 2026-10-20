// Score inputs shared by the desktop grid, the mobile cards and the detail panel.

import type { Decision } from '../format/types';
import { t } from '../i18n';
import { Segmented } from './ui';

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
