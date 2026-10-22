// Shared folders: what may go in one, how ballots come out of it, and how participants get the group's
// results from it. The folder is in memory here (see FakeFolder); keys live in memory too, since tests
// have no browser storage.

import { describe, expect, it } from 'vitest';
import { addBallots, applyFolderResults, defaultFolderResults, isNewerResult, markInvited, refreshFromInvite, setGroupSettings, setResultsLock, startGroup } from '../src/app/edit';
import { ballotFileName, folderFile, inviteFileName, readBallots, readNamed, resultsFileName, saveToFolder, type FolderFile, type FolderHandle } from '../src/app/folder';
import { ballotsFromTexts, publishResults, readUpdate, signedInvite, signedResults, unlockUpdate } from '../src/app/groupFiles';
import { editedSinceInvite, inviteChanges, inviteShape } from '../src/app/invites';
import { ballotKey, keepResultsKey } from '../src/app/keys';
import { groupView } from '../src/engine';
import { joinInvite } from '../src/format/create';
import { WrongKey, checkInvite, generateSigner, keyFromPassphrase, lockWithKey, newKdf, openWithKey, openWithPassphrase, sealTo, signBallot, signEnvelope } from '../src/format/crypto';
import { backupEnvelope, ballotEnvelope, resultsEnvelope, shareEnvelope } from '../src/format/share';
import type { BallotEnvelope, Decision, Envelope, GroupResult, SealedEnvelope } from '../src/format/types';
import { cleanGroupSettings, validateDecision } from '../src/format/validate';
import { FakeFolder, NAME_MARKER, PRIVATE_MARKER, SHARED_MARKER, ballotFrom, groupDecision, participantCopy, sampleDecision, unsigned } from './fixtures';

const SLOW = 30_000;
const PASSPHRASE = 'seven quiet lanterns drift north';
const asHandle = (f: FakeFolder) => f as unknown as FolderHandle;

/** An organizer in an open group with two approved ballots. */
function organizer(settings: Parameters<typeof groupDecision>[0] = {}): Decision {
  const d = groupDecision({ scoring: 'open', folderResults: 'approval', ...settings });
  return addBallots(unsigned(ballotFrom(d, 'voterA', 4), ballotFrom(d, 'voterB', 8)))(d);
}

/** The organizer's signed invite, joined by a participant who trusts its signature. */
async function joined(d: Decision): Promise<Decision> {
  const invite = await signedInvite(d, groupView(d)!.result);
  return joinInvite(invite.data, 'en', true);
}

const resultOf = (d: Decision): GroupResult => groupView(d)!.result;

/** A participant's ballot, signed, as it goes into the folder: sealed to the organizer's key from the invite. */
async function ballotFile(p: Decision): Promise<FolderFile> {
  const env = ballotEnvelope(p);
  const signed: BallotEnvelope = { ...env, data: await signBallot(env.data, await ballotKey(p)) };
  return { kind: 'ballot', env: signed, seal: (json) => sealTo(p.group!.organizerSealKey!, json) };
}

