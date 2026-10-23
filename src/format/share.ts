// Everything that leaves the device goes through here. Private notes never do, and neither does a
// decision's group data (approved ballots, voter ids). Previews are counted from the exact envelope
// that will be sent, so what the preview lists is what goes out.

import { dayOnly } from './sanitize';
import {
  FORMAT_VERSION,
  type AnyEnvelope,
  type Ballot,
  type BallotEnvelope,
  type Decision,
  type DecisionKind,
  type Envelope,
  type GroupResult,
  type Invite,
  type InviteEnvelope,
  type Note,
} from './types';

export type ShareKind = Exclude<DecisionKind, 'backup'>;

/**
 * A copy safe to give to others. Built field by field from the original, so a field added to
 * Decision later (like `group`) is left out until someone decides it is shareable.
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

/** The owner's own full copy, private notes and group data included. For saving to their own device only. */
export function backupEnvelope(d: Decision): Envelope {
  return { doocide: FORMAT_VERSION, kind: 'backup', enc: 'none', data: d };
}

/** Field by field: combined numbers only, never who gave them. */
function copyResult(r: GroupResult): GroupResult {
  return {
    ballots: r.ballots,
    cells: r.cells.map((c) => ({ optionId: c.optionId, factorId: c.factorId, n: c.n, value: c.value, low: c.low, high: c.high, spread: c.spread })),
    ...(r.weights && {
      weights: r.weights.map((w) => ({ factorId: w.factorId, n: w.n, value: w.value, low: w.low, high: w.high, spread: w.spread })),
    }),
  };
}

/**
 * The group's combined results, for everyone to see: the decision as a plain share, but with the
 * organizer's own scores swapped for the combined ones. No individual ballots, no names.
 */
export function resultsEnvelope(d: Decision, result: GroupResult): Envelope {
  // The organizer's selection summary goes along when they added it, field by field.
  const s = d.group?.role === 'organizer' ? d.group.summary : undefined;
  const summary = s && { text: s.text, selected: [...s.selected], ballots: s.ballots, at: s.at, lang: s.lang };
  return {
    doocide: FORMAT_VERSION,
    kind: 'decision',
    enc: 'none',
    data: { ...shareableCopy(d, 'decision'), scores: [], pugh: [], groupResult: { ...copyResult(result), ...(summary && { summary }) } },
  };
}

/**
 * Asks people to score: the structure (like a template), the group's rules, in open scoring the
 * results so far, and the organizer's sealing key so ballots come back sealed.
 */
export function inviteEnvelope(d: Decision, result?: GroupResult, sealKey?: string): InviteEnvelope {
  const g = d.group;
  if (!g || g.role !== 'organizer') throw new Error('Only the organizer of a group decision can invite');
  const named = g.settings.anonymity === 'named';
  const data: Invite = {
    decision: shareableCopy(d, 'template'),
    settings: { ...g.settings },
    inviteId: g.inviteId,
    ...(named && g.myName && { organizerName: g.myName }),
    ...(g.settings.scoring === 'open' && result && { result: copyResult(result) }),
    ...(sealKey && { sealKey }),
  };
  return { doocide: FORMAT_VERSION, kind: 'invite', enc: 'none', data };
}

/**
 * One participant's ballot. In an anonymous group there is no name field at all, not an empty one,
 * and every date is cut back to the day. Private notes stay behind; shared notes go without an author.
 */
export function ballotEnvelope(d: Decision): BallotEnvelope {
  const g = d.group;
  if (!g || g.role !== 'participant' || !g.sourceId || !g.voterId) throw new Error('Only a participant can send a ballot');
  const name = g.settings.anonymity === 'named' ? (g.myName ?? '').trim() : '';
  const when = (iso: string) => (name ? iso : dayOnly(iso));
  const pugh = d.settings.mode === 'pugh';
  // Options this person abstains from: no scores or notes for them go out, only the fact of abstaining.
  const skip = abstainedOptions(d);
  const abstain = d.options.filter((o) => skip.has(o.id)).map((o) => o.id);
  const notes: Note[] = d.notes
    .filter((n) => n.visibility === 'shared' && (!n.optionId || !skip.has(n.optionId)))
    .map((n) => ({
      id: n.id,
      ...(n.optionId && { optionId: n.optionId }),
      ...(n.factorId && { factorId: n.factorId }),
      text: n.text,
      visibility: 'shared',
      createdAt: when(n.createdAt),
    }));
  const data: Ballot = {
    decisionId: g.sourceId,
    inviteId: g.inviteId,
    voterId: g.voterId,
    revision: Math.max(1, g.revision ?? 1),
    createdAt: when(new Date().toISOString()),
    ...(name && { author: name }),
    scores: pugh ? [] : d.scores.filter((s) => !skip.has(s.optionId)).map((s) => ({ ...s })),
    pugh: pugh ? d.pugh.filter((s) => !skip.has(s.optionId)).map((s) => ({ ...s })) : [],
    ...(g.settings.weights === 'everyone' && { weights: d.factors.map((f) => ({ factorId: f.id, weight: f.weight })) }),
    notes,
    ...(abstain.length > 0 && { abstain }),
  };
  return { doocide: FORMAT_VERSION, kind: 'ballot', enc: 'none', data };
}

