// Carrying a person's scores from one decision into another, usually an earlier version of the same
// decision: which old option or factor becomes which new one, and what goes across. Pure, so other
// tools can use the same rules. The source decision is never changed: what isn't carried stays there.
//
// Suggested matches, strongest first:
//   1. declared   the new item says it was the old one (its `was` lists the old id)
//   2. name       the same name, ignoring case, accents, punctuation and spacing
//   3. reworded   the same id and a lightly reworded name (a typo, an added word)
// The same id with a different name is never matched on its own (`renamed`): ids get reused with a
// new meaning, and scores would land on the wrong option. Nothing is final until the person confirms.

import type { Decision, Note, Score } from './types';

export type MatchReason = 'declared' | 'name' | 'reworded';

/** renamed: same id, different name, so it may mean something else now. ambiguous: the same name more than once. */
export type MatchFlag = 'renamed' | 'ambiguous';

export interface Match {
  /** The old item's id. */
  from: string;
  /** The new item it carries into, or null: not carried. */
  to: string | null;
  reason?: MatchReason;
  flag?: MatchFlag;
}

interface Item {
  id: string;
  name: string;
  was?: string[];
}

/** A name compared loosely: no accents, no case, words only. */
export function looseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length]!;
}

/** Lightly reworded: half the words shared (an added or dropped word), or a few letters changed (a typo). */
export function reworded(a: string, b: string): boolean {
  const x = looseName(a);
  const y = looseName(b);
  if (!x || !y) return false;
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  const shared = [...wx].filter((w) => wy.has(w)).length;
  if (shared / new Set([...wx, ...wy]).size >= 0.5) return true;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length) >= 0.8;
}

/**
 * Whether the new version's declarations (`was`) speak about this source: it's one the new version says
 * it replaces, or its origin is unknown (saved before Doocide recorded where decisions come from). Never
 * for a decision known to come from another file: ids like "o01" are reused across unrelated decisions.
 */
export const declarationsApply = (source: Decision, target: Decision): boolean => !source.origin || Boolean(target.replaces?.includes(source.origin.id));

/**
 * Which old item carries into which new one, as suggested before the person decides. One new item takes
 * at most one old one. `declared`: follow the new items' `was` (see declarationsApply).
 */
export function suggestMatches(from: readonly Item[], to: readonly Item[], declared = true): Match[] {
  const matches = new Map<string, Match>(from.map((f) => [f.id, { from: f.id, to: null }]));
  const taken = new Set<string>();
  const assign = (fromId: string, toId: string, reason: MatchReason) => {
    matches.set(fromId, { from: fromId, to: toId, reason });
    taken.add(toId);
  };
  const open = (fromId: string) => matches.get(fromId)?.to === null;

  // 1. Declared by whoever made the new version.
  for (const t of declared ? to : []) {
    const old = (t.was ?? []).find((id) => open(id));
    if (old && !taken.has(t.id)) assign(old, t.id, 'declared');
  }

  // 2. The same name, when it picks out one item on each side.
  const byName = (items: readonly Item[], keep: (i: Item) => boolean) => {
    const out = new Map<string, Item[]>();
    for (const i of items.filter(keep)) {
      const key = looseName(i.name);
      if (key) out.set(key, [...(out.get(key) ?? []), i]);
    }
    return out;
  };
  const oldNames = byName(from, (f) => open(f.id));
  const newNames = byName(to, (t) => !taken.has(t.id));
  for (const [name, olds] of oldNames) {
    const news = newNames.get(name);
    if (!news) continue;
    if (olds.length === 1 && news.length === 1) assign(olds[0]!.id, news[0]!.id, 'name');
    else for (const o of olds) matches.set(o.id, { from: o.id, to: null, flag: 'ambiguous' });
  }

  // 3. The same id: matched only when the name is lightly reworded, flagged otherwise.
  const newById = new Map(to.map((t) => [t.id, t]));
  for (const f of from) {
    const m = matches.get(f.id)!;
    const t = newById.get(f.id);
    if (m.to !== null || m.flag || !t || taken.has(t.id)) continue;
    if (reworded(f.name, t.name)) assign(f.id, t.id, 'reworded');
    else matches.set(f.id, { from: f.id, to: null, flag: 'renamed' });
  }

  return from.map((f) => matches.get(f.id)!);
}

/** The person's choice: old id to new id (null or missing: not carried), and what else comes along. */
export interface CarryChoice {
  options: Record<string, string | null>;
  factors: Record<string, string | null>;
  /** Their importance for factors that carry over. */
  importance: boolean;
  /** Their notes on what carries over, and on the decision itself. */
  notes: boolean;
}

export interface CarryResult {
  /** The target with what was carried. */
  decision: Decision;
  /** Scores and ratings filled in. */
  scores: number;
  /** Cells the target already had a score for, left as they were. */
  kept: number;
  /** Scores whose option or factor isn't carried: they stay in the source only. */
  left: number;
  /** The scales differ, so scores were scaled to the new one. */
  rescaled: boolean;
  /** Ratings against a baseline that doesn't carry over to the new baseline: not carried. */
  ratingsLeft: number;
  /** Factors whose importance changed. */
  weights: number;
  notes: number;
}

const key = (s: { optionId: string; factorId: string }) => `${s.optionId} ${s.factorId}`;

/** Only real pairs, one new item per old one, in the order the old items come. */
function cleanChoice(map: Record<string, string | null>, fromIds: string[], toIds: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const id of fromIds) {
    const target = map[id];
    if (!target || !toIds.has(target) || used.has(target)) continue;
    out.set(id, target);
    used.add(target);
  }
  return out;
}