describe('what goes in a shared folder', () => {
  it('refuses backups, decisions that aren’t results, unsigned results and private notes', async () => {
    const d = organizer();
    const { group: _group, ...plain } = d;
    const withPrivate: Envelope = { doocide: 1, kind: 'decision', enc: 'none', data: { ...plain, groupResult: resultOf(d) }, key: 'k', sig: 's' };
    await expect(folderFile({ kind: 'results', env: backupEnvelope(d) })).rejects.toThrow();
    await expect(folderFile({ kind: 'results', env: { ...shareEnvelope(d, 'decision'), key: 'k', sig: 's' } })).rejects.toThrow(/results/);
    await expect(folderFile({ kind: 'results', env: resultsEnvelope(d, resultOf(d)) })).rejects.toThrow(/signed/);
    await expect(folderFile({ kind: 'results', env: withPrivate })).rejects.toThrow(/Private notes/);
    await expect(folderFile({ kind: 'invite', env: shareEnvelope(d, 'template') } as unknown as FolderFile)).rejects.toThrow();
  });

  it('takes ballots sealed or not at all', async () => {
    const d = organizer();
    const file = (await ballotFile(participantCopy(d))) as Extract<FolderFile, { kind: 'ballot' }>;
    await expect(folderFile({ ...file, seal: async (json) => JSON.parse(json) as SealedEnvelope })).rejects.toThrow(/sealed/);
    await expect(folderFile({ kind: 'ballot', env: file.env } as FolderFile)).rejects.toThrow(/sealed/);
  });

  it('names files without names: the decision id for invites and results, a random id for ballots', async () => {
    const d = organizer({ anonymity: 'named' });
    const p = { ...(await joined(d)), notes: participantCopy(d).notes };
    const named = { ...p, group: { ...p.group!, myName: NAME_MARKER } };
    const { name, text } = await folderFile(await ballotFile(named));
    expect(name).toBe(ballotFileName(named.group.voterId!));
    expect(name).toMatch(/^ballot-[A-Za-z0-9]{8}\.doocide$/);
    // Sealed: the name, the notes and the voter id are all inside.
    for (const secret of [NAME_MARKER, PRIVATE_MARKER, SHARED_MARKER, named.group.voterId!]) expect(text).not.toContain(secret);
    expect(inviteFileName(d.id)).toBe(`invite-${d.id.slice(0, 6)}.doocide`);
    expect(resultsFileName(d.id)).toBe(`results-${d.id.slice(0, 6)}.doocide`);
  });

  it('asks again for access, and writes nothing without it', async () => {
    const d = organizer();
    const refused = new FakeFolder('Trip folder', 'prompt', 'denied');
    expect(await saveToFolder(asHandle(refused), { kind: 'invite', env: await signedInvite(d) })).toBe('denied');
    expect(refused.files.size).toBe(0);
    const allowed = new FakeFolder('Trip folder', 'prompt', 'granted');
    expect(await saveToFolder(asHandle(allowed), { kind: 'invite', env: await signedInvite(d) })).toBe('written');
    expect([...allowed.files.keys()]).toEqual([inviteFileName(d.id)]);
  });
});

describe('collecting ballots from the folder', () => {
  it('reads ballot files only, opens sealed ones, and leaves out ballots already approved', async () => {
    const d = organizer();
    const folder = new FakeFolder();
    const p = await joined(d);
    const scored = { ...p, scores: d.scores.map((s) => ({ ...s, value: 6 })), group: { ...p.group!, revision: 1 } };
    expect(await saveToFolder(asHandle(folder), await ballotFile(scored))).toBe('written');
    folder.files.set('notes.txt', 'not a ballot');
    folder.files.set('ballot-huge.doocide', 'x'.repeat(2_000_001));

    const read = await readBallots(asHandle(folder));
    if (read === 'denied') throw new Error('denied');
    expect(read.texts).toHaveLength(1);
    expect(read.failed).toBe(1);

    const first = await ballotsFromTexts(d, read.texts, true);
    expect(first.ballots).toHaveLength(1);
    expect(first.ballots[0]!.signature).toBe('valid');
    const approved = addBallots(first.ballots)(d);
    const again = await ballotsFromTexts(approved, read.texts, true);
    expect(again).toMatchObject({ ballots: [], known: 1 });

    // Sent again: a higher revision is new.
    await saveToFolder(asHandle(folder), await ballotFile({ ...scored, group: { ...scored.group, revision: 2 } }));
    const read2 = (await readBallots(asHandle(folder))) as { texts: string[] };
    expect((await ballotsFromTexts(approved, read2.texts, true)).ballots).toHaveLength(1);
  });
});

