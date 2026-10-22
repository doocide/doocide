// Signatures for invites, ballots and group results files. MIT licensed (see LICENSE in this folder).
//
// WebCrypto only: ECDSA on the P-256 curve with SHA-256. Nothing here is hand-made cryptography; this
// file only decides what gets signed. That is the cleaned data (validateBallot, validateInvite, or the
// whole cleaned envelope for results files) without its `sig` field, written as canonical JSON (keys
// sorted, undefined left out), so the sender and the receiver sign and check exactly the same text.
//
// Keys are base64url of the raw public key (65 bytes). Private keys never pass through this file as
// data: callers hand over a CryptoKey, made non-extractable (see src/app/keys.ts).

import { deflate, fromBase64Url, inflateCapped, toBase64Url } from './codec';
import { ITERATIONS, LIMITS } from './limits';
import { FORMAT_VERSION, type Ballot, type Box, type Envelope, type Invite, type Kdf, type PassphraseEnvelope, type SealedEnvelope, type Signature } from './types';
import { validateBallot, validateEnvelope, validateInvite } from './validate';

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
 * Signs a whole decision envelope (a group results file): the format version, the kind and the data
 * all count, so nobody can turn signed results into something else or edit a single number.
 */
export async function signEnvelope(env: Envelope, signer: Signer): Promise<Envelope> {
  const body = withoutSig(validateEnvelope({ ...withoutSig(env), key: signer.publicKey }));
  return { ...body, sig: await sign(signer, canonicalJson(body)) };
}

/** Checks an envelope that went through validateEnvelope. Who the key belongs to is the caller's question. */
export async function checkEnvelope(env: Envelope): Promise<Signature> {
  if (!env.key && !env.sig) return 'none';
  if (!env.key || !env.sig) return 'invalid';
  return (await verify(env.key, env.sig, canonicalJson(withoutSig(env)))) ? 'valid' : 'invalid';
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

// Encryption. Passphrases: PBKDF2 (SHA-256) turns the passphrase into an AES-GCM key. Sealed ballots:
// a one-time ECDH P-256 key agrees a secret with the organizer's sealing key, and HKDF (SHA-256) turns
// it into an AES-GCM key, bound to both public keys (the same shape as HPKE). The library lock: a
// random AES-GCM data key, kept wrapped with the passphrase key. All of it is WebCrypto; nothing here
// is a hand-made cipher. Every encryption draws a fresh random IV, so an IV is never reused with a key.

/**
 * PBKDF2 iterations (see ITERATIONS in limits.ts): OWASP's 2023 figure for SHA-256. Files asking for
 * more than the maximum are refused, since a hostile file could otherwise freeze the page for minutes;
 * files asking for fewer than the minimum are too weak to protect anything.
 */
export const PBKDF2_ITERATIONS = ITERATIONS.default;
const { max: MAX_ITERATIONS, min: MIN_ITERATIONS } = ITERATIONS;

const AES = { name: 'AES-GCM', length: 256 } as const;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const text = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(b);

/** The passphrase or key doesn't open it, or what it guards was changed. AES-GCM can't tell which. */
export class WrongKey extends Error {
  constructor() {
    super("The passphrase or key doesn't open this, or it was changed");
    this.name = 'WrongKey';
  }
}

/** AES-GCM with a fresh random 12-byte IV every time. */
export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<Box> {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource));
  return { iv: toBase64Url(iv), ct: toBase64Url(ct) };
}

/** Throws WrongKey when the key is wrong or anything was changed: AES-GCM checks both. */
export async function decryptBytes(key: CryptoKey, box: Box): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(box.iv) as BufferSource }, key, fromBase64Url(box.ct) as BufferSource));
  } catch {
    throw new WrongKey();
  }
}

/** Compressed, then encrypted: ciphertext doesn't compress, so the order matters for link length. */
const seal = async (key: CryptoKey, json: string) => encryptBytes(key, await deflate(bytes(json)));
const unseal = async (key: CryptoKey, box: Box) => text(await inflateCapped(await decryptBytes(key, box), LIMITS.unpackedBytes));

export const newKdf = (): Kdf => ({ name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64Url(random(16)) });

/** The key a passphrase makes with these settings. Spaces at the ends don't count; letters are compared in one Unicode form. */
async function passphraseKey(passphrase: string, kdf: Kdf, usages: KeyUsage[]): Promise<CryptoKey> {
  if (kdf.iterations > MAX_ITERATIONS || kdf.iterations < MIN_ITERATIONS) throw new WrongKey();
  const base = await crypto.subtle.importKey('raw', bytes(passphrase.trim().normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(kdf.salt) as BufferSource, iterations: kdf.iterations }, base, AES, false, usages);
}

/** Locks an envelope's JSON with a passphrase: a fresh salt and a fresh IV every time. */
export async function lockWithPassphrase(innerJson: string, passphrase: string): Promise<PassphraseEnvelope> {
  const kdf = newKdf();
  return { doocide: FORMAT_VERSION, enc: 'passphrase', kdf, ...(await seal(await passphraseKey(passphrase, kdf, ['encrypt']), innerJson)) };
}

/** The inner JSON of a passphrase envelope, or WrongKey. Handles locked backups, whose data key is wrapped inside. */
export async function openWithPassphrase(env: PassphraseEnvelope, passphrase: string): Promise<string> {
  if (!env.wrappedKey) return unseal(await passphraseKey(passphrase, env.kdf, ['decrypt']), env);
  return unseal(await unwrapDataKey(env.wrappedKey, await passphraseKey(passphrase, env.kdf, ['unwrapKey'])), env);
}

