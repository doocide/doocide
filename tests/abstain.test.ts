// Abstaining from an option: a conflict of interest, say. The ballot says so, carries no scores for
// that option, and the group's result leaves it out instead of counting it as zero.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { addBallots, refreshFromInvite, setAbstain, setSettings, withoutAbstained } from '../src/app/edit';
import { computeResults, groupView, reviewBallots } from '../src/engine';
import { checkBallot, generateSigner, signBallot } from '../src/format/crypto';
import { ballotEnvelope, ballotSummary, inviteEnvelope } from '../src/format/share';
import type { Decision } from '../src/format/types';
import { matchBallot, validateBallot, validateDecision } from '../src/format/validate';
import { PRIVATE_MARKER, SHARED_MARKER, ballotFrom, groupDecision, participantCopy, unsigned } from './fixtures';

const root = new URL('..', import.meta.url).pathname;
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schema/doocide-v1.schema.json'), 'utf8')));

const cell = (d: Decision, optionId: string, factorId: string) => groupView(d)!.result.cells.find((c) => c.optionId === optionId && c.factorId === factorId);

/** A participant's copy, scored everywhere, abstaining from Car A. */
function abstainingCopy(organizer: Decision = groupDecision()): Decision {
  return setAbstain('a', true)(participantCopy(organizer));
}

describe('abstaining on a ballot', () => {
  it('sends no scores or notes for the option, only the fact of abstaining', () => {
    const p = abstainingCopy();
    // The person did score Car A before abstaining, and wrote a shared note on Car B and a private one on Car A.
    expect(p.scores.some((s) => s.optionId === 'a')).toBe(true);
    const { data } = ballotEnvelope(p);
    expect(data.abstain).toEqual(['a']);
    expect(data.scores.some((s) => s.optionId === 'a')).toBe(false);
    expect(data.scores.length).toBe(6);
    expect(JSON.stringify(data)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(data)).toContain(SHARED_MARKER);
    expect(ballotSummary(p)).toMatchObject({ scores: 6, abstained: ['a'] });
  });

  it('keeps the scores on this device, so taking part again brings them back', () => {
    const p = abstainingCopy();
    const back = setAbstain('a', false)(p);
    expect(back.group!.abstain).toBeUndefined();
    expect(ballotEnvelope(back).data.scores.filter((s) => s.optionId === 'a')).toHaveLength(3);
    expect('abstain' in ballotEnvelope(back).data).toBe(false);
    // Nothing to change: the same decision comes back.
    expect(setAbstain('a', true)(p)).toBe(p);
    expect(setAbstain('nope', true)(p)).toBe(p);
  });

  it('is never offered for the Pugh baseline, which nobody scores', () => {
    const d = setSettings({ mode: 'pugh', baselineId: 'a' })(groupDecision());
    const p = participantCopy(d);
    expect(setAbstain('a', true)(p)).toBe(p);
  });

  it('keeps an anonymous ballot anonymous: no name, the date only, option ids only', () => {
    const { data } = ballotEnvelope(abstainingCopy());
    expect('author' in data).toBe(false);
    expect(data.createdAt.endsWith('T00:00:00.000Z')).toBe(true);
    expect(data.abstain).toEqual(['a']);
  });

  it('is covered by the signature: adding or removing an abstention breaks it', async () => {
    const signer = await generateSigner();
    const signed = await signBallot(ballotEnvelope(abstainingCopy()).data, signer);
    expect(await checkBallot(validateBallot(JSON.parse(JSON.stringify(signed))))).toBe('valid');
    expect(await checkBallot(validateBallot({ ...signed, abstain: ['a', 'b'] }))).toBe('invalid');
    const { abstain: _a, ...without } = signed;
    expect(await checkBallot(validateBallot(without))).toBe('invalid');
  });

  it('matches the published schema', () => {
    const env = ballotEnvelope(abstainingCopy());
    expect(validateSchema(JSON.parse(JSON.stringify(env))), JSON.stringify(validateSchema.errors)).toBe(true);
  });
});

describe('abstentions arriving at the organizer', () => {
  it('are cleaned: unknown options, repeats and the baseline are dropped, and an abstention beats a score', () => {
    const d = groupDecision();
    const b = validateBallot({ ...ballotFrom(d, 'v1', 7), abstain: ['a', 'a', 'ghost', 'b'] });
    expect(b.abstain).toEqual(['a', 'ghost', 'b']);
    const matched = matchBallot(b, d).ballot;
    expect(matched.abstain).toEqual(['a', 'b']);
    expect(matched.scores.every((s) => s.optionId === 'c')).toBe(true);
    const pugh = setSettings({ mode: 'pugh', baselineId: 'a' })(d);
    expect(matchBallot(validateBallot({ ...ballotFrom(pugh, 'v1', 1), abstain: ['a'] }), pugh).ballot.abstain).toBeUndefined();
  });

  it('are left out of the result, never counted as zero', () => {
    const d = groupDecision({ scoring: 'open' });
    const withBallots = addBallots(unsigned(ballotFrom(d, 'v1', 2), { ...ballotFrom(d, 'v2', 10), abstain: ['a'] }))(d);
    // Car A on Price: the organizer's 9 and v1's 2; v2 abstained.
    expect(cell(withBallots, 'a', 'price')).toMatchObject({ n: 2, value: 5.5 });
    // Car B on Price: all three.
    expect(cell(withBallots, 'b', 'price')).toMatchObject({ n: 3 });
  });

  it('show in the review as an abstention, not as missing scores', () => {
    const d = groupDecision();
    const [review] = reviewBallots(d, unsigned({ ...ballotFrom(d, 'v1', 6), abstain: ['b'] }));
    expect(review!.flags).toContainEqual({ kind: 'abstained', options: ['b'] });
    expect(review!.flags.some((f) => f.kind === 'missing')).toBe(false);
  });

  it('also apply to the organizer’s own scores', () => {
    const d = setAbstain('a', true)(groupDecision());
    const ballots = addBallots(unsigned(ballotFrom(d, 'v1', 4)))(d);
    expect(cell(ballots, 'a', 'price')).toMatchObject({ n: 1, value: 4 });
    expect(cell(ballots, 'b', 'price')).toMatchObject({ n: 2 });
  });
});

describe('abstentions on this device', () => {
  it('survive a backup, minus options the decision no longer has', () => {
    const p = abstainingCopy();
    const back = validateDecision(JSON.parse(JSON.stringify({ ...p, group: { ...p.group!, abstain: ['a', 'ghost'] } })), 'backup');
    expect(back.group!.abstain).toEqual(['a']);
  });

  it('follow a newer invite: an option it removes leaves the list', () => {
    const v1 = { ...groupDecision(), updatedAt: '2026-10-20T10:00:00.000Z' };
    const p = setAbstain('c', true)(abstainingCopy(v1));
    const v2 = { ...v1, updatedAt: '2026-10-21T10:00:00.000Z', options: v1.options.filter((o) => o.id !== 'c') };
    expect(refreshFromInvite(inviteEnvelope(v2).data, false)(p).group!.abstain).toEqual(['a']);
  });

  it('leave the person’s own ranking, so nothing reads as missing', () => {
    const p = abstainingCopy();
    const ranked = withoutAbstained(p, new Set(['a']));
    const results = computeResults(ranked);
    expect(results.ranking.map((r) => r.optionId)).not.toContain('a');
    expect(results.ranking.every((r) => r.complete)).toBe(true);
  });
});
