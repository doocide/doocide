// Groups and newer versions: when the organizer changes the decision, nothing a participant scored is
// lost (scores for removed items are set aside, and come back if the item does), renamed items are
// named so people can check them, and the organizer sees which ballots were scored on an earlier version.

import { describe, expect, it } from 'vitest';
import { countAside, discardSetAside, markInvited, refreshFromInvite, removeOption, renameOption } from '../src/app/edit';
import { inviteChanges } from '../src/app/invites';
import { reviewBallots, scoredBefore } from '../src/engine/ballots';
import { joinInvite } from '../src/format/create';
import { backupEnvelope, ballotEnvelope, inviteEnvelope } from '../src/format/share';
import type { Decision } from '../src/format/types';
import { validateEnvelope } from '../src/format/validate';
import { ballotFrom, groupDecision, unsigned } from './fixtures';

const at = (d: Decision, updatedAt: string): Decision => ({ ...d, updatedAt });
const invite = (d: Decision) => inviteEnvelope(d).data;

/** A participant who scored everything in version 1, with a note on Car C. */
function scoredCopy(v1: Decision): Decision {
  const p = joinInvite(invite(v1), 'en');
  return {
    ...p,
    scores: v1.options.flatMap((o) => v1.factors.map((f) => ({ optionId: o.id, factorId: f.id, value: 6 }))),
    notes: [{ id: 'note-c', optionId: 'c', text: 'Too small for us', visibility: 'private', createdAt: '2026-10-20T10:00:00.000Z' }],
  };
}

describe('a newer invite that removes an option', () => {
  const v1 = at(groupDecision(), '2026-10-20T10:00:00.000Z');
  const v2 = at(removeOption('c')(v1), '2026-10-21T10:00:00.000Z');

  it('sets its scores and notes aside instead of dropping them', () => {
    const updated = refreshFromInvite(invite(v2), false)(scoredCopy(v1));
    expect(updated.scores.some((s) => s.optionId === 'c')).toBe(false);
    expect(updated.notes).toEqual([]);
    expect(updated.group!.setAside!.scores).toHaveLength(3);
    expect(updated.group!.setAside!.notes.map((n) => n.id)).toEqual(['note-c']);
    expect(countAside(updated.group!.setAside)).toBe(4);
  });

  it('never sends what was set aside', () => {
    const updated = refreshFromInvite(invite(v2), false)(scoredCopy(v1));
    const ballot = JSON.stringify(ballotEnvelope({ ...updated, group: { ...updated.group!, revision: 1 } }));
    expect(ballot).not.toContain('"c"');
    expect(ballot).not.toContain('Too small');
  });

  it('brings it back when the option returns, into empty cells only', () => {
    const v3 = at(v1, '2026-10-22T10:00:00.000Z');
    const updated = refreshFromInvite(invite(v2), false)(scoredCopy(v1));
    const back = refreshFromInvite(invite(v3), false)(updated);
    expect(back.scores.filter((s) => s.optionId === 'c')).toHaveLength(3);
    expect(back.notes.map((n) => n.id)).toEqual(['note-c']);
    expect(back.group!.setAside).toBeUndefined();
  });

  it('keeps it in the owner’s backup, and lets it go only when discarded', () => {
    const updated = refreshFromInvite(invite(v2), false)(scoredCopy(v1));
    const restored = validateEnvelope(JSON.parse(JSON.stringify(backupEnvelope(updated)))).data as Decision;
    expect(countAside(restored.group!.setAside)).toBe(4);
    const discarded = discardSetAside(updated);
    expect(discarded.group!.setAside).toBeUndefined();
    expect(discardSetAside(discarded)).toBe(discarded);
  });
});

describe('a newer invite that renames an option', () => {
  it('names it, old and new, so people can check the scores that stay on it', () => {
    const v1 = at(groupDecision(), '2026-10-20T10:00:00.000Z');
    const v2 = at(renameOption('a', 'Car A, hybrid')(v1), '2026-10-21T10:00:00.000Z');
    const p = scoredCopy(v1);
    expect(inviteChanges(p, invite(v2)).renamed).toEqual([{ from: 'Car A', to: 'Car A, hybrid' }]);
    expect(refreshFromInvite(invite(v2), false)(p).scores.filter((s) => s.optionId === 'a')).toHaveLength(3);
  });
});

describe('ballots scored on an earlier version', () => {
  it('records a change only when an invite shows a changed decision', () => {
    const d = groupDecision();
    const first = markInvited('shape1')(d);
    expect(first.group!.shapeChangedAt).toBeUndefined();
    expect(markInvited('shape1')(first).group!.shapeChangedAt).toBeUndefined();
    expect(markInvited('shape2')(first).group!.shapeChangedAt).toBeTruthy();
  });

  it('flags ballots made before the change, without blocking them', () => {
    const d = groupDecision({ anonymity: 'named' });
    const changed = { ...d, group: { ...d.group!, shapeChangedAt: '2026-10-21T15:00:00.000Z' } };
    const before = ballotFrom(changed, 'v1', 5, { createdAt: '2026-10-21T09:00:00.000Z', author: 'Pat' });
    const after = ballotFrom(changed, 'v2', 5, { createdAt: '2026-10-21T16:00:00.000Z', author: 'Sam' });
    const [r1, r2] = reviewBallots(changed, unsigned(before, after));
    expect(r1!.flags).toContainEqual({ kind: 'earlierVersion', changedAt: '2026-10-21T15:00:00.000Z' });
    expect(r1!.adds).toBe(true);
    expect(r2!.flags.some((f) => f.kind === 'earlierVersion')).toBe(false);
  });

  it('can’t tell for an anonymous ballot from the day of the change, so doesn’t flag it', () => {
    expect(scoredBefore({ createdAt: '2026-10-21T00:00:00.000Z' }, '2026-10-21T15:00:00.000Z')).toBe(false);
    expect(scoredBefore({ createdAt: '2026-10-20T00:00:00.000Z' }, '2026-10-21T15:00:00.000Z')).toBe(true);
    expect(scoredBefore({ createdAt: '2026-10-20T00:00:00.000Z' }, undefined)).toBe(false);
  });
});
