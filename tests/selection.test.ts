// A selection summary: the organizer picks options, Doocide drafts what the ballots say about them,
// in the language they choose. Partial ballots and abstentions are said plainly, and nothing
// individual (ballots, names, voter ids, private notes) ever reaches the text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { addBallots, addOption, applyFolderResults, setIncludeOwn, setSummary } from '../src/app/edit';
import { draftSummary } from '../src/app/selectionText';
import { computeResults, groupView, selectionFacts } from '../src/engine';
import { checkEnvelope, generateSigner, signEnvelope } from '../src/format/crypto';
import { resultsEnvelope, resultsSummary } from '../src/format/share';
import type { Decision, Score } from '../src/format/types';
import { validateEnvelope } from '../src/format/validate';
import en from '../src/i18n/locales/en.json';
import ro from '../src/i18n/locales/ro.json';
import { makeTranslator } from '../src/i18n/translator';
import { NAME_MARKER, PRIVATE_MARKER, ballotFrom, groupDecision, participantCopy, unsigned } from './fixtures';

const root = new URL('..', import.meta.url).pathname;
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schema/doocide-v1.schema.json'), 'utf8')));
const english = makeTranslator('en', en, en);
const romanian = makeTranslator('ro', ro, en);

const scores = (cells: [string, string, number][]): Score[] => cells.map(([optionId, factorId, value]) => ({ optionId, factorId, value }));

/**
 * A named open group: the organizer's own scores, one full ballot, one partial ballot (no Looks, no
 * Car C), and one that abstains from Car C. Every ballot has a name, to prove names never reach the text.
 */
function panel(): Decision {
  const d = groupDecision({ anonymity: 'named', scoring: 'open' });
  return addBallots(
    unsigned(
      ballotFrom(d, 'voterAlpha', 6, { author: NAME_MARKER }),
      ballotFrom(d, 'voterBravo', 0, {
        author: 'Second Person',
        scores: scores([
          ['a', 'price', 7],
          ['a', 'safety', 7],
          ['b', 'price', 7],
          ['b', 'safety', 7],
        ]),
      }),
      ballotFrom(d, 'voterCharlie', 8, { author: 'Third Person', abstain: ['c'] }),
    ),
  )(d);
}

describe('the facts behind a selection', () => {
  it('rank, strongest and weakest factors, evidence, and how many ballots each rests on', () => {
    const d = panel();
    const facts = selectionFacts(d, ['a'])!;
    expect(facts.ballots).toBe(4);
    const a = facts.selected[0]!;
    // Price adds the most (7.5 × 5), then Safety (6.75 × 4); Looks is what's left.
    expect(a.strongest.map((c) => c.factorId)).toEqual(['price', 'safety']);
    expect(a.strongest[0]).toMatchObject({ value: 7.5, low: 6, high: 9, n: 4 });
    expect(a.weakest).toMatchObject({ factorId: 'looks', n: 3 });
    expect(a.facts).toEqual([{ factorId: 'price', text: '€14,000' }]);
    expect(a.rank).toBe(computeResults(groupView(d)!.merged).byOption.get('a')!.rank);
  });

  it('counts partial ballots and abstentions, apart from each other', () => {
    const facts = selectionFacts(panel(), ['c'])!;
    // The partial ballot skipped cells; the abstaining one covered everything it didn't abstain from.
    expect(facts.partialBallots).toBe(1);
    expect(facts.abstainingBallots).toBe(1);
    expect(facts.selected[0]!.abstained).toBe(1);
  });

  it('names factors scored by fewer than half the ballots, and options nobody scored', () => {
    const d = setIncludeOwn(false)(groupDecision());
    const full = ballotFrom(d, 'v1', 5);
    const withThin = addBallots(
      unsigned(full, { ...ballotFrom(d, 'v2', 5), scores: ballotFrom(d, 'v2', 5).scores.filter((s) => !(s.optionId === 'b' && s.factorId === 'looks')) }, {
        ...ballotFrom(d, 'v3', 5),
        scores: ballotFrom(d, 'v3', 5).scores.filter((s) => !(s.optionId === 'b' && s.factorId === 'looks')),
      }),
    )(d);
    expect(selectionFacts(withThin, ['b'])!.selected[0]!.thin.map((c) => c.factorId)).toEqual(['looks']);
    const withNew = addOption('Car D')(panel());
    const carD = withNew.options.at(-1)!.id;
    expect(selectionFacts(withNew, [carD])!.selected[0]!.unscored).toEqual(['price', 'safety', 'looks']);
  });

  it('compares with the best option left out, and says when a selected one ranked lower', () => {
    const d = panel();
    const ranking = computeResults(groupView(d)!.merged).ranking.map((r) => r.optionId);
    const top = ranking[0]!;
    const last = ranking.at(-1)!;
    const fair = selectionFacts(d, [top])!;
    expect(fair.bestLeftOut).toMatchObject({ optionId: ranking[1], lowestSelectedId: top });
    expect(fair.bestLeftOut!.gap).toBeGreaterThanOrEqual(0);
    expect(fair.outranked).toEqual([]);
    expect(fair.closest).toMatchObject({ selectedId: top, leftOutId: ranking[1] });
    const unfair = selectionFacts(d, [last])!;
    expect(unfair.bestLeftOut).toMatchObject({ optionId: top });
    expect(unfair.bestLeftOut!.gap).toBeLessThan(0);
    expect(unfair.outranked).toEqual([{ selectedId: last, leftOutId: top }]);
    expect(unfair.closest).toBeUndefined();
  });

  it('is for organizers with ballots only', () => {
    expect(selectionFacts(participantCopy(panel()), ['a'])).toBeNull();
  });
});

