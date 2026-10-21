// Combines a group's ballots into one result, and finds where the group disagrees.
// MIT licensed (see LICENSE in this folder).
//
// Each cell combines the ballots that scored it (average or median); a ballot that skipped a cell
// doesn't count as 0. spread = standard deviation ÷ half the scale's range, so 0 means everyone gave
// the same score and 1 means the group split between the two ends of the scale.

import type { CellResult, Decision, GroupResult, GroupSettings, Score, Weight, WeightResult } from '../format/types';
import { WEIGHT_MAX, WEIGHT_MIN } from '../format/types';
import { cellKey } from './score';

/** One set of scores going into the result: a ballot, or the organizer's own scores. */
export interface Voter {
  scores: Score[];
  pugh: Score[];
  /** Only when everyone sets importance. Missing factors fall back to the organizer's importance. */
  weights?: Weight[];
}

export type Combine = GroupSettings['combine'];

export function combine(values: number[], how: Combine): number {
  if (values.length === 0) return 0;
  if (how === 'median') {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function summarize(values: number[], how: Combine, range: number) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return {
    n: values.length,
    value: round(combine(values, how)),
    low: Math.min(...values),
    high: Math.max(...values),
    spread: range > 0 ? round(Math.min(1, sd / (range / 2))) : 0,
  };
}

/** The range of the decision's scale: 0..scaleMax, or -steps..+steps against the baseline. */
export function scaleRange(d: Decision): { lo: number; hi: number } {
  return d.settings.mode === 'pugh' ? { lo: -d.settings.pughSteps, hi: d.settings.pughSteps } : { lo: 0, hi: d.settings.scaleMax };
}

/** Combines voters into a group result. Only options and factors the decision still has are counted. */
export function combineVoters(d: Decision, voters: Voter[], settings: Pick<GroupSettings, 'weights' | 'combine'>): GroupResult {
  const pugh = d.settings.mode === 'pugh';
  const { lo, hi } = scaleRange(d);
  const baselineId = pugh ? d.settings.baselineId : undefined;

  const byCell = new Map<string, number[]>();
  for (const v of voters) {
    for (const s of pugh ? v.pugh : v.scores) {
      const key = cellKey(s.optionId, s.factorId);
      const values = byCell.get(key);
      if (values) values.push(s.value);
      else byCell.set(key, [s.value]);
    }
  }

  const cells: CellResult[] = [];
  for (const o of d.options) {
    if (o.id === baselineId) continue;
    for (const f of d.factors) {
      const values = byCell.get(cellKey(o.id, f.id));
      if (values?.length) cells.push({ optionId: o.id, factorId: f.id, ...summarize(values, settings.combine, hi - lo) });
    }
  }

  let weights: WeightResult[] | undefined;
  if (settings.weights === 'everyone' && voters.length > 0) {
    weights = d.factors.map((f) => {
      const values = voters.map((v) => v.weights?.find((w) => w.factorId === f.id)?.weight ?? f.weight);
      return { factorId: f.id, ...summarize(values, settings.combine, WEIGHT_MAX - WEIGHT_MIN) };
    });
  }

  return { ballots: voters.length, cells, ...(weights && { weights }) };
}

/**
 * The decision as the group sees it: combined scores in place of anyone's own, and combined
 * importance when everyone sets it. For display and scoring only; never stored or shared.
 */
export function applyResult(d: Decision, result: GroupResult): Decision {
  const values: Score[] = result.cells.map((c) => ({ optionId: c.optionId, factorId: c.factorId, value: c.value }));
  const weights = new Map(result.weights?.map((w) => [w.factorId, w.value]));
  const { group: _group, ...rest } = d;
  const pugh = d.settings.mode === 'pugh';
  return {
    ...rest,
    factors: d.factors.map((f) => (weights.has(f.id) ? { ...f, weight: weights.get(f.id)! } : f)),
    scores: pugh ? [] : values,
    pugh: pugh ? values : [],
  };
}

const hasScores = (v: Voter, d: Decision) => (d.settings.mode === 'pugh' ? v.pugh.length : v.scores.length) > 0;

/** The organizer's voters: approved ballots that are included, plus their own scores when those count. */
export function groupVoters(d: Decision): Voter[] {
  const g = d.group;
  if (!g || g.role !== 'organizer') return [];
  const own: Voter = {
    scores: d.scores,
    pugh: d.pugh,
    ...(g.settings.weights === 'everyone' && { weights: d.factors.map((f) => ({ factorId: f.id, weight: f.weight })) }),
  };
  return [...(g.includeOwn && hasScores(own, d) ? [own] : []), ...g.ballots.filter((b) => b.included)];
}

export interface GroupView {
  /** The decision with the group's combined scores, ready for computeResults and analyze. */
  merged: Decision;
  result: GroupResult;
}

/**
 * What the group thinks, from wherever this device knows it: the organizer's approved ballots, the
 * results that came with an open invite, or a results share someone sent. null when there's nothing yet.
 */
export function groupView(d: Decision): GroupView | null {
  const g = d.group;
  if (g?.role === 'organizer') {
    const voters = groupVoters(d);
    if (!voters.length) return null;
    const result = combineVoters(d, voters, g.settings);
    return { merged: applyResult(d, result), result };
  }
  const result = g?.result ?? d.groupResult;
  return result ? { merged: applyResult(d, result), result } : null;
}

/** 0: the group roughly agrees. 1: some disagreement. 2: the group is split. */
export function spreadLevel(spread: number): 0 | 1 | 2 {
  return spread >= 0.5 ? 2 : spread >= 0.2 ? 1 : 0;
}

/** Cells where the group disagrees most, worst first. Needs at least two ballots on a cell. */
export function disagreements(result: GroupResult, limit = 5): CellResult[] {
  return result.cells
    .filter((c) => c.n >= 2 && spreadLevel(c.spread) > 0)
    .sort((a, b) => b.spread - a.spread || b.high - b.low - (a.high - a.low))
    .slice(0, limit);
}

/** Factors whose importance the group disagrees on, worst first. */
export function weightDisagreements(result: GroupResult, limit = 3): WeightResult[] {
  return (result.weights ?? [])
    .filter((w) => w.n >= 2 && spreadLevel(w.spread) > 0)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, limit);
}
