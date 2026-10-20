import { newId } from './ids';
import type { Decision } from './types';

export function emptyDecision(lang: string, title = ''): Decision {
  const now = new Date().toISOString();
  return {
    id: newId(),
    title,
    lang,
    createdAt: now,
    updatedAt: now,
    settings: { mode: 'weighted', scaleMax: 10, pughSteps: 1 },
    options: [],
    factors: [],
    facts: [],
    scores: [],
    pugh: [],
    notes: [],
  };
}

/** A new decision of your own, started from a template or someone else's share. */
export function adopt(d: Decision, lang: string): Decision {
  const now = new Date().toISOString();
  return { ...d, id: newId(), lang: d.lang || lang, createdAt: now, updatedAt: now };
}
