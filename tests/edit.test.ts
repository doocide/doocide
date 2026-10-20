import { describe, expect, it } from 'vitest';
import { addNote, removeOption, setFact, setScore, setSettings, tidyNames, renameOption } from '../src/app/edit';
import { sampleDecision } from './fixtures';

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
