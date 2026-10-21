// Turns untrusted JSON into a clean Decision, Invite or Ballot. Only known fields are read, every
// string is cleaned, every reference is checked, and the result is built from fresh objects
// (no prototype pollution).

import { ID_PATTERN, newId } from './ids';
import { ITERATIONS, LIMITS } from './limits';
import { checkLink, cleanText, dayOnly } from './sanitize';
import {
  FORMAT_VERSION,
  SCALES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  type AnyEnvelope,
  type Ballot,
  type CellResult,
  type Decision,
  type DecisionKind,
  type EncryptedEnvelope,
  type Envelope,
  type Fact,
  type Factor,
  type Group,
  type GroupResult,
  type GroupSettings,
  type Invite,
  type Note,
  type Option,
  type Score,
  type Settings,
  type StoredBallot,
  type Translations,
  type Weight,
  type WeightResult,
} from './types';

export type FormatErrorCode =
  | 'too-big' // over a size or count limit
  | 'too-deep' // nesting deeper than any real file
  | 'bad-data' // not JSON, or a damaged link
  | 'not-doocide' // valid JSON, but not a Doocide file
  | 'newer-version' // made with a newer Doocide
  | 'encrypted' // encrypted; supported from milestone 2
  | 'invalid'; // a Doocide file that breaks the rules

export class FormatError extends Error {
  constructor(
    readonly code: FormatErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'FormatError';
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads own properties only, so "__proto__" or "constructor" keys are never followed. */
const get = (o: Obj, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);

const list = (v: unknown, max: number, what: string): unknown[] => {
  if (!Array.isArray(v)) return [];
  if (v.length > max) throw new FormatError('too-big', `Too many ${what} (${v.length}, limit ${max})`);
  return v;
};

const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
const T = LIMITS.text;

export function cleanLang(v: unknown, fallback = 'en'): string {
  return typeof v === 'string' && v.length <= LIMITS.text.lang && LANG.test(v) ? v : fallback;
}

function cleanDate(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || v.length > 40) return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

const cleanId = (v: unknown): string | undefined => (typeof v === 'string' && ID_PATTERN.test(v) ? v : undefined);

/** A public key or a signature: base64url, short. Whether it actually verifies is checked in src/format/crypto.ts. */
const cleanKey = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= LIMITS.text.key && /^[A-Za-z0-9_-]+$/.test(v) ? v : undefined;

const intIn = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

/** A finite number clamped to [min, max] and rounded to 3 decimals, or undefined. */
const numIn = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 1000) / 1000 : undefined;

/** Deepest nesting of objects and arrays, scanned without parsing. */
export function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123 || c === 91) max = Math.max(max, ++depth);
    else if (c === 125 || c === 93) depth--;
  }
  return max;
}

/** JSON.parse with size and depth limits checked first. */
export function parseJsonText(text: string, maxChars: number = LIMITS.unpackedBytes): unknown {
  if (text.length > maxChars) throw new FormatError('too-big');
  if (jsonDepth(text) > LIMITS.depth) throw new FormatError('too-deep');
  try {
    return JSON.parse(text);
  } catch {
    throw new FormatError('bad-data');
  }
}

/** A decision, template or backup. Invites and ballots are refused here; see parseAnyEnvelopeText. */
export function parseEnvelopeText(text: string, maxChars?: number): Envelope {
  return validateEnvelope(parseJsonText(text, maxChars));
}

/** Any Doocide file: a decision, template, backup, invite or ballot. */
export function parseAnyEnvelopeText(text: string, maxChars?: number): AnyEnvelope {
  return validateAnyEnvelope(parseJsonText(text, maxChars));
}

