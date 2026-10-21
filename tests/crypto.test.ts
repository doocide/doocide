// Signatures on invites and ballots: what's signed, what breaks a signature, and the short codes.

import { describe, expect, it } from 'vitest';
import { addBallots, confirmKey, setBallotIncluded } from '../src/app/edit';
import { reviewBallots } from '../src/engine';
import { decodePayload, encodePayload } from '../src/format/codec';
import { canonicalJson, checkBallot, checkInvite, generateSigner, shortCode, signBallot, signInvite } from '../src/format/crypto';
import { ballotEnvelope, inviteEnvelope } from '../src/format/share';
import type { AnyEnvelope, Ballot, Invite } from '../src/format/types';
import { validateBallot, validateInvite } from '../src/format/validate';
import { ballotFrom, groupDecision, participantCopy, randomDecision } from './fixtures';

/** What the receiving app sees: the signed data sent through a real link and read back. */
async function overTheWire(env: AnyEnvelope): Promise<AnyEnvelope> {
  return decodePayload(await encodePayload(env));
}

const asBallot = (env: AnyEnvelope): Ballot => {
  if (env.kind !== 'ballot') throw new Error('expected a ballot');
  return env.data;
};

const asInvite = (env: AnyEnvelope): Invite => {
  if (env.kind !== 'invite') throw new Error('expected an invite');
  return env.data;
};

