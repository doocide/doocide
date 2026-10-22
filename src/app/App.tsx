import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTemplateText } from '@packs';
import { appBase, decodeIncoming, readFragment } from '../format/codec';
import { adopt, emptyDecision, joinInvite } from '../format/create';
import { checkBallot, checkInvite, createLock, openLock, openSealed, openWithPassphrase } from '../format/crypto';
import type { AnyEnvelope, Decision, Envelope, Invite, InviteEnvelope, PassphraseEnvelope, ReceivedBallot } from '../format/types';
import { FormatError, parseAnyEnvelopeText, parseEnvelopeText, parseIncomingText, type FormatErrorCode, type Incoming } from '../format/validate';
import { getLang, t, useLang } from '../i18n';
import { BallotReview } from './BallotReview';
import { DecisionView } from './DecisionView';
import { addBallots, applyFolderResults, isNewerResult, refreshFromInvite, type Edit } from './edit';
import { FILE_EXTENSION, pickFileText, pickFilesText } from './files';
import { canUseFolders, connectFolder, forgetFolder, inviteFileName, pickFolderBallots, readBallots, readNamed, rememberedFolder, resultsFileName } from './folder';
import { ballotsFromTexts, findOrganizer, readUpdate, unlockUpdate, type Update } from './groupFiles';
import { ImportDialog } from './ImportDialog';
import { TemplatesDialog } from './InfoDialogs';
import { hasChanges, inviteChanges, isOlderInvite } from './invites';
import { findSealer, forgetDecisionKey } from './keys';
import { decisionTitle } from './labels';
import { Library } from './Library';
import { LockDialog, LockScreen, PassphraseDialog, PassphrasePrompt } from './Lock';
import { afterApproval } from './SharedFolder';
import { downloadBackup } from './backup';
import { forgetAllBackups, forgetBackup, getBackups } from './prefs';
import {
  deleteDecision,
  eraseEverything,
  forgetDataKey,
  isPersistent,
  listDecisions,
  lockOn,
  readLock,
  requestPersistence,
  saveDecision,
  setDataKey,
  storagePersisted,
  turnLockOff,
  turnLockOn,
} from './store';
import { Icon, useConfirm, useToast } from './ui';

type ErrorCode = FormatErrorCode | 'template-missing' | 'ballot-unknown' | 'bad-signature' | 'sealed-elsewhere';

type View =
  | { name: 'library' }
  | { name: 'decision'; id: string }
  | { name: 'incoming'; env: Envelope }
  /** `signed`: the invite's signature checked out. */
  | { name: 'incoming-invite'; env: InviteEnvelope; signed: boolean }
  | { name: 'review'; decisionId: string; ballots: ReceivedBallot[]; skipped: number }
  /** A link or file locked with a passphrase, waiting for it. Backups never come from links. */
  | { name: 'locked-share'; box: PassphraseEnvelope; source: 'link' | 'file' }
  | { name: 'error'; code: ErrorCode };

const errorCode = (e: unknown): FormatErrorCode => (e instanceof FormatError ? e.code : 'bad-data');

/** This person's copy of an invite they already started. */
const findJoined = (all: Iterable<Decision>, inv: Invite) =>
  [...all].find((d) => d.group?.role === 'participant' && d.group.sourceId === inv.decision.id && d.group.inviteId === inv.inviteId);

