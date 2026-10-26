import { newId } from './ids';
import type { Decision, Invite } from './types';

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

/**
 * A new decision of your own, started from a file or link (someone's share, a template), your own
 * backup, or a duplicate. Group data and this device's bookkeeping come along only from your own
 * backup. Saved from a file or link, it remembers that file's id and last change (`origin`), so a
 * newer version of the same file can be recognized later; a duplicate keeps its original's.
 */
export function adopt(d: Decision, lang: string, how: 'file' | 'backup' | 'duplicate' = 'file'): Decision {
  const now = new Date().toISOString();
  const { group, origin, carriedFrom, ...rest } = d;
  const restore = how === 'backup';
  const from = how === 'file' ? { id: d.id, updatedAt: d.updatedAt } : origin;
  return {
    ...rest,
    ...(restore && group && { group }),
    ...(restore && carriedFrom && { carriedFrom }),
    ...(from && { origin: from }),
    id: newId(),
    lang: d.lang || lang,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A participant's own copy of an invite: their scores go here, and their ballot is made from it.
 * `signed`: the invite's signature checked out, so its key is kept to recognize the organizer by.
 */
export function joinInvite(invite: Invite, lang: string, signed = false): Decision {
  const now = new Date().toISOString();
  const d = invite.decision;
  return {
    ...d,
    id: newId(),
    lang: d.lang || lang,
    createdAt: now,
    updatedAt: now,
    scores: [],
    pugh: [],
    notes: [],
    group: {
      role: 'participant',
      settings: { ...invite.settings },
      inviteId: invite.inviteId,
      ballots: [],
      includeOwn: false,
      anonymityLocked: true,
      sourceId: d.id,
      // The organizer's last change before this invite: a later, older invite can't roll this copy back.
      inviteVersion: d.updatedAt,
      // Made fresh for this decision only, so nothing links this person's ballots across decisions.
      voterId: newId(22),
      revision: 0,
      ...(invite.organizerName && { organizerName: invite.organizerName }),
      ...(signed && invite.key && { organizerKey: invite.key }),
      // Only a signed invite's sealing key is trusted: otherwise anyone could swap in their own.
      ...(signed && invite.sealKey && { organizerSealKey: invite.sealKey }),
      ...(invite.result && { result: invite.result, resultsAt: d.updatedAt }),
    },
  };
}