describe('canonical JSON', () => {
  it('sorts keys at every level, keeps array order and leaves out undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: undefined, b: 'x' } })).toBe('{"a":{"b":"x","d":[3,1]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('signed ballots', () => {
  const sendSigned = async (named = false) => {
    const signer = await generateSigner();
    const ballot = await signBallot(ballotEnvelope(participantCopy(groupDecision({ anonymity: named ? 'named' : 'anonymous' }))).data, signer);
    return { signer, ballot };
  };

  it('check out after travelling through a link', async () => {
    const { ballot, signer } = await sendSigned(true);
    const received = asBallot(await overTheWire({ doocide: 1, kind: 'ballot', enc: 'none', data: ballot }));
    expect(received.key).toBe(signer.publicKey);
    expect(await checkBallot(received)).toBe('valid');
  });

  it('fail when anything signed is changed', async () => {
    const { ballot } = await sendSigned(true);
    const changed = (patch: Partial<Ballot>) => checkBallot(validateBallot({ ...ballot, ...patch }));
    expect(await changed({ scores: ballot.scores.map((s, i) => (i === 0 ? { ...s, value: s.value === 9 ? 1 : 9 } : s)) })).toBe('invalid');
    expect(await changed({ author: 'Someone else' })).toBe('invalid');
    expect(await changed({ revision: ballot.revision + 1 })).toBe('invalid');
    expect(await changed({ voterId: 'another-voter' })).toBe('invalid');
  });

  it('fail when signed with a different key than the one they carry', async () => {
    const { ballot } = await sendSigned();
    const other = await generateSigner();
    expect(await checkBallot({ ...ballot, key: other.publicKey })).toBe('invalid');
  });

  it('count a key without a signature, or the reverse, as invalid, and no signature at all as unsigned', async () => {
    const { ballot } = await sendSigned();
    const { sig: _sig, ...noSig } = ballot;
    const { key: _key, ...noKey } = ballot;
    expect(await checkBallot(noSig)).toBe('invalid');
    expect(await checkBallot(noKey)).toBe('invalid');
    expect(await checkBallot(validateBallot(ballotFrom(groupDecision(), 'v1', 5)))).toBe('none');
    expect(await checkBallot({ ...ballot, sig: 'not-a-signature' })).toBe('invalid');
  });

  it("can't be replaced by a ballot signed with another key, or unsigned", async () => {
    const organizer = groupDecision({ anonymity: 'named' });
    const first = await signBallot(ballotFrom(organizer, 'v1', 2), await generateSigner());
    const d = addBallots([{ ballot: first, signature: 'valid' }])(organizer);
    expect(d.group!.ballots[0]!.signed).toBe(true);

    const impostor = await signBallot(ballotFrom(organizer, 'v1', 9, { revision: 2 }), await generateSigner());
    expect(addBallots([{ ballot: impostor, signature: 'valid' }])(d)).toBe(d);
    expect(addBallots([{ ballot: ballotFrom(organizer, 'v1', 9, { revision: 2 }), signature: 'none' }])(d)).toBe(d);
    expect(reviewBallots(d, [{ ballot: impostor, signature: 'valid' }])[0]!.flags.map((f) => f.kind)).toContain('keyChanged');
  });

  it('can be replaced by a newer ballot signed with the same key', async () => {
    const organizer = groupDecision();
    const signer = await generateSigner();
    const d = addBallots([{ ballot: await signBallot(ballotFrom(organizer, 'v1', 2), signer), signature: 'valid' }])(organizer);
    const kept = setBallotIncluded('v1', false)(d);
    const newer = await signBallot(ballotFrom(organizer, 'v1', 7, { revision: 2 }), signer);
    const after = addBallots([{ ballot: newer, signature: 'valid' }])(kept);
    expect(after.group!.ballots[0]!.scores[0]!.value).toBe(7);
    expect(after.group!.ballots[0]!.included).toBe(false);
  });

  it('are never added when the signature is bad', () => {
    const organizer = groupDecision();
    const d = addBallots([{ ballot: ballotFrom(organizer, 'v1', 2), signature: 'invalid' }])(organizer);
    expect(d).toBe(organizer);
    expect(reviewBallots(organizer, [{ ballot: ballotFrom(organizer, 'v1', 2), signature: 'invalid' }])[0]!.adds).toBe(false);
  });
});

describe('signed invites', () => {
  it('check out after travelling through a link, and fail when changed', async () => {
    const signer = await generateSigner();
    const env = inviteEnvelope(groupDecision({ anonymity: 'named' }));
    const signed = { ...env, data: await signInvite(env.data, signer) };
    const received = asInvite(await overTheWire(signed));
    expect(await checkInvite(received)).toBe('valid');
    const retitled = validateInvite({ ...received, decision: { ...received.decision, title: 'Something else' } });
    expect(await checkInvite(retitled)).toBe('invalid');
    const reweighted = validateInvite({ ...received, settings: { ...received.settings, weights: 'everyone' } });
    expect(await checkInvite(reweighted)).toBe('invalid');
  });
});

describe('what gets signed is stable', () => {
  // The sender signs the cleaned data and the receiver cleans it again, so cleaning twice must change nothing.
  it('cleaning a ballot or an invite a second time changes nothing', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const organizer = { ...randomDecision(seed), group: groupDecision({ anonymity: seed % 2 ? 'named' : 'anonymous', weights: seed % 3 ? 'organizer' : 'everyone' }).group! };
      const ballot = validateBallot({ ...ballotEnvelope(participantCopy(organizer)).data, key: 'k'.repeat(87), sig: 's'.repeat(86) });
      expect(validateBallot(JSON.parse(JSON.stringify(ballot))), `ballot ${seed}`).toEqual(ballot);
      const invite = validateInvite(inviteEnvelope(organizer).data);
      expect(validateInvite(JSON.parse(JSON.stringify(invite))), `invite ${seed}`).toEqual(invite);
    }
  });
});

describe('short codes', () => {
  it('are twelve digits in three groups, the same for the same key, different for different keys', async () => {
    const a = await generateSigner();
    const b = await generateSigner();
    const code = await shortCode(a.publicKey);
    expect(code).toMatch(/^\d{4} \d{4} \d{4}$/);
    expect(await shortCode(a.publicKey)).toBe(code);
    expect(await shortCode(b.publicKey)).not.toBe(code);
  });
});

describe('keys', () => {
  it('make private keys that can sign but can never be read out', async () => {
    const signer = await generateSigner();
    expect(signer.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', signer.privateKey)).rejects.toThrow();
  });

  it('only confirm keys in named groups', () => {
    const anonymous = groupDecision({ anonymity: 'anonymous' });
    expect(confirmKey('k'.repeat(87))(anonymous)).toBe(anonymous);
  });
});
