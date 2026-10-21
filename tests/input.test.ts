// Incoming links and files are hostile until proven otherwise.

import { describe, expect, it } from 'vitest';
import { decodePayload } from '../src/format/codec';
import { LIMITS } from '../src/format/limits';
import { checkLink, cleanText, escapeSpreadsheetText } from '../src/format/sanitize';
import { parseTable, toCSV } from '../src/format/table';
import { inviteEnvelope } from '../src/format/share';
import {
  FormatError,
  jsonDepth,
  matchBallot,
  parseAnyEnvelopeText,
  readIncoming,
  parseEnvelopeText,
  validateAnyEnvelope,
  validateBallot,
  validateEnvelope,
} from '../src/format/validate';
import { NAME_MARKER, ballotFrom, groupDecision, sampleDecision } from './fixtures';

const toPayload = async (text: string) => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof FormatError ? e.code : 'other';
  }
};

const envelope = (data: unknown) => ({ doocide: 1, kind: 'decision', enc: 'none', data });

describe('text cleaning', () => {
  it('removes direction overrides that disguise text', () => {
    expect(cleanText('moc.live‮evil', 100)).toBe('moc.liveevil');
    expect(cleanText('a⁦b⁩c', 100)).toBe('abc');
  });

  it('removes invisible characters but keeps the joiners real scripts need', () => {
    expect(cleanText('sam​ple﻿', 100)).toBe('sample');
    const persian = 'می‌خواهم';
    expect(cleanText(persian, 100)).toBe(persian);
    const family = '👨‍👩‍👧';
    expect(cleanText(family, 100)).toBe(family);
  });

  it('keeps right-to-left text intact', () => {
    expect(cleanText('مرحبا بالعالم', 100)).toBe('مرحبا بالعالم');
    expect(cleanText('שלום', 100)).toBe('שלום');
  });

  it('caps stacked combining marks (Zalgo text)', () => {
    const zalgo = 'a' + '́'.repeat(40);
    expect(Array.from(cleanText(zalgo, 100)).length).toBe(5);
    expect(cleanText('Tiếng Việt', 100)).toBe('Tiếng Việt');
  });

  it('drops control characters and truncates by character, not by byte', () => {
    expect(cleanText('a\u0000b\u0007c', 100)).toBe('abc');
    expect(cleanText('😀😀😀', 2)).toBe('😀😀');
  });
});

describe('links', () => {
  it('allows only plain http and https', () => {
    expect(checkLink('https://example.com/a')?.host).toBe('example.com');
    expect(checkLink('javascript:alert(1)')).toBeNull();
    expect(checkLink('data:text/html,<script>')).toBeNull();
    expect(checkLink('file:///etc/passwd')).toBeNull();
    expect(checkLink(42)).toBeNull();
  });

  it('rejects addresses that hide the real site behind credentials', () => {
    expect(checkLink('https://bank.com@evil.example/')).toBeNull();
  });

  it('flags look-alike domains written with other alphabets', () => {
    const link = checkLink('https://exаmple.com/'); // Cyrillic "а" in place of Latin "a"
    expect(link?.lookalike).toBe(true);
    expect(link?.host.startsWith('xn--')).toBe(true);
    expect(checkLink('https://example.com/')?.lookalike).toBe(false);
  });

  it('drops unsafe fact links from incoming files', () => {
    const d = sampleDecision({ facts: [{ optionId: 'a', factorId: 'price', text: 'x', url: 'javascript:alert(1)' }] });
    expect(validateEnvelope(envelope(d)).data.facts[0]?.url).toBeUndefined();
  });
});

