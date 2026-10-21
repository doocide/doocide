// The never-list in CLAUDE.md, enforced. A failure here is a privacy bug, not a style issue.

import { describe, expect, it } from 'vitest';
import { addBallots, endGroup, setGroupSettings, startGroup } from '../src/app/edit';
import { groupView } from '../src/engine';
import { decodePayload, encodePayload, inflateCapped, makeLink, readFragment } from '../src/format/codec';
import {
  assertShareable,
  backupEnvelope,
  ballotEnvelope,
  ballotSummary,
  inviteEnvelope,
  inviteSummary,
  resultsEnvelope,
  resultsSummary,
  shareEnvelope,
  shareSummary,
  shareableCopy,
} from '../src/format/share';
import type { AnyEnvelope, Decision, Envelope } from '../src/format/types';
import { validateBallot, validateEnvelope } from '../src/format/validate';
import { NAME_MARKER, PRIVATE_MARKER, SHARED_MARKER, ballotFrom, groupDecision, participantCopy, sampleDecision } from './fixtures';

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function linkJson(link: string): Promise<string> {
  const payload = link.slice(link.indexOf('#d=') + 3);
  return new TextDecoder().decode(await inflateCapped(fromBase64Url(payload), 10_000_000));
}

describe('private notes never leave the device', () => {
  it('are left out of shared copies of a decision', () => {
    const copy = shareableCopy(sampleDecision(), 'decision');
    expect(JSON.stringify(copy)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(copy)).toContain(SHARED_MARKER);
  });

  it('are left out of links, checked in the raw link payload', async () => {
    const link = await makeLink(shareEnvelope(sampleDecision(), 'decision'), 'https://doocide.github.io/');
    const json = await linkJson(link);
    expect(json).not.toContain(PRIVATE_MARKER);
    expect(json).toContain(SHARED_MARKER);
  });

  it('are left out of shared files', () => {
    const file = JSON.stringify(shareEnvelope(sampleDecision(), 'decision'));
    expect(file).not.toContain(PRIVATE_MARKER);
  });

  it('are left out even when every note is private', async () => {
    const d = sampleDecision();
    d.notes = d.notes.map((n) => ({ ...n, visibility: 'private' as const }));
    const json = await linkJson(await makeLink(shareEnvelope(d, 'decision'), 'https://doocide.github.io/'));
    expect(json).not.toContain(SHARED_MARKER);
    expect(json).not.toContain(PRIVATE_MARKER);
  });

  it('are kept only in the owner backup', () => {
    expect(JSON.stringify(backupEnvelope(sampleDecision()))).toContain(PRIVATE_MARKER);
  });

  it('cannot be smuggled in through a hand-built envelope', async () => {
    const env: Envelope = { doocide: 1, kind: 'decision', enc: 'none', data: sampleDecision() };
    expect(() => assertShareable(env)).toThrow();
    await expect(encodePayload(env)).rejects.toThrow();
  });

  it('are dropped when someone else sends them inside a shared decision', () => {
    const incoming = validateEnvelope({ doocide: 1, kind: 'decision', enc: 'none', data: sampleDecision() });
    expect(incoming.data.notes.every((n) => n.visibility === 'shared')).toBe(true);
    expect(JSON.stringify(incoming)).not.toContain(PRIVATE_MARKER);
  });

  it('are counted in the share preview as left out', () => {
    const s = shareSummary(sampleDecision(), 'decision');
    expect(s.privateNotes).toBe(1);
    expect(s.sharedNotes).toBe(1);
  });
});

describe('shares carry only what the share type allows', () => {
  it('templates carry no scores and no notes', async () => {
    const env = shareEnvelope(sampleDecision(), 'template');
    expect(env.data.scores).toEqual([]);
    expect(env.data.pugh).toEqual([]);
    expect(env.data.notes).toEqual([]);
    const decoded = await decodePayload(await encodePayload(env));
    if (decoded.kind !== 'template') throw new Error('expected a template');
    expect(decoded.data.scores).toEqual([]);
    expect(decoded.data.notes).toEqual([]);
  });

  it('copies field by field, so a field added later is not shared by accident', () => {
    const d = { ...sampleDecision(), secretFutureField: PRIVATE_MARKER } as Decision;
    expect(JSON.stringify(shareableCopy(d, 'decision'))).not.toContain(PRIVATE_MARKER);
  });

  it('backups are never shareable and never travel in links', async () => {
    const backup = backupEnvelope(sampleDecision({ notes: [] }));
    expect(() => assertShareable(backup)).toThrow();
    await expect(encodePayload(backup)).rejects.toThrow();
  });
});