export function validateAnyEnvelope(raw: unknown): AnyEnvelope {
  if (!isObj(raw)) throw new FormatError('not-doocide');
  const version = get(raw, 'doocide');
  if (typeof version !== 'number') throw new FormatError('not-doocide');
  if (version > FORMAT_VERSION) throw new FormatError('newer-version');
  if (version !== FORMAT_VERSION) throw new FormatError('not-doocide');

  const enc = get(raw, 'enc') ?? 'none';
  if (enc === 'passphrase' || enc === 'sealed') throw new FormatError('encrypted');
  if (enc !== 'none') throw new FormatError('newer-version');

  const kind = get(raw, 'kind');
  const data = get(raw, 'data');
  const base = { doocide: FORMAT_VERSION, enc: 'none' } as const;
  if (kind === 'decision' || kind === 'template' || kind === 'backup') return { ...base, kind, data: validateDecision(data, kind) };
  if (kind === 'invite') return { ...base, kind, data: validateInvite(data) };
  if (kind === 'ballot') return { ...base, kind, data: validateBallot(data) };
  // A kind this version doesn't know is most likely from a newer Doocide.
  if (typeof kind === 'string') throw new FormatError('newer-version');
  throw new FormatError('invalid', 'Unknown kind');
}

/** What came in: a plain envelope, or an encrypted one still to be opened. */
export type Incoming = { type: 'plain'; env: AnyEnvelope } | { type: 'encrypted'; box: EncryptedEnvelope };

const b64 = (v: unknown, min: number, max: number): string | undefined =>
  typeof v === 'string' && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v) ? v : undefined;

/** An AES-GCM IV and ciphertext. The IV is always 12 bytes (16 characters). */
function cleanBox(o: Obj, maxCt: number): { iv: string; ct: string } {
  const rawCt = get(o, 'ct');
  if (typeof rawCt === 'string' && rawCt.length > maxCt) throw new FormatError('too-big');
  const iv = b64(get(o, 'iv'), 16, 16);
  const ct = b64(rawCt, 1, maxCt);
  if (!iv || !ct) throw new FormatError('invalid', 'Damaged encrypted data');
  return { iv, ct };
}

/** The outside of an encrypted envelope, checked before any decryption is tried. Nothing inside is read here. */
export function validateEncrypted(raw: Obj): EncryptedEnvelope {
  const enc = get(raw, 'enc');
  const box = cleanBox(raw, LIMITS.fileBytes);
  if (enc === 'passphrase') {
    const k = get(raw, 'kdf');
    if (!isObj(k)) throw new FormatError('invalid', 'Missing key settings');
    if (get(k, 'name') !== 'PBKDF2' || get(k, 'hash') !== 'SHA-256') throw new FormatError('newer-version');
    const iterations = get(k, 'iterations');
    if (typeof iterations !== 'number' || !Number.isInteger(iterations)) throw new FormatError('invalid', 'Bad key settings');
    // A file asking for far more work than Doocide ever uses could freeze the page.
    if (iterations > ITERATIONS.max) throw new FormatError('too-big', 'Asks for too much work');
    if (iterations < ITERATIONS.min) throw new FormatError('invalid', 'Key settings too weak');
    const salt = b64(get(k, 'salt'), 16, 64);
    if (!salt) throw new FormatError('invalid', 'Bad key settings');
    const w = get(raw, 'wrappedKey');
    const wrappedKey = isObj(w) ? cleanBox(w, 100) : undefined;
    return { doocide: FORMAT_VERSION, enc, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, ...box, ...(wrappedKey && { wrappedKey }) };
  }
  if (enc === 'sealed') {
    const to = cleanKey(get(raw, 'to'));
    const epk = cleanKey(get(raw, 'epk'));
    const salt = b64(get(raw, 'salt'), 16, 64);
    if (!to || !epk || !salt) throw new FormatError('invalid', 'Damaged sealed data');
    return { doocide: FORMAT_VERSION, enc, to, epk, salt, ...box };
  }
  throw new FormatError('newer-version');
}

/** Any Doocide file, encrypted or not. Encrypted ones come back unopened, for the app to ask for a passphrase or find a key. */
export function readIncoming(raw: unknown): Incoming {
  if (isObj(raw)) {
    const enc = get(raw, 'enc');
    if (enc === 'passphrase' || enc === 'sealed') {
      const version = get(raw, 'doocide');
      if (typeof version !== 'number') throw new FormatError('not-doocide');
      if (version > FORMAT_VERSION) throw new FormatError('newer-version');
      if (version !== FORMAT_VERSION) throw new FormatError('not-doocide');
      return { type: 'encrypted', box: validateEncrypted(raw) };
    }
  }
  return { type: 'plain', env: validateAnyEnvelope(raw) };
}

export const parseIncomingText = (text: string, maxChars?: number): Incoming => readIncoming(parseJsonText(text, maxChars));