describe('size, depth and format limits', () => {
  it('rejects nesting deeper than any real file', () => {
    const deep = '['.repeat(50) + ']'.repeat(50);
    expect(jsonDepth(deep)).toBe(50);
    expect(() => parseEnvelopeText(deep)).toThrow(FormatError);
  });

  it('ignores brackets inside strings when measuring depth', () => {
    expect(jsonDepth('{"a":"[[[[[[[[[[[[[[["}')).toBe(1);
  });

  it('stops unpacking a zip bomb as soon as it passes the limit', async () => {
    const bomb = await toPayload(' '.repeat(LIMITS.unpackedBytes + 1_000_000));
    expect(bomb.length).toBeLessThan(10_000);
    expect(await code(decodePayload(bomb))).toBe('too-big');
  });

  it('rejects oversized links before unpacking', async () => {
    expect(await code(decodePayload('A'.repeat(LIMITS.linkChars + 1)))).toBe('too-big');
  });

  it('rejects damaged links', async () => {
    expect(await code(decodePayload('not*base64'))).toBe('bad-data');
    expect(await code(decodePayload('AAAA'))).toBe('bad-data');
  });

  it('rejects too many options', () => {
    const options = Array.from({ length: LIMITS.options + 1 }, (_, i) => ({ id: `o${i}`, name: `${i}` }));
    expect(() => validateEnvelope(envelope(sampleDecision({ options })))).toThrow(/Too many/);
  });

  it('reports newer and encrypted files instead of guessing', () => {
    const err = (raw: unknown) => {
      try {
        validateEnvelope(raw);
        return 'ok';
      } catch (e) {
        return (e as FormatError).code;
      }
    };
    expect(err({ doocide: 2, kind: 'decision', data: {} })).toBe('newer-version');
    expect(err({ doocide: 1, kind: 'decision', enc: 'sealed', data: {} })).toBe('encrypted');
    expect(err({ doocide: 1, kind: 'decision', enc: 'quantum', data: {} })).toBe('newer-version');
    expect(err({ hello: 'world' })).toBe('not-doocide');
  });

  it('rejects duplicate ids rather than mixing up scores', () => {
    const d = sampleDecision({ options: [{ id: 'a', name: 'One' }, { id: 'a', name: 'Two' }] });
    expect(() => validateEnvelope(envelope(d))).toThrow(FormatError);
  });

  it('drops scores, facts and notes that point at nothing', () => {
    const d = sampleDecision();
    d.scores.push({ optionId: 'ghost', factorId: 'price', value: 5 });
    d.facts.push({ optionId: 'a', factorId: 'ghost', text: 'x' });
    d.notes.push({ id: 'n9', optionId: 'ghost', text: 'x', visibility: 'shared', createdAt: d.createdAt });
    const out = validateEnvelope(envelope(d)).data;
    expect(out.scores.some((s) => s.optionId === 'ghost')).toBe(false);
    expect(out.facts.some((f) => f.factorId === 'ghost')).toBe(false);
    expect(out.notes.some((n) => n.id === 'n9')).toBe(false);
  });

  it('keeps only a known rows layout, and leaves the default out', () => {
    const rows = (v: unknown) => validateEnvelope(envelope({ ...sampleDecision(), settings: { mode: 'weighted', scaleMax: 10, pughSteps: 1, rows: v } })).data.settings;
    expect(rows('options').rows).toBe('options');
    expect('rows' in rows('factors')).toBe(false);
    expect('rows' in rows('sideways')).toBe(false);
  });

  it('clamps out-of-range scores and weights', () => {
    const d = sampleDecision();
    d.scores[0] = { optionId: 'a', factorId: 'price', value: 9999 };
    d.factors[0] = { id: 'price', name: 'Price', weight: -4 };
    const out = validateEnvelope(envelope(d)).data;
    expect(out.scores.find((s) => s.optionId === 'a' && s.factorId === 'price')?.value).toBe(10);
    expect(out.factors[0]?.weight).toBe(1);
  });
});