describe('links keep data after "#" only', () => {
  it('puts the payload in the fragment, never the path or query', async () => {
    const link = await makeLink(shareEnvelope(sampleDecision(), 'decision'), 'https://doocide.github.io/app/?utm=x#old');
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.pathname).toBe('/app/');
    expect(url.hash.startsWith('#d=')).toBe(true);
  });

  it('only reads data and template names from fragments, never commands', () => {
    expect(readFragment('#d=abc')).toEqual({ type: 'data', payload: 'abc' });
    expect(readFragment('#t=choose-a-car')).toEqual({ type: 'template', name: 'choose-a-car' });
    expect(readFragment('#t=../../secrets')).toEqual({ type: 'unknown' });
    expect(readFragment('#t=https://evil.example/x.json')).toEqual({ type: 'unknown' });
    expect(readFragment('#delete=all')).toEqual({ type: 'unknown' });
    expect(readFragment('')).toEqual({ type: 'none' });
  });

  it('refuses a backup arriving in a link', async () => {
    const json = JSON.stringify(backupEnvelope(sampleDecision({ notes: [] })));
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expect(decodePayload(payload)).rejects.toThrow();
  });
});

/** Everything a group share can turn into: the raw JSON of a link payload and of a file. */
async function everyForm(env: AnyEnvelope): Promise<string[]> {
  return [JSON.stringify(env), await linkJson(await makeLink(env, 'https://doocide.github.io/'))];
}

/** An organizer with two approved ballots, ready to share invites and results. */
function organizerWithBallots(anonymity: 'anonymous' | 'named' = 'anonymous') {
  const d = groupDecision({ anonymity, scoring: 'open' });
  return addBallots([ballotFrom(d, 'voterA', 4, { author: NAME_MARKER }), ballotFrom(d, 'voterB', 8)])(d);
}

describe('groups: private notes and group data never leave the device', () => {
  it('invites carry no notes, no scores and no ballots, in links and files', async () => {
    const d = organizerWithBallots();
    for (const json of await everyForm(inviteEnvelope(d, groupView(d)!.result))) {
      expect(json).not.toContain(PRIVATE_MARKER);
      expect(json).not.toContain(SHARED_MARKER);
      expect(json).not.toContain('voterA');
      expect(json).not.toContain(NAME_MARKER);
    }
  });

  it('blind invites carry no one\'s scores, open invites only the combined result', () => {
    const d = organizerWithBallots();
    const result = groupView(d)!.result;
    const blind = inviteEnvelope(setGroupSettings({ scoring: 'blind' })(d), result);
    expect(blind.data.result).toBeUndefined();
    expect(blind.data.decision.scores).toEqual([]);
    expect(() => assertShareable({ ...blind, data: { ...blind.data, result } })).toThrow();
    const open = inviteEnvelope(d, result);
    expect(open.data.result?.ballots).toBe(3);
    expect(JSON.stringify(open)).not.toContain('voterB');
  });

  it('ballots carry shared notes only, without their author', async () => {
    const env = ballotEnvelope(participantCopy(groupDecision({ anonymity: 'named' })));
    for (const json of await everyForm(env)) {
      expect(json).not.toContain(PRIVATE_MARKER);
      expect(json).toContain(SHARED_MARKER);
    }
    expect(env.data.notes.every((n) => !('author' in n))).toBe(true);
  });

  it('group results carry combined numbers only: no ballots, no names, no one\'s own scores', async () => {
    const d = organizerWithBallots('named');
    for (const json of await everyForm(resultsEnvelope(d, groupView(d)!.result))) {
      expect(json).not.toContain(PRIVATE_MARKER);
      expect(json).not.toContain(NAME_MARKER);
      expect(json).not.toContain('voterA');
      expect(json).not.toContain('"group"');
    }
    expect(resultsEnvelope(d, groupView(d)!.result).data.scores).toEqual([]);
  });

  it('a plain share of a group decision leaves the group data behind', () => {
    const d = organizerWithBallots('named');
    const json = JSON.stringify(shareEnvelope(d, 'decision'));
    expect(json).not.toContain('voterA');
    expect(json).not.toContain(NAME_MARKER);
    expect(() => assertShareable({ doocide: 1, kind: 'decision', enc: 'none', data: d })).toThrow();
    expect(shareSummary(d, 'decision').ballotsLeftOut).toBe(2);
  });

  it('previews count exactly what each share carries', () => {
    const d = organizerWithBallots();
    const result = groupView(d)!.result;
    expect(inviteSummary(d, result)).toMatchObject({ options: 3, factors: 3, facts: 1, resultBallots: 3, ownScores: 9, notes: 2, ballots: 2 });
    expect(resultsSummary(d, result)).toMatchObject({ ballots: 3, cells: 9, sharedNotes: 1, privateNotes: 1 });
    const p = participantCopy(groupDecision());
    expect(ballotSummary(p)).toEqual({ scores: 9, weights: 0, sharedNotes: 1, name: null, privateNotes: 1 });
  });

  it('invite and ballot links keep their data after "#"', async () => {
    const d = groupDecision();
    for (const env of [inviteEnvelope(d), ballotEnvelope(participantCopy(d))]) {
      const url = new URL(await makeLink(env, 'https://doocide.github.io/?x=1#old'));
      expect(url.search).toBe('');
      expect(url.hash.startsWith('#d=')).toBe(true);
    }
  });
});