/**
 * Copies the source's scores into the target as chosen. Only empty cells are filled: what the target
 * already has stays. The source is not changed, so nothing is lost: what isn't carried stays there.
 */
export function carryScores(from: Decision, to: Decision, choice: CarryChoice, newId: () => string): CarryResult {
  const options = cleanChoice(
    choice.options,
    from.options.map((o) => o.id),
    new Set(to.options.map((o) => o.id)),
  );
  const factors = cleanChoice(
    choice.factors,
    from.factors.map((f) => f.id),
    new Set(to.factors.map((f) => f.id)),
  );
  const cell = (s: Score) => {
    const optionId = options.get(s.optionId);
    const factorId = factors.get(s.factorId);
    return optionId && factorId ? { optionId, factorId } : null;
  };

  let filled = 0;
  let kept = 0;
  let left = 0;

  // Weighted scores, scaled when the new version scores out of something else.
  const rescaled = from.settings.scaleMax !== to.settings.scaleMax;
  const scores = [...to.scores];
  const scored = new Set(scores.map(key));
  for (const s of from.scores) {
    const c = cell(s);
    if (!c) left++;
    else if (scored.has(key(c))) kept++;
    else {
      const raw = rescaled ? Math.round(((s.value * to.settings.scaleMax) / from.settings.scaleMax) * 10) / 10 : s.value;
      scores.push({ ...c, value: Math.min(to.settings.scaleMax, Math.max(0, raw)) });
      scored.add(key(c));
      filled++;
    }
  }

  // Ratings mean something only against the same baseline.
  const sameBaseline = Boolean(from.settings.baselineId && to.settings.baselineId && options.get(from.settings.baselineId) === to.settings.baselineId);
  const steps = to.settings.pughSteps;
  const pugh = [...to.pugh];
  const rated = new Set(pugh.map(key));
  let ratingsLeft = 0;
  for (const s of from.pugh) {
    const c = sameBaseline ? cell(s) : null;
    if (!c || c.optionId === to.settings.baselineId) ratingsLeft++;
    else if (rated.has(key(c))) kept++;
    else {
      pugh.push({ ...c, value: Math.max(-steps, Math.min(steps, s.value)) });
      rated.add(key(c));
      filled++;
    }
  }

  // Importance for factors that carry over.
  let weights = 0;
  const oldWeight = new Map(from.factors.map((f) => [f.id, f.weight]));
  const weightFor = new Map([...factors].map(([oldId, newId]) => [newId, oldWeight.get(oldId)!]));
  const outFactors = to.factors.map((f) => {
    const w = choice.importance ? weightFor.get(f.id) : undefined;
    if (w === undefined || w === f.weight) return f;
    weights++;
    return { ...f, weight: w };
  });

  // Notes on what carries over, and on the decision itself; never twice.
  let noteCount = 0;
  const notes: Note[] = [...to.notes];
  if (choice.notes) {
    const seen = new Set(notes.map((n) => `${n.optionId ?? ''} ${n.factorId ?? ''} ${n.text}`));
    for (const n of from.notes) {
      const optionId = n.optionId === undefined ? undefined : options.get(n.optionId);
      const factorId = n.factorId === undefined ? undefined : factors.get(n.factorId);
      if ((n.optionId !== undefined && !optionId) || (n.factorId !== undefined && !factorId)) continue;
      const sig = `${optionId ?? ''} ${factorId ?? ''} ${n.text}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const { optionId: _o, factorId: _f, ...rest } = n;
      notes.push({ ...rest, id: newId(), ...(optionId && { optionId }), ...(factorId && { factorId }) });
      noteCount++;
    }
  }

  return {
    decision: { ...to, scores, pugh, factors: outFactors, notes },
    scores: filled,
    kept,
    left,
    rescaled: rescaled && from.scores.length > 0,
    ratingsLeft,
    weights,
    notes: noteCount,
  };
}

/** Why a decision looks like an earlier version of another, strongest first. */
export type EarlierWhy = 'replaces' | 'sameFile' | 'overlap';

export interface Earlier {
  id: string;
  why: EarlierWhy;
  /** Share of the newer decision's factors found in it, by id or name (0 to 1). */
  overlap: number;
}

const hasScores = (d: Decision) => d.scores.length + d.pugh.length > 0;

/**
 * This person's decisions that look like earlier versions of `target`, most likely first: one the
 * target declares it replaces, one saved from the same file, or one sharing at least half its factors.
 * Only decisions with scores to carry.
 */
export function earlierVersions(target: Decision, library: readonly Decision[]): Earlier[] {
  const ids = new Set(target.factors.map((f) => f.id));
  const names = new Set(target.factors.map((f) => looseName(f.name)));
  const out: (Earlier & { at: string })[] = [];
  for (const d of library) {
    if (d.id === target.id || !hasScores(d)) continue;
    const overlap = target.factors.length ? d.factors.filter((f) => ids.has(f.id) || names.has(looseName(f.name))).length / target.factors.length : 0;
    const why: EarlierWhy | null =
      d.origin && target.replaces?.includes(d.origin.id)
        ? 'replaces'
        : d.origin && target.origin && d.origin.id === target.origin.id
          ? 'sameFile'
          : overlap >= 0.5
            ? 'overlap'
            : null;
    if (why) out.push({ id: d.id, why, overlap: Math.min(1, overlap), at: d.updatedAt });
  }
  const rank: Record<EarlierWhy, number> = { replaces: 0, sameFile: 1, overlap: 2 };
  return out
    .sort((a, b) => rank[a.why] - rank[b.why] || b.overlap - a.overlap || b.at.localeCompare(a.at))
    .map(({ id, why, overlap }) => ({ id, why, overlap }));
}
