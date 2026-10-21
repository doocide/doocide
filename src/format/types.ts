// Doocide file format, version 1. MIT licensed (see LICENSE in this folder).

export const FORMAT_VERSION = 1;

/** weighted: each option scored 0..scaleMax per factor. pugh: each option rated against a baseline option. */
export type Mode = 'weighted' | 'pugh';

export type Visibility = 'private' | 'shared';

/** Optional translations of a label, keyed by language code (e.g. "ro", "pt-BR"). */
export type Translations = Record<string, { name?: string; guide?: string }>;

export interface Option {
  id: string;
  name: string;
  description?: string;
  l10n?: Translations;
}

export interface Factor {
  id: string;
  name: string;
  /** Importance, 1 (least important) to 5 (very important). */
  weight: number;
  /** What a low and a high score mean for this factor, so everyone scores the same way. */
  guide?: string;
  l10n?: Translations;
}

/** Evidence for one option on one factor, e.g. "4.3 inches, 480x800". Always shared. */
export interface Fact {
  optionId: string;
  factorId: string;
  text: string;
  url?: string;
}

export interface Score {
  optionId: string;
  factorId: string;
  value: number;
}

/**
 * Reasoning attached to the decision, an option, a factor, or one cell (option + factor).
 * Private notes never leave the device; see src/format/share.ts.
 */
export interface Note {
  id: string;
  optionId?: string;
  factorId?: string;
  text: string;
  visibility: Visibility;
  /** Self-declared, never verified. */
  author?: string;
  createdAt: string;
}

export interface Settings {
  mode: Mode;
  /** Top of the weighted scale: 5, 10 or 100. */
  scaleMax: number;
  /** Pugh ratings run from -pughSteps to +pughSteps (1: -/S/+, 2: --/-/S/+/++). */
  pughSteps: 1 | 2;
  /** The option every other option is compared against in pugh mode. */
  baselineId?: string;
}

export interface Decision {
  id: string;
  title: string;
  description?: string;
  /** Language the content is written in (BCP 47). */
  lang: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  options: Option[];
  factors: Factor[];
  facts: Fact[];
  /** Weighted-mode scores. */
  scores: Score[];
  /** Pugh-mode ratings against the baseline. Kept separately so switching modes loses nothing. */
  pugh: Score[];
  notes: Note[];
  /** Scoring with others. Local to this device: never shared as-is (see src/format/share.ts). */
  group?: Group;
  /** A snapshot of a group's combined results, as shared by its organizer. No individual ballots, no names. */
  groupResult?: GroupResult;
}

// Groups: an organizer invites people, each sends back a ballot, the organizer approves and merges them.

/** anonymous: ballots carry no name at all. named: ballots carry a name the sender typed (not verified). */
export type Anonymity = 'anonymous' | 'named';

export interface GroupSettings {
  /** Locked once the first ballot arrives. */
  anonymity: Anonymity;
  /** blind: invites carry no one's scores. open: invites carry the group's current combined results. */
  scoring: 'blind' | 'open';
  /** Who sets importance: the organizer only, or every participant (combined like scores). */
  weights: 'organizer' | 'everyone';
  /** How the ballots for one cell combine. */
  combine: 'mean' | 'median';
  /** How many people the organizer expects to send ballots. */
  expected?: number;
}

export interface Weight {
  factorId: string;
  weight: number;
}

/** One person's scores for a group decision. */
export interface Ballot {
  /** The organizer's decision this ballot belongs to. */
  decisionId: string;
  inviteId: string;
  /** Random, made once per person and decision. A re-sent ballot keeps it, so the newer one replaces the older. */
  voterId: string;
  /** Goes up by one each time the person sends their ballot again. */
  revision: number;
  /** Anonymous ballots carry the date only, not the time. */
  createdAt: string;
  /** Named ballots only, typed by the sender, never verified. Anonymous ballots have no such field at all. */
  author?: string;
  scores: Score[];
  pugh: Score[];
  /** Only when everyone sets importance. */
  weights?: Weight[];
  /** Shared notes only, with no author and the date only. */
  notes: Note[];
}

/** A ballot the organizer approved. */
export interface StoredBallot extends Ballot {
  /** Counts in the group result. The organizer can leave a ballot out without deleting it. */
  included: boolean;
  receivedAt: string;
}

export interface Group {
  role: 'organizer' | 'participant';
  settings: GroupSettings;
  inviteId: string;
  /** Organizer: approved ballots. */
  ballots: StoredBallot[];
  /** Organizer: their own scores count as a ballot. */
  includeOwn: boolean;
  /** Set when the first ballot arrives. From then on the anonymity setting can't change. */
  anonymityLocked: boolean;
  /** Name shown with the organizer's invites or on the participant's ballot (named groups only). */
  myName?: string;
  /** Participant: the organizer's decision id, which the ballot points at. */
  sourceId?: string;
  /** Participant: this person's random id for this decision. */
  voterId?: string;
  /** Participant: how many times the ballot was sent. */
  revision?: number;
  sentAt?: string;
  /** Participant: the organizer's name from the invite (named groups only, not verified). */
  organizerName?: string;
  /** Participant, open scoring: the group's results when the invite was made. */
  result?: GroupResult;
}

/**
 * Combined values for one cell. spread: standard deviation divided by half the scale's range, so 0
 * means everyone gave the same score and 1 means the group split between the two ends of the scale.
 */
export interface CellResult {
  optionId: string;
  factorId: string;
  /** Ballots that scored this cell. */
  n: number;
  value: number;
  low: number;
  high: number;
  spread: number;
}

export interface WeightResult {
  factorId: string;
  n: number;
  value: number;
  low: number;
  high: number;
  spread: number;
}

export interface GroupResult {
  /** Ballots that went into the result. */
  ballots: number;
  cells: CellResult[];
  /** Combined importance, when everyone sets it. */
  weights?: WeightResult[];
}

/** What a participant receives: the decision's structure and the rules of the group. */
export interface Invite {
  /** Structure only, like a template: no scores, no notes. Its id is the organizer's decision id. */
  decision: Decision;
  settings: GroupSettings;
  inviteId: string;
  /** Named groups only. Typed by the organizer, never verified. */
  organizerName?: string;
  /** Open scoring only: the group's combined results so far. */
  result?: GroupResult;
}

/**
 * decision: shared with others (scores, facts, shared notes, and a group's combined results).
 * template: structure only (options, factors, weights, guides, facts); no scores, no notes.
 * backup: the owner's own full copy, private notes included. Never shared, never put in a link.
 * invite: asks someone to score a group decision.
 * ballot: one person's scores, sent back to the organizer.
 */
export type DecisionKind = 'decision' | 'template' | 'backup';
export type Kind = DecisionKind | 'invite' | 'ballot';

/** Reserved for milestone 2. Files using them are reported as encrypted. */
export type Encryption = 'none' | 'passphrase' | 'sealed';

/** A decision, template or backup. */
export interface Envelope {
  doocide: typeof FORMAT_VERSION;
  kind: DecisionKind;
  enc: 'none';
  data: Decision;
}

export interface InviteEnvelope {
  doocide: typeof FORMAT_VERSION;
  kind: 'invite';
  enc: 'none';
  data: Invite;
}

export interface BallotEnvelope {
  doocide: typeof FORMAT_VERSION;
  kind: 'ballot';
  enc: 'none';
  data: Ballot;
}

export type AnyEnvelope = Envelope | InviteEnvelope | BallotEnvelope;

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 5;
export const SCALES = [5, 10, 100] as const;
