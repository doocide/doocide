// Turns untrusted JSON into a clean Decision. Only known fields are read, every string is cleaned,
// every reference is checked, and the result is built from fresh objects (no prototype pollution).

import { ID_PATTERN, newId } from './ids';
import { LIMITS } from './limits';
import { checkLink, cleanText } from './sanitize';
import {
  FORMAT_VERSION,
  SCALES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  type Decision,
  type Envelope,
  type Fact,
  type Factor,
  type Kind,
  type Note,
  type Option,
  type Score,
  type Settings,
  type Translations,
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

export function cleanLang(v: unknown, fallback = 'en'): string {
  return typeof v === 'string' && v.length <= LIMITS.text.lang && LANG.test(v) ? v : fallback;
}

function cleanDate(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || v.length > 40) return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

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

export function parseEnvelopeText(text: string, maxChars?: number): Envelope {
  return validateEnvelope(parseJsonText(text, maxChars));
}

export function validateEnvelope(raw: unknown): Envelope {
  if (!isObj(raw)) throw new FormatError('not-doocide');
  const version = get(raw, 'doocide');
  if (typeof version !== 'number') throw new FormatError('not-doocide');
  if (version > FORMAT_VERSION) throw new FormatError('newer-version');
  if (version !== FORMAT_VERSION) throw new FormatError('not-doocide');

  const enc = get(raw, 'enc') ?? 'none';
  if (enc === 'passphrase' || enc === 'sealed') throw new FormatError('encrypted');
  if (enc !== 'none') throw new FormatError('newer-version');

  const kind = get(raw, 'kind');
  if (kind !== 'decision' && kind !== 'template' && kind !== 'backup') throw new FormatError('invalid', 'Unknown kind');

  return { doocide: FORMAT_VERSION, kind, enc: 'none', data: validateDecision(get(raw, 'data'), kind) };
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

const refId = (v: unknown, valid: Set<string>): string | undefined =>
  typeof v === 'string' && valid.has(v) ? v : undefined;

function cleanSettings(v: unknown, optionIds: Set<string>): Settings {
  const o = isObj(v) ? v : {};
  const mode = get(o, 'mode') === 'pugh' ? 'pugh' : 'weighted';
  const scale = get(o, 'scaleMax');
  const scaleMax = SCALES.includes(scale as (typeof SCALES)[number]) ? (scale as number) : 10;
  const pughSteps = get(o, 'pughSteps') === 2 ? 2 : 1;
  const baselineId = refId(get(o, 'baselineId'), optionIds);
  return { mode, scaleMax, pughSteps, ...(baselineId && { baselineId }) };
}

function cleanScores(
  raw: unknown,
  optionIds: Set<string>,
  factorIds: Set<string>,
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

export function validateDecision(raw: unknown, kind: Kind): Decision {
  if (!isObj(raw)) throw new FormatError('invalid', 'Missing decision data');
  const now = new Date().toISOString();
  const T = LIMITS.text;

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

  const notes: Note[] = [];
  const noteIdsSeen = new Set<string>();
  if (kind !== 'template') {
    for (const item of list(get(raw, 'notes'), LIMITS.notes, 'notes')) {
      if (!isObj(item)) continue;
      const visibility = get(item, 'visibility') === 'shared' ? 'shared' : 'private';
      if (visibility === 'private' && kind !== 'backup') continue;
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
        id: uniqueId(get(item, 'id'), noteIdsSeen),
        ...(optionId && { optionId }),
        ...(factorId && { factorId }),
        text,
        visibility,
        ...(author && { author }),
        createdAt: cleanDate(get(item, 'createdAt'), now),
      });
    }
  }

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
  };
}
