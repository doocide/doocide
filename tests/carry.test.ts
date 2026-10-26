// Carrying scores into a newer version of a decision: which old option or factor becomes which new
// one, and what goes across. The same id with a different name is never matched on its own, only
// empty cells are filled, and the source is never changed, so nothing is lost.

import { describe, expect, it } from 'vitest';
import { carryFrom } from '../src/app/edit';
import { carryScores, declarationsApply, earlierVersions, looseName, reworded, suggestMatches, type CarryChoice } from '../src/format/carry';
import type { Decision, Factor, Option, Score } from '../src/format/types';
import { sampleDecision } from './fixtures';

let counter = 0;
const nextId = () => `new-${++counter}`;

/** Factor ids shaped like the real case: six groups, 37 in all, the same in both versions. */
const FACTOR_IDS = [
  ...['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08'],
  ...['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08'],
  ...['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07'],
  ...['t01', 't02', 't03', 't04'],
  ...['m01', 'm02', 'm03', 'm04', 'm05'],
  ...['u01', 'u02', 'u03', 'u04', 'u05'],
];
const factors = (): Factor[] => FACTOR_IDS.map((id, i) => ({ id, name: `Factor ${id.toUpperCase()}`, weight: (i % 5) + 1 }));

const decision = (id: string, options: Option[], scores: Score[] = [], extra: Partial<Decision> = {}): Decision => ({
  id,
  title: 'Start a company?',
  lang: 'en',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  settings: { mode: 'weighted', scaleMax: 10, pughSteps: 1 },
  options,
  factors: factors(),
  facts: [],
  scores,
  pugh: [],
  notes: [],
  ...extra,
});

/** Version 1: three options, every cell scored (option index + 1, factor position). */
const OLD_OPTIONS: Option[] = [
  { id: 'o01', name: 'One company for everything' },
  { id: 'o02', name: 'Through a fiscal sponsor' },
  { id: 'o03', name: 'Community only, no company yet' },
];
const oldVersion = () =>
  decision(
    'local-old',
    OLD_OPTIONS,
    OLD_OPTIONS.flatMap((o, i) => FACTOR_IDS.map((f, j) => ({ optionId: o.id, factorId: f, value: (i * 3 + j) % 11 }))),
  );

/** Version 2: a brand-new first option, so the old ones moved one id up. */
const NEW_OPTIONS: Option[] = [{ id: 'o01', name: 'Publishing company only' }, ...OLD_OPTIONS.map((o, i) => ({ ...o, id: `o0${i + 2}` }))];
const newVersion = (options: Option[] = NEW_OPTIONS) => decision('local-new', options);

const choiceFrom = (from: Decision, to: Decision, extra: Partial<CarryChoice> = {}): CarryChoice => ({
  options: Object.fromEntries(suggestMatches(from.options, to.options).map((m) => [m.from, m.to])),
  factors: Object.fromEntries(suggestMatches(from.factors, to.factors).map((m) => [m.from, m.to])),
  importance: true,
  notes: true,
  ...extra,
});