export function App() {
  useLang();
  const toast = useToast();
  const ask = useConfirm();
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const decisionsRef = useRef(decisions);
  const [loaded, setLoaded] = useState(false);
  /** The library lock is on and the passphrase hasn't opened it yet. */
  const [locked, setLocked] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [view, setView] = useState<View>({ name: 'library' });
  const [dialog, setDialog] = useState<null | 'templates' | 'import' | 'lock'>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backups, setBackups] = useState(getBackups);
  /** A participant's results file is locked, and this device doesn't have its key yet. */
  const [unlocking, setUnlocking] = useState<{ id: string; box: PassphraseEnvelope } | null>(null);
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const commit = useCallback((next: Map<string, Decision>) => {
    decisionsRef.current = next;
    setDecisions(next);
  }, []);

  const loadLibrary = useCallback(async () => {
    const list = await listDecisions();
    commit(new Map(list.map((d) => [d.id, d])));
    setLoaded(true);
    // Only ask the browser to keep storage once there is something worth keeping.
    (list.length ? requestPersistence() : storagePersisted()).then(setPersisted);
  }, [commit]);

  // A locked library shows nothing, not even how many decisions it holds, until the passphrase opens it.
  useEffect(() => {
    readLock().then((meta) => {
      setLockEnabled(meta !== null);
      if (meta) setLocked(true);
      else loadLibrary();
    });
  }, [loadLibrary]);

  const backup = useCallback(async (id: string) => {
    const d = decisionsRef.current.get(id);
    if (!d) return;
    await downloadBackup(d);
    setBackups(getBackups());
  }, []);

  // Navigation uses history state only; the address never carries anything but shared data.
  const go = useCallback((next: View, replace = false) => {
    setView(next);
    const state = next.name === 'decision' ? { decisionId: next.id } : {};
    const url = appBase(location.href);
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const id = (e.state as { decisionId?: unknown } | null)?.decisionId;
      setView(typeof id === 'string' && decisionsRef.current.has(id) ? { name: 'decision', id } : { name: 'library' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * Where an incoming envelope opens. Signatures are checked here, before anything is shown. Nothing is
   * saved: every path ends at a screen with a button.
   */
  const viewFor = useCallback(async (env: AnyEnvelope): Promise<View> => {
    if (env.kind === 'ballot') {
      const d = findOrganizer(decisionsRef.current.values(), env.data);
      if (!d) return { name: 'error', code: 'ballot-unknown' };
      return { name: 'review', decisionId: d.id, ballots: [{ ballot: env.data, signature: await checkBallot(env.data) }], skipped: 0 };
    }
    if (env.kind === 'invite') {
      const signature = await checkInvite(env.data);
      if (signature === 'invalid') return { name: 'error', code: 'bad-signature' };
      return { name: 'incoming-invite', env, signed: signature === 'valid' };
    }
    return { name: 'incoming', env };
  }, []);

  /**
   * Encrypted envelopes first: a passphrase-locked one waits for its passphrase; a sealed ballot opens
   * with this device's sealing key for that decision, if it has one.
   */
  const openIncoming = useCallback(
    async (incoming: Incoming, source: 'link' | 'file'): Promise<View> => {
      if (incoming.type === 'plain') return viewFor(incoming.env);
      const { box } = incoming;
      if (box.enc === 'passphrase') return { name: 'locked-share', box, source };
      const organizers = [...decisionsRef.current.values()].filter((d) => d.group?.role === 'organizer').map((d) => d.id);
      const found = await findSealer(box.to, organizers);
      if (!found) return { name: 'error', code: 'sealed-elsewhere' };
      const env = parseAnyEnvelopeText(await openSealed(box, found.sealer));
      if (env.kind !== 'ballot') return { name: 'error', code: 'invalid' };
      return viewFor(env);
    },
    [viewFor],
  );

  // Incoming links: "#d=..." (someone's decision, template, invite or ballot, maybe locked or sealed)
  // or "#t=name" (a built-in template). They open as a read-only preview or a review screen; nothing is
  // saved until the user says so.
  const readHash = useCallback(async () => {
    const req = readFragment(location.hash);
    if (req.type === 'none') return;
    try {
      if (req.type === 'data') setView(await openIncoming(await decodeIncoming(req.payload), 'link'));
      else if (req.type === 'template') {
        const text = await loadTemplateText(req.name);
        if (!text) return setView({ name: 'error', code: 'template-missing' });
        const env = parseEnvelopeText(text);
        if (env.kind !== 'template') throw new FormatError('invalid');
        setView({ name: 'incoming', env });
      } else setView({ name: 'error', code: 'bad-data' });
    } catch (e) {
      setView({ name: 'error', code: errorCode(e) });
    }
  }, [openIncoming]);

  // Wait for the library: a ballot link needs the organizer's decision to land on.
  useEffect(() => {
    if (!loaded) return;
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [loaded, readHash]);

  const persist = useCallback((d: Decision) => {
    clearTimeout(pending.current.get(d.id));
    pending.current.set(
      d.id,
      setTimeout(() => {
        pending.current.delete(d.id);
        saveDecision(d);
      }, 300),
    );
  }, []);

  /** Writes every edit still waiting for its save. */
  const flushSaves = useCallback(async () => {
    const saves: Promise<void>[] = [];
    for (const [id, timer] of pending.current) {
      clearTimeout(timer);
      const d = decisionsRef.current.get(id);
      if (d) saves.push(saveDecision(d));
    }
    pending.current.clear();
    await Promise.all(saves);
  }, []);

  useEffect(() => {
    const flush = () => void flushSaves();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flushSaves]);

  // The library lock. The passphrase is used, then forgotten: only the wrapped data key is stored.
  const unlock = async (passphrase: string) => {
    const meta = await readLock();
    if (!meta) return;
    setDataKey(await openLock(meta, passphrase));
    setLocked(false);
    await loadLibrary();
  };

  const lockNow = async () => {
    await flushSaves();
    forgetDataKey();
    commit(new Map());
    setLoaded(false);
    setLocked(true);
    go({ name: 'library' }, true);
  };

  const turnOn = async (passphrase: string) => {
    await flushSaves();
    const { meta, key } = await createLock(passphrase);
    await turnLockOn(meta, key);
    setLockEnabled(true);
    toast(t('lock.turnedOn'));
  };

  const turnOff = async (passphrase: string) => {
    const meta = await readLock();
    if (!meta) return;
    // The passphrase is asked again, so nobody at an unlocked screen can quietly remove the lock.
    await openLock(meta, passphrase);
    await flushSaves();
    await turnLockOff();
    setLockEnabled(lockOn());
    toast(t('lock.turnedOff'));
  };

  const erase = async () => {
    await eraseEverything();
    forgetAllBackups();
    setBackups(getBackups());
    setLockEnabled(false);
    setLocked(false);
    await loadLibrary();
  };

  const add = useCallback(
    (d: Decision) => {
      const next = new Map(decisionsRef.current);
      next.set(d.id, d);
      commit(next);
      saveDecision(d);
      requestPersistence().then(setPersisted);
      go({ name: 'decision', id: d.id }, true);
    },
    [commit, go],
  );

  /** Applies an edit and returns the decision as it is now. */
  const edit = useCallback(
    (id: string, change: Edit): Decision | undefined => {
      const current = decisionsRef.current.get(id);
      if (!current) return undefined;
      const updated = change(current);
      if (updated === current) return current;
      const next = new Map(decisionsRef.current);
      next.set(id, updated);
      commit(next);
      persist(updated);
      return updated;
    },
    [commit, persist],
  );

  const remove = useCallback(
    async (id: string) => {
      const d = decisionsRef.current.get(id);
      if (!d) return;
      const ok = await ask({ title: t('decision.delete'), message: t('library.confirmDelete', { title: decisionTitle(d) }), confirmLabel: t('decision.delete'), danger: true });
      if (!ok) return;
      clearTimeout(pending.current.get(id));
      const next = new Map(decisionsRef.current);
      next.delete(id);
      commit(next);
      await deleteDecision(id);
      await forgetDecisionKey(id);
      await forgetFolder(id);
      forgetBackup(id);
      setBackups(getBackups());
      go({ name: 'library' }, true);
    },
    [commit, go, ask],
  );

  const openFile = async () => {
    try {
      const text = await pickFileText(`${FILE_EXTENSION},.json,application/json`);
      if (text !== null) go(await openIncoming(parseIncomingText(text), 'file'));
    } catch (e) {
      setView({ name: 'error', code: errorCode(e) });
    }
  };

  /** The organizer picks several ballot files at once; files that aren't ballots for this decision are counted, not opened. */
  const openBallots = async (d: Decision) => {
    const picked = await pickFilesText(`${FILE_EXTENSION},.json,application/json`);
    if (!picked) return;
    const { ballots, skipped } = await ballotsFromTexts(d, picked.texts);
    if (ballots.length === 0) return toast(t('review.noneFound'));
    go({ name: 'review', decisionId: d.id, ballots, skipped: skipped + picked.failed });
  };

  /** The organizer checks the shared folder (or, without folder access, picks it): only ballots that bring something new go to review. */
  const collectBallots = async (d: Decision) => {
    try {
      const folder = canUseFolders() ? await rememberedFolder(d.id) : null;
      const read = folder ? await readBallots(folder) : await pickFolderBallots();
      if (!read) return;
      if (read === 'denied') return toast(t('folder.denied'));
      const { ballots, skipped, known } = await ballotsFromTexts(d, read.texts, true);
      if (ballots.length === 0) return toast(known ? t('folder.noNew', { count: known }) : t('folder.noBallots'));
      go({ name: 'review', decisionId: d.id, ballots, skipped: skipped + read.failed });
    } catch {
      toast(t('folder.failed'));
    }
  };

  /** Participant: what one file brings their copy. Returns a line to show, or null when it opened a screen or dialog. */
  const applyUpdate = async (id: string, update: Update): Promise<string | null> => {
    const d = decisionsRef.current.get(id);
    const g = d?.group;
    if (!d || g?.role !== 'participant') return null;
    switch (update.type) {
      case 'results':
        if (!isNewerResult(d, update.at)) return t('updates.none');
        edit(id, applyFolderResults(update.result, update.at));
        return t('updates.results', { count: update.result.ballots });
      case 'invite':
        // A newer invite opens on the usual screen, which lists what changed. The same or an older one needs nothing.
        if (g.inviteVersion && update.env.data.decision.updatedAt <= g.inviteVersion) return t('updates.upToDate');
        go(await viewFor(update.env));
        return null;
      case 'locked':
        setUnlocking({ id, box: update.box });
        return null;
      case 'refused':
        return t(`updates.refused.${update.reason}`);
    }
  };

  /**
   * Participant: "Check for updates". From the shared folder where this browser can use one (picked
   * once, then remembered): the group's results and the invite. Elsewhere, the person picks the file.
   */
  const checkUpdates = async (id: string) => {
    const d = decisionsRef.current.get(id);
    const g = d?.group;
    if (!d || g?.role !== 'participant' || !g.sourceId) return;
    try {
      let texts: string[];
      if (canUseFolders()) {
        const folder = (await rememberedFolder(id)) ?? (await connectFolder(id));
        if (!folder) return;
        const results = await readNamed(folder, resultsFileName(g.sourceId));
        if (results === 'denied') return toast(t('folder.denied'));
        const invite = await readNamed(folder, inviteFileName(g.sourceId));
        texts = [results, invite].filter((x): x is string => typeof x === 'string' && x !== 'denied');
        if (results === null) {
          // No results (yet, or the organizer keeps them): a newer invite may still be there.
          const resultsInFolder = (g.settings.folderResults ?? 'never') !== 'never';
          if (!texts.length) return toast(resultsInFolder ? t('updates.noFile') : t('updates.nothing'));
          const said = await applyUpdate(id, await readUpdate(d, texts[0]!));
          if (said) toast(resultsInFolder ? t('updates.noFile') : said);
          return;
        }
      } else {
        const text = await pickFileText(`${FILE_EXTENSION},.json,application/json`);
        if (text === null) return;
        texts = [text];
      }
      // Results first, then the invite: a newer invite opens its own screen.
      let line: string | null = null;
      for (const text of texts) {
        const said = await applyUpdate(id, await readUpdate(d, text));
        line ??= said;
      }
      if (line) toast(line);
    } catch {
      toast(t('updates.failed'));
    }
  };

  const pickTemplate = async (name: string) => {
    setDialog(null);
    try {
      const text = await loadTemplateText(name);
      if (!text) return setView({ name: 'error', code: 'template-missing' });
      go({ name: 'incoming', env: parseEnvelopeText(text) });
    } catch (e) {
      setView({ name: 'error', code: errorCode(e) });
    }
  };

  if (locked) return <LockScreen onUnlock={unlock} onErase={erase} />;

  if (view.name === 'locked-share') {
    const { box, source } = view;
    return (
      <PassphrasePrompt
        backup={Boolean(box.wrappedKey)}
        onOpen={async (passphrase) => {
          const inner = await openWithPassphrase(box, passphrase);
          try {
            const env = parseAnyEnvelopeText(inner);
            if (source === 'link' && env.kind === 'backup') throw new FormatError('invalid', 'Backups cannot travel in links');
            setView(await viewFor(env));
          } catch (e) {
            setView({ name: 'error', code: errorCode(e) });
          }
        }}
        onCancel={() => go({ name: 'library' }, true)}
      />
    );
  }

  if (view.name === 'error') {
    return (
      <div className="error-page">
        <Icon name="warn" size={32} />
        <h1>{t('error.title')}</h1>
        <p>{t(`error.${view.code}`)}</p>
        <button className="button primary" onClick={() => go({ name: 'library' }, true)}>
          {t('error.back')}
        </button>
      </div>
    );
  }

  if (view.name === 'review') {
    const d = decisions.get(view.decisionId);
    if (d) {
      return (
        <BallotReview
          d={d}
          ballots={view.ballots}
          skipped={view.skipped}
          onApprove={(chosen) => {
            const updated = edit(d.id, addBallots(chosen));
            toast(t('review.added', { count: chosen.length }));
            go({ name: 'decision', id: d.id }, true);
            if (updated) void afterApproval(updated, (change) => edit(d.id, change), toast);
          }}
          onDiscard={() => go({ name: 'decision', id: d.id }, true)}
        />
      );
    }
  }

  if (view.name === 'incoming-invite') {
    const invite = view.env.data;
    const { signed } = view;
    const joined = findJoined(decisions.values(), invite);
    // Someone who already joined: an older invite changes nothing; a newer one says what it changes.
    const older = joined ? isOlderInvite(joined, invite) : false;
    const changes = joined && !older ? inviteChanges(joined, invite) : undefined;
    return (
      <DecisionView
        d={{ ...invite.decision, ...(invite.result && { groupResult: invite.result }) }}
        incoming={{
          kind: 'invite',
          invite: {
            settings: invite.settings,
            ...(invite.organizerName && { organizerName: invite.organizerName }),
            ...(signed && invite.key && { organizerKey: invite.key }),
            joined: Boolean(joined),
            // Mirrors joinInvite: only a signed invite's sealing key is used.
            sealed: signed && Boolean(invite.sealKey),
            older,
            ...(changes && { changes }),
          },
          onSave: () => {
            if (joined) {
              if (!older) {
                edit(joined.id, refreshFromInvite(invite, signed));
                if (changes && hasChanges(changes)) toast(t('incoming.updatedToast'));
              }
              go({ name: 'decision', id: joined.id }, true);
            } else {
              add(joinInvite(invite, getLang(), signed));
              toast(t('incoming.joined'));
            }
          },
          onDiscard: () => go({ name: 'library' }, true),
        }}
        onEdit={() => {}}
        onBack={() => go({ name: 'library' }, true)}
        onBackup={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
      />
    );
  }

  if (view.name === 'incoming') {
    const { env } = view;
    return (
      <DecisionView
        d={env.data}
        incoming={{
          kind: env.kind,
          onSave: () => {
            add(adopt(env.data, getLang(), env.kind === 'backup'));
            toast(t('incoming.saved'));
          },
          onDiscard: () => go({ name: 'library' }, true),
        }}
        onEdit={() => {}}
        onBack={() => go({ name: 'library' }, true)}
        onBackup={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
      />
    );
  }

  const current = view.name === 'decision' ? decisions.get(view.id) : undefined;
  if (current) {
    const unlockingHere = unlocking?.id === current.id ? unlocking : null;
    return (
      <>
      {unlockingHere && (
        <PassphraseDialog
          title={t('updates.lockedTitle')}
          text={t('updates.lockedText')}
          onClose={() => setUnlocking(null)}
          onSubmit={async (passphrase) => {
            const update = await unlockUpdate(current, unlockingHere.box, passphrase);
            setUnlocking(null);
            const line = await applyUpdate(current.id, update);
            if (line) toast(line);
          }}
        />
      )}
      <DecisionView
        d={current}
        onEdit={(change) => edit(current.id, change)}
        onBack={() => go({ name: 'library' })}
        onBackup={() => backup(current.id)}
        onDuplicate={() => add({ ...adopt(current, getLang()), title: t('decision.copyOf', { title: decisionTitle(current) }) })}
        onDelete={() => remove(current.id)}
        onOpenBallots={() => openBallots(current)}
        onCollectBallots={() => collectBallots(current)}
        onCheckUpdates={() => checkUpdates(current.id)}
      />
      </>
    );
  }

  return (
    <>
      <Library
        decisions={[...decisions.values()]}
        persistent={isPersistent()}
        persisted={persisted}
        backups={backups}
        onBackup={backup}
        onOpen={(id) => go({ name: 'decision', id })}
        onNew={() => add(emptyDecision(getLang()))}
        onTemplates={() => setDialog('templates')}
        onImportTable={() => setDialog('import')}
        onOpenFile={openFile}
        onDelete={remove}
        lockEnabled={lockEnabled}
        onLockSettings={() => setDialog('lock')}
        onLockNow={lockNow}
      />
      {dialog === 'templates' && <TemplatesDialog onPick={pickTemplate} onClose={() => setDialog(null)} />}
      {dialog === 'lock' && <LockDialog on={lockEnabled} onTurnOn={turnOn} onTurnOff={turnOff} onLockNow={lockNow} onClose={() => setDialog(null)} />}
      {dialog === 'import' && (
        <ImportDialog
          onCreate={(d) => {
            setDialog(null);
            add(d);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