/** A decision, template or backup. */
export function validateEnvelope(raw: unknown): Envelope {
  const env = validateAnyEnvelope(raw);
  if (env.kind === 'invite' || env.kind === 'ballot') throw new FormatError('invalid', 'Not a decision');
  return env;
}

function cleanTranslations(v: unknown): Translations | undefined {
  if (!isObj(v)) return undefined;
  const out: Translations = {};
  let count = 0;
  for (const lang of Object.keys(v)) {
    if (++count > LIMITS.translations) break;
    if (!LANG.test(lang) || lang.length > LIMITS.text.lang) continue;
    const entry = get(v, lang);
    if (!isObj(entry)) continue;
    const name = cleanText(get(entry, 'name'), LIMITS.text.name);
    const guide = cleanText(get(entry, 'guide'), LIMITS.text.guide, true);
    if (name || guide) out[lang] = { ...(name && { name }), ...(guide && { guide }) };
  }
  return Object.keys(out).length ? out : undefined;
}

function uniqueId(v: unknown, seen: Set<string>): string {
  if (typeof v === 'string' && ID_PATTERN.test(v)) {
    if (seen.has(v)) throw new FormatError('invalid', `Duplicate id ${v}`);
    seen.add(v);
    return v;
  }
  let id = newId();
  while (seen.has(id)) id = newId();
  seen.add(id);
  return id;
}

/** A reference to an option or factor. With no set to check against (a ballot read on its own), any well-formed id. */
const refId = (v: unknown, valid: Set<string> | null): string | undefined =>
  typeof v !== 'string' ? undefined : valid ? (valid.has(v) ? v : undefined) : cleanId(v);

function cleanSettings(v: unknown, optionIds: Set<string>): Settings {
  const o = isObj(v) ? v : {};
  const mode = get(o, 'mode') === 'pugh' ? 'pugh' : 'weighted';
  const scale = get(o, 'scaleMax');
  const scaleMax = SCALES.includes(scale as (typeof SCALES)[number]) ? (scale as number) : 10;
  const pughSteps = get(o, 'pughSteps') === 2 ? 2 : 1;
  const baselineId = refId(get(o, 'baselineId'), optionIds);
  // Factors as rows is the default, so it's left out rather than written.
  const optionRows = get(o, 'rows') === 'options';
  return { mode, scaleMax, pughSteps, ...(baselineId && { baselineId }), ...(optionRows && { rows: 'options' as const }) };
}

function cleanScores(
  raw: unknown,
  optionIds: Set<string> | null,
  factorIds: Set<string> | null,
  min: number,
  max: number,
  integer: boolean,
  skipOption?: string,
): Score[] {
  const byCell = new Map<string, Score>();
  for (const item of list(raw, LIMITS.scores, 'scores')) {
    if (!isObj(item)) continue;
    const optionId = refId(get(item, 'optionId'), optionIds);
    const factorId = refId(get(item, 'factorId'), factorIds);
    const value = get(item, 'value');
    if (!optionId || !factorId || optionId === skipOption) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const clamped = Math.min(max, Math.max(min, integer ? Math.round(value) : Math.round(value * 100) / 100));
    byCell.set(`${optionId} ${factorId}`, { optionId, factorId, value: clamped });
  }
  return [...byCell.values()];
}

function cleanNotes(raw: unknown, optionIds: Set<string> | null, factorIds: Set<string> | null, keepPrivate: boolean, now: string): Note[] {
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const item of list(raw, LIMITS.notes, 'notes')) {
    if (!isObj(item)) continue;
    const visibility = get(item, 'visibility') === 'shared' ? 'shared' : 'private';
    if (visibility === 'private' && !keepPrivate) continue;
    const text = cleanText(get(item, 'text'), T.note, true);
    if (!text) continue;
    const rawOption = get(item, 'optionId');
    const rawFactor = get(item, 'factorId');
    const optionId = refId(rawOption, optionIds);
    const factorId = refId(rawFactor, factorIds);
    // A note pointing at something that doesn't exist is dropped rather than re-attached elsewhere.
    if ((rawOption !== undefined && !optionId) || (rawFactor !== undefined && !factorId)) continue;
    const author = cleanText(get(item, 'author'), T.author);
    notes.push({
      id: uniqueId(get(item, 'id'), seen),
      ...(optionId && { optionId }),
      ...(factorId && { factorId }),
      text,
      visibility,
      ...(author && { author }),
      createdAt: cleanDate(get(item, 'createdAt'), now),
    });
  }
  return notes;
}