/** The options this person abstains from: ones the decision still has, never the Pugh baseline. */
export function abstainedOptions(d: Decision): Set<string> {
  const baseline = d.settings.mode === 'pugh' ? d.settings.baselineId : undefined;
  const ids = new Set(d.group?.abstain ?? []);
  return new Set(d.options.filter((o) => ids.has(o.id) && o.id !== baseline).map((o) => o.id));
}

const isDay = (iso: string) => iso.endsWith('T00:00:00.000Z');

/** Last line of defense before anything is put in a link or a shared file. */
export function assertShareable(env: AnyEnvelope): void {
  switch (env.kind) {
    case 'backup':
      throw new Error('Backups are never shared');
    case 'decision':
    case 'template': {
      const d = env.data;
      if (d.notes.some((n) => n.visibility !== 'shared')) throw new Error('Private notes are never shared');
      if ('group' in d) throw new Error('Group data stays on this device');
      if (env.kind === 'template' && (d.scores.length || d.pugh.length || d.notes.length || d.groupResult)) {
        throw new Error('Templates carry no scores or notes');
      }
      return;
    }
    case 'invite': {
      const { decision, settings, result, organizerName } = env.data;
      if (decision.scores.length || decision.pugh.length || decision.notes.length || 'group' in decision || decision.groupResult) {
        throw new Error('Invites carry the structure only');
      }
      if (settings.scoring === 'blind' && result) throw new Error("Blind invites carry no one's scores");
      if (settings.anonymity !== 'named' && organizerName) throw new Error('Names go only with named groups');
      return;
    }
    case 'ballot': {
      const b = env.data;
      if (b.notes.some((n) => n.visibility !== 'shared' || 'author' in n)) throw new Error('Ballots carry shared notes only, without authors');
      if (!b.author && (!isDay(b.createdAt) || b.notes.some((n) => !isDay(n.createdAt)))) {
        throw new Error('Ballots without a name carry the date only');
      }
      return;
    }
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
  /** Left out: ballots others sent to this group decision. */
  ballotsLeftOut: number;
}

const activeScores = (d: Decision) => (d.settings.mode === 'pugh' ? d.pugh.length : d.scores.length);
const privateCount = (d: Decision) => d.notes.filter((n) => n.visibility !== 'shared').length;
const ballotCount = (d: Decision) => (d.group?.role === 'organizer' ? d.group.ballots.length : 0);

/** What a share will include and leave out, for the preview shown before anything is shared. */
export function shareSummary(d: Decision, kind: ShareKind): ShareSummary {
  const copy = shareEnvelope(d, kind).data;
  const privateNotes = privateCount(d);
  const keptScores = activeScores(copy);
  return {
    options: copy.options.length,
    factors: copy.factors.length,
    facts: copy.facts.length,
    scores: keptScores,
    sharedNotes: copy.notes.length,
    privateNotes,
    scoresLeftOut: activeScores(d) - keptScores,
    notesLeftOut: d.notes.length - copy.notes.length - privateNotes,
    ballotsLeftOut: ballotCount(d),
  };
}

export interface InviteSummary {
  options: number;
  factors: number;
  facts: number;
  /** Open scoring: how many ballots the included results combine. */
  resultBallots: number | null;
  organizerName: string | null;
  /** Left out: the organizer's own scores, every note, every ballot. */
  ownScores: number;
  notes: number;
  ballots: number;
}

export function inviteSummary(d: Decision, result?: GroupResult): InviteSummary {
  const { data } = inviteEnvelope(d, result);
  return {
    options: data.decision.options.length,
    factors: data.decision.factors.length,
    facts: data.decision.facts.length,
    resultBallots: data.result ? data.result.ballots : null,
    organizerName: data.organizerName ?? null,
    ownScores: activeScores(d),
    notes: d.notes.length,
    ballots: ballotCount(d),
  };
}

export interface BallotSummary {
  scores: number;
  weights: number;
  sharedNotes: number;
  /** null: the ballot carries no name. */
  name: string | null;
  /** Option ids this ballot abstains from. */
  abstained: string[];
  /** Left out: private notes. */
  privateNotes: number;
}

export function ballotSummary(d: Decision): BallotSummary {
  const { data } = ballotEnvelope(d);
  return {
    scores: data.scores.length + data.pugh.length,
    weights: data.weights?.length ?? 0,
    sharedNotes: data.notes.length,
    name: data.author ?? null,
    abstained: data.abstain ?? [],
    privateNotes: privateCount(d),
  };
}

export interface ResultsSummary {
  options: number;
  factors: number;
  facts: number;
  /** Cells with a combined score. */
  cells: number;
  ballots: number;
  sharedNotes: number;
  /** Left out: individual ballots (including the organizer's own scores) and private notes. */
  individualBallots: number;
  privateNotes: number;
  /** The organizer's selection summary goes along. */
  summary: boolean;
}

export function resultsSummary(d: Decision, result: GroupResult): ResultsSummary {
  const { data } = resultsEnvelope(d, result);
  return {
    options: data.options.length,
    factors: data.factors.length,
    facts: data.facts.length,
    cells: data.groupResult?.cells.length ?? 0,
    ballots: data.groupResult?.ballots ?? 0,
    sharedNotes: data.notes.length,
    individualBallots: result.ballots,
    privateNotes: privateCount(d),
    summary: Boolean(data.groupResult?.summary),
  };
}
