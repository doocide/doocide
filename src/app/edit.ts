// Pure edits on a decision. Each returns a new decision with updatedAt bumped, or the same decision
// when the edit isn't allowed (a participant changing the organizer's structure, for example).

import { newId } from '../format/ids';
import { LIMITS } from '../format/limits';
import { checkLink, cleanText } from '../format/sanitize';
import { signatureAllows } from '../engine/ballots';
import type { Decision, GroupResult, GroupSettings, Invite, Kdf, Note, ReceivedBallot, Score, Settings, StoredBallot, Visibility } from '../format/types';
import { WEIGHT_MAX, WEIGHT_MIN } from '../format/types';
import { cleanFolderResults, matchBallot } from '../format/validate';

export type Edit = (d: Decision) => Decision;

const touch = (d: Decision): Decision => ({ ...d, updatedAt: new Date().toISOString() });
const T = LIMITS.text;

/** While typing: drop unsafe characters but keep a trailing space. Names are trimmed on blur (tidy). */
const typingText = (s: string, max: number) => cleanText(s, max, false, false);

export const tidy = (s: string, max: number = T.name) => cleanText(s, max);

// Locks

const isParticipant = (d: Decision) => d.group?.role === 'participant';

/** A participant's copy belongs to the organizer: options, factors, guides and facts stay as invited. */
export const structureLocked = (d: Decision) => isParticipant(d);

/**
 * Scoring rules can't change under ballots that were scored with them, or once invites are out: people
 * may already be scoring on that scale, and their ballots would be squeezed into a new one.
 */
export const scoringLocked = (d: Decision) =>
  isParticipant(d) || (d.group?.role === 'organizer' && (d.group.ballots.length > 0 || Boolean(d.group.lastInviteAt)));

/**
 * Participant: their ballot will be sealed to the organizer. Only when the invite was signed and
 * carried a sealing key; otherwise it travels readable, and the screens say so.
 */
export const ballotSealed = (d: Decision) => d.group?.role === 'participant' && Boolean(d.group.organizerSealKey);

/**
 * Participant in a named group, before their first ballot: compare the organizer's code before their
 * name goes out. A fake invite signed with someone else's key shows a different code.
 */
export const checkOrganizerFirst = (d: Decision) => {
  const g = d.group;
  return g?.role === 'participant' && g.settings.anonymity === 'named' && Boolean(g.organizerKey) && !g.organizerConfirmed && !g.sentAt;
};

/** Participants set importance only when the organizer asked everyone to. */
export const weightsLocked = (d: Decision) => isParticipant(d) && d.group?.settings.weights !== 'everyone';

const structural =
  (edit: Edit): Edit =>
  (d) =>
    structureLocked(d) ? d : edit(d);

export const setTitle = (title: string): Edit => structural((d) => touch({ ...d, title: typingText(title, T.title) }));

/** Run when a name field loses focus: trims what was typed. */
export const tidyNames: Edit = (d) => ({
  ...d,
  title: tidy(d.title, T.title),
  options: d.options.map((o) => ({ ...o, name: tidy(o.name) })),
  factors: d.factors.map((f) => ({ ...f, name: tidy(f.name) })),
});

export const setDescription = (text: string): Edit =>
  structural((d) => {
    const description = cleanText(text, T.description, true);
    const { description: _old, ...rest } = d;
    return touch(description ? { ...rest, description } : rest);
  });

export const setLang = (lang: string): Edit => structural((d) => touch({ ...d, lang }));

export const setSettings = (patch: Partial<Settings>): Edit => (d) => {
  if (scoringLocked(d)) return d;
  const settings = { ...d.settings, ...patch };
  if (!patch.baselineId && 'baselineId' in patch) delete settings.baselineId;
  // Ratings outside a smaller Pugh range are clamped, not lost.
  const pugh = d.pugh.map((s) => ({ ...s, value: Math.max(-settings.pughSteps, Math.min(settings.pughSteps, s.value)) }));
  const scores = d.scores.map((s) => ({ ...s, value: Math.min(settings.scaleMax, s.value) }));
  return touch({ ...d, settings, pugh, scores });
};