function cleanWeights(raw: unknown, factorIds: Set<string> | null): Weight[] {
  const byFactor = new Map<string, Weight>();
  for (const item of list(raw, LIMITS.factors, 'weights')) {
    if (!isObj(item)) continue;
    const factorId = refId(get(item, 'factorId'), factorIds);
    const w = get(item, 'weight');
    if (!factorId || typeof w !== 'number' || !Number.isFinite(w)) continue;
    byFactor.set(factorId, { factorId, weight: Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(w))) });
  }
  return [...byFactor.values()];
}

/** Group rules from someone else. When in doubt, anonymous: a ballot without a name is the safe side. */
export function cleanGroupSettings(v: unknown): GroupSettings {
  const o = isObj(v) ? v : {};
  const expected = intIn(get(o, 'expected'), 1, LIMITS.expected);
  return {
    anonymity: get(o, 'anonymity') === 'named' ? 'named' : 'anonymous',
    scoring: get(o, 'scoring') === 'open' ? 'open' : 'blind',
    weights: get(o, 'weights') === 'everyone' ? 'everyone' : 'organizer',
    combine: get(o, 'combine') === 'median' ? 'median' : 'mean',
    ...(expected && { expected }),
  };
}

function cleanGroupResult(v: unknown, optionIds: Set<string>, factorIds: Set<string>, settings: Settings): GroupResult | undefined {
  if (!isObj(v)) return undefined;
  const pugh = settings.mode === 'pugh';
  const lo = pugh ? -settings.pughSteps : 0;
  const hi = pugh ? settings.pughSteps : settings.scaleMax;
  // The organizer's own scores can count as one more ballot.
  const maxBallots = LIMITS.ballots + 1;

  const cells = new Map<string, CellResult>();
  for (const item of list(get(v, 'cells'), LIMITS.scores, 'cells')) {
    if (!isObj(item)) continue;
    const optionId = refId(get(item, 'optionId'), optionIds);
    const factorId = refId(get(item, 'factorId'), factorIds);
    const n = intIn(get(item, 'n'), 1, maxBallots);
    const value = numIn(get(item, 'value'), lo, hi);
    if (!optionId || !factorId || !n || value === undefined) continue;
    if (pugh && optionId === settings.baselineId) continue;
    const low = Math.min(numIn(get(item, 'low'), lo, hi) ?? value, value);
    const high = Math.max(numIn(get(item, 'high'), lo, hi) ?? value, value);
    cells.set(`${optionId} ${factorId}`, { optionId, factorId, n, value, low, high, spread: numIn(get(item, 'spread'), 0, 1) ?? 0 });
  }

  const weights = new Map<string, WeightResult>();
  for (const item of list(get(v, 'weights'), LIMITS.factors, 'weights')) {
    if (!isObj(item)) continue;
    const factorId = refId(get(item, 'factorId'), factorIds);
    const n = intIn(get(item, 'n'), 1, maxBallots);
    const value = numIn(get(item, 'value'), WEIGHT_MIN, WEIGHT_MAX);
    if (!factorId || !n || value === undefined) continue;
    const low = Math.min(numIn(get(item, 'low'), WEIGHT_MIN, WEIGHT_MAX) ?? value, value);
    const high = Math.max(numIn(get(item, 'high'), WEIGHT_MIN, WEIGHT_MAX) ?? value, value);
    weights.set(factorId, { factorId, n, value, low, high, spread: numIn(get(item, 'spread'), 0, 1) ?? 0 });
  }

  return {
    ballots: intIn(get(v, 'ballots'), 0, maxBallots) ?? 0,
    cells: [...cells.values()],
    ...(weights.size > 0 && { weights: [...weights.values()] }),
  };
}

/**
 * A ballot read on its own, before it is matched to a decision: ids well formed, numbers finite,
 * text cleaned, private notes dropped, note authors dropped. See matchBallot for the rest.
 */
