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
 * A new decision of your own, started from a template, someone else's share or a duplicate.
 * Group data never comes along, except when restoring your own backup.
 */
export function adopt(d: Decision, lang: string, restore = false): Decision {
  const now = new Date().toISOString();
  const { group, ...rest } = d;
  return { ...rest, ...(restore && group && { group }), id: newId(), lang: d.lang || lang, createdAt: now, updatedAt: now };
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
      // Made fresh for this decision only, so nothing links this person's ballots across decisions.
      voterId: newId(22),
      revision: 0,
      ...(invite.organizerName && { organizerName: invite.organizerName }),
      ...(signed && invite.key && { organizerKey: invite.key }),
      ...(invite.result && { result: invite.result }),
    },
  };
}