describe('group results in the folder', () => {
  it('reach participants only when signed by their organizer, for this decision', async () => {
    const d = organizer();
    const p = await joined(d);
    const good = JSON.stringify(await signedResults(d, resultOf(d)));
    expect(await readUpdate(p, good)).toMatchObject({ type: 'results', at: d.updatedAt });

    const edited = JSON.parse(good);
    edited.data.groupResult.cells[0].value = 0;
    expect(await readUpdate(p, JSON.stringify(edited))).toEqual({ type: 'refused', reason: 'not-signed' });
    expect(await readUpdate(p, JSON.stringify(resultsEnvelope(d, resultOf(d))))).toEqual({ type: 'refused', reason: 'not-signed' });
    const forged = await signEnvelope(resultsEnvelope(d, resultOf(d)), await generateSigner());
    expect(await readUpdate(p, JSON.stringify(forged))).toEqual({ type: 'refused', reason: 'not-organizer' });
    const otherDecision = await signedResults({ ...d, id: 'someOtherId' }, resultOf(d));
    expect(await readUpdate(p, JSON.stringify(otherDecision))).toEqual({ type: 'refused', reason: 'other-decision' });
  });

  it('never replace newer results with older ones', () => {
    const d = organizer();
    const p = participantCopy(d);
    const r = resultOf(d);
    const updated = applyFolderResults(r, '2026-10-21T10:00:00.000Z')(p);
    expect(updated.group!.resultsAt).toBe('2026-10-21T10:00:00.000Z');
    expect(applyFolderResults({ ...r, ballots: 1 }, '2026-10-20T10:00:00.000Z')(updated)).toBe(updated);
    expect(applyFolderResults({ ...r, ballots: 1 }, '2026-10-21T10:00:00.000Z')(updated)).toBe(updated);
    expect(isNewerResult(updated, '2026-10-22T10:00:00.000Z')).toBe(true);
    // The participant's own copy doesn't change its last-changed time for a view of the group.
    expect(updated.updatedAt).toBe(p.updatedAt);
  });

  it('keep whichever is newer when a newer invite arrives', async () => {
    const v1 = { ...organizer(), updatedAt: '2026-10-20T10:00:00.000Z' };
    const p = await joined(v1);
    const folderResult = { ...resultOf(v1), ballots: 7 };
    const withFolder = applyFolderResults(folderResult, '2026-10-22T10:00:00.000Z')(p);
    const v2 = { ...v1, updatedAt: '2026-10-21T10:00:00.000Z' };
    const kept = refreshFromInvite((await signedInvite(v2, resultOf(v2))).data, true)(withFolder);
    expect(kept.group).toMatchObject({ resultsAt: '2026-10-22T10:00:00.000Z', result: { ballots: 7 } });
    const v3 = { ...v1, updatedAt: '2026-10-23T10:00:00.000Z' };
    const replaced = refreshFromInvite((await signedInvite(v3, resultOf(v3))).data, true)(kept);
    expect(replaced.group).toMatchObject({ resultsAt: '2026-10-23T10:00:00.000Z', result: { ballots: 3 } });
  });

  it(
    'locked with a passphrase: a fresh IV every time under one key, asked once per device, asked again for a new passphrase',
    async () => {
      const kdf = newKdf();
      const key = await keyFromPassphrase(PASSPHRASE, kdf);
      const a = await lockWithKey('{"x":1}', key, kdf);
      const b = await lockWithKey('{"x":1}', key, kdf);
      expect(a.iv).not.toBe(b.iv);
      expect(a.kdf).toEqual(b.kdf);
      expect(await openWithKey(b, key)).toBe('{"x":1}');
      // Any Doocide opens it with the passphrase, like any locked file.
      expect(await openWithPassphrase(a, PASSPHRASE)).toBe('{"x":1}');

      const d = setResultsLock(kdf)(organizer());
      await keepResultsKey(d.id, key, kdf);
      const folder = new FakeFolder();
      const p = await joined(d);
      expect(await publishResults(d, asHandle(folder))).toBe('written');
      const first = (await readNamed(asHandle(folder), resultsFileName(d.id))) as string;
      expect(JSON.parse(first)).toMatchObject({ enc: 'passphrase' });
      expect(first).not.toContain(PRIVATE_MARKER);

      const locked = await readUpdate(p, first);
      if (locked.type !== 'locked') throw new Error(locked.type);
      await expect(unlockUpdate(p, locked.box, 'not the passphrase')).rejects.toBeInstanceOf(WrongKey);
      expect(await unlockUpdate(p, locked.box, PASSPHRASE)).toMatchObject({ type: 'results' });

      // The next publish: same settings, new IV. The participant's kept key opens it without asking.
      await publishResults(d, asHandle(folder));
      const second = (await readNamed(asHandle(folder), resultsFileName(d.id))) as string;
      expect(JSON.parse(second).iv).not.toBe(JSON.parse(first).iv);
      expect(await readUpdate(p, second)).toMatchObject({ type: 'results' });

      // A new passphrase has a new salt: the old key doesn't fit, so the participant is asked again.
      const kdf2 = newKdf();
      const d2 = setResultsLock(kdf2)(d);
      await keepResultsKey(d.id, await keyFromPassphrase('another passphrase entirely', kdf2), kdf2);
      await publishResults(d2, asHandle(folder));
      expect(await readUpdate(p, (await readNamed(asHandle(folder), resultsFileName(d.id))) as string)).toMatchObject({ type: 'locked' });
    },
    SLOW,
  );

  it('need the passphrase key on the organizer’s device too, or nothing is written', async () => {
    const d = setResultsLock(newKdf())(organizer());
    const fresh = { ...d, id: 'restoredElsewhere' };
    const folder = new FakeFolder();
    expect(await publishResults(fresh, asHandle(folder))).toBe('no-key');
    expect(folder.files.size).toBe(0);
  });
});

