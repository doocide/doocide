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
}

/**
 * decision: shared with others (scores, facts, shared notes).
 * template: structure only (options, factors, weights, guides, facts); no scores, no notes.
 * backup: the owner's own full copy, private notes included. Never shared, never put in a link.
 */
export type Kind = 'decision' | 'template' | 'backup';

/** Reserved for milestone 2. Files using them are reported as "made with a newer Doocide". */
export type Encryption = 'none' | 'passphrase' | 'sealed';

export interface Envelope {
  doocide: typeof FORMAT_VERSION;
  kind: Kind;
  enc: 'none';
  data: Decision;
}

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 5;
export const SCALES = [5, 10, 100] as const;