/**
 * Factors or options as the matrix rows. A view choice saved with the decision, so it isn't locked by
 * ballots or by being a participant: it changes how the matrix looks, never a score.
 */
export const setRows = (rows: 'factors' | 'options'): Edit => (d) => {
  if ((d.settings.rows ?? 'factors') === rows) return d;
  const { rows: _rows, ...settings } = d.settings;
  return touch({ ...d, settings: rows === 'options' ? { ...settings, rows } : settings });
};

// Options

/** `id`: chosen by the caller when the screen needs to know it (to focus the new name field). */
export const addOption = (name: string, id: string = newId()): Edit =>
  structural((d) => (d.options.length >= LIMITS.options || d.options.some((o) => o.id === id) ? d : touch({ ...d, options: [...d.options, { id, name: tidy(name) }] })));

export const renameOption = (id: string, name: string): Edit =>
  structural((d) => touch({ ...d, options: d.options.map((o) => (o.id === id ? { ...o, name: typingText(name, T.name) } : o)) }));

export const setOptionDescription = (id: string, text: string): Edit =>
  structural((d) =>
    touch({
      ...d,
      options: d.options.map((o) => {
        if (o.id !== id) return o;
        const description = cleanText(text, T.description, true);
        const { description: _old, ...rest } = o;
        return description ? { ...rest, description } : rest;
      }),
    }),
  );

export const removeOption = (id: string): Edit =>
  structural((d) => {
    // Removing the baseline would change what every Pugh rating means.
    if (scoringLocked(d) && d.settings.baselineId === id) return d;
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
  });

export const moveOption = (id: string, by: -1 | 1): Edit => structural((d) => touch({ ...d, options: move(d.options, id, by) }));

// Factors

export const addFactor = (name: string, id: string = newId()): Edit =>
  structural((d) => (d.factors.length >= LIMITS.factors || d.factors.some((f) => f.id === id) ? d : touch({ ...d, factors: [...d.factors, { id, name: tidy(name), weight: 3 }] })));

export const renameFactor = (id: string, name: string): Edit =>
  structural((d) => touch({ ...d, factors: d.factors.map((f) => (f.id === id ? { ...f, name: typingText(name, T.name) } : f)) }));

export const setWeight = (id: string, weight: number): Edit => (d) => {
  if (weightsLocked(d)) return d;
  const w = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Math.round(weight)));
  return touch({ ...d, factors: d.factors.map((f) => (f.id === id ? { ...f, weight: w } : f)) });
};

export const setGuide = (id: string, text: string): Edit =>
  structural((d) =>
    touch({
      ...d,
      factors: d.factors.map((f) => {
        if (f.id !== id) return f;
        const guide = cleanText(text, T.guide, true);
        const { guide: _old, ...rest } = f;
        return guide ? { ...rest, guide } : rest;
      }),
    }),
  );

export const removeFactor = (id: string): Edit =>
  structural((d) =>
    touch({
      ...d,
      factors: d.factors.filter((f) => f.id !== id),
      facts: d.facts.filter((f) => f.factorId !== id),
      scores: d.scores.filter((s) => s.factorId !== id),
      pugh: d.pugh.filter((s) => s.factorId !== id),
      notes: d.notes.filter((n) => n.factorId !== id),
    }),
  );

export const moveFactor = (id: string, by: -1 | 1): Edit => structural((d) => touch({ ...d, factors: move(d.factors, id, by) }));

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

export const setFact = (optionId: string, factorId: string, text: string, url: string): Edit =>
  structural((d) => {
    const rest = d.facts.filter((f) => !(f.optionId === optionId && f.factorId === factorId));
    const clean = cleanText(text, T.fact, true);
    const link = checkLink(url);
    if (!clean && !link) return touch({ ...d, facts: rest });
    return touch({ ...d, facts: [...rest, { optionId, factorId, text: clean, ...(link && { url: link.href }) }] });
  });

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