describe('the drafted summary', () => {
  it('says what the ballots say, and never anything individual', () => {
    const d = panel();
    const text = draftSummary(selectionFacts(d, ['a', 'b'])!, d, { compare: true, tr: english });
    expect(text).toContain('Choose a car: the selection');
    expect(text).toContain('Combined from 4 ballots');
    expect(text).toContain('Car A');
    expect(text).toContain('Strongest: Price 7.5 (6 to 9, 4 ballots)');
    expect(text).toContain('Evidence on Price: €14,000');
    expect(text).toContain("1 ballot doesn't cover every option and factor");
    expect(text).toContain('Compared with the options not selected');
    for (const secret of [PRIVATE_MARKER, NAME_MARKER, 'Second Person', 'Third Person', 'voterAlpha', 'voterBravo', 'voterCharlie']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('leaves the comparison out when asked', () => {
    const d = panel();
    expect(draftSummary(selectionFacts(d, ['a'])!, d, { compare: false, tr: english })).not.toContain('Compared with');
  });

  it('is written in the language the organizer picks, numbers included', () => {
    const d = panel();
    const text = draftSummary(selectionFacts(d, ['a'])!, d, { compare: true, tr: romanian });
    expect(text).toContain('Choose a car: selecția');
    expect(text).toContain('Cele mai bune: Price 7,5');
    expect(text).toContain('Comparat cu opțiunile neselectate');
    expect(text).not.toContain('Strongest');
  });
});

describe('a saved summary', () => {
  const saved = (d: Decision, text = 'We funded Car A.\nIt led on Price.') =>
    setSummary({ text, selected: ['a', 'ghost'], compare: false, ballots: 4, at: '2026-10-22T10:00:00.000Z', lang: 'en' })(d);

  it('travels in results shares, without the organizer’s own settings, and only for options that exist', () => {
    const d = saved(panel());
    const env = resultsEnvelope(d, groupView(d)!.result);
    expect(env.data.groupResult!.summary).toEqual({ text: 'We funded Car A.\nIt led on Price.', selected: ['a', 'ghost'], ballots: 4, at: '2026-10-22T10:00:00.000Z', lang: 'en' });
    expect(resultsSummary(d, groupView(d)!.result).summary).toBe(true);
    const back = validateEnvelope(JSON.parse(JSON.stringify(env)));
    expect(back.data.groupResult!.summary).toMatchObject({ text: 'We funded Car A.\nIt led on Price.', selected: ['a'] });
    expect(validateSchema(JSON.parse(JSON.stringify(env))), JSON.stringify(validateSchema.errors)).toBe(true);
  });

  it('is capped and cleaned like any incoming text', () => {
    const d = saved(panel(), `${'x'.repeat(7000)}‮end`);
    const env = resultsEnvelope(d, groupView(d)!.result);
    const back = validateEnvelope(JSON.parse(JSON.stringify(env)));
    expect(back.data.groupResult!.summary!.text.length).toBeLessThanOrEqual(6000);
    expect(back.data.groupResult!.summary!.text).not.toContain('‮');
  });

  it('is covered by the results signature, and reaches participants through the shared folder', async () => {
    const d = saved(panel());
    const signed = await signEnvelope(resultsEnvelope(d, groupView(d)!.result), await generateSigner());
    expect(await checkEnvelope(validateEnvelope(JSON.parse(JSON.stringify(signed))))).toBe('valid');
    const tampered = JSON.parse(JSON.stringify(signed));
    tampered.data.groupResult.summary.text = 'We funded Car C.';
    expect(await checkEnvelope(validateEnvelope(tampered))).toBe('invalid');
    const result = validateEnvelope(JSON.parse(JSON.stringify(signed))).data.groupResult!;
    const p = applyFolderResults(result, '2026-10-22T11:00:00.000Z')(participantCopy(d));
    expect(p.group!.result!.summary).toMatchObject({ selected: ['a'], text: 'We funded Car A.\nIt led on Price.' });
  });

  it('moves the decision on, so participants see the results as newer, and comes out cleanly', () => {
    const d = panel();
    const with_ = saved(d);
    expect(with_.updatedAt >= d.updatedAt).toBe(true);
    const without = setSummary(null)(with_);
    expect(without.group!.summary).toBeUndefined();
    expect(resultsEnvelope(without, groupView(without)!.result).data.groupResult!.summary).toBeUndefined();
    expect(setSummary(null)(without)).toBe(without);
  });
});