describe('suggested matches', () => {
  it('follows the names when ids moved: o01 to o02, o02 to o03, o03 to o04, and the new o01 gets nothing', () => {
    expect(suggestMatches(OLD_OPTIONS, NEW_OPTIONS)).toEqual([
      { from: 'o01', to: 'o02', reason: 'name' },
      { from: 'o02', to: 'o03', reason: 'name' },
      { from: 'o03', to: 'o04', reason: 'name' },
    ]);
  });

  it('never matches the same id with a different name on its own: it flags it to check', () => {
    const renamed = NEW_OPTIONS.map((o, i) => ({ ...o, name: `Plan ${i + 1}` }));
    expect(suggestMatches(OLD_OPTIONS, renamed)).toEqual([
      { from: 'o01', to: null, flag: 'renamed' },
      { from: 'o02', to: null, flag: 'renamed' },
      { from: 'o03', to: null, flag: 'renamed' },
    ]);
  });

  it('follows what the new version declares, before names and ids', () => {
    const declared = NEW_OPTIONS.map((o, i) => (i === 0 ? o : { ...o, name: `Plan ${i + 1}`, was: [`o0${i}`] }));
    expect(suggestMatches(OLD_OPTIONS, declared).map((m) => [m.from, m.to, m.reason])).toEqual([
      ['o01', 'o02', 'declared'],
      ['o02', 'o03', 'declared'],
      ['o03', 'o04', 'declared'],
    ]);
  });

  it('follows declarations only for the version they speak about', () => {
    const declared = NEW_OPTIONS.map((o, i) => (i === 0 ? o : { ...o, name: `Plan ${i + 1}`, was: [`o0${i}`] }));
    expect(suggestMatches(OLD_OPTIONS, declared, false).every((m) => m.to === null && m.flag === 'renamed')).toBe(true);
    const target = { ...newVersion(), replaces: ['file-v1'] };
    expect(declarationsApply({ ...oldVersion(), origin: { id: 'file-v1', updatedAt: '2026-10-01T00:00:00.000Z' } }, target)).toBe(true);
    // Saved before Doocide recorded origins: the person picked it, and sees each match before confirming.
    expect(declarationsApply(oldVersion(), target)).toBe(true);
    // Known to come from another file, which happens to use the same ids.
    expect(declarationsApply({ ...oldVersion(), origin: { id: 'other-file', updatedAt: '2026-10-01T00:00:00.000Z' } }, target)).toBe(false);
  });

  it('keeps a lightly reworded name on the same id, and says so', () => {
    expect(suggestMatches([{ id: 'x', name: 'Safety' }], [{ id: 'x', name: 'Safty' }])[0]).toEqual({ from: 'x', to: 'x', reason: 'reworded' });
    expect(suggestMatches([{ id: 'x', name: 'Total price' }], [{ id: 'x', name: 'Total price, all in' }])[0]!.reason).toBe('reworded');
    // One word inside a longer name isn't enough: "Inc." could be any of several new options.
    expect(suggestMatches([{ id: 'x', name: 'Inc.' }], [{ id: 'x', name: 'Publishing Inc., with the community' }])[0]!.flag).toBe('renamed');
    expect(reworded('Through a fiscal sponsor', 'One company for everything')).toBe(false);
  });

  it('ignores case, accents and punctuation in names, and flags a name that appears twice', () => {
    expect(looseName('  Comunitatea   UR, fără entitate! ')).toBe('comunitatea ur fara entitate');
    expect(suggestMatches([{ id: 'a', name: 'Fără Inc.' }], [{ id: 'b', name: 'fara inc' }])[0]).toEqual({ from: 'a', to: 'b', reason: 'name' });
    const twice = suggestMatches(
      [
        { id: 'a', name: 'Same' },
        { id: 'b', name: 'same' },
      ],
      [{ id: 'c', name: 'SAME' }],
    );
    expect(twice.map((m) => m.flag)).toEqual(['ambiguous', 'ambiguous']);
    expect(twice.every((m) => m.to === null)).toBe(true);
  });

  it('gives each new item to one old item at most', () => {
    const matches = suggestMatches(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      [{ id: 'n', name: 'N', was: ['a', 'b'] }],
    );
    expect(matches.filter((m) => m.to === 'n')).toHaveLength(1);
  });

  it('matches all 37 factors when their ids and names stay', () => {
    expect(suggestMatches(factors(), factors()).every((m, i) => m.to === FACTOR_IDS[i] && m.reason === 'name')).toBe(true);
  });
});