// Groups

/** What new groups do with results in the shared folder: publish on purpose when blind, after each approval when open. */
export const defaultFolderResults = (scoring: GroupSettings['scoring']) => (scoring === 'open' ? 'approval' : 'publish');

/** "After each approval" only with open scoring: blind groups' results go out only when the organizer publishes them. */
function withFolderRule(settings: GroupSettings): GroupSettings {
  const { folderResults: raw, ...rest } = settings;
  const folderResults = cleanFolderResults(raw, settings.scoring);
  return folderResults ? { ...rest, folderResults } : rest;
}

/** Turns on scoring with others. The organizer has to choose anonymous or named; there is no default. */
export const startGroup = (settings: GroupSettings, myName = ''): Edit => (d) => {
  if (d.group) return d;
  const name = settings.anonymity === 'named' ? tidy(myName, T.author) : '';
  return touch({
    ...d,
    group: {
      role: 'organizer',
      settings: withFolderRule(settings),
      inviteId: newId(16),
      ballots: [],
      includeOwn: true,
      anonymityLocked: false,
      ...(name && { myName: name }),
    },
  });
};

/** Changes the group's rules. Anonymity can't change once the first ballot is in. */
export const setGroupSettings = (patch: Partial<GroupSettings>): Edit => (d) => {
  const g = d.group;
  if (!g || g.role !== 'organizer') return d;
  if (patch.anonymity !== undefined && patch.anonymity !== g.settings.anonymity && g.anonymityLocked) return d;
  const settings: GroupSettings = withFolderRule({ ...g.settings, ...patch });
  const expected = settings.expected === undefined ? undefined : Math.round(settings.expected);
  if (expected === undefined || !Number.isFinite(expected) || expected < 1) delete settings.expected;
  else settings.expected = Math.min(LIMITS.expected, expected);
  return touch({ ...d, group: { ...g, settings } });
};

/**
 * Organizer: lock the results file with a passphrase (its key settings; the key itself stays in
 * keys.ts), or stop locking it (null). Bookkeeping: what people score doesn't change.
 */
export const setResultsLock = (kdf: Kdf | null): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'organizer') return d;
  const { resultsKdf: _old, ...rest } = g;
  return { ...d, group: kdf ? { ...rest, resultsKdf: kdf } : rest };
};

/** Organizer: results just went to the shared folder. */
export const markPublished: Edit = (d) =>
  d.group?.role === 'organizer' ? { ...d, group: { ...d.group, publishedAt: new Date().toISOString() } } : d;

/** Results fitted to the options and factors this copy has, so nothing points at what isn't there. */
function fitResult(result: GroupResult, d: Pick<Decision, 'options' | 'factors' | 'settings'>): GroupResult {
  const options = new Set(d.options.map((o) => o.id));
  const factors = new Set(d.factors.map((f) => f.id));
  const baseline = d.settings.mode === 'pugh' ? d.settings.baselineId : undefined;
  const weights = result.weights?.filter((w) => factors.has(w.factorId));
  return {
    ballots: result.ballots,
    cells: result.cells.filter((c) => options.has(c.optionId) && factors.has(c.factorId) && c.optionId !== baseline),
    ...(weights?.length && { weights }),
  };
}

/** Participant: results are newer than the ones this copy shows. Equal or older ones change nothing. */
export const isNewerResult = (d: Decision, at: string) => d.group?.role === 'participant' && (!d.group.resultsAt || at > d.group.resultsAt);

/**
 * Participant: group results from the shared folder, already checked to be signed by the organizer.
 * `at` is the organizer's last-change time in that file. A view of the group, not the person's own
 * edit, so the copy's last-changed time stays.
 */
export const applyFolderResults = (result: GroupResult, at: string): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'participant' || !isNewerResult(d, at)) return d;
  return { ...d, group: { ...g, result: fitResult(result, d), resultsAt: at } };
};

