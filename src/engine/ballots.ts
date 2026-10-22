// Checks on incoming ballots, shown to the organizer before they approve anything, and how each
// approved ballot is labeled. MIT licensed (see LICENSE in this folder).

import type { Ballot, Decision, Group, ReceivedBallot, Signature, StoredBallot } from '../format/types';
import { matchBallot } from '../format/validate';

export type BallotFlag =
  /** A newer ballot from the same person: it replaces their earlier one. */
  | { kind: 'replaces' }
  /** The same or a newer ballot from this person is already in, so this one changes nothing. */
  | { kind: 'outdated' }
  /** The signature doesn't match: the ballot was changed after it was signed, or it's damaged. Refused. */
  | { kind: 'badSignature' }
  /** Signed by a different key than this person's earlier ballot, so it can't replace it. Refused. */
  | { kind: 'keyChanged' }
  /** Not signed: made with Doocide 0.2.0. */
  | { kind: 'unsigned' }
  /** Exactly the same scores as another ballot from someone else. */
  | { kind: 'copy' }
  /** Named groups: another ballot carries the same name. */
  | { kind: 'sameName' }
  /** More ballots than the organizer expected. */
  | { kind: 'overCount'; count: number; expected: number }
  /** Options or factors this ballot has no scores for at all: skipped, or added after it was made. Abstentions aren't counted here. */
  | { kind: 'missing'; options: number; factors: number }
  /** The sender abstained from these options (a conflict of interest, say). Left out of the result, not counted as zero. */
  | { kind: 'abstained'; options: string[] }
  /** The ballot carried a name, but the group is anonymous, so the name was removed. */
  | { kind: 'nameRemoved' }
  /** No scores at all. */
  | { kind: 'empty' }
  /** Made from an earlier invite of this decision. */
  | { kind: 'otherRound' };

export interface Review {
  /** The ballot fitted to the decision: unknown cells dropped, values clamped, names removed when anonymous. */
  ballot: Ballot;
  signature: Signature;
  flags: BallotFlag[];
  /** Approving it changes something: it isn't outdated or refused. */
  adds: boolean;
}

/**
 * Can this ballot take its sender's place? A sender who signed before is held to that key from then
 * on; a bad signature never gets in. This is the rule addBallots enforces, so the review shows it too.
 */
export function signatureAllows(prev: StoredBallot | undefined, r: ReceivedBallot): 'ok' | 'badSignature' | 'keyChanged' {
  if (r.signature === 'invalid') return 'badSignature';
  if (prev?.signed && (r.signature !== 'valid' || r.ballot.key !== prev.key)) return 'keyChanged';
  return 'ok';
}

const scoreKey = (b: Ballot, pugh: boolean) =>
  (pugh ? b.pugh : b.scores)
    .map((s) => `${s.optionId} ${s.factorId} ${s.value}`)
    .sort()
    .join('|');

const nameKey = (b: Ballot) => b.author?.trim().toLocaleLowerCase() ?? '';

/** Fits each incoming ballot to the organizer's decision and lists what the organizer should know before approving. */
export function reviewBallots(d: Decision, incoming: ReceivedBallot[]): Review[] {
  const g = d.group;
  const pugh = d.settings.mode === 'pugh';
  const existing = new Map((g?.ballots ?? []).map((b) => [b.voterId, b]));
  const matches = incoming.map((r) => ({ ...matchBallot(r.ballot, d), received: r }));

  // Several ballots from the same person in one batch: only the newest counts.
  const newest = new Map<string, number>();
  for (const { ballot } of matches) newest.set(ballot.voterId, Math.max(newest.get(ballot.voterId) ?? 0, ballot.revision));

  const others = (voterId: string) => [
    ...[...existing.values()].filter((b) => b.voterId !== voterId),
    ...matches.map((m) => m.ballot).filter((b) => b.voterId !== voterId),
  ];

  const voterIds = new Set(existing.keys());
  for (const { ballot } of matches) voterIds.add(ballot.voterId);
  const count = voterIds.size;
  const expected = g?.settings.expected;
  const baselineId = pugh ? d.settings.baselineId : undefined;

  return matches.map(({ ballot, nameRemoved, received }) => {
    const flags: BallotFlag[] = [];
    const prev = existing.get(ballot.voterId);
    const allowed = signatureAllows(prev, received);
    const stale = ballot.revision < (newest.get(ballot.voterId) ?? 0) || (prev !== undefined && prev.revision >= ballot.revision);
    if (allowed !== 'ok') flags.push({ kind: allowed });
    else if (stale) flags.push({ kind: 'outdated' });
    else if (prev) flags.push({ kind: 'replaces' });
    if (received.signature === 'none') flags.push({ kind: 'unsigned' });

    const cells = pugh ? ballot.pugh : ballot.scores;
    if (cells.length === 0) flags.push({ kind: 'empty' });
    else {
      const key = scoreKey(ballot, pugh);
      if (others(ballot.voterId).some((b) => scoreKey(b, pugh) === key)) flags.push({ kind: 'copy' });
      const scoredOptions = new Set(cells.map((s) => s.optionId));
      const scoredFactors = new Set(cells.map((s) => s.factorId));
      const abstained = new Set(ballot.abstain ?? []);
      const options = d.options.filter((o) => o.id !== baselineId && !abstained.has(o.id) && !scoredOptions.has(o.id)).length;
      const factors = d.factors.filter((f) => !scoredFactors.has(f.id)).length;
      if (options || factors) flags.push({ kind: 'missing', options, factors });
    }

    if (ballot.abstain?.length) flags.push({ kind: 'abstained', options: ballot.abstain });
    const name = nameKey(ballot);
    if (name && others(ballot.voterId).some((b) => nameKey(b) === name)) flags.push({ kind: 'sameName' });
    const adds = allowed === 'ok' && !stale;
    if (expected && count > expected && adds) flags.push({ kind: 'overCount', count, expected });
    if (nameRemoved) flags.push({ kind: 'nameRemoved' });
    if (g && ballot.inviteId !== g.inviteId) flags.push({ kind: 'otherRound' });

    return { ballot, signature: received.signature, flags, adds };
  });
}

/**
 * How a ballot's sender is shown. "verified" needs all three: a named group, a signature that checked
 * out when the ballot arrived, and a key the organizer confirmed by comparing short codes with its
 * owner. Anything less is "self-declared": the name is only what the sender typed.
 */
export function ballotStatus(b: StoredBallot, g: Group): 'verified' | 'self-declared' | 'no-name' | 'anonymous' {
  if (g.settings.anonymity !== 'named') return 'anonymous';
  if (!b.author) return 'no-name';
  return b.signed && b.key && g.confirmed?.includes(b.key) ? 'verified' : 'self-declared';
}
