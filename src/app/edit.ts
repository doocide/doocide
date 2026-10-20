// Pure edits on a decision. Each returns a new decision with updatedAt bumped.

import { newId } from '../format/ids';
import { LIMITS } from '../format/limits';
import { checkLink, cleanText } from '../format/sanitize';
import type { Decision, Note, Score, Settings, Visibility } from '../format/types';
import { WEIGHT_MAX, WEIGHT_MIN } from '../format/types';

export type Edit = (d: Decision) => Decision;

const touch = (d: Decision): Decision => ({ ...d, updatedAt: new Date().toISOString() });
const T = LIMITS.text;

/** While typing: drop unsafe characters but keep a trailing space. Names are trimmed on blur (tidy). */
const typingText = (s: string, max: number) => cleanText(s, max, false, false);

export const tidy = (s: string, max: number = T.name) => cleanText(s, max);

export const setTitle = (title: string): Edit => (d) => touch({ ...d, title: typingText(title, T.title) });

/** Run when a name field loses focus: trims what was typed. */
export const tidyNames: Edit = (d) => ({
  ...d,
  title: tidy(d.title, T.title),
  options: d.options.map((o) => ({ ...o, name: tidy(o.name) })),
  factors: d.factors.map((f) => ({ ...f, name: tidy(f.name) })),
});

export const setDescription = (text: string): Edit => (d) => {
  const description = cleanText(text, T.description, true);
  const { description: _old, ...rest } = d;
  return touch(description ? { ...rest, description } : rest);
};

export const setLang = (lang: string): Edit => (d) => touch({ ...d, lang });

export const setSettings = (patch: Partial<Settings>): Edit => (d) => {
  const settings = { ...d.settings, ...patch };
  if (!patch.baselineId && 'baselineId' in patch) delete settings.baselineId;
  // Ratings outside a smaller Pugh range are clamped, not lost.
  const pugh = d.pugh.map((s) => ({ ...s, value: Math.max(-settings.pughSteps, Math.min(settings.pughSteps, s.value)) }));
  const scores = d.scores.map((s) => ({ ...s, value: Math.min(settings.scaleMax, s.value) }));
  return touch({ ...d, settings, pugh, scores });
};

// Options

export const addOption = (name: string): Edit => (d) =>
  d.options.length >= LIMITS.options ? d : touch({ ...d, options: [...d.options, { id: newId(), name: tidy(name) }] });

export const renameOption = (id: string, name: string): Edit => (d) =>
  touch({ ...d, options: d.options.map((o) => (o.id === id ? { ...o, name: typingText(name, T.name) } : o)) });

export const setOptionDescription = (id: string, text: string): Edit => (d) =>
  touch({
    ...d,
    options: d.options.map((o) => {
      if (o.id !== id) return o;
      const description = cleanText(text, T.description, true);
      const { description: _old, ...rest } = o;
      return description ? { ...rest, description } : rest;
    }),
  });

export const removeOption = (id: string): Edit => (d) => {
  const settings = { ...d.settings };
  if (settings.baselineId === id) delete settings.baselineId;
  return touch({
    ...d,
    settings,
    options: d.options.filter((o) => o.id !== id),
    facts: d.facts.filter((f) => f.optionId !== id),
    scores: d.scores.filter((s) => s.optionId !== id),
    pugh: d.pugh.filter((s) => s.optionId !== id),
    notes: d.notes.filter((n) => n.optionId !== id),
  });
};

export const moveOption = (id: string, by: -1 | 1): Edit => (d) => touch({ ...d, options: move(d.options, id, by) });

// Factors

export const addFactor = (name: string): Edit => (d) =>
  d.factors.length >= LIMITS.factors ? d : touch({ ...d, factors: [...d.factors, { id: newId(), name: tidy(name), weight: 3 }] });

export const renameFactor = (id: string, name: string): Edit => (d) =>
  touch({ ...d, factors: d.factors.map((f) => (f.id === id ? { ...f, name: typingText(name, T.name) } : f)) });

export const setWeight = (id: string, weight: number): Edit => (d) => {
  const w = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Math.round(weight)));
  return touch({ ...d, factors: d.factors.map((f) => (f.id === id ? { ...f, weight: w } : f)) });
};

export const setGuide = (id: string, text: string): Edit => (d) =>
  touch({
    ...d,
    factors: d.factors.map((f) => {
      if (f.id !== id) return f;
      const guide = cleanText(text, T.guide, true);
      const { guide: _old, ...rest } = f;
      return guide ? { ...rest, guide } : rest;
    }),
  });

export const removeFactor = (id: string): Edit => (d) =>
  touch({
    ...d,
    factors: d.factors.filter((f) => f.id !== id),
    facts: d.facts.filter((f) => f.factorId !== id),
    scores: d.scores.filter((s) => s.factorId !== id),
    pugh: d.pugh.filter((s) => s.factorId !== id),
    notes: d.notes.filter((n) => n.factorId !== id),
  });

export const moveFactor = (id: string, by: -1 | 1): Edit => (d) => touch({ ...d, factors: move(d.factors, id, by) });

// Scores

function setCell(list: Score[], optionId: string, factorId: string, value: number | undefined): Score[] {
  const rest = list.filter((s) => !(s.optionId === optionId && s.factorId === factorId));
  return value === undefined || !Number.isFinite(value) ? rest : [...rest, { optionId, factorId, value }];
}

export const setScore = (optionId: string, factorId: string, value: number | undefined): Edit => (d) => {
  const v = value === undefined ? undefined : Math.max(0, Math.min(d.settings.scaleMax, Math.round(value * 100) / 100));
  return touch({ ...d, scores: setCell(d.scores, optionId, factorId, v) });
};

export const setRating = (optionId: string, factorId: string, value: number | undefined): Edit => (d) => {
  const steps = d.settings.pughSteps;
  const v = value === undefined ? undefined : Math.max(-steps, Math.min(steps, Math.round(value)));
  return touch({ ...d, pugh: setCell(d.pugh, optionId, factorId, v) });
};

// Facts

export const setFact = (optionId: string, factorId: string, text: string, url: string): Edit => (d) => {
  const rest = d.facts.filter((f) => !(f.optionId === optionId && f.factorId === factorId));
  const clean = cleanText(text, T.fact, true);
  const link = checkLink(url);
  if (!clean && !link) return touch({ ...d, facts: rest });
  return touch({ ...d, facts: [...rest, { optionId, factorId, text: clean, ...(link && { url: link.href }) }] });
};

// Notes

export interface Target {
  optionId?: string;
  factorId?: string;
}

export const sameTarget = (n: Target, t: Target) => n.optionId === t.optionId && n.factorId === t.factorId;

export const addNote = (target: Target, text: string, visibility: Visibility): Edit => (d) => {
  const clean = cleanText(text, T.note, true);
  if (!clean || d.notes.length >= LIMITS.notes) return d;
  const note: Note = {
    id: newId(),
    ...(target.optionId && { optionId: target.optionId }),
    ...(target.factorId && { factorId: target.factorId }),
    text: clean,
    visibility,
    createdAt: new Date().toISOString(),
  };
  return touch({ ...d, notes: [...d.notes, note] });
};

export const setNoteVisibility = (id: string, visibility: Visibility): Edit => (d) =>
  touch({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, visibility } : n)) });

export const removeNote = (id: string): Edit => (d) => touch({ ...d, notes: d.notes.filter((n) => n.id !== id) });

function move<T extends { id: string }>(items: T[], id: string, by: -1 | 1): T[] {
  const i = items.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const out = [...items];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
