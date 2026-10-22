import { describe, expect, it } from 'vitest';
import { joinInvite } from '../src/format/create';
import { generateSealer, generateSigner } from '../src/format/crypto';
import { inviteEnvelope } from '../src/format/share';
import {
  addBallots,
  ballotSealed,
  checkOrganizerFirst,
  confirmOrganizer,
  markSent,
  addFactor,
  addNote,
  addOption,
  removeOption,
  renameOption,
  setFact,
  refreshFromInvite,
  setRows,
  setScore,
  setSettings,
  setTitle,
  setWeight,
  tidyNames,
} from '../src/app/edit';
import { ballotFrom, groupDecision, participantCopy, sampleDecision, unsigned } from './fixtures';

describe('edits', () => {
  it('removing an option removes its scores, facts, notes and baseline role', () => {
    const d = setSettings({ mode: 'pugh', baselineId: 'a' })(sampleDecision());
    const out = removeOption('a')(d);
    expect(out.options.map((o) => o.id)).toEqual(['b', 'c']);
    expect(out.scores.some((s) => s.optionId === 'a')).toBe(false);
    expect(out.facts.some((f) => f.optionId === 'a')).toBe(false);
    expect(out.notes.some((n) => n.optionId === 'a')).toBe(false);
    expect(out.settings.baselineId).toBeUndefined();
  });

  it('new notes are private unless the user chooses shared', () => {
    const out = addNote({ optionId: 'a' }, 'hmm', 'private')(sampleDecision({ notes: [] }));
    expect(out.notes[0]?.visibility).toBe('private');
  });

  it('refuses unsafe fact links', () => {
    const out = setFact('b', 'price', 'claim', 'javascript:alert(1)')(sampleDecision());
    expect(out.facts.find((f) => f.optionId === 'b')).toEqual({ optionId: 'b', factorId: 'price', text: 'claim' });
  });

  it('clamps scores to the scale', () => {
    expect(setScore('a', 'price', 42)(sampleDecision()).scores.find((s) => s.optionId === 'a' && s.factorId === 'price')?.value).toBe(10);
  });

  it('keeps a trailing space while typing and trims it on blur', () => {
    const typed = renameOption('a', 'Car A ')(sampleDecision());
    expect(typed.options[0]?.name).toBe('Car A ');
    expect(tidyNames(typed).options[0]?.name).toBe('Car A');
  });
});

describe('group locks', () => {
  it("a participant scores, but can't change the organizer's options, factors or facts", () => {
    const p = participantCopy(groupDecision());
    for (const edit of [addOption('Car D'), renameOption('a', 'x'), removeOption('a'), addFactor('Color'), setTitle('x'), setFact('a', 'price', 'x', '')]) {
      expect(edit(p)).toBe(p);
    }
    expect(setScore('a', 'price', 2)(p)).not.toBe(p);
  });

  it('a participant sets importance only when the organizer asked everyone to', () => {
    expect(setWeight('price', 1)(participantCopy(groupDecision({ weights: 'organizer' }))).factors[0]!.weight).toBe(5);
    expect(setWeight('price', 1)(participantCopy(groupDecision({ weights: 'everyone' }))).factors[0]!.weight).toBe(1);
  });

  it('scoring rules lock once ballots exist', () => {
    const d = groupDecision();
    expect(setSettings({ scaleMax: 5 })(d).settings.scaleMax).toBe(5);
    const withBallot = addBallots(unsigned(ballotFrom(d, 'v1', 5)))(d);
    expect(setSettings({ scaleMax: 5 })(withBallot)).toBe(withBallot);
    expect(setSettings({ mode: 'pugh' })(withBallot)).toBe(withBallot);
  });
});

describe('rows layout', () => {
  it('switches between factors and options as rows, leaving the default out of the file', () => {
    const d = sampleDecision();
    const sideways = setRows('options')(d);
    expect(sideways.settings.rows).toBe('options');
    expect('rows' in setRows('factors')(sideways).settings).toBe(false);
    expect(setRows('factors')(d)).toBe(d);
  });

  it("is a view choice: participants and decisions with ballots can still switch it", () => {
    const p = participantCopy(groupDecision());
    expect(setRows('options')(p).settings.rows).toBe('options');
    const withBallot = addBallots(unsigned(ballotFrom(groupDecision(), 'v1', 5)))(groupDecision());
    expect(setRows('options')(withBallot).settings.rows).toBe('options');
  });

  it("keeps a participant's layout when they open the organizer's invite again", () => {
    const organizer = groupDecision();
    const p = setRows('options')(participantCopy(organizer));
    const invite = { decision: organizer, settings: organizer.group!.settings, inviteId: 'invite1' };
    expect(refreshFromInvite(invite, false)(p).settings.rows).toBe('options');
  });
});

describe('sealing and the organizer check', () => {
  const invite = async (named: boolean, withSealKey: boolean) => {
    const organizer = groupDecision({ anonymity: named ? 'named' : 'anonymous' });
    const data = inviteEnvelope(organizer, undefined, withSealKey ? (await generateSealer()).publicKey : undefined).data;
    return { ...data, key: (await generateSigner()).publicKey };
  };

  it('counts a ballot as sealed only when a signed invite carried a sealing key', async () => {
    expect(ballotSealed(joinInvite(await invite(false, true), 'en', true))).toBe(true);
    expect(ballotSealed(joinInvite(await invite(false, true), 'en', false))).toBe(false);
    expect(ballotSealed(joinInvite(await invite(false, false), 'en', true))).toBe(false);
  });

  it('asks a named participant to check the organizer code before their first ballot, until they do or send', async () => {
    const p = joinInvite(await invite(true, true), 'en', true);
    expect(checkOrganizerFirst(p)).toBe(true);
    expect(checkOrganizerFirst(confirmOrganizer(p))).toBe(false);
    expect(checkOrganizerFirst(markSent(p))).toBe(false);
    expect(checkOrganizerFirst(joinInvite(await invite(false, true), 'en', true))).toBe(false);
    expect(checkOrganizerFirst(joinInvite(await invite(true, true), 'en', false))).toBe(false);
  });
});

describe('adding options and factors', () => {
  it('can use an id the screen chose, so it can focus the new name field, and never adds the same id twice', () => {
    const d = addOption('', 'newOption')(sampleDecision());
    expect(d.options.at(-1)).toEqual({ id: 'newOption', name: '' });
    expect(addOption('', 'newOption')(d)).toBe(d);
    const f = addFactor('', 'newFactor')(d);
    expect(f.factors.at(-1)).toMatchObject({ id: 'newFactor', name: '', weight: 3 });
    expect(addFactor('', 'newFactor')(f)).toBe(f);
  });
});