export function validateBallot(raw: unknown): Ballot {
  if (!isObj(raw)) throw new FormatError('invalid', 'Missing ballot');
  const decisionId = cleanId(get(raw, 'decisionId'));
  const inviteId = cleanId(get(raw, 'inviteId'));
  const voterId = cleanId(get(raw, 'voterId'));
  if (!decisionId || !inviteId || !voterId) throw new FormatError('invalid', 'Ballot without ids');
  const now = new Date().toISOString();
  const author = cleanText(get(raw, 'author'), T.author);
  const weights = cleanWeights(get(raw, 'weights'), null);
  const key = cleanKey(get(raw, 'key'));
  const sig = cleanKey(get(raw, 'sig'));
  return {
    decisionId,
    inviteId,
    voterId,
    revision: intIn(get(raw, 'revision'), 1, LIMITS.revision) ?? 1,
    createdAt: cleanDate(get(raw, 'createdAt'), now),
    ...(author && { author }),
    // The widest range any decision allows; matchBallot narrows it to the decision's own scale.
    scores: cleanScores(get(raw, 'scores'), null, null, 0, Math.max(...SCALES), false),
    pugh: cleanScores(get(raw, 'pugh'), null, null, -2, 2, true),
    ...(weights.length > 0 && { weights }),
    notes: cleanNotes(get(raw, 'notes'), null, null, false, now).map(({ author: _a, ...n }) => n),
    ...(key && { key }),
    ...(sig && { sig }),
  };
}

export interface BallotMatch {
  ballot: Ballot;
  /** The ballot carried a name, but the decision is anonymous, so the name was removed. */
  nameRemoved: boolean;
  /** Scores that pointed at options or factors this decision doesn't have. */
  dropped: number;
}

interface Shape {
  optionIds: Set<string>;
  factorIds: Set<string>;
  settings: Settings;
  group?: GroupSettings;
}

function matchTo(b: Ballot, s: Shape): BallotMatch {
  const { settings } = s;
  // Without group rules to go by, a ballot is treated as anonymous.
  const anonymous = s.group?.anonymity !== 'named';
  const scores = cleanScores(b.scores, s.optionIds, s.factorIds, 0, settings.scaleMax, false);
  const pugh = cleanScores(b.pugh, s.optionIds, s.factorIds, -settings.pughSteps, settings.pughSteps, true, settings.baselineId);
  const weights = s.group?.weights === 'everyone' ? cleanWeights(b.weights, s.factorIds) : [];
  const notes = cleanNotes(b.notes, s.optionIds, s.factorIds, false, b.createdAt).map(({ author: _a, ...n }) =>
    anonymous ? { ...n, createdAt: dayOnly(n.createdAt) } : n,
  );
  const author = !anonymous && b.author ? b.author : undefined;
  return {
    ballot: {
      decisionId: b.decisionId,
      inviteId: b.inviteId,
      voterId: b.voterId,
      revision: b.revision,
      createdAt: anonymous ? dayOnly(b.createdAt) : b.createdAt,
      ...(author && { author }),
      scores,
      pugh,
      ...(weights.length > 0 && { weights }),
      notes,
      // The key stays, so later ballots from this person can be held to it. The signature was checked on arrival.
      ...(b.key && { key: b.key }),
    },
    nameRemoved: anonymous && Boolean(b.author),
    dropped: b.scores.length + b.pugh.length - scores.length - pugh.length,
  };
}

/** Fits a ballot to the decision it belongs to: unknown cells dropped, values clamped, names removed in anonymous groups. */
export function matchBallot(b: Ballot, d: Decision): BallotMatch {
  return matchTo(b, {
    optionIds: new Set(d.options.map((o) => o.id)),
    factorIds: new Set(d.factors.map((f) => f.id)),
    settings: d.settings,
    ...(d.group && { group: d.group.settings }),
  });
}

