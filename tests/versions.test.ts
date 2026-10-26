// Versions of a decision in the file format: a new version may declare which earlier versions it
// replaces (`replaces`) and the ids its options and factors had (`was`), so people's scores can
// follow them. Optional and additive: files without them work as before, and they never go into
// signed invites or results, which an older Doocide would then refuse. Where a saved decision came
// from (`origin`) and what was carried into it (`carriedFrom`) stay on the device.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { adopt } from '../src/format/create';
import { backupEnvelope, inviteEnvelope, resultsEnvelope, shareEnvelope } from '../src/format/share';
import type { Decision } from '../src/format/types';
import { FormatError, validateEnvelope } from '../src/format/validate';
import { groupDecision, sampleDecision } from './fixtures';

const root = new URL('..', import.meta.url).pathname;
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(join(root, 'schema/doocide-v1.schema.json'), 'utf8')));
const roundTrip = (env: unknown) => validateEnvelope(JSON.parse(JSON.stringify(env)));

/** Version 2 of the sample: option a's old id was "x", Safety used to be "safe", and it replaces "dec0". */
const versioned = (overrides: Partial<Decision> = {}): Decision => {
  const d = sampleDecision({ replaces: ['dec0'], ...overrides });
  return {
    ...d,
    options: d.options.map((o) => (o.id === 'a' ? { ...o, was: ['x'] } : o)),
    factors: d.factors.map((f) => (f.id === 'safety' ? { ...f, was: ['safe'] } : f)),
  };
};

describe('declaring earlier versions', () => {
  it('travels in decision and template shares, and passes the schema', () => {
    for (const kind of ['decision', 'template'] as const) {
      const env = shareEnvelope(versioned(), kind);
      expect(validateSchema(JSON.parse(JSON.stringify(env))), JSON.stringify(validateSchema.errors)).toBe(true);
      const back = roundTrip(env).data as Decision;
      expect(back.replaces).toEqual(['dec0']);
      expect(back.options.find((o) => o.id === 'a')!.was).toEqual(['x']);
      expect(back.factors.find((f) => f.id === 'safety')!.was).toEqual(['safe']);
    }
  });

  it('is cleaned like any incoming id: well-formed, each once, never the item’s own id', () => {
    const env = JSON.parse(JSON.stringify(shareEnvelope(versioned(), 'decision')));
    env.data.replaces = ['dec0', 'dec0', 'bad id!', 'dec1'];
    env.data.options[0].was = ['x', 'x', 'a', '<script>'];
    const back = roundTrip(env).data as Decision;
    expect(back.replaces).toEqual(['dec0']);
    expect(back.options[0]!.was).toEqual(['x']);
  });

  it('refuses a file that declares too many', () => {
    const env = JSON.parse(JSON.stringify(shareEnvelope(versioned(), 'decision')));
    env.data.options[0].was = Array.from({ length: 21 }, (_, i) => `x${i}`);
    expect(() => roundTrip(env)).toThrow(FormatError);
  });

  it('is optional: a file without it reads exactly as before', () => {
    const plain = roundTrip(shareEnvelope(sampleDecision(), 'decision')).data as Decision;
    expect(plain.replaces).toBeUndefined();
    expect(plain.options.every((o) => o.was === undefined)).toBe(true);
  });

  it('stays out of signed invites and results, which older versions would refuse', () => {
    const organizer = { ...groupDecision(), replaces: ['dec0'], options: versioned().options, factors: versioned().factors };
    const invite = JSON.stringify(inviteEnvelope(organizer));
    const results = JSON.stringify(resultsEnvelope(organizer, { ballots: 0, cells: [] }));
    for (const text of [invite, results]) {
      expect(text).not.toContain('"was"');
      expect(text).not.toContain('"replaces"');
    }
  });
});

describe('where a saved decision came from', () => {
  const now = Date.now();

  it('saving a file or link remembers its id and last change', () => {
    const file = roundTrip(shareEnvelope(sampleDecision(), 'decision')).data as Decision;
    const saved = adopt(file, 'en', 'file');
    expect(saved.id).not.toBe('dec1');
    expect(saved.origin).toEqual({ id: 'dec1', updatedAt: '2026-10-19T00:00:00.000Z' });
    expect(Date.parse(saved.createdAt)).toBeGreaterThanOrEqual(now - 1000);
  });

  it('is never taken from someone else’s file, only from this device’s storage and backups', () => {
    const env = JSON.parse(JSON.stringify(shareEnvelope(sampleDecision(), 'decision')));
    env.data.origin = { id: 'mine', updatedAt: '2026-10-01T00:00:00.000Z' };
    env.data.carriedFrom = [{ id: 'other', at: '2026-10-01T00:00:00.000Z' }];
    const shared = roundTrip(env).data as Decision;
    expect(shared.origin).toBeUndefined();
    expect(shared.carriedFrom).toBeUndefined();
    // A decision saved from it records the file itself, not what the file claimed.
    expect(adopt(shared, 'en', 'file').origin).toEqual({ id: 'dec1', updatedAt: '2026-10-19T00:00:00.000Z' });
  });

  it('stays on the device: never in shares, kept in the owner’s backup', () => {
    const d = sampleDecision({ origin: { id: 'file1', updatedAt: '2026-10-19T00:00:00.000Z' }, carriedFrom: [{ id: 'old1', at: '2026-10-20T00:00:00.000Z' }] });
    for (const kind of ['decision', 'template'] as const) {
      const text = JSON.stringify(shareEnvelope(d, kind));
      expect(text).not.toContain('origin');
      expect(text).not.toContain('carriedFrom');
    }
    const backup = roundTrip(backupEnvelope(d)).data as Decision;
    expect(validateSchema(JSON.parse(JSON.stringify(backupEnvelope(d)))), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(backup.origin).toEqual(d.origin);
    expect(backup.carriedFrom).toEqual(d.carriedFrom);
    expect(adopt(backup, 'en', 'backup')).toMatchObject({ origin: d.origin, carriedFrom: d.carriedFrom });
  });

  it('a duplicate keeps its original’s source, not what was carried into it', () => {
    const d = sampleDecision({ origin: { id: 'file1', updatedAt: '2026-10-19T00:00:00.000Z' }, carriedFrom: [{ id: 'old1', at: '2026-10-20T00:00:00.000Z' }] });
    const copy = adopt(d, 'en', 'duplicate');
    expect(copy.origin).toEqual(d.origin);
    expect(copy.carriedFrom).toBeUndefined();
  });
});