describe('carrying scores over', () => {
  it('the real case: every old score lands on the option it meant, the new option starts empty, and the source is untouched', () => {
    const from = oldVersion();
    const before = JSON.stringify(from);
    const to = newVersion();
    const r = carryScores(from, to, choiceFrom(from, to), nextId);
    expect(r.scores).toBe(3 * 37);
    expect(r.left).toBe(0);
    expect(r.kept).toBe(0);
    for (const [oldId, newId] of [
      ['o01', 'o02'],
      ['o02', 'o03'],
      ['o03', 'o04'],
    ]) {
      for (const f of FACTOR_IDS) {
        const was = from.scores.find((s) => s.optionId === oldId && s.factorId === f)!.value;
        expect(r.decision.scores.find((s) => s.optionId === newId && s.factorId === f)!.value).toBe(was);
      }
    }
    expect(r.decision.scores.some((s) => s.optionId === 'o01')).toBe(false);
    expect(JSON.stringify(from)).toBe(before);
  });

  it('fills only empty cells: what the new version already has stays', () => {
    const from = oldVersion();
    const to = { ...newVersion(), scores: [{ optionId: 'o02', factorId: 'e01', value: 10 }] };
    const r = carryScores(from, to, choiceFrom(from, to), nextId);
    expect(r.kept).toBe(1);
    expect(r.decision.scores.find((s) => s.optionId === 'o02' && s.factorId === 'e01')!.value).toBe(10);
  });

  it('leaves behind, in the source only, what isn’t carried', () => {
    const from = oldVersion();
    const to = newVersion();
    const choice = choiceFrom(from, to);
    choice.options.o03 = null;
    const r = carryScores(from, to, choice, nextId);
    expect(r.left).toBe(37);
    expect(r.decision.scores.some((s) => s.optionId === 'o04')).toBe(false);
    expect(from.scores.filter((s) => s.optionId === 'o03')).toHaveLength(37);
  });

  it('refuses two old options landing on one new option, whatever it is asked', () => {
    const from = oldVersion();
    const to = newVersion();
    const r = carryScores(from, to, { ...choiceFrom(from, to), options: { o01: 'o02', o02: 'o02' } }, nextId);
    expect(r.decision.scores.filter((s) => s.optionId === 'o02')).toHaveLength(37);
    expect(r.left).toBe(2 * 37);
  });

  it('scales scores to a different scale, and says so', () => {
    const from = sampleDecision();
    const to = { ...sampleDecision({ id: 'v2', scores: [] }), settings: { mode: 'weighted' as const, scaleMax: 100, pughSteps: 1 as const } };
    const r = carryScores(from, to, choiceFrom(from, to), nextId);
    expect(r.rescaled).toBe(true);
    expect(r.decision.scores.find((s) => s.optionId === 'a' && s.factorId === 'price')!.value).toBe(90);
  });

  it('carries ratings only against the same baseline', () => {
    const pugh = (baselineId: string) => ({ mode: 'pugh' as const, scaleMax: 10, pughSteps: 1 as const, baselineId });
    const from = sampleDecision({ settings: pugh('a'), pugh: [{ optionId: 'b', factorId: 'price', value: 1 }] });
    const same = carryScores(from, sampleDecision({ id: 'v2', scores: [], settings: pugh('a') }), choiceFrom(from, sampleDecision()), nextId);
    expect(same.decision.pugh).toEqual([{ optionId: 'b', factorId: 'price', value: 1 }]);
    const other = carryScores(from, sampleDecision({ id: 'v2', scores: [], settings: pugh('c') }), choiceFrom(from, sampleDecision()), nextId);
    expect(other.decision.pugh).toEqual([]);
    expect(other.ratingsLeft).toBe(1);
  });

  it('brings importance and notes only when asked, notes with new ids and never twice', () => {
    const from = sampleDecision({ factors: sampleDecision().factors.map((f) => ({ ...f, weight: 2 })) });
    const to = sampleDecision({ id: 'v2', scores: [], notes: [] });
    const plain = carryScores(from, to, choiceFrom(from, to, { importance: false, notes: false }), nextId);
    expect(plain.weights).toBe(0);
    expect(plain.decision.notes).toEqual([]);
    const full = carryScores(from, to, choiceFrom(from, to), nextId);
    expect(full.decision.factors.every((f) => f.weight === 2)).toBe(true);
    expect(full.notes).toBe(2);
    expect(full.decision.notes.map((n) => n.id)).not.toContain('n1');
    expect(full.decision.notes.find((n) => n.visibility === 'private')).toMatchObject({ optionId: 'a', factorId: 'price' });
    const again = carryScores(from, full.decision, choiceFrom(from, to), nextId);
    expect(again.notes).toBe(0);
    expect(again.scores).toBe(0);
    expect(again.kept).toBe(9);
  });
});

describe('finding earlier versions', () => {
  const at = (d: Decision, updatedAt: string) => ({ ...d, updatedAt });

  it('ranks a declared earlier version first, then the same file, then shared factors', () => {
    const target = { ...newVersion(), replaces: ['file-v1'], origin: { id: 'file-v2', updatedAt: '2026-10-25T00:00:00.000Z' } };
    const declared = { ...oldVersion(), id: 'declared', origin: { id: 'file-v1', updatedAt: '2026-10-01T00:00:00.000Z' } };
    const sameFile = { ...oldVersion(), id: 'same-file', origin: { id: 'file-v2', updatedAt: '2026-10-20T00:00:00.000Z' } };
    const similar = at({ ...oldVersion(), id: 'similar' }, '2026-10-24T00:00:00.000Z');
    const unrelated = { ...sampleDecision(), id: 'unrelated' };
    const unscored = { ...newVersion(), id: 'unscored' };
    expect(earlierVersions(target, [similar, unrelated, sameFile, unscored, declared, target])).toEqual([
      { id: 'declared', why: 'replaces', overlap: 1 },
      { id: 'same-file', why: 'sameFile', overlap: 1 },
      { id: 'similar', why: 'overlap', overlap: 1 },
    ]);
  });

  it('finds the real case’s earlier version by its factors, though nothing was declared', () => {
    expect(earlierVersions(newVersion(), [oldVersion()])).toEqual([{ id: 'local-old', why: 'overlap', overlap: 1 }]);
  });
});

describe('the edit that carries', () => {
  it('records where the scores came from, once per source, and never carries into itself', () => {
    const from = oldVersion();
    const to = newVersion();
    const choice = choiceFrom(from, to);
    const once = carryFrom(from, choice)(to);
    expect(once.scores).toHaveLength(111);
    expect(once.carriedFrom).toEqual([{ id: 'local-old', at: expect.any(String) }]);
    expect(once.updatedAt).not.toBe(to.updatedAt);
    expect(carryFrom(from, choice)(once).carriedFrom).toHaveLength(1);
    expect(carryFrom(from, choice)(from)).toBe(from);
  });
});
