// How solid is the winner? Finds the smallest single change that hands the win to another option.
// Totals are linear in weights and scores, so each check is exact; no simulation needed.

import type { Decision } from '../format/types';
import { WEIGHT_MAX, WEIGHT_MIN } from '../format/types';
import { cellKey, cellValues, type Results } from './score';

export type Robustness =
  | 'unscored' // options and factors exist, nothing scored yet
  | 'clear' // no small change flips it
  | 'close' // one weight step or a small score change flips it
  | 'coin-flip' // the top two are within 2% of the scale
  | 'incomplete' // some scores are missing
  | 'none'; // nothing to compare yet

export type Flip =
  | { kind: 'weight'; factorId: string; from: number; to: number; challengerId: string }
  | { kind: 'score'; optionId: string; factorId: string; from: number; to: number; challengerId: string };

export interface Analysis {
  robustness: Robustness;
  /** Percentage points between first and second place. */
  margin: number;
  runnerUpId?: string;
  weightFlip?: Flip;
  scoreFlip?: Flip;
}

export function analyze(d: Decision, results: Results): Analysis {
  const [first, second] = results.ranking;
  if (!first || !second || d.factors.length === 0 || results.needsBaseline) return { robustness: 'none', margin: 0 };
  if (!results.hasScores) return { robustness: 'unscored', margin: 0 };
  const margin = first.percent - second.percent;
  if (!results.winnerId) return { robustness: 'coin-flip', margin: 0, runnerUpId: second.optionId };
  if (results.ranking.some((r) => !r.complete)) return { robustness: 'incomplete', margin, runnerUpId: second.optionId };

  const pugh = d.settings.mode === 'pugh';
  const lo = pugh ? -d.settings.pughSteps : 0;
  const hi = pugh ? d.settings.pughSteps : d.settings.scaleMax;
  const baselineId = pugh ? d.settings.baselineId : undefined;
  const values = cellValues(d);
  const value = (optionId: string, factorId: string) => (optionId === baselineId ? 0 : (values.get(cellKey(optionId, factorId)) ?? 0));
  const winner = results.winnerId;
  const winnerTotal = first.total;

  let weightFlip: Flip | undefined;
  let scoreFlip: Flip | undefined;
  const weightCost = (f: Flip) => (f.kind === 'weight' ? Math.abs(f.to - f.from) : Infinity);
  const scoreCost = (f: Flip) => (f.kind === 'score' ? Math.abs(f.to - f.from) : Infinity);

  for (const challenger of results.ranking.slice(1)) {
    // gap > 0: how far the winner is ahead of this challenger.
    const gap = winnerTotal - challenger.total;
    for (const f of d.factors) {
      const diff = value(winner, f.id) - value(challenger.optionId, f.id);

      // Weight change: the gap becomes gap + (w' - w) × diff. The challenger wins when it drops below 0.
      if (diff !== 0) {
        for (let w = WEIGHT_MIN; w <= WEIGHT_MAX; w++) {
          if (w === f.weight || gap + (w - f.weight) * diff >= 0) continue;
          const flip: Flip = { kind: 'weight', factorId: f.id, from: f.weight, to: w, challengerId: challenger.optionId };
          if (!weightFlip || weightCost(flip) < weightCost(weightFlip)) weightFlip = flip;
        }
      }

      // Score change on one cell: the smallest whole step strictly greater than gap / weight.
      const delta = Math.floor(gap / f.weight) + 1;
      const up = value(challenger.optionId, f.id) + delta;
      if (challenger.optionId !== baselineId && up <= hi) {
        const flip: Flip = { kind: 'score', optionId: challenger.optionId, factorId: f.id, from: value(challenger.optionId, f.id), to: up, challengerId: challenger.optionId };
        if (!scoreFlip || scoreCost(flip) < scoreCost(scoreFlip)) scoreFlip = flip;
      }
      const down = value(winner, f.id) - delta;
      if (winner !== baselineId && down >= lo) {
        const flip: Flip = { kind: 'score', optionId: winner, factorId: f.id, from: value(winner, f.id), to: down, challengerId: challenger.optionId };
        if (!scoreFlip || scoreCost(flip) < scoreCost(scoreFlip)) scoreFlip = flip;
      }
    }
  }

  const range = hi - lo;
  let robustness: Robustness = 'clear';
  if (Math.abs(margin) < 2) robustness = 'coin-flip';
  else if ((weightFlip && weightCost(weightFlip) <= 1) || (scoreFlip && scoreCost(scoreFlip) <= Math.max(1, range * 0.1))) {
    robustness = 'close';
  }

  return {
    robustness,
    margin,
    runnerUpId: second.optionId,
    ...(weightFlip && { weightFlip }),
    ...(scoreFlip && { scoreFlip }),
  };
}