export function validateInvite(raw: unknown): Invite {
  if (!isObj(raw)) throw new FormatError('invalid', 'Missing invite');
  const rawDecision = get(raw, 'decision');
  // Ballots find their way back by this id, so it must be the organizer's own, not a made-up one.
  if (!isObj(rawDecision) || !cleanId(get(rawDecision, 'id'))) throw new FormatError('invalid', 'Invite without a decision id');
  const decision = validateDecision(rawDecision, 'template');
  const inviteId = cleanId(get(raw, 'inviteId'));
  if (!inviteId) throw new FormatError('invalid', 'Invite without an id');
  const settings = cleanGroupSettings(get(raw, 'settings'));
  const organizerName = settings.anonymity === 'named' ? cleanText(get(raw, 'organizerName'), T.author) : '';
  const result =
    settings.scoring === 'open'
      ? cleanGroupResult(get(raw, 'result'), new Set(decision.options.map((o) => o.id)), new Set(decision.factors.map((f) => f.id)), decision.settings)
      : undefined;
  const key = cleanKey(get(raw, 'key'));
  const sig = cleanKey(get(raw, 'sig'));
  const sealKey = cleanKey(get(raw, 'sealKey'));
  return {
    decision,
    settings,
    inviteId,
    ...(organizerName && { organizerName }),
    ...(result && { result }),
    ...(sealKey && { sealKey }),
    ...(key && { key }),
    ...(sig && { sig }),
  };
}

/** The group data kept with a decision on this device. Only ever read from the owner's own storage and backups. */
function cleanGroup(v: unknown, shape: Omit<Shape, 'group'>): Group | undefined {
  if (!isObj(v)) return undefined;
  const role = get(v, 'role') === 'participant' ? 'participant' : 'organizer';
  const settings = cleanGroupSettings(get(v, 'settings'));
  const myName = settings.anonymity === 'named' ? cleanText(get(v, 'myName'), T.author) : '';

  if (role === 'participant') {
    const result = cleanGroupResult(get(v, 'result'), shape.optionIds, shape.factorIds, shape.settings);
    const sourceId = cleanId(get(v, 'sourceId'));
    const voterId = cleanId(get(v, 'voterId'));
    const inviteId = cleanId(get(v, 'inviteId'));
    // Without these the ballot can't reach the organizer or replace an earlier one; keep it as a plain decision.
    if (!sourceId || !voterId || !inviteId) return undefined;
    const sentAt = get(v, 'sentAt') === undefined ? undefined : cleanDate(get(v, 'sentAt'), new Date().toISOString());
    const organizerName = settings.anonymity === 'named' ? cleanText(get(v, 'organizerName'), T.author) : '';
    const organizerKey = cleanKey(get(v, 'organizerKey'));
    const organizerSealKey = cleanKey(get(v, 'organizerSealKey'));
    const key = cleanKey(get(v, 'key'));
    return {
      role,
      settings,
      inviteId,
      ballots: [],
      includeOwn: false,
      anonymityLocked: true,
      ...(myName && { myName }),
      sourceId,
      voterId,
      revision: intIn(get(v, 'revision'), 0, LIMITS.revision) ?? 0,
      ...(sentAt && { sentAt }),
      ...(organizerName && { organizerName }),
      ...(organizerKey && { organizerKey }),
      ...(organizerKey && get(v, 'organizerConfirmed') === true && { organizerConfirmed: true }),
      ...(organizerSealKey && { organizerSealKey }),
      ...(key && { key }),
      ...(result && { result }),
    };
  }

  const byVoter = new Map<string, StoredBallot>();
  for (const item of list(get(v, 'ballots'), LIMITS.ballots, 'ballots')) {
    if (!isObj(item)) continue;
    let ballot: Ballot;
    try {
      ballot = validateBallot(item);
    } catch {
      continue;
    }
    const matched = matchTo(ballot, { ...shape, group: settings }).ballot;
    const prev = byVoter.get(matched.voterId);
    if (prev && prev.revision >= matched.revision) continue;
    byVoter.set(matched.voterId, {
      ...matched,
      included: get(item, 'included') !== false,
      receivedAt: cleanDate(get(item, 'receivedAt'), matched.createdAt),
      // Recorded by this device when the signature checked out on arrival; it is read back only from the owner's own storage.
      ...(matched.key && get(item, 'signed') === true && { signed: true }),
    });
  }
  const ballots = [...byVoter.values()];
  const confirmed = settings.anonymity === 'named' ? [...new Set(list(get(v, 'confirmed'), LIMITS.ballots, 'keys').flatMap((k) => cleanKey(k) ?? []))] : [];
  return {
    role,
    settings,
    inviteId: cleanId(get(v, 'inviteId')) ?? newId(16),
    ballots,
    includeOwn: get(v, 'includeOwn') !== false,
    anonymityLocked: get(v, 'anonymityLocked') === true || ballots.length > 0,
    ...(myName && { myName }),
    ...(confirmed.length > 0 && { confirmed }),
  };
}