/** The name that goes with your invites or your ballot, in named groups. Trimmed when it's sent. */
export const setMyName = (name: string): Edit => (d) => (d.group ? touch({ ...d, group: { ...d.group, myName: typingText(name, T.author) } }) : d);

/** Turns group scoring off. Only before the first ballot: after that, the promise made to the people who sent ballots stands. */
export const endGroup: Edit = (d) => {
  if (d.group?.role !== 'organizer' || d.group.anonymityLocked) return d;
  const { group: _group, ...rest } = d;
  return touch(rest);
};

/**
 * The organizer's approval, and the only way a ballot gets into a decision. Each ballot is fitted to
 * the decision again (names removed in anonymous groups). A newer ballot from the same person replaces
 * their earlier one, but only if it's signed by the same key when the earlier one was signed. A ballot
 * whose signature doesn't check out never gets in.
 */
export const addBallots = (received: ReceivedBallot[]): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'organizer') return d;
  const byVoter = new Map<string, StoredBallot>(g.ballots.map((b) => [b.voterId, b]));
  const now = new Date().toISOString();
  let changed = false;
  for (const r of received) {
    const raw = r.ballot;
    if (raw.decisionId !== d.id && raw.inviteId !== g.inviteId) continue;
    const prev = byVoter.get(raw.voterId);
    if (signatureAllows(prev, r) !== 'ok') continue;
    const b = matchBallot(raw, d).ballot;
    if (prev && prev.revision >= b.revision) continue;
    if (!prev && byVoter.size >= LIMITS.ballots) continue;
    byVoter.set(b.voterId, { ...b, included: prev ? prev.included : true, receivedAt: now, ...(r.signature === 'valid' && b.key && { signed: true }) });
    changed = true;
  }
  if (!changed) return d;
  return touch({ ...d, group: { ...g, ballots: [...byVoter.values()], anonymityLocked: true } });
};

export const setBallotIncluded = (voterId: string, included: boolean): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'organizer') return d;
  return touch({ ...d, group: { ...g, ballots: g.ballots.map((b) => (b.voterId === voterId ? { ...b, included } : b)) } });
};

export const removeBallot = (voterId: string): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'organizer') return d;
  return touch({ ...d, group: { ...g, ballots: g.ballots.filter((b) => b.voterId !== voterId) } });
};

/** Organizer, named groups: the codes matched, so ballots signed with this key show as verified. */
export const confirmKey = (key: string): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'organizer' || g.settings.anonymity !== 'named' || g.confirmed?.includes(key)) return d;
  return touch({ ...d, group: { ...g, confirmed: [...(g.confirmed ?? []), key] } });
};

export const unconfirmKey = (key: string): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'organizer' || !g.confirmed?.includes(key)) return d;
  return touch({ ...d, group: { ...g, confirmed: g.confirmed.filter((k) => k !== key) } });
};

/** Participant: the organizer's code matched the one on the invite. */
export const confirmOrganizer: Edit = (d) =>
  d.group?.role === 'participant' && d.group.organizerKey && !d.group.organizerConfirmed
    ? touch({ ...d, group: { ...d.group, organizerConfirmed: true } })
    : d;

/**
 * Participant: this device can't sign as the person who sent the earlier ballot (a copy restored on
 * another device, say), so the next ballot goes out as a new person rather than one the organizer would refuse.
 */
export const restartVoter: Edit = (d) => {
  const g = d.group;
  if (g?.role !== 'participant') return d;
  const { sentAt: _sentAt, key: _key, ...rest } = g;
  return touch({ ...d, group: { ...rest, voterId: newId(22), revision: 0 } });
};

export const setIncludeOwn = (includeOwn: boolean): Edit => (d) =>
  d.group?.role === 'organizer' ? touch({ ...d, group: { ...d.group, includeOwn } }) : d;

