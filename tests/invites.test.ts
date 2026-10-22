// Keeping participants' copies in step with the organizer's invites.

import { describe, expect, it } from 'vitest';
import { addFactor, markInvited, refreshFromInvite, renameOption, setRows, setScore, setSettings, setWeight } from '../src/app/edit';
import { editedSinceInvite, hasChanges, inviteChanges, inviteShape, isOlderInvite } from '../src/app/invites';
import { joinInvite } from '../src/format/create';
import { inviteEnvelope } from '../src/format/share';
import type { Decision } from '../src/format/types';
import { groupDecision } from './fixtures';

/** The organizer's decision as it was at a given time. */
const at = (d: Decision, updatedAt: string): Decision => ({ ...d, updatedAt });
const invite = (d: Decision) => inviteEnvelope(d).data;

describe('older invites', () => {
  it("can't roll a participant's copy back", () => {
    const v1 = at(groupDecision(), '2026-10-20T10:00:00.000Z');
    const v2 = at(addFactor('Comfort')(v1), '2026-10-21T10:00:00.000Z');
    const p = joinInvite(invite(v2), 'en');
    const comfort = p.factors.find((f) => f.name === 'Comfort')!.id;
    const scored = setScore('a', comfort, 8)(p);

    expect(isOlderInvite(scored, invite(v1))).toBe(true);
    // Opening the older link changes nothing: the newer factor and its score stay.
    expect(refreshFromInvite(invite(v1), false)(scored)).toBe(scored);
  });

  it('a newer invite updates the copy, keeps scores for what is still there, and becomes the new version', () => {
    const v1 = at(groupDecision(), '2026-10-20T10:00:00.000Z');
    const p = setScore('a', 'price', 7)(joinInvite(invite(v1), 'en'));
    const v2 = at(addFactor('Comfort')(v1), '2026-10-21T10:00:00.000Z');
    const updated = refreshFromInvite(invite(v2), false)(p);
    expect(updated.factors.map((f) => f.name)).toContain('Comfort');
    expect(updated.scores.find((s) => s.optionId === 'a' && s.factorId === 'price')?.value).toBe(7);
    expect(updated.group!.inviteVersion).toBe('2026-10-21T10:00:00.000Z');
    expect(isOlderInvite(updated, invite(v1))).toBe(true);
  });
});

describe('what changed', () => {
  it('lists new, removed and renamed items, importance and rule changes', () => {
    const v1 = groupDecision();
    const p = joinInvite(invite(v1), 'en');
    let v2 = addFactor('Comfort')(v1);
    v2 = { ...v2, options: v2.options.filter((o) => o.id !== 'c') };
    v2 = renameOption('b', 'Car B, the new one')(v2);
    v2 = setWeight('looks', 3)(v2);
    const c = inviteChanges(p, invite(v2));
    expect(c.addedFactors).toEqual(['Comfort']);
    expect(c.removedOptions).toEqual(['Car C']);
    expect(c.renamed).toBe(1);
    expect(c.reweighted).toBe(1);
    expect(c.rules).toBe(false);
    expect(hasChanges(c)).toBe(true);
    expect(hasChanges(inviteChanges(p, invite(v1)))).toBe(false);
    expect(inviteChanges(p, invite(setSettings({ scaleMax: 5 })(v1))).rules).toBe(true);
  });
});

describe('organizer edits after an invite', () => {
  it('are noticed when they change what invites show, not when the organizer only scores or flips the layout', () => {
    const d = groupDecision();
    const invited = markInvited(inviteShape(d))(d);
    expect(editedSinceInvite(invited)).toBe(false);
    expect(editedSinceInvite(setScore('a', 'price', 1)(invited))).toBe(false);
    expect(editedSinceInvite(setRows('options')(invited))).toBe(false);
    expect(editedSinceInvite(addFactor('Comfort')(invited))).toBe(true);
    expect(editedSinceInvite(setWeight('looks', 4)(invited))).toBe(true);
  });

  it("don't change the decision's last-changed time, so invites stay in order", () => {
    const d = groupDecision();
    expect(markInvited(inviteShape(d))(d).updatedAt).toBe(d.updatedAt);
  });
});

describe('scoring rules once invites are out', () => {
  it('lock, because people may already be scoring with them', () => {
    const d = groupDecision();
    expect(setSettings({ scaleMax: 5 })(d).settings.scaleMax).toBe(5);
    const invited = markInvited(inviteShape(d))(d);
    expect(setSettings({ scaleMax: 5 })(invited)).toBe(invited);
    expect(setSettings({ mode: 'pugh' })(invited)).toBe(invited);
  });
});
