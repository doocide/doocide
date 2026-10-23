// Turns a selection's facts (src/engine/selection.ts) into a plain-text summary the organizer can
// edit and share, in the language they choose for their readers. Only combined numbers, names and
// facts go in: never a ballot, a voter or a private note.

import type { CellFact, SelectionFacts } from '../engine/selection';
import type { Decision } from '../format/types';
import type { Translator } from '../i18n/translator';

export interface DraftOptions {
  /** Add the comparison with the options left out. */
  compare: boolean;
  tr: Translator;
}

function optionLabel(d: Decision, id: string, tr: Translator): string {
  const i = d.options.findIndex((o) => o.id === id);
  const o = d.options[i];
  if (!o) return '';
  return (tr.lang !== d.lang && o.l10n?.[tr.lang]?.name) || o.name || tr.t('option.unnamed', { n: i + 1 });
}

function factorLabel(d: Decision, id: string, tr: Translator): string {
  const i = d.factors.findIndex((f) => f.id === id);
  const f = d.factors[i];
  if (!f) return '';
  return (tr.lang !== d.lang && f.l10n?.[tr.lang]?.name) || f.name || tr.t('factor.unnamed', { n: i + 1 });
}

export function draftSummary(facts: SelectionFacts, d: Decision, { compare, tr }: DraftOptions): string {
  const pugh = d.settings.mode === 'pugh';
  const value = (v: number) => (pugh && v > 0 ? `+${tr.number(v, 1)}` : tr.number(v, 1));
  const option = (id: string) => optionLabel(d, id, tr);
  const factor = (id: string) => factorLabel(d, id, tr);
  const cell = (c: CellFact) => tr.t('summary.cell', { factor: factor(c.factorId), value: value(c.value), low: value(c.low), high: value(c.high), count: c.n });
  const list = (items: string[]) => items.join('; ');

  const lines: string[] = [tr.t('summary.title', { title: d.title || tr.t('decision.untitled') })];
  lines.push(
    tr.t('summary.basis', {
      count: facts.ballots,
      method: tr.t(d.group?.settings.combine === 'median' ? 'summary.median' : 'summary.mean'),
    }),
  );
  lines.push(tr.t('summary.selectedOf', { selected: facts.selected.length, options: facts.options }));
  const coverage: string[] = [];
  if (facts.partialBallots) coverage.push(tr.t('summary.partial', { count: facts.partialBallots }));
  if (facts.abstainingBallots) coverage.push(tr.t('summary.abstaining', { count: facts.abstainingBallots }));
  if (coverage.length) lines.push([...coverage, tr.t('summary.restsOn')].join(' '));

  facts.selected.forEach((o, i) => {
    lines.push('');
    lines.push(
      pugh
        ? tr.t('summary.optionPugh', { n: i + 1, name: option(o.optionId), rank: o.rank, options: facts.options, total: value(o.total) })
        : tr.t('summary.option', { n: i + 1, name: option(o.optionId), rank: o.rank, options: facts.options, percent: tr.number(o.percent, 1) }),
    );
    const indent = (s: string) => lines.push(`   ${s}`);
    if (o.baseline) {
      indent(tr.t('summary.baseline'));
      return;
    }
    if (o.strongest.length) indent(tr.t('summary.strongest', { cells: list(o.strongest.map(cell)) }));
    if (o.weakest) indent(tr.t('summary.weakest', { cell: cell(o.weakest) }));
    if (o.split.length) {
      indent(tr.t('summary.split', { cells: list(o.split.map((c) => tr.t('summary.splitCell', { factor: factor(c.factorId), low: value(c.low), high: value(c.high) }))) }));
    }
    for (const f of o.facts) indent(tr.t('summary.evidence', { factor: factor(f.factorId), text: f.text }));
    if (o.abstained) indent(tr.t('summary.abstained', { count: o.abstained }));
    for (const c of o.thin) indent(tr.t('summary.thin', { factor: factor(c.factorId), count: c.n, total: facts.ballots }));
    if (o.unscored.length) indent(tr.t('summary.unscored', { factors: o.unscored.map(factor).join(', ') }));
  });

  const best = facts.bestLeftOut;
  if (compare && best) {
    lines.push('', tr.t('summary.compareTitle'));
    const bullet = (s: string) => lines.push(`- ${s}`);
    const name = option(best.optionId);
    const lowest = option(best.lowestSelectedId);
    if (pugh) bullet(tr.t('summary.bestPugh', { name, rank: best.rank }));
    else if (best.gap >= 0) bullet(tr.t('summary.bestBehind', { name, rank: best.rank, percent: tr.number(best.percent, 1), gap: tr.number(best.gap, 1), lowest }));
    else bullet(tr.t('summary.bestAhead', { name, rank: best.rank, percent: tr.number(best.percent, 1), gap: tr.number(-best.gap, 1), lowest }));
    for (const o of facts.outranked) bullet(tr.t('summary.outranked', { selected: option(o.selectedId), leftOut: option(o.leftOutId) }));

    const c = facts.closest;
    if (c) {
      const pair = { selected: option(c.selectedId), leftOut: option(c.leftOutId) };
      if (c.robustness === 'incomplete') bullet(tr.t('summary.closeIncomplete', pair));
      else if (c.robustness === 'clear') bullet(tr.t('summary.closeNone', pair));
      else if (c.robustness === 'close' || c.robustness === 'coin-flip') {
        const s = c.scoreFlip;
        if (s?.kind === 'score') {
          const key = s.optionId === c.leftOutId ? 'summary.closeScoreUp' : 'summary.closeScoreDown';
          bullet(tr.t(key, { ...pair, factor: factor(s.factorId), from: value(s.from), to: value(s.to) }));
        }
        const w = c.weightFlip;
        if (w?.kind === 'weight' && Math.abs(w.to - w.from) <= 1) {
          bullet(tr.t('summary.closeWeight', { ...pair, factor: factor(w.factorId), from: tr.t(`weight.${w.from}`), to: tr.t(`weight.${w.to}`) }));
        }
      }
    }
  }

  lines.push('', tr.t('summary.footer'));
  return lines.join('\n');
}
