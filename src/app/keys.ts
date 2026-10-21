// Signing keys on this device. Two kinds, never mixed:
// - The device key: long-lived. It signs invites and named ballots, so people can recognize you by its
//   short code across decisions.
// - A decision key: made fresh for one anonymous decision and used for nothing else. It is generated on
//   its own, never derived from the device key, so ballots in different anonymous decisions can't be
//   linked to each other or to you. It is deleted with the decision.
// Private keys are non-extractable CryptoKeys: they can sign, but they can't be read out or backed up.

import { generateSigner, type Signer } from '../format/crypto';
import type { Decision } from '../format/types';
import { deleteKey, getKey, putKey } from './store';

const DEVICE = 'device';
const forDecision = (decisionId: string) => `decision:${decisionId}`;

// One lookup at a time per key, so two quick sends can't each make a different key.
const pending = new Map<string, Promise<Signer>>();

function getOrCreate(id: string): Promise<Signer> {
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      const found = await getKey(id);
      if (found) return { privateKey: found.privateKey, publicKey: found.publicKey };
      const signer = await generateSigner();
      await putKey({ id, ...signer, createdAt: new Date().toISOString() });
      return signer;
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

export async function forgetDecisionKey(decisionId: string): Promise<void> {
  pending.delete(forDecision(decisionId));
  await deleteKey(forDecision(decisionId));
}

/** The key a participant's ballot is signed with: the decision's own key when anonymous, the device key when named. */
export function ballotKey(d: Decision): Promise<Signer> {
  return d.group?.settings.anonymity === 'named' ? deviceKey() : decisionKey(d.id);
}
