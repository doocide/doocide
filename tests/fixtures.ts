import type { Decision } from '../src/format/types';

export const PRIVATE_MARKER = 'PRIVATE-7f3a-do-not-share';
export const SHARED_MARKER = 'SHARED-91bc';

/** Three options, three factors, all scored, with one private and one shared note. */
export function sampleDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec1',
    title: 'Choose a car',
    lang: 'en',
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    settings: { mode: 'weighted', scaleMax: 10, pughSteps: 1 },
    options: [
      { id: 'a', name: 'Car A' },
      { id: 'b', name: 'Car B' },
      { id: 'c', name: 'Car C' },
    ],
    factors: [
      { id: 'price', name: 'Price', weight: 5 },
      { id: 'safety', name: 'Safety', weight: 4 },
      { id: 'looks', name: 'Looks', weight: 1 },
    ],
    facts: [{ optionId: 'a', factorId: 'price', text: '€14,000', url: 'https://example.com/car-a' }],
    scores: [
      { optionId: 'a', factorId: 'price', value: 9 },
      { optionId: 'a', factorId: 'safety', value: 6 },
      { optionId: 'a', factorId: 'looks', value: 5 },
      { optionId: 'b', factorId: 'price', value: 7 },
      { optionId: 'b', factorId: 'safety', value: 8 },
      { optionId: 'b', factorId: 'looks', value: 6 },
      { optionId: 'c', factorId: 'price', value: 5 },
      { optionId: 'c', factorId: 'safety', value: 9 },
      { optionId: 'c', factorId: 'looks', value: 7 },
    ],
    pugh: [],
    notes: [
      { id: 'n1', optionId: 'a', factorId: 'price', text: PRIVATE_MARKER, visibility: 'private', createdAt: '2026-10-19T00:00:00.000Z' },
      { id: 'n2', optionId: 'b', text: SHARED_MARKER, visibility: 'shared', createdAt: '2026-10-19T00:00:00.000Z' },
    ],
    ...overrides,
  };
}

/** Deterministic pseudo-random numbers for property tests. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function randomDecision(seed: number): Decision {
  const r = rng(seed);
  const int = (n: number) => Math.floor(r() * n);
  const optionCount = 2 + int(4);
  const factorCount = 1 + int(6);
  const options = Array.from({ length: optionCount }, (_, i) => ({ id: `o${i}`, name: `Option ${i}` }));
  const factors = Array.from({ length: factorCount }, (_, i) => ({ id: `f${i}`, name: `Factor ${i}`, weight: 1 + int(5) }));
  const pughMode = r() < 0.3;
  const scores = options.flatMap((o) => factors.map((f) => ({ optionId: o.id, factorId: f.id, value: int(11) })));
  const pugh = options.slice(1).flatMap((o) => factors.map((f) => ({ optionId: o.id, factorId: f.id, value: int(3) - 1 })));
  return sampleDecision({
    id: `rand${seed}`,
    settings: pughMode ? { mode: 'pugh', scaleMax: 10, pughSteps: 1, baselineId: 'o0' } : { mode: 'weighted', scaleMax: 10, pughSteps: 1 },
    options,
    factors,
    facts: [],
    scores,
    pugh,
    notes: [],
  });
}
