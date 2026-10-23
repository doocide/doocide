// What a group's ballots say about a selection: the options an organizer picked (the projects that
// get funded, say), compared with the ones left out. Facts only, no wording: see src/app/selectionText.ts.
// Partial ballots are the norm, so every number carries how many ballots it rests on.
// MIT licensed (see LICENSE in this folder).

import type { CellResult, Decision } from '../format/types';
import { groupView, spreadLevel } from './merge';
import { cellKey, computeResults } from './score';
import { analyze, type Flip, type Robustness } from './sensitivity';

/** One option on one factor, as the group scored it. `contribution`: score × importance, what it adds to the total. */
export interface CellFact {
  factorId: string;
  value: number;
  low: number;
  high: number;
  /** Ballots that scored this cell. */
  n: number;
  spread: number;
  contribution: number;
}

export interface OptionFacts {
  optionId: string;
  rank: number;
  percent: number;
  total: number;
  /** The two factors that add the most to its total. */
  strongest: CellFact[];
  /** Its lowest score, when it isn't already among the strongest. */
  weakest?: CellFact;
  /** Where the group disagreed about it, worst first (at most two). */
  split: CellFact[];
  /** Factors scored by fewer than half the ballots. */
  thin: CellFact[];
  /** Factors nobody scored for it: its total counts them as 0. */
  unscored: string[];
  /** Ballots (the organizer's own scores included) that abstained from it. */
  abstained: number;
  /** Evidence on its strongest factors, at most two. */
  facts: { factorId: string; text: string }[];
  /** The Pugh baseline: everything else is rated against it. */
  baseline: boolean;
}

export interface SelectionFacts {
  /** Ballots in the result, the organizer's own scores included when they count. */
  ballots: number;
  /** Options ranked. */
  options: number;
  /** The selected options, best first. */
  selected: OptionFacts[];
  /** Ballots that don't cover every option and factor (left out, or made before something was added). Abstentions aside. */
  partialBallots: number;
  /** Ballots that abstained from at least one option. */
  abstainingBallots: number;
  /** The best option not selected, against the lowest selected one. `gap`: percentage points the selected one is ahead (negative: behind). */
  bestLeftOut?: { optionId: string; rank: number; percent: number; lowestSelectedId: string; gap: number };
  /** Selected options that a left-out option ranked above. */
  outranked: { selectedId: string; leftOutId: string }[];
  /**
   * How close the cut is between the lowest selected option and the best one left out, when the
   * selected one is ahead: the smallest single change that would swap them (weighted scoring only).
   */
  closest?: { selectedId: string; leftOutId: string; robustness: Robustness; scoreFlip?: Flip; weightFlip?: Flip };
}

/** The organizer's decision and the ids they selected. null when there are no ballots to go on. */
export function selectionFacts(d: Decision, selectedIds: string[]): SelectionFacts | null {
  const g = d.group;
  const view = groupView(d);
  if (g?.role !== 'organizer' || !view) return null;
  const { merged, result } = view;
  const results = computeResults(merged);
  const pugh = d.settings.mode === 'pugh';
  const baselineId = pugh ? d.settings.baselineId : undefined;
  const cells = new Map(result.cells.map((c) => [cellKey(c.optionId, c.factorId), c]));
  const weight = new Map(merged.factors.map((f) => [f.id, f.weight]));
  const chosen = new Set(selectedIds);

  // Who voted: approved ballots that count, and the organizer's own scores when they do.
  const own = { scores: d.scores, pugh: d.pugh, abstain: g.abstain ?? [] };
  const ownCounts = g.includeOwn && (pugh ? d.pugh : d.scores).length > 0;
  const voters = [...(ownCounts ? [own] : []), ...g.ballots.filter((b) => b.included).map((b) => ({ scores: b.scores, pugh: b.pugh, abstain: b.abstain ?? [] }))];
  const scorable = d.options.filter((o) => o.id !== baselineId);
  let partialBallots = 0;
  let abstainingBallots = 0;
  for (const v of voters) {
    const skip = new Set(v.abstain);
    if (skip.size) abstainingBallots++;
    const scored = new Set((pugh ? v.pugh : v.scores).map((s) => cellKey(s.optionId, s.factorId)));
    if (scorable.some((o) => !skip.has(o.id) && d.factors.some((f) => !scored.has(cellKey(o.id, f.id))))) partialBallots++;
  }

  const fact = (c: CellResult): CellFact => ({
    factorId: c.factorId,
    value: c.value,
    low: c.low,
    high: c.high,
    n: c.n,
    spread: c.spread,
    contribution: c.value * (weight.get(c.factorId) ?? 0),
  });

  const ranked = results.ranking;
  const optionFacts = (optionId: string): OptionFacts => {
    const r = results.byOption.get(optionId)!;
    const isBaseline = optionId === baselineId;
    const scored: CellFact[] = [];
    const unscored: string[] = [];
    for (const f of d.factors) {
      const c = cells.get(cellKey(optionId, f.id));
      if (c) scored.push(fact(c));
      else if (!isBaseline) unscored.push(f.id);
    }
    const strongest = [...scored].filter((c) => c.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 2);
    const strong = new Set(strongest.map((c) => c.factorId));
    const weakest = [...scored]
      .filter((c) => !strong.has(c.factorId))
      .sort((a, b) => a.value - b.value || (weight.get(b.factorId) ?? 0) - (weight.get(a.factorId) ?? 0))[0];
    const split = scored.filter((c) => c.n >= 2 && spreadLevel(c.spread) > 0).sort((a, b) => b.spread - a.spread).slice(0, 2);
    const thin = scored.filter((c) => c.n * 2 < result.ballots);
    const facts = strongest.flatMap((c) => {
      const found = d.facts.find((x) => x.optionId === optionId && x.factorId === c.factorId && x.text);
      return found ? [{ factorId: c.factorId, text: found.text }] : [];
    });
    return {
      optionId,
      rank: r.rank,
      percent: r.percent,
      total: r.total,
      strongest,
      ...(weakest && { weakest }),
      split,
      thin,
      unscored,
      abstained: voters.filter((v) => v.abstain.includes(optionId)).length,
      facts,
      baseline: isBaseline,
    };
  };

  const selected = ranked.filter((r) => chosen.has(r.optionId)).map((r) => optionFacts(r.optionId));
  const leftOut = ranked.filter((r) => !chosen.has(r.optionId));
  const out: SelectionFacts = {
    ballots: result.ballots,
    options: ranked.length,
    selected,
    partialBallots,
    abstainingBallots,
    outranked: [],
  };
  if (!selected.length || !leftOut.length) return out;

  const best = leftOut[0]!;
  const lowest = selected[selected.length - 1]!;
  out.bestLeftOut = { optionId: best.optionId, rank: best.rank, percent: best.percent, lowestSelectedId: lowest.optionId, gap: lowest.percent - best.percent };
  out.outranked = selected.filter((s) => s.rank > best.rank).map((s) => ({ selectedId: s.optionId, leftOutId: best.optionId }));

  // The cut between them, measured with the same "smallest change that flips it" check as the winner.
  if (!pugh && lowest.percent > best.percent) {
    const pair = { ...merged, options: merged.options.filter((o) => o.id === lowest.optionId || o.id === best.optionId) };
    const a = analyze(pair, computeResults(pair));
    out.closest = {
      selectedId: lowest.optionId,
      leftOutId: best.optionId,
      robustness: a.robustness,
      ...(a.scoreFlip && { scoreFlip: a.scoreFlip }),
      ...(a.weightFlip && { weightFlip: a.weightFlip }),
    };
  }
  return out;
}