/**
 * A participant opens the invite again after the organizer changed it. The structure and the rules
 * follow the invite; their own scores and notes stay wherever the cells still exist. Anonymity stays
 * as it was when they joined: their ballots were made under that promise.
 */
export const refreshFromInvite = (invite: Invite, signed: boolean): Edit => (d) => {
  const g = d.group;
  if (g?.role !== 'participant' || g.sourceId !== invite.decision.id) return d;
  // An invite older than the one this copy follows would roll it back and lose scores for newer items.
  if (g.inviteVersion && invite.decision.updatedAt < g.inviteVersion) return d;
  // Once an invite came signed, only invites signed by that same key may change this copy.
  if (g.organizerKey && (!signed || invite.key !== g.organizerKey)) return d;
  const inv = invite.decision;
  const optionIds = new Set(inv.options.map((o) => o.id));
  const factorIds = new Set(inv.factors.map((f) => f.id));
  const steps = inv.settings.pughSteps;
  const keep = (s: Score) => optionIds.has(s.optionId) && factorIds.has(s.factorId);
  const ownWeight = new Map(d.factors.map((f) => [f.id, f.weight]));
  const everyone = invite.settings.weights === 'everyone';
  const { description: _description, group: _group, ...rest } = d;
  const { result: oldResult, resultsAt: oldAt, ...kept } = g;
  // Results go with whichever is newer: the ones in this invite, or the ones the copy already shows.
  const inviteResult = invite.result && (!oldAt || inv.updatedAt >= oldAt);
  const result = inviteResult ? invite.result : oldResult && fitResult(oldResult, inv);
  const resultsAt = inviteResult ? inv.updatedAt : oldAt;
  return touch({
    ...rest,
    title: inv.title,
    ...(inv.description && { description: inv.description }),
    lang: inv.lang,
    settings: { ...withoutRows(inv.settings), ...(d.settings.rows === 'options' && { rows: 'options' as const }) },
    options: inv.options,
    factors: inv.factors.map((f) => (everyone && ownWeight.has(f.id) ? { ...f, weight: ownWeight.get(f.id)! } : f)),
    facts: inv.facts,
    scores: d.scores.filter(keep).map((s) => ({ ...s, value: Math.min(inv.settings.scaleMax, s.value) })),
    pugh: d.pugh
      .filter((s) => keep(s) && s.optionId !== inv.settings.baselineId)
      .map((s) => ({ ...s, value: Math.max(-steps, Math.min(steps, s.value)) })),
    notes: d.notes.filter((n) => (!n.optionId || optionIds.has(n.optionId)) && (!n.factorId || factorIds.has(n.factorId))),
    group: {
      ...kept,
      inviteVersion: inv.updatedAt,
      settings: { ...invite.settings, anonymity: g.settings.anonymity },
      ...(result && { result }),
      ...(result && resultsAt && { resultsAt }),
      ...(!g.organizerKey && signed && invite.key && { organizerKey: invite.key }),
      ...(signed && invite.sealKey && { organizerSealKey: invite.sealKey }),
    },
  });
};

/**
 * Organizer: an invite went out showing this shape (see invites.ts). Bookkeeping, not a change to the
 * decision, so the last-changed time stays as it is.
 */
export const markInvited = (shape: string): Edit => (d) =>
  d.group?.role === 'organizer' ? { ...d, group: { ...d.group, lastInviteAt: new Date().toISOString(), lastInviteShape: shape } } : d;

/** A participant sends their ballot (again): the revision goes up, so it replaces the one sent before. */
export const markSent: Edit = (d) =>
  d.group?.role === 'participant'
    ? touch({ ...d, group: { ...d.group, revision: (d.group.revision ?? 0) + 1, sentAt: new Date().toISOString() } })
    : d;

function withoutRows(s: Settings): Settings {
  const { rows: _rows, ...rest } = s;
  return rest;
}

function move<T extends { id: string }>(items: T[], id: string, by: -1 | 1): T[] {
  const i = items.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const out = [...items];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