export function validateDecision(raw: unknown, kind: DecisionKind): Decision {
  if (!isObj(raw)) throw new FormatError('invalid', 'Missing decision data');
  const now = new Date().toISOString();

  const optionIdsSeen = new Set<string>();
  const options: Option[] = [];
  for (const item of list(get(raw, 'options'), LIMITS.options, 'options')) {
    if (!isObj(item)) continue;
    const description = cleanText(get(item, 'description'), T.description, true);
    const l10n = cleanTranslations(get(item, 'l10n'));
    options.push({
      id: uniqueId(get(item, 'id'), optionIdsSeen),
      name: cleanText(get(item, 'name'), T.name),
      ...(description && { description }),
      ...(l10n && { l10n }),
    });
  }

  const factorIdsSeen = new Set<string>();
  const factors: Factor[] = [];
  for (const item of list(get(raw, 'factors'), LIMITS.factors, 'factors')) {
    if (!isObj(item)) continue;
    const w = get(item, 'weight');
    const weight = typeof w === 'number' && Number.isFinite(w) ? Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(w))) : 3;
    const guide = cleanText(get(item, 'guide'), T.guide, true);
    const l10n = cleanTranslations(get(item, 'l10n'));
    factors.push({
      id: uniqueId(get(item, 'id'), factorIdsSeen),
      name: cleanText(get(item, 'name'), T.name),
      weight,
      ...(guide && { guide }),
      ...(l10n && { l10n }),
    });
  }

  const optionIds = new Set(options.map((o) => o.id));
  const factorIds = new Set(factors.map((f) => f.id));
  const settings = cleanSettings(get(raw, 'settings'), optionIds);

  const factsByCell = new Map<string, Fact>();
  for (const item of list(get(raw, 'facts'), LIMITS.facts, 'facts')) {
    if (!isObj(item)) continue;
    const optionId = refId(get(item, 'optionId'), optionIds);
    const factorId = refId(get(item, 'factorId'), factorIds);
    if (!optionId || !factorId) continue;
    const text = cleanText(get(item, 'text'), T.fact, true);
    const link = checkLink(get(item, 'url'));
    if (!text && !link) continue;
    factsByCell.set(`${optionId} ${factorId}`, { optionId, factorId, text, ...(link && { url: link.href }) });
  }

  // Templates carry structure only; shared files never carry private notes.
  const keepScores = kind !== 'template';
  const scores = keepScores ? cleanScores(get(raw, 'scores'), optionIds, factorIds, 0, settings.scaleMax, false) : [];
  const pugh = keepScores
    ? cleanScores(get(raw, 'pugh'), optionIds, factorIds, -settings.pughSteps, settings.pughSteps, true, settings.baselineId)
    : [];
  const notes = kind === 'template' ? [] : cleanNotes(get(raw, 'notes'), optionIds, factorIds, kind === 'backup', now);

  // Group data stays on the owner's device: it is read back from their own storage and backups only.
  const group = kind === 'backup' ? cleanGroup(get(raw, 'group'), { optionIds, factorIds, settings }) : undefined;
  const groupResult = kind === 'template' ? undefined : cleanGroupResult(get(raw, 'groupResult'), optionIds, factorIds, settings);

  const id = get(raw, 'id');
  const description = cleanText(get(raw, 'description'), T.description, true);
  return {
    id: typeof id === 'string' && ID_PATTERN.test(id) ? id : newId(),
    title: cleanText(get(raw, 'title'), T.title),
    ...(description && { description }),
    lang: cleanLang(get(raw, 'lang')),
    createdAt: cleanDate(get(raw, 'createdAt'), now),
    updatedAt: cleanDate(get(raw, 'updatedAt'), now),
    settings,
    options,
    factors,
    facts: [...factsByCell.values()],
    scores,
    pugh,
    notes,
    ...(group && { group }),
    ...(groupResult && { groupResult }),
  };
}
