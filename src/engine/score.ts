// Doocide scoring engine. MIT licensed (see LICENSE in this folder).
//
// weighted: total = Σ weight × score, missing scores count as 0.
//           percent = total / (Σ weight × scaleMax).
// pugh:     every option is rated against the baseline per factor, from -steps to +steps.
//           total = Σ weight × rating (missing = same as baseline), baseline totals 0.
//           percent = total / (Σ weight × steps), so it runs from -100 to 100.

import type { Decision } from '../format/types';

export interface OptionResult {
  optionId: string;
  total: number;
  percent: number;
  /** 1 = best. Ties share a rank (1, 1, 3). */
  rank: number;
  /** Factors with a score or rating for this option. */
  scored: number;
  complete: boolean;
  /** pugh only: factors rated better, worse, or the same as the baseline. */
  better?: number;
  worse?: number;
  same?: number;
  isBaseline?: boolean;
}

export interface Results {
  mode: Decision['settings']['mode'];
  /** Best first. */
  ranking: OptionResult[];
  byOption: Map<string, OptionResult>;
  /** Set only when exactly one option is on top. */
  winnerId?: string;
  /** pugh mode without a baseline can't be scored yet. */
  needsBaseline: boolean;
  /** At least one score or rating exists. */
  hasScores: boolean;
}

/** Value used for each cell: weighted score or pugh rating. Missing cells are absent. */
export function cellValues(d: Decision): Map<string, number> {
  const source = d.settings.mode === 'pugh' ? d.pugh : d.scores;
  return new Map(source.map((s) => [`${s.optionId} ${s.factorId}`, s.value]));
}

export const cellKey = (optionId: string, factorId: string) => `${optionId} ${factorId}`;

export function computeResults(d: Decision): Results {
  const pugh = d.settings.mode === 'pugh';
  const baselineId = pugh ? d.settings.baselineId : undefined;
  const needsBaseline = pugh && !d.options.some((o) => o.id === baselineId);
  const values = cellValues(d);
  const weightSum = d.factors.reduce((sum, f) => sum + f.weight, 0);
  const unit = pugh ? d.settings.pughSteps : d.settings.scaleMax;
  const maxTotal = weightSum * unit;

  const results: OptionResult[] = d.options.map((o) => {
    const isBaseline = o.id === baselineId;
    let total = 0;
    let scored = 0;
    let better = 0;
    let worse = 0;
    for (const f of d.factors) {
      const v = isBaseline ? 0 : values.get(cellKey(o.id, f.id));
      if (v !== undefined) scored++;
      const value = v ?? 0;
      total += f.weight * value;
      if (value > 0) better++;
      else if (value < 0) worse++;
    }
    const base: OptionResult = {
      optionId: o.id,
      total,
      percent: maxTotal > 0 ? (total / maxTotal) * 100 : 0,
      rank: 0,
      scored: isBaseline ? d.factors.length : scored,
      complete: isBaseline || scored === d.factors.length,
    };
    return pugh ? { ...base, better, worse, same: d.factors.length - better - worse, isBaseline } : base;
  });

  const ranking = [...results].sort((a, b) => b.total - a.total);
  ranking.forEach((r, i) => {
    const prev = ranking[i - 1];
    r.rank = prev && prev.total === r.total ? prev.rank : i + 1;
  });

  const top = ranking.filter((r) => r.rank === 1);
  const hasScores = values.size > 0;
  const winnerId = !needsBaseline && hasScores && top.length === 1 && d.factors.length > 0 ? top[0]!.optionId : undefined;

  return {
    mode: d.settings.mode,
    ranking,
    byOption: new Map(results.map((r) => [r.optionId, r])),
    ...(winnerId && { winnerId }),
    needsBaseline,
    hasScores,
  };
}
