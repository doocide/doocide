// Checks on incoming ballots, shown to the organizer before they approve anything.
// MIT licensed (see LICENSE in this folder).

import type { Ballot, Decision } from '../format/types';
import { matchBallot } from '../format/validate';

export type BallotFlag =
  /** A newer ballot from the same person: it replaces their earlier one. */
  | { kind: 'replaces' }
  /** The same or a newer ballot from this person is already in, so this one changes nothing. */
  | { kind: 'outdated' }
  /** Exactly the same scores as another ballot from someone else. */
  | { kind: 'copy' }
  /** Named groups: another ballot carries the same name. */
  | { kind: 'sameName' }
  /** More ballots than the organizer expected. */
  | { kind: 'overCount'; count: number; expected: number }
  /** Options or factors this ballot has no scores for at all: skipped, or added after it was made. */
  | { kind: 'missing'; options: number; factors: number }
  /** The ballot carried a name, but the group is anonymous, so the name was removed. */
  | { kind: 'nameRemoved' }
  /** No scores at all. */
  | { kind: 'empty' }
  /** Made from an earlier invite of this decision. */
  | { kind: 'otherRound' };

export interface Review {
  /** The ballot fitted to the decision: unknown cells dropped, values clamped, names removed when anonymous. */
  ballot: Ballot;
  flags: BallotFlag[];
  /** Approving it changes something (it isn't outdated). */
  adds: boolean;
}

const scoreKey = (b: Ballot, pugh: boolean) =>
  (pugh ? b.pugh : b.scores)
    .map((s) => `${s.optionId} ${s.factorId} ${s.value}`)
    .sort()
    .join('|');

const nameKey = (b: Ballot) => b.author?.trim().toLocaleLowerCase() ?? '';

/** Fits each incoming ballot to the organizer's decision and lists what the organizer should know before approving. */
export function reviewBallots(d: Decision, incoming: Ballot[]): Review[] {
  const g = d.group;
  const pugh = d.settings.mode === 'pugh';
  const existing = new Map((g?.ballots ?? []).map((b) => [b.voterId, b]));
  const matches = incoming.map((b) => matchBallot(b, d));

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

  return matches.map(({ ballot, nameRemoved }) => {
    const flags: BallotFlag[] = [];
    const prev = existing.get(ballot.voterId);
    const stale = ballot.revision < (newest.get(ballot.voterId) ?? 0) || (prev !== undefined && prev.revision >= ballot.revision);
    if (stale) flags.push({ kind: 'outdated' });
    else if (prev) flags.push({ kind: 'replaces' });

    const cells = pugh ? ballot.pugh : ballot.scores;
    if (cells.length === 0) flags.push({ kind: 'empty' });
    else {
      const key = scoreKey(ballot, pugh);
      if (others(ballot.voterId).some((b) => scoreKey(b, pugh) === key)) flags.push({ kind: 'copy' });
      const scoredOptions = new Set(cells.map((s) => s.optionId));
      const scoredFactors = new Set(cells.map((s) => s.factorId));
      const options = d.options.filter((o) => o.id !== baselineId && !scoredOptions.has(o.id)).length;
      const factors = d.factors.filter((f) => !scoredFactors.has(f.id)).length;
      if (options || factors) flags.push({ kind: 'missing', options, factors });
    }

    const name = nameKey(ballot);
    if (name && others(ballot.voterId).some((b) => nameKey(b) === name)) flags.push({ kind: 'sameName' });
    if (expected && count > expected && !stale) flags.push({ kind: 'overCount', count, expected });
    if (nameRemoved) flags.push({ kind: 'nameRemoved' });
    if (g && ballot.inviteId !== g.inviteId) flags.push({ kind: 'otherRound' });

    return { ballot, flags, adds: !stale };
  });
}