// Files locked again and again with one passphrase: a group's results file, rewritten at each publish.
// The organizer keeps the key a passphrase makes (non-extractable, never the passphrase), and so does
// each person who entered it once. Every file still gets a fresh IV, so no IV is ever used twice.

/** The key a passphrase makes with these settings. It can encrypt and decrypt, but can never be read out. */
export const keyFromPassphrase = (passphrase: string, kdf: Kdf): Promise<CryptoKey> => passphraseKey(passphrase, kdf, ['encrypt', 'decrypt']);

/** Locks an envelope's JSON with a key from keyFromPassphrase. The file looks like any passphrase-locked file. */
export async function lockWithKey(innerJson: string, key: CryptoKey, kdf: Kdf): Promise<PassphraseEnvelope> {
  return { doocide: FORMAT_VERSION, enc: 'passphrase', kdf, ...(await seal(key, innerJson)) };
}

/** The inner JSON of a passphrase envelope, opened with a key kept from earlier, or WrongKey. */
export async function openWithKey(env: PassphraseEnvelope, key: CryptoKey): Promise<string> {
  if (env.wrappedKey) throw new WrongKey();
  return unseal(key, env);
}

// The library lock

/** What's stored to unlock the library: the passphrase settings and the wrapped data key. Never the passphrase. */
export interface LockMeta {
  kdf: Kdf;
  wrapped: Box;
}

async function unwrapDataKey(wrapped: Box, kek: CryptoKey): Promise<CryptoKey> {
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      fromBase64Url(wrapped.ct) as BufferSource,
      kek,
      { name: 'AES-GCM', iv: fromBase64Url(wrapped.iv) as BufferSource },
      AES,
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongKey();
  }
}

/**
 * A new random data key for the library, wrapped with the passphrase key. The key is extractable only
 * for the moment it takes to wrap it; what comes back for use is a non-extractable copy.
 */
export async function createLock(passphrase: string): Promise<{ meta: LockMeta; key: CryptoKey }> {
  const kdf = newKdf();
  const kek = await passphraseKey(passphrase, kdf, ['wrapKey', 'unwrapKey']);
  const dek = await crypto.subtle.generateKey(AES, true, ['encrypt', 'decrypt']);
  const iv = random(12);
  const wrapped = { iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }))) };
  return { meta: { kdf, wrapped }, key: await unwrapDataKey(wrapped, kek) };
}

/** The library's data key, if the passphrase is right. Throws WrongKey otherwise. */
export async function openLock(meta: LockMeta, passphrase: string): Promise<CryptoKey> {
  return unwrapDataKey(meta.wrapped, await passphraseKey(passphrase, meta.kdf, ['unwrapKey']));
}

export const encryptJson = (key: CryptoKey, value: unknown): Promise<Box> => seal(key, JSON.stringify(value));

/** The decrypted JSON text; the caller parses and checks it like anything else. */
export const decryptJson = (key: CryptoKey, box: Box): Promise<string> => unseal(key, box);

/** A backup made while the library is locked: encrypted with the data key, which travels wrapped, so the passphrase opens it anywhere. */
export async function lockBackup(innerJson: string, meta: LockMeta, key: CryptoKey): Promise<PassphraseEnvelope> {
  return { doocide: FORMAT_VERSION, enc: 'passphrase', kdf: meta.kdf, wrappedKey: meta.wrapped, ...(await seal(key, innerJson)) };
}

// Sealed ballots

/** An organizer's sealing key for one decision: the private half can only agree secrets, never be read out. */
export interface Sealer {
  privateKey: CryptoKey;
  publicKey: string;
}

export async function generateSealer(): Promise<Sealer> {
  const pair = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
}

async function sealedKey(privateKey: CryptoKey, peer: string, recipient: string, ephemeral: string, salt: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const peerKey = await crypto.subtle.importKey('raw', fromBase64Url(peer) as BufferSource, ECDH, true, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  // Both public keys go into the key, so a ballot can't be re-addressed or paired with another one-time key.
  const info = bytes(`doocide sealed v1|${recipient}|${ephemeral}`);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info }, hkdf, AES, false, [usage]);
}

/** Seals an envelope's JSON so only the holder of `recipient`'s private key can open it. */
export async function sealTo(recipient: string, innerJson: string): Promise<SealedEnvelope> {
  // A one-time key, made for this ballot and thrown away: nothing links two sealed ballots.
  const once = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  const epk = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', once.publicKey)));
  const salt = random(16);
  const key = await sealedKey(once.privateKey, recipient, recipient, epk, salt, 'encrypt');
  return { doocide: FORMAT_VERSION, enc: 'sealed', to: recipient, epk, salt: toBase64Url(salt), ...(await seal(key, innerJson)) };
}

/** The inner JSON of a sealed envelope, or WrongKey when it isn't sealed to this key or was changed. */
export async function openSealed(env: SealedEnvelope, sealer: Sealer): Promise<string> {
  if (env.to !== sealer.publicKey) throw new WrongKey();
  let key: CryptoKey;
  try {
    key = await sealedKey(sealer.privateKey, env.epk, env.to, env.epk, fromBase64Url(env.salt), 'decrypt');
  } catch {
    throw new WrongKey();
  }
  return unseal(key, env);
}
