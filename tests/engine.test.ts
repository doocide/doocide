import { describe, expect, it } from 'vitest';
import { analyze, computeResults, type Flip } from '../src/engine';
import type { Decision } from '../src/format/types';
import { randomDecision, sampleDecision } from './fixtures';

describe('weighted scoring', () => {
  it('weights each score by importance and ranks best first', () => {
    // Car A 5*9+4*6+1*5 = 74, Car B 5*7+4*8+1*6 = 73, Car C 5*5+4*9+1*7 = 68; max = 10*10 = 100
    const r = computeResults(sampleDecision());
    expect(r.ranking.map((x) => [x.optionId, x.total])).toEqual([['a', 74], ['b', 73], ['c', 68]]);
    expect(r.byOption.get('a')?.percent).toBeCloseTo(74);
    expect(r.winnerId).toBe('a');
  });

  it('counts missing scores as 0 and marks the option incomplete', () => {
    const d = sampleDecision();
    d.scores = d.scores.filter((s) => !(s.optionId === 'c' && s.factorId === 'safety'));
    const c = computeResults(d).byOption.get('c')!;
    expect(c.total).toBe(32);
    expect(c.complete).toBe(false);
    expect(c.scored).toBe(2);
  });

  it('shares ranks on ties and names no winner', () => {
    const d = sampleDecision({ factors: [{ id: 'price', name: 'Price', weight: 3 }] });
    d.scores = [
      { optionId: 'a', factorId: 'price', value: 8 },
      { optionId: 'b', factorId: 'price', value: 8 },
      { optionId: 'c', factorId: 'price', value: 2 },
    ];
    const r = computeResults(d);
    expect(r.ranking.map((x) => x.rank)).toEqual([1, 1, 3]);
    expect(r.winnerId).toBeUndefined();
  });

  it('names no winner before anything is scored', () => {
    const r = computeResults(sampleDecision({ scores: [] }));
    expect(r.winnerId).toBeUndefined();
    expect(r.hasScores).toBe(false);
  });
});

describe('Pugh scoring', () => {
  const pughDecision = (): Decision =>
    sampleDecision({
      settings: { mode: 'pugh', scaleMax: 10, pughSteps: 1, baselineId: 'a' },
      pugh: [
        { optionId: 'b', factorId: 'price', value: -1 },
        { optionId: 'b', factorId: 'safety', value: 1 },
        { optionId: 'b', factorId: 'looks', value: 1 },
        { optionId: 'c', factorId: 'price', value: -1 },
        { optionId: 'c', factorId: 'safety', value: 1 },
      ],
    });

  it('scores the baseline 0 and others against it', () => {
    const r = computeResults(pughDecision());
    expect(r.byOption.get('a')).toMatchObject({ total: 0, isBaseline: true, complete: true });
    expect(r.byOption.get('b')).toMatchObject({ total: 0, better: 2, worse: 1, same: 0 });
    expect(r.byOption.get('c')).toMatchObject({ total: -1, better: 1, worse: 1, same: 1, complete: false });
  });

  it('needs a baseline before it can rank', () => {
    const d = pughDecision();
    delete d.settings.baselineId;
    const r = computeResults(d);
    expect(r.needsBaseline).toBe(true);
    expect(r.winnerId).toBeUndefined();
  });
});

describe('how solid the winner is', () => {
  it('calls a one-point lead a coin flip', () => {
    const a = analyze(sampleDecision(), computeResults(sampleDecision()));
    expect(a.robustness).toBe('coin-flip');
  });

  it('calls a wide lead clear', () => {
    const d = sampleDecision();
    d.scores = d.scores.map((s) => (s.optionId === 'a' ? { ...s, value: 10 } : { ...s, value: 2 }));
    expect(analyze(d, computeResults(d)).robustness).toBe('clear');
  });

  it('waits for missing scores before judging', () => {
    const d = sampleDecision();
    d.scores.pop();
    expect(analyze(d, computeResults(d)).robustness).toBe('incomplete');
  });

  it('every reported flip really changes the winner (200 random decisions)', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const d = randomDecision(seed);
      const before = computeResults(d);
      if (!before.winnerId) continue;
      const a = analyze(d, before);
      for (const flip of [a.weightFlip, a.scoreFlip].filter((f): f is Flip => Boolean(f))) {
        const after = computeResults(applyFlip(d, flip));
        expect(after.winnerId, `seed ${seed} ${flip.kind}`).not.toBe(before.winnerId);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

function applyFlip(d: Decision, flip: Flip): Decision {
  if (flip.kind === 'weight') {
    return { ...d, factors: d.factors.map((f) => (f.id === flip.factorId ? { ...f, weight: flip.to } : f)) };
  }
  const key = d.settings.mode === 'pugh' ? 'pugh' : 'scores';
  const list = d[key].filter((s) => !(s.optionId === flip.optionId && s.factorId === flip.factorId));
  return { ...d, [key]: [...list, { optionId: flip.optionId, factorId: flip.factorId, value: flip.to }] };
}
