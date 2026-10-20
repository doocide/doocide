// Everything that leaves the device goes through here. Private notes never do.

import { FORMAT_VERSION, type Decision, type Envelope, type Kind } from './types';

export type ShareKind = Exclude<Kind, 'backup'>;

/**
 * A copy safe to give to others. Built field by field from the original, so a field added to
 * Decision later is left out until someone decides it is shareable.
 */
export function shareableCopy(d: Decision, kind: ShareKind): Decision {
  const template = kind === 'template';
  return {
    id: d.id,
    title: d.title,
    ...(d.description && { description: d.description }),
    lang: d.lang,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    settings: { ...d.settings },
    options: d.options.map((o) => ({ ...o })),
    factors: d.factors.map((f) => ({ ...f })),
    facts: d.facts.map((f) => ({ ...f })),
    scores: template ? [] : d.scores.map((s) => ({ ...s })),
    pugh: template ? [] : d.pugh.map((s) => ({ ...s })),
    notes: template ? [] : d.notes.filter((n) => n.visibility === 'shared').map((n) => ({ ...n })),
  };
}

export function shareEnvelope(d: Decision, kind: ShareKind): Envelope {
  return { doocide: FORMAT_VERSION, kind, enc: 'none', data: shareableCopy(d, kind) };
}

/** The owner's own full copy, private notes included. For saving to their own device only. */
export function backupEnvelope(d: Decision): Envelope {
  return { doocide: FORMAT_VERSION, kind: 'backup', enc: 'none', data: d };
}

/** Last line of defense before anything is put in a link or a shared file. */
export function assertShareable(env: Envelope): void {
  if (env.kind === 'backup') throw new Error('Backups are never shared');
  if (env.data.notes.some((n) => n.visibility !== 'shared')) throw new Error('Private notes are never shared');
  if (env.kind === 'template' && (env.data.scores.length || env.data.pugh.length || env.data.notes.length)) {
    throw new Error('Templates carry no scores or notes');
  }
}

export interface ShareSummary {
  options: number;
  factors: number;
  facts: number;
  scores: number;
  sharedNotes: number;
  /** Left out: the owner's private notes. */
  privateNotes: number;
  /** Left out of a template: scores and every note. */
  scoresLeftOut: number;
  notesLeftOut: number;
}

/** What a share will include and leave out, for the preview shown before anything is shared. */
export function shareSummary(d: Decision, kind: ShareKind): ShareSummary {
  const copy = shareableCopy(d, kind);
  const privateNotes = d.notes.filter((n) => n.visibility !== 'shared').length;
  const allScores = d.settings.mode === 'pugh' ? d.pugh.length : d.scores.length;
  const keptScores = copy.settings.mode === 'pugh' ? copy.pugh.length : copy.scores.length;
  return {
    options: copy.options.length,
    factors: copy.factors.length,
    facts: copy.facts.length,
    scores: keptScores,
    sharedNotes: copy.notes.length,
    privateNotes,
    scoresLeftOut: allScores - keptScores,
    notesLeftOut: d.notes.length - copy.notes.length - privateNotes,
  };
}
