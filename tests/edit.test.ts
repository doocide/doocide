import { describe, expect, it } from 'vitest';
import {
  addBallots,
  addFactor,
  addNote,
  addOption,
  removeOption,
  renameOption,
  setFact,
  setScore,
  setSettings,
  setTitle,
  setWeight,
  tidyNames,
} from '../src/app/edit';
import { ballotFrom, groupDecision, participantCopy, sampleDecision } from './fixtures';

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
    const withBallot = addBallots([ballotFrom(d, 'v1', 5)])(d);
    expect(setSettings({ scaleMax: 5 })(withBallot)).toBe(withBallot);
    expect(setSettings({ mode: 'pugh' })(withBallot)).toBe(withBallot);
  });
});
