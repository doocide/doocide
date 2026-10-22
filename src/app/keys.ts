// Keys on this device. Three kinds, never mixed:
// - The device key: long-lived. It signs invites and named ballots, so people can recognize you by its
//   short code across decisions.
// - A decision key: made fresh for one anonymous decision and used for nothing else. It is generated on
//   its own, never derived from the device key, so ballots in different anonymous decisions can't be
//   linked to each other or to you. It is deleted with the decision.
// - A sealing key: made for one decision its organizer invites people to. Ballots are sealed to it, so
//   only the organizer can open them. It can only agree secrets, never sign. Deleted with the decision.
// - A results key: what a group results file's passphrase turned into, kept by the organizer and by
//   each person who entered it once, so later files open without asking again. Never the passphrase.
// Private keys are non-extractable CryptoKeys: they can sign or open, but they can't be read out or backed up.

import { generateSealer, generateSigner, type Sealer, type Signer } from '../format/crypto';
import type { Decision, Kdf } from '../format/types';
import { deleteKey, getKey, getSecret, putKey, putSecret } from './store';

const DEVICE = 'device';
const forDecision = (decisionId: string) => `decision:${decisionId}`;
const forSealing = (decisionId: string) => `seal:${decisionId}`;
const forResults = (decisionId: string) => `results:${decisionId}`;

// One lookup at a time per key, so two quick sends can't each make a different key.
const pending = new Map<string, Promise<Signer | Sealer>>();

function getOrCreate(id: string, make: () => Promise<Signer | Sealer> = generateSigner): Promise<Signer | Sealer> {
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      const found = await getKey(id);
      if (found) return { privateKey: found.privateKey, publicKey: found.publicKey };
      const key = await make();
      await putKey({ id, ...key, createdAt: new Date().toISOString() });
      return key;
    })();
    pending.set(id, p);
    p.catch(() => pending.delete(id));
  }
  return p;
}

/** This device's long-lived key. For invites and named ballots only, never for anonymous ones. */
export const deviceKey = (): Promise<Signer> => getOrCreate(DEVICE);

/** The key made for one anonymous decision, created the first time it's needed. */
export const decisionKey = (decisionId: string): Promise<Signer> => getOrCreate(forDecision(decisionId));

/** The organizer's sealing key for one decision, created with its first invite. */
export const sealingKey = (decisionId: string): Promise<Sealer> => getOrCreate(forSealing(decisionId), generateSealer);

/** Which of these decisions holds the sealing key a ballot was sealed to, if any. Never creates a key. */
export async function findSealer(publicKey: string, decisionIds: string[]): Promise<{ decisionId: string; sealer: Sealer } | null> {
  for (const decisionId of decisionIds) {
    const found = await getKey(forSealing(decisionId));
    if (found?.publicKey === publicKey) return { decisionId, sealer: { privateKey: found.privateKey, publicKey: found.publicKey } };
  }
  return null;
}

const sameKdf = (a: Kdf, b: Kdf) => a.name === b.name && a.hash === b.hash && a.iterations === b.iterations && a.salt === b.salt;

/** The key kept for this decision's results file, if it was made with these settings (a new passphrase has a new salt). */
export async function resultsKey(decisionId: string, kdf: Kdf): Promise<CryptoKey | null> {
  const found = await getSecret(forResults(decisionId));
  return found && sameKdf(found.kdf, kdf) ? found.secret : null;
}

/** Keeps a results key that just worked, replacing any older one for this decision. */
export const keepResultsKey = (decisionId: string, secret: CryptoKey, kdf: Kdf): Promise<void> =>
  putSecret({ id: forResults(decisionId), secret, kdf, createdAt: new Date().toISOString() });

export const forgetResultsKey = (decisionId: string): Promise<void> => deleteKey(forResults(decisionId));

/** Deletes every key made for this decision: its anonymous signing key, its sealing key and its results key. */
export async function forgetDecisionKey(decisionId: string): Promise<void> {
  for (const id of [forDecision(decisionId), forSealing(decisionId), forResults(decisionId)]) {
    pending.delete(id);
    await deleteKey(id);
  }
}

/** The key a participant's ballot is signed with: the decision's own key when anonymous, the device key when named. */
export function ballotKey(d: Decision): Promise<Signer> {
  return d.group?.settings.anonymity === 'named' ? deviceKey() : decisionKey(d.id);
}