describe('anonymity and signatures', () => {
  it('anonymous ballots contain no name, no author and no time of day', async () => {
    const env = ballotEnvelope(participantCopy(groupDecision({ anonymity: 'anonymous' })));
    expect('author' in env.data).toBe(false);
    for (const json of await everyForm(env)) {
      expect(json).not.toContain(NAME_MARKER);
      expect(json).not.toContain('"author"');
      expect(json).not.toContain('14:35');
    }
    expect(env.data.createdAt.endsWith('T00:00:00.000Z')).toBe(true);
  });

  it('named ballots carry the name the person typed', () => {
    const env = ballotEnvelope(participantCopy(groupDecision({ anonymity: 'named' })));
    expect(env.data.author).toBe(NAME_MARKER);
  });

  it('a name sent into an anonymous decision is removed before it is stored', () => {
    const d = groupDecision({ anonymity: 'anonymous' });
    const ballot = validateBallot({ ...ballotFrom(d, 'voterA', 5), author: NAME_MARKER, createdAt: '2026-10-20T14:35:12.000Z' });
    const after = addBallots([ballot])(d);
    expect(JSON.stringify(after.group)).not.toContain(NAME_MARKER);
    expect(after.group!.ballots[0]!.createdAt).toBe('2026-10-20T00:00:00.000Z');
  });

  it('each participant copy gets its own random voter id, never shared across decisions', () => {
    const one = participantCopy(groupDecision());
    const two = participantCopy(groupDecision());
    expect(one.group!.voterId).not.toBe(two.group!.voterId);
    expect(one.group!.voterId!.length).toBeGreaterThanOrEqual(22);
  });

  it('the anonymity setting cannot change after the first ballot exists', () => {
    const d = groupDecision({ anonymity: 'anonymous' });
    expect(setGroupSettings({ anonymity: 'named' })(d).group!.settings.anonymity).toBe('named');
    const withBallot = addBallots([ballotFrom(d, 'voterA', 5)])(d);
    expect(withBallot.group!.anonymityLocked).toBe(true);
    expect(setGroupSettings({ anonymity: 'named' })(withBallot).group!.settings.anonymity).toBe('anonymous');
    // Not by ending the group and starting over either.
    expect(endGroup(withBallot)).toBe(withBallot);
    expect(startGroup({ anonymity: 'named', scoring: 'blind', weights: 'organizer', combine: 'mean' })(withBallot)).toBe(withBallot);
  });

  it('ballots merge only after the organizer approves them', async () => {
    const d = groupDecision();
    const env = ballotEnvelope(participantCopy(d));
    // Opening a ballot link only reads it; nothing in the decision changes until addBallots.
    const decoded = await decodePayload(await encodePayload(env));
    expect(decoded.kind).toBe('ballot');
    expect(d.group!.ballots).toEqual([]);
    const approved = addBallots([env.data])(d);
    expect(approved.group!.ballots).toHaveLength(1);
    // Left out by the organizer: kept, but not counted.
    const leftOut = { ...approved, group: { ...approved.group!, includeOwn: false, ballots: approved.group!.ballots.map((b) => ({ ...b, included: false })) } };
    expect(groupView(leftOut)).toBeNull();
  });

  it.todo('anonymous ballots are signed with a per-decision key that is never reused or derived (milestone 2b)');
  it.todo('names show as verified only when the signature matches a group-confirmed key (milestone 2b)');
  it.todo('an invite code is accepted once, and no record links codes to people (milestone 3, room mode)');
});
