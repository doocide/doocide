// Group decisions: combining ballots, finding disagreement, and the checks shown before approval.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { addBallots, setBallotIncluded, setIncludeOwn } from '../src/app/edit';
import { combine, combineVoters, computeResults, disagreements, groupView, reviewBallots, spreadLevel } from '../src/engine';
import { joinInvite } from '../src/format/create';
import { ballotEnvelope, inviteEnvelope, resultsEnvelope } from '../src/format/share';
import type { Decision } from '../src/format/types';
import { ballotFrom, groupDecision, participantCopy } from './fixtures';

const root = new URL('..', import.meta.url).pathname;
const schema = JSON.parse(readFileSync(join(root, 'schema/doocide-v1.schema.json'), 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

const cell = (d: Decision, optionId: string, factorId: string) => groupView(d)!.result.cells.find((c) => c.optionId === optionId && c.factorId === factorId);

/** The organizer doesn't vote, so the result is just the ballots. */
const facilitator = (settings = {}) => setIncludeOwn(false)(groupDecision(settings));

describe('combining ballots', () => {
  it('averages, or takes the median', () => {
    expect(combine([2, 4, 9], 'mean')).toBe(5);
    expect(combine([2, 4, 9], 'median')).toBe(4);
    expect(combine([2, 4, 6, 9], 'median')).toBe(5);
  });

  it('gives back one ballot exactly as it was scored', () => {
    const d = addBallots([ballotFrom(facilitator(), 'v1', 7)])(facilitator());
    const view = groupView(d)!;
    expect(view.result.ballots).toBe(1);
    expect(view.merged.scores.every((s) => s.value === 7)).toBe(true);
    expect(view.result.cells.every((c) => c.n === 1 && c.spread === 0)).toBe(true);
  });

  it("doesn't count a skipped cell as zero", () => {
    const base = facilitator();
    const partial = ballotFrom(base, 'v2', 9, { scores: [{ optionId: 'a', factorId: 'price', value: 9 }] });
    const d = addBallots([ballotFrom(base, 'v1', 3), partial])(base);
    expect(cell(d, 'a', 'price')).toMatchObject({ n: 2, value: 6 });
    expect(cell(d, 'b', 'price')).toMatchObject({ n: 1, value: 3 });
  });

  it('lets one outlier move the average but not the median', () => {
    const ballots = (d: Decision) => [ballotFrom(d, 'v1', 6), ballotFrom(d, 'v2', 6), ballotFrom(d, 'v3', 0)];
    const mean = facilitator({ combine: 'mean' });
    const median = facilitator({ combine: 'median' });
    expect(cell(addBallots(ballots(mean))(mean), 'a', 'price')!.value).toBe(4);
    expect(cell(addBallots(ballots(median))(median), 'a', 'price')!.value).toBe(6);
  });

  it('combines Pugh ratings into fractions', () => {
    const base = setIncludeOwn(false)(groupDecision({}, { settings: { mode: 'pugh', scaleMax: 10, pughSteps: 1, baselineId: 'a' } }));
    const rating = (voterId: string, value: number) =>
      ballotFrom(base, voterId, 0, { scores: [], pugh: [{ optionId: 'b', factorId: 'price', value }] });
    const d = addBallots([rating('v1', 1), rating('v2', 1), rating('v3', -1)])(base);
    expect(cell(d, 'b', 'price')!.value).toBeCloseTo(0.333, 3);
    // Combined values keep 3 decimals: 0.333 × weight 5.
    expect(computeResults(groupView(d)!.merged).byOption.get('b')!.total).toBeCloseTo(1.665, 3);
  });

  it('combines importance when everyone sets it', () => {
    const base = facilitator({ weights: 'everyone' });
    const withWeight = (voterId: string, weight: number) => ballotFrom(base, voterId, 5, { weights: [{ factorId: 'looks', weight }] });
    const d = addBallots([withWeight('v1', 5), withWeight('v2', 3)])(base);
    const merged = groupView(d)!.merged;
    expect(merged.factors.find((f) => f.id === 'looks')!.weight).toBe(4);
    // A ballot without a weight for a factor falls back to the organizer's.
    expect(merged.factors.find((f) => f.id === 'price')!.weight).toBe(5);
  });

  it('counts the organizer only when they scored and chose to count', () => {
    const d = addBallots([ballotFrom(groupDecision(), 'v1', 1)])(groupDecision());
    expect(groupView(d)!.result.ballots).toBe(2);
    expect(groupView(setIncludeOwn(false)(d))!.result.ballots).toBe(1);
    expect(groupView(setBallotIncluded('v1', false)(setIncludeOwn(false)(d)))).toBeNull();
  });
});

describe('where the group disagrees', () => {
  it('measures spread from 0 (everyone agrees) to 1 (split between the ends)', () => {
    const base = facilitator();
    const agree = addBallots([ballotFrom(base, 'v1', 6), ballotFrom(base, 'v2', 6)])(base);
    const split = addBallots([ballotFrom(base, 'v1', 0), ballotFrom(base, 'v2', 10)])(base);
    expect(cell(agree, 'a', 'price')!.spread).toBe(0);
    expect(cell(split, 'a', 'price')!.spread).toBe(1);
    expect(spreadLevel(1)).toBe(2);
    expect(spreadLevel(0.1)).toBe(0);
  });

  it('lists the most split cells first, and only with two or more ballots', () => {
    const base = facilitator();
    const scores = (a: number, b: number) => [
      { optionId: 'a', factorId: 'price', value: a },
      { optionId: 'b', factorId: 'price', value: b },
    ];
    const d = addBallots([ballotFrom(base, 'v1', 0, { scores: scores(0, 5) }), ballotFrom(base, 'v2', 0, { scores: scores(10, 7) })])(base);
    const list = disagreements(groupView(d)!.result);
    expect(list.map((c) => c.optionId)).toEqual(['a', 'b']);
    const one = addBallots([ballotFrom(base, 'v1', 0, { scores: scores(0, 10) })])(base);
    expect(disagreements(groupView(one)!.result)).toEqual([]);
  });

  it('ignores scores for options and factors the decision no longer has', () => {
    const base = facilitator();
    const result = combineVoters(base, [{ scores: [{ optionId: 'gone', factorId: 'price', value: 9 }], pugh: [] }], base.group!.settings);
    expect(result.cells).toEqual([]);
  });
});

describe('approving ballots', () => {
  it('replaces an earlier ballot from the same person with a newer one, and keeps it left out if it was', () => {
    const base = facilitator();
    const first = addBallots([ballotFrom(base, 'v1', 2)])(base);
    const excluded = setBallotIncluded('v1', false)(first);
    const updated = addBallots([ballotFrom(base, 'v1', 9, { revision: 2 })])(excluded);
    expect(updated.group!.ballots).toHaveLength(1);
    expect(updated.group!.ballots[0]!.scores[0]!.value).toBe(9);
    expect(updated.group!.ballots[0]!.included).toBe(false);
    // An older one changes nothing.
    expect(addBallots([ballotFrom(base, 'v1', 1, { revision: 1 })])(updated)).toBe(updated);
  });

  it('refuses ballots meant for another decision', () => {
    const base = facilitator();
    expect(addBallots([ballotFrom(base, 'v1', 2, { decisionId: 'other', inviteId: 'other' })])(base)).toBe(base);
  });
});

describe('checks before approval', () => {
  const kinds = (d: Decision, ...ballots: Parameters<typeof reviewBallots>[1]) => reviewBallots(d, ballots).map((r) => r.flags.map((f) => f.kind));

  it('flags a newer ballot from someone who already sent one, and an outdated one', () => {
    const d = addBallots([ballotFrom(facilitator(), 'v1', 2, { revision: 2 })])(facilitator());
    expect(kinds(d, ballotFrom(d, 'v1', 3, { revision: 3 }))[0]).toContain('replaces');
    const old = reviewBallots(d, [ballotFrom(d, 'v1', 3, { revision: 1 })])[0]!;
    expect(old.flags.map((f) => f.kind)).toContain('outdated');
    expect(old.adds).toBe(false);
  });

  it('flags copies, repeated names and more ballots than expected', () => {
    const named = addBallots([ballotFrom(facilitator({ anonymity: 'named', expected: 1 }), 'v1', 4, { author: 'Person A' })])(
      facilitator({ anonymity: 'named', expected: 1 }),
    );
    const flags = kinds(named, ballotFrom(named, 'v2', 4, { author: 'person a' }))[0]!;
    expect(flags).toEqual(expect.arrayContaining(['copy', 'sameName', 'overCount']));
  });

  it('flags empty ballots, missing options, removed names and earlier invites', () => {
    const d = facilitator();
    expect(kinds(d, ballotFrom(d, 'v1', 0, { scores: [] }))[0]).toContain('empty');
    expect(kinds(d, ballotFrom(d, 'v1', 0, { scores: [{ optionId: 'a', factorId: 'price', value: 3 }] }))[0]).toContain('missing');
    expect(kinds(d, ballotFrom(d, 'v1', 3, { author: 'Someone' }))[0]).toContain('nameRemoved');
    expect(kinds(d, ballotFrom(d, 'v1', 3, { inviteId: 'older' }))[0]).toContain('otherRound');
  });
});

describe('the whole round trip', () => {
  it('invite, join, score, send, approve', () => {
    const organizer = facilitator({ anonymity: 'named' });
    const invite = inviteEnvelope(organizer);
    const copy = joinInvite(invite.data, 'en');
    expect(copy.id).not.toBe(organizer.id);
    expect(copy.group).toMatchObject({ role: 'participant', sourceId: organizer.id, inviteId: 'invite1', revision: 0 });
    const scored = participantCopy(organizer, [{ optionId: 'c', factorId: 'safety', value: 10 }]);
    const approved = addBallots([ballotEnvelope(scored).data])(organizer);
    expect(cell(approved, 'c', 'safety')).toMatchObject({ n: 1, value: 10 });
  });

  it('every group file matches the published schema', () => {
    const organizer = addBallots([ballotFrom(groupDecision({ scoring: 'open', weights: 'everyone' }), 'v1', 4)])(groupDecision({ scoring: 'open', weights: 'everyone' }));
    const result = groupView(organizer)!.result;
    const files = [inviteEnvelope(organizer, result), ballotEnvelope(participantCopy(groupDecision({ weights: 'everyone' }))), resultsEnvelope(organizer, result)];
    for (const env of files) expect(validateSchema(JSON.parse(JSON.stringify(env))), JSON.stringify(validateSchema.errors)).toBe(true);
  });
});
