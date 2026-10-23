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
  /**
   * What the matrix shows as rows: factors (the default, also when absent) or options. On phones:
   * score one factor at a time, or one option at a time. Only a view choice; it changes no score.
   */
  rows?: 'factors' | 'options';
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
  /**
   * Group results in the shared folder: never (also when absent), when the organizer publishes them,
   * or after each approval (open scoring only, since blind scoring keeps everyone's scores hidden).
   */
  folderResults?: FolderResults;
}

export type FolderResults = 'never' | 'publish' | 'approval';

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
  /**
   * Options this person abstained from (a conflict of interest, say). The ballot has no scores for
   * them, and they're left out of the group's result rather than counted as zero. Only when not empty.
   */
  abstain?: string[];
  /**
   * The public key the ballot is signed with (base64url, raw P-256). Anonymous ballots use a key made
   * for this one decision; named ballots use the person's device key. See src/format/crypto.ts.
   */
  key?: string;
  /** Signature over the rest of the ballot, made with `key`. */
  sig?: string;
}

/** What checking a signature found: it matches, it doesn't, or there is none (made with Doocide 0.2.0). */
export type Signature = 'valid' | 'invalid' | 'none';

/** A ballot as it arrives, with what its signature check found. */
export interface ReceivedBallot {
  ballot: Ballot;
  signature: Signature;
}

/** A ballot the organizer approved. */
export interface StoredBallot extends Ballot {
  /** Counts in the group result. The organizer can leave a ballot out without deleting it. */
  included: boolean;
  receivedAt: string;
  /** Its signature matched `key` when it arrived. Later ballots from this person must be signed by the same key. */
  signed?: boolean;
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
  /**
   * Options this person abstains from. Their scores for them stay on this device, so taking part
   * again brings them back, but they never go out on a ballot or count in the group's result.
   */
  abstain?: string[];
  /** Organizer, named groups: keys the organizer confirmed by comparing short codes with their owner. */
  confirmed?: string[];
  /** Organizer: when the last invite was made. From then on the scoring rules are locked: people may be scoring with them. */
  lastInviteAt?: string;
  /** Organizer: a short fingerprint of what the last invite showed, to notice edits people haven't received yet. */
  lastInviteShape?: string;
  /** Organizer: when results last went to the shared folder. */
  publishedAt?: string;
  /** Organizer: their saved selection summary, which results shares carry. `compare`: it compares with the options left out. */
  summary?: SelectionSummary & { compare: boolean };
  /**
   * Organizer: how the results file's passphrase becomes its key. The salt stays the same from one
   * publish to the next (each gets a fresh IV), so people who entered the passphrase once can open
   * later files too. A new passphrase makes a new salt.
   */
  resultsKdf?: Kdf;
  /** Participant: the organizer's decision id, which the ballot points at. */
  sourceId?: string;
  /** Participant: this person's random id for this decision. */
  voterId?: string;
  /** Participant: how many times the ballot was sent. */
  revision?: number;
  sentAt?: string;
  /** Participant: the organizer's name from the invite (named groups only, not verified). */
  organizerName?: string;
  /** Participant: the key that signed the invite. */
  organizerKey?: string;
  /** Participant: the organizer's sealing key from a signed invite. Ballots are sealed to it. */
  organizerSealKey?: string;
  /** Participant: they compared short codes with the organizer and the codes matched. */
  organizerConfirmed?: boolean;
  /** Participant: the public key their ballots were signed with, to notice when this device can't sign as them. */
  key?: string;
  /** Participant: the version (the organizer's last-change time) of the invite this copy follows. Older invites are refused. */
  inviteVersion?: string;
  /** Participant: the group's results, from an open invite or the shared folder. */
  result?: GroupResult;
  /** Participant: the version (the organizer's last-change time) of `result`, so older results never replace newer ones. */
  resultsAt?: string;
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
  /** Results shares only: the organizer's summary of what they selected, when they added it. */
  summary?: SelectionSummary;
}

/** An organizer's summary of a selection: drafted from the group's results, then edited by them. */
export interface SelectionSummary {
  /** Plain text, as the organizer last left it. Shown as text, never formatted. */
  text: string;
  /** The options selected. */
  selected: string[];
  /** Ballots in the result when it was saved, so newer ballots can be noticed. */
  ballots: number;
  at: string;
  /** The language it's written in. */
  lang: string;
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
  /**
   * The organizer's sealing key for this decision (ECDH P-256, raw, base64url). Ballots are sealed to it,
   * so only the organizer can open them. Covered by the invite's signature, so nobody can swap it.
   */
  sealKey?: string;
  /** The organizer's device key, and their signature over the rest of the invite. */
  key?: string;
  sig?: string;
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

/** none: plain JSON. passphrase: locked with a passphrase. sealed: only the holder of one key can open it. */
export type Encryption = 'none' | 'passphrase' | 'sealed';

/** How a passphrase becomes a key: PBKDF2 with SHA-256, a random salt (base64url) and an iteration count. */
export interface Kdf {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string;
}

/** AES-GCM output: a fresh random 12-byte IV and the ciphertext, both base64url. */
export interface Box {
  iv: string;
  ct: string;
}

/**
 * A share or file locked with a passphrase. Nothing about the content shows outside: the whole inner
 * envelope (compressed) is the ciphertext. Locked backups also carry `wrappedKey`: the library's data
 * key, wrapped with the passphrase key, which in turn decrypts `ct`.
 */
export interface PassphraseEnvelope extends Box {
  doocide: typeof FORMAT_VERSION;
  enc: 'passphrase';
  kdf: Kdf;
  wrappedKey?: Box;
}

/**
 * A ballot sealed to the organizer: an ephemeral ECDH P-256 key (`epk`) agrees a secret with the
 * organizer's sealing key (`to`), HKDF turns it into an AES-GCM key. Only the organizer can open it.
 */
export interface SealedEnvelope extends Box {
  doocide: typeof FORMAT_VERSION;
  enc: 'sealed';
  to: string;
  epk: string;
  salt: string;
}

export type EncryptedEnvelope = PassphraseEnvelope | SealedEnvelope;

/** A decision, template or backup. */
export interface Envelope {
  doocide: typeof FORMAT_VERSION;
  kind: DecisionKind;
  enc: 'none';
  data: Decision;
  /**
   * Group results files only: the organizer's device key and their signature over the rest, so people
   * can tell the organizer made the file and nobody changed it. See signEnvelope in src/format/crypto.ts.
   */
  key?: string;
  sig?: string;
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