describe('the folder setting', () => {
  it('defaults by scoring mode, and offers "after each approval" only with open scoring', () => {
    expect(defaultFolderResults('blind')).toBe('publish');
    expect(defaultFolderResults('open')).toBe('approval');
    expect(cleanGroupSettings({ scoring: 'blind', folderResults: 'approval' }).folderResults).toBe('publish');
    expect(cleanGroupSettings({ scoring: 'open', folderResults: 'approval' }).folderResults).toBe('approval');
    expect(cleanGroupSettings({ scoring: 'open', folderResults: 'always' }).folderResults).toBeUndefined();
    const started = startGroup({ anonymity: 'anonymous', scoring: 'blind', weights: 'organizer', combine: 'mean', folderResults: 'approval' })(sampleDecision());
    expect(started.group!.settings.folderResults).toBe('publish');
    expect(setGroupSettings({ scoring: 'blind' })(organizer()).group!.settings.folderResults).toBe('publish');
  });

  it('travels in the signed invite, so nobody can change it on the way', async () => {
    const d = organizer();
    const invite = (await signedInvite(d)).data;
    expect(invite.settings.folderResults).toBe('approval');
    expect(await checkInvite(invite)).toBe('valid');
    expect(await checkInvite({ ...invite, settings: { ...invite.settings, folderResults: 'never' } })).toBe('invalid');
  });

  it('is part of what invites show: changing it flags the invite as not yet sent, and participants see it changed', async () => {
    const d = organizer();
    const invited = markInvited(inviteShape(d))(d);
    const changed = setGroupSettings({ folderResults: 'never' })(invited);
    expect(editedSinceInvite(changed)).toBe(true);
    expect(inviteChanges(await joined(d), (await signedInvite(changed)).data).rules).toBe(true);
  });

  it('keeps the bookkeeping in the owner’s own storage only', async () => {
    const d = { ...markInvited(inviteShape(organizer()))(organizer()), group: { ...organizer().group!, publishedAt: '2026-10-21T10:00:00.000Z', resultsKdf: newKdf() } };
    const back = validateDecision(JSON.parse(JSON.stringify(backupEnvelope(d).data)), 'backup');
    expect(back.group).toMatchObject({ publishedAt: '2026-10-21T10:00:00.000Z', resultsKdf: d.group.resultsKdf });
    const p = applyFolderResults(resultOf(d), '2026-10-22T10:00:00.000Z')(participantCopy(d));
    expect(validateDecision(JSON.parse(JSON.stringify(p)), 'backup').group!.resultsAt).toBe('2026-10-22T10:00:00.000Z');
    // Shares never carry it.
    expect(JSON.stringify(resultsEnvelope(d, resultOf(d)))).not.toContain('resultsKdf');
  });
});
