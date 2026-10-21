// Signatures for invites and ballots. MIT licensed (see LICENSE in this folder).
//
// WebCrypto only: ECDSA on the P-256 curve with SHA-256. Nothing here is hand-made cryptography; this
// file only decides what gets signed. That is the cleaned envelope data (validateBallot/validateInvite)
// without its `sig` field, written as canonical JSON (keys sorted, undefined left out), so the sender
// and the receiver sign and check exactly the same text.
//
// Keys are base64url of the raw public key (65 bytes). Private keys never pass through this file as
// data: callers hand over a CryptoKey, made non-extractable (see src/app/keys.ts).

import { fromBase64Url, toBase64Url } from './codec';
import type { Ballot, Invite, Signature } from './types';
import { validateBallot, validateInvite } from './validate';

const CURVE = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** A key that can sign: the private half as a CryptoKey, the public half as text. */
export interface Signer {
  privateKey: CryptoKey;
  publicKey: string;
}

/** JSON with object keys sorted and undefined values left out, so the same data always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** A fresh key pair. The private key can sign but can never be read out, by Doocide or anyone else. */
export async function generateSigner(): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(CURVE, false, ['sign', 'verify'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
}

async function sign(signer: Signer, text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign(SIGN, signer.privateKey, bytes(text))));
}

/** true only when `sig` is a valid signature of `text` by `publicKey`. Malformed keys or signatures are simply false. */
async function verify(publicKey: string, sig: string, text: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64Url(publicKey) as BufferSource, CURVE, true, ['verify']);
    return await crypto.subtle.verify(SIGN, key, fromBase64Url(sig) as BufferSource, bytes(text));
  } catch {
    return false;
  }
}

const withoutSig = <T extends { sig?: string }>(x: T): Omit<T, 'sig'> => {
  const { sig: _sig, ...rest } = x;
  return rest;
};

/** Signs a ballot: the cleaned ballot with the signer's public key in it, then the signature over that. */
export async function signBallot(b: Ballot, signer: Signer): Promise<Ballot> {
  const body = withoutSig(validateBallot({ ...withoutSig(b), key: signer.publicKey }));
  return { ...body, sig: await sign(signer, canonicalJson(body)) };
}

/** Checks a ballot that went through validateBallot. Half a signature (a key without a signature, or the reverse) is invalid. */
export async function checkBallot(b: Ballot): Promise<Signature> {
  if (!b.key && !b.sig) return 'none';
  if (!b.key || !b.sig) return 'invalid';
  return (await verify(b.key, b.sig, canonicalJson(withoutSig(b)))) ? 'valid' : 'invalid';
}

export async function signInvite(inv: Invite, signer: Signer): Promise<Invite> {
  const body = withoutSig(validateInvite({ ...withoutSig(inv), key: signer.publicKey }));
  return { ...body, sig: await sign(signer, canonicalJson(body)) };
}

export async function checkInvite(inv: Invite): Promise<Signature> {
  if (!inv.key && !inv.sig) return 'none';
  if (!inv.key || !inv.sig) return 'invalid';
  return (await verify(inv.key, inv.sig, canonicalJson(withoutSig(inv)))) ? 'valid' : 'invalid';
}

/**
 * Twelve digits two people can read to each other to check they hold the same key, e.g.
 * "4821 0937 5562". About 40 bits of the key's SHA-256: making a different key with the same code
 * would take far more work than anyone would spend on a group decision.
 */
export async function shortCode(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(publicKey) as BufferSource));
  let n = 0n;
  for (const b of digest.subarray(0, 5)) n = (n << 8n) | BigInt(b);
  return (n % 10n ** 12n).toString().padStart(12, '0').replace(/(\d{4})(?=\d)/g, '$1 ');
}
