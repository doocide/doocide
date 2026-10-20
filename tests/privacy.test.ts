// The never-list in CLAUDE.md, enforced. A failure here is a privacy bug, not a style issue.

import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload, inflateCapped, makeLink, readFragment } from '../src/format/codec';
import { assertShareable, backupEnvelope, shareEnvelope, shareSummary, shareableCopy } from '../src/format/share';
import type { Decision, Envelope } from '../src/format/types';
import { validateEnvelope } from '../src/format/validate';
import { PRIVATE_MARKER, SHARED_MARKER, sampleDecision } from './fixtures';

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
    const decoded = await decodePayload((await encodePayload(env)));
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

// Milestone 2 (groups). Listed now so the rules are visible; each becomes a real test with the feature.
describe('anonymity and signatures (milestone 2)', () => {
  it.todo('anonymous ballots contain no name, author or long-lived key');
  it.todo('the anonymity setting cannot change after the first ballot exists');
  it.todo('anonymous ballots are signed with a per-decision key that is never reused or derived');
  it.todo('names show as verified only when the signature matches a group-confirmed key');
  it.todo('ballots merge only after the organizer approves them');
  it.todo('an invite code is accepted once, and no record links codes to people');
});
