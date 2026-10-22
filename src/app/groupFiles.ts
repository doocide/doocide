// A group's files, made and checked: the signed invite, the group's results (signed by the organizer,
// maybe locked with a passphrase), ballots read from files or the shared folder, and results or a
// newer invite coming back to a participant. Writing to the folder itself goes through folder.ts.

import { groupView } from '../engine';
import { checkBallot, checkEnvelope, keyFromPassphrase, lockWithKey, openSealed, openWithKey, signEnvelope, signInvite, WrongKey } from '../format/crypto';
import { inviteEnvelope, resultsEnvelope } from '../format/share';
import type { AnyEnvelope, Ballot, Decision, Envelope, GroupResult, InviteEnvelope, PassphraseEnvelope, ReceivedBallot } from '../format/types';
import { parseAnyEnvelopeText, parseIncomingText } from '../format/validate';
import { rememberedFolder, saveToFolder, type FolderHandle, type Saved } from './folder';
import { deviceKey, findSealer, keepResultsKey, resultsKey, sealingKey } from './keys';

/** The organizer's decision a ballot belongs to. A restored backup has a new id, so the invite id is checked too. */
export function findOrganizer(all: Iterable<Decision>, b: Ballot): Decision | undefined {
  const organizers = [...all].filter((d) => d.group?.role === 'organizer');
  return (
    organizers.find((d) => d.id === b.decisionId) ??
    organizers.filter((d) => d.group!.inviteId === b.inviteId).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
  );
}

/** The invite, signed with this device's key, carrying the sealing key so ballots come back sealed to it. */
export async function signedInvite(d: Decision, result?: GroupResult): Promise<InviteEnvelope> {
  const env = inviteEnvelope(d, result, (await sealingKey(d.id)).publicKey);
  return { ...env, data: await signInvite(env.data, await deviceKey()) };
}

/** The group's results, signed with the same key as the invites, so participants can tell the organizer made them. */
export async function signedResults(d: Decision, result: GroupResult): Promise<Envelope> {
  return signEnvelope(resultsEnvelope(d, result), await deviceKey());
}

/** empty: no ballots to combine yet. no-key: the results file is locked, but this device doesn't have its passphrase key. */
export type Published = Saved | 'empty' | 'no-key';

/** Organizer: writes the group's current results to the shared folder, or downloads them without one. */
export async function publishResults(d: Decision, folder: FolderHandle | null): Promise<Published> {
  const gv = groupView(d);
  if (d.group?.role !== 'organizer' || !gv) return 'empty';
  const kdf = d.group.resultsKdf;
  const key = kdf ? await resultsKey(d.id, kdf) : null;
  if (kdf && !key) return 'no-key';
  const env = await signedResults(d, gv.result);
  return saveToFolder(folder, { kind: 'results', env, ...(kdf && key && { lock: (json: string) => lockWithKey(json, key, kdf) }) });
}

/** After the organizer approves, leaves out or removes ballots: publishes when they chose "after each approval" and a folder is connected. */
export async function publishAfterApproval(d: Decision): Promise<Published | null> {
  if (d.group?.role !== 'organizer' || d.group.settings.folderResults !== 'approval') return null;
  const folder = await rememberedFolder(d.id);
  return folder ? publishResults(d, folder) : null;
}

export interface Collected {
  ballots: ReceivedBallot[];
  /** Files that aren't ballots for this decision, or can't be opened here. */
  skipped: number;
  /** Ballots already approved in this version or a newer one. */
  known: number;
}

/**
 * Ballot files for this decision: sealed ones open only with its sealing key, every signature is
 * checked. With `onlyNew`, ballots already approved (same revision or newer) are left out, so checking
 * the shared folder again shows only what changed.
 */
export async function ballotsFromTexts(d: Decision, texts: string[], onlyNew = false): Promise<Collected> {
  const ballots: ReceivedBallot[] = [];
  let skipped = 0;
  let known = 0;
  const stored = new Map((d.group?.role === 'organizer' ? d.group.ballots : []).map((b) => [b.voterId, b.revision]));
  for (const text of texts) {
    try {
      const incoming = parseIncomingText(text);
      let env: AnyEnvelope | null = incoming.type === 'plain' ? incoming.env : null;
      if (incoming.type === 'encrypted' && incoming.box.enc === 'sealed') {
        const found = await findSealer(incoming.box.to, [d.id]);
        if (found) env = parseAnyEnvelopeText(await openSealed(incoming.box, found.sealer));
      }
      if (env?.kind !== 'ballot' || !findOrganizer([d], env.data)) {
        skipped++;
        continue;
      }
      const revision = stored.get(env.data.voterId);
      if (onlyNew && revision !== undefined && revision >= env.data.revision) {
        known++;
        continue;
      }
      ballots.push({ ballot: env.data, signature: await checkBallot(env.data) });
    } catch {
      skipped++;
    }
  }
  return { ballots, skipped, known };
}

/** Why a file meant for a participant was ignored. */
export type Refusal = 'not-signed' | 'not-organizer' | 'other-decision' | 'not-results';

/** What a file brings a participant's copy. `locked`: the results file needs its passphrase first. */
export type Update =
  | { type: 'results'; result: GroupResult; at: string }
  | { type: 'invite'; env: InviteEnvelope }
  | { type: 'locked'; box: PassphraseEnvelope }
  | { type: 'refused'; reason: Refusal };

const refused = (reason: Refusal): Update => ({ type: 'refused', reason });

/**
 * Results count only when signed by the key that signed this person's invite, and only for this
 * decision: anyone with access to the folder could drop a results file of their own.
 */
async function fromEnvelope(d: Decision, env: AnyEnvelope): Promise<Update> {
  const g = d.group;
  if (g?.role !== 'participant') return refused('not-results');
  if (env.kind === 'invite') return env.data.decision.id === g.sourceId ? { type: 'invite', env } : refused('other-decision');
  if (env.kind !== 'decision' || !env.data.groupResult) return refused('not-results');
  if (env.data.id !== g.sourceId) return refused('other-decision');
  if ((await checkEnvelope(env)) !== 'valid') return refused('not-signed');
  if (!g.organizerKey || env.key !== g.organizerKey) return refused('not-organizer');
  return { type: 'results', result: env.data.groupResult, at: env.data.updatedAt };
}

/** Reads a file for a participant's copy: the group's results, or the invite. A locked file opens with a key kept from earlier, if any. */
export async function readUpdate(d: Decision, text: string): Promise<Update> {
  const incoming = parseIncomingText(text);
  if (incoming.type === 'plain') return fromEnvelope(d, incoming.env);
  const { box } = incoming;
  if (box.enc !== 'passphrase' || box.wrappedKey) return refused('not-results');
  const key = await resultsKey(d.id, box.kdf);
  if (key) {
    try {
      return await fromEnvelope(d, parseAnyEnvelopeText(await openWithKey(box, key)));
    } catch (e) {
      // The organizer changed the passphrase but kept the settings: ask for it again.
      if (!(e instanceof WrongKey)) throw e;
    }
  }
  return { type: 'locked', box };
}

/**
 * The passphrase someone typed for a locked results file. Throws WrongKey when it doesn't fit. When
 * it opens real results, the key it makes is kept (never the passphrase), so later files open without asking.
 */
export async function unlockUpdate(d: Decision, box: PassphraseEnvelope, passphrase: string): Promise<Update> {
  const key = await keyFromPassphrase(passphrase, box.kdf);
  const update = await fromEnvelope(d, parseAnyEnvelopeText(await openWithKey(box, key)));
  if (update.type === 'results') await keepResultsKey(d.id, key, box.kdf);
  return update;
}