describe('prototype pollution', () => {
  it('ignores __proto__ and constructor keys in incoming data', () => {
    const text = `{"doocide":1,"kind":"decision","enc":"none","__proto__":{"polluted":true},"data":{"title":"x","__proto__":{"polluted":true},"options":[{"id":"a","name":"A","__proto__":{"polluted":true}}],"factors":[],"settings":{"constructor":{"prototype":{"polluted":true}}}}}`;
    const env = parseEnvelopeText(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((env.data as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(env.data.options[0])).toBe(Object.prototype);
  });
});

describe('spreadsheets', () => {
  it('escapes text that spreadsheet apps would run as a formula', () => {
    expect(escapeSpreadsheetText('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`);
    expect(escapeSpreadsheetText('+1')).toBe(`'+1`);
    expect(escapeSpreadsheetText('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(escapeSpreadsheetText('Price')).toBe('Price');
  });

  it('exports options as rows when the decision shows them that way', () => {
    const d = sampleDecision({ settings: { mode: 'weighted', scaleMax: 10, pughSteps: 1, rows: 'options' } });
    const lines = toCSV(d, new Map([['a', 71.5]]), { factor: 'Factor', weight: 'Weight', total: 'Total' }).trim().split('\r\n');
    expect(lines[0]).toBe('Factor,Price,Safety,Looks,Total');
    expect(lines[1]).toBe('Weight,5,4,1,');
    expect(lines[2]).toBe('Car A,9,6,5,71.5');
  });

  it('exports names safely and numbers as numbers', () => {
    const d = sampleDecision();
    d.options[0] = { id: 'a', name: '=cmd|"/c calc"!A1' };
    const csv = toCSV(d, new Map([['a', 71.5]]), { factor: 'Factor', weight: 'Weight', total: 'Total' });
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
    expect(csv).toContain('Price,5,9,7,5');
  });

  it('reads pasted tables from spreadsheet apps and CSV files', () => {
    expect(parseTable('A\tB\n1\t2')).toEqual([['A', 'B'], ['1', '2']]);
    expect(parseTable('"Name, with comma",B\r\n"Say ""hi""",2\r\n')).toEqual([['Name, with comma', 'B'], ['Say "hi"', '2']]);
    expect(parseTable('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
});

describe('invites and ballots from others', () => {
  const err = (fn: () => unknown) => {
    try {
      fn();
      return 'ok';
    } catch (e) {
      return e instanceof FormatError ? e.code : 'other';
    }
  };

  it('refuses ballots without well-formed ids', () => {
    expect(err(() => validateBallot({ decisionId: 'dec1', inviteId: 'invite1' }))).toBe('invalid');
    expect(err(() => validateBallot({ decisionId: '../x', inviteId: 'i', voterId: 'v' }))).toBe('invalid');
    expect(err(() => validateBallot('ballot'))).toBe('invalid');
  });

  it('fits a ballot to the decision: unknown cells dropped, values clamped', () => {
    const d = groupDecision();
    const raw = ballotFrom(d, 'voterA', 5, {
      scores: [
        { optionId: 'a', factorId: 'price', value: 9999 },
        { optionId: 'ghost', factorId: 'price', value: 5 },
        { optionId: 'b', factorId: 'safety', value: -3 },
      ],
    });
    const { ballot, dropped } = matchBallot(validateBallot(raw), d);
    expect(ballot.scores).toEqual([
      { optionId: 'a', factorId: 'price', value: 10 },
      { optionId: 'b', factorId: 'safety', value: 0 },
    ]);
    expect(dropped).toBe(1);
  });

  it('removes a name from a ballot sent to an anonymous decision, and keeps it in a named one', () => {
    const raw = validateBallot({ ...ballotFrom(groupDecision(), 'voterA', 5), author: NAME_MARKER });
    const anonymous = matchBallot(raw, groupDecision({ anonymity: 'anonymous' }));
    expect(anonymous.nameRemoved).toBe(true);
    expect(JSON.stringify(anonymous.ballot)).not.toContain(NAME_MARKER);
    expect(matchBallot(raw, groupDecision({ anonymity: 'named' })).ballot.author).toBe(NAME_MARKER);
  });

  it('drops private notes and note authors from incoming ballots', () => {
    const b = validateBallot({
      ...ballotFrom(groupDecision(), 'voterA', 5),
      notes: [
        { id: 'n1', text: 'secret', visibility: 'private' },
        { id: 'n2', text: 'reason', visibility: 'shared', author: NAME_MARKER },
      ],
    });
    expect(b.notes).toHaveLength(1);
    expect(JSON.stringify(b)).not.toContain(NAME_MARKER);
  });

  it('drops malformed keys and signatures instead of passing them on', () => {
    const b = validateBallot({ ...ballotFrom(groupDecision(), 'voterA', 5), key: 'not/base64', sig: 'x'.repeat(500) });
    expect(b.key).toBeUndefined();
    expect(b.sig).toBeUndefined();
  });

  it('caps the size of a ballot', () => {
    const scores = Array.from({ length: LIMITS.scores + 1 }, () => ({ optionId: 'a', factorId: 'price', value: 1 }));
    expect(err(() => validateBallot({ ...ballotFrom(groupDecision(), 'voterA', 5), scores }))).toBe('too-big');
  });

  it('ignores __proto__ keys inside ballots', () => {
    const text = `{"doocide":1,"kind":"ballot","enc":"none","data":{"decisionId":"dec1","inviteId":"invite1","voterId":"v1","__proto__":{"polluted":true},"scores":[{"optionId":"a","factorId":"price","value":3,"__proto__":{"polluted":true}}]}}`;
    const env = parseAnyEnvelopeText(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(env.kind).toBe('ballot');
  });

  it('reads an unknown kind as made by a newer Doocide', () => {
    expect(err(() => validateAnyEnvelope({ doocide: 1, kind: 'poll', enc: 'none', data: {} }))).toBe('newer-version');
    expect(err(() => validateAnyEnvelope({ doocide: 1, kind: 7, enc: 'none', data: {} }))).toBe('invalid');
  });

  it('keeps invites and ballots out of the decision-only reader', () => {
    expect(err(() => validateEnvelope(inviteEnvelope(groupDecision())))).toBe('invalid');
  });

  it('treats unclear group rules as anonymous and blind', () => {
    const env = validateAnyEnvelope({
      doocide: 1,
      kind: 'invite',
      enc: 'none',
      data: {
        decision: { id: 'dec1', title: 'x', options: [{ id: 'a', name: 'A' }], factors: [{ id: 'f', name: 'F', weight: 3 }] },
        inviteId: 'invite1',
        settings: { anonymity: 'NAMED', scoring: 'peek', expected: 1e9 },
        organizerName: NAME_MARKER,
        result: { ballots: 1, cells: [{ optionId: 'a', factorId: 'f', n: 1, value: 5, low: 5, high: 5, spread: 0 }] },
      },
    });
    if (env.kind !== 'invite') throw new Error('expected an invite');
    expect(env.data.settings).toEqual({ anonymity: 'anonymous', scoring: 'blind', weights: 'organizer', combine: 'mean' });
    expect(env.data.organizerName).toBeUndefined();
    expect(env.data.result).toBeUndefined();
  });

  it('refuses an invite whose decision id is missing or made up', () => {
    const invite = (id: unknown) => ({ doocide: 1, kind: 'invite', enc: 'none', data: { decision: { id, title: 'x' }, inviteId: 'i1', settings: {} } });
    expect(err(() => validateAnyEnvelope(invite(undefined)))).toBe('invalid');
    expect(err(() => validateAnyEnvelope(invite('a/b')))).toBe('invalid');
  });

  it("can't slip group data into someone's library through a shared decision", () => {
    const d = groupDecision({ anonymity: 'named' });
    const shared = validateEnvelope({ doocide: 1, kind: 'decision', enc: 'none', data: d });
    expect(shared.data.group).toBeUndefined();
  });

  it('checks and clamps a shared group result', () => {
    const d = sampleDecision({
      groupResult: {
        ballots: 3,
        cells: [
          { optionId: 'a', factorId: 'price', n: 3, value: 500, low: -9, high: 500, spread: 7 },
          { optionId: 'ghost', factorId: 'price', n: 3, value: 5, low: 5, high: 5, spread: 0 },
        ],
      },
    });
    const out = validateEnvelope({ doocide: 1, kind: 'decision', enc: 'none', data: d }).data.groupResult!;
    expect(out.cells).toEqual([{ optionId: 'a', factorId: 'price', n: 3, value: 10, low: 0, high: 10, spread: 1 }]);
  });
});

describe('encrypted files from others', () => {
  const box = { doocide: 1, enc: 'passphrase', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: 'A'.repeat(22) }, iv: 'A'.repeat(16), ct: 'AAAA' };
  const err = (raw: unknown) => {
    try {
      readIncoming(raw);
      return 'ok';
    } catch (e) {
      return e instanceof FormatError ? e.code : 'other';
    }
  };

  it('come back unopened, for the app to ask for a passphrase or find a key', () => {
    expect(readIncoming(box).type).toBe('encrypted');
    expect(readIncoming({ doocide: 1, kind: 'decision', enc: 'none', data: sampleDecision() }).type).toBe('plain');
  });

  it('are checked before any decryption is tried', () => {
    expect(err({ ...box, iv: 'A'.repeat(20) })).toBe('invalid');
    expect(err({ ...box, ct: 'A'.repeat(LIMITS.fileBytes + 1) })).toBe('too-big');
    expect(err({ ...box, kdf: { ...box.kdf, iterations: 5_000_000 } })).toBe('too-big');
    expect(err({ ...box, kdf: { ...box.kdf, name: 'scrypt' } })).toBe('newer-version');
    expect(err({ doocide: 1, enc: 'sealed', iv: box.iv, ct: box.ct, to: 'k', salt: 'A'.repeat(22) })).toBe('invalid');
    expect(err({ ...box, doocide: 2 })).toBe('newer-version');
  });

  it('are still refused where only plain files make sense', () => {
    expect(() => validateEnvelope(box)).toThrow(expect.objectContaining({ code: 'encrypted' }));
  });
});
