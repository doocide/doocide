import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTemplateText } from '@packs';
import { appBase, decodePayload, readFragment } from '../format/codec';
import { adopt, emptyDecision, joinInvite } from '../format/create';
import type { AnyEnvelope, Ballot, Decision, Envelope, Invite, InviteEnvelope } from '../format/types';
import { FormatError, parseAnyEnvelopeText, parseEnvelopeText, type FormatErrorCode } from '../format/validate';
import { getLang, t, useLang } from '../i18n';
import { BallotReview } from './BallotReview';
import { DecisionView } from './DecisionView';
import { addBallots, refreshFromInvite, type Edit } from './edit';
import { FILE_EXTENSION, pickFileText, pickFilesText } from './files';
import { ImportDialog } from './ImportDialog';
import { TemplatesDialog } from './InfoDialogs';
import { decisionTitle } from './labels';
import { Library } from './Library';
import { downloadBackup } from './backup';
import { forgetBackup, getBackups } from './prefs';
import { deleteDecision, isPersistent, listDecisions, requestPersistence, saveDecision, storagePersisted } from './store';
import { Icon, useConfirm, useToast } from './ui';

type ErrorCode = FormatErrorCode | 'template-missing' | 'ballot-unknown';

type View =
  | { name: 'library' }
  | { name: 'decision'; id: string }
  | { name: 'incoming'; env: Envelope | InviteEnvelope }
  | { name: 'review'; decisionId: string; ballots: Ballot[]; skipped: number }
  | { name: 'error'; code: ErrorCode };

const errorCode = (e: unknown): FormatErrorCode => (e instanceof FormatError ? e.code : 'bad-data');

/** The organizer's decision a ballot belongs to. A restored backup has a new id, so the invite id is checked too. */
function findOrganizer(all: Iterable<Decision>, b: Ballot): Decision | undefined {
  const organizers = [...all].filter((d) => d.group?.role === 'organizer');
  return (
    organizers.find((d) => d.id === b.decisionId) ??
    organizers.filter((d) => d.group!.inviteId === b.inviteId).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
  );
}

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
  const [view, setView] = useState<View>({ name: 'library' });
  const [dialog, setDialog] = useState<null | 'templates' | 'import'>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backups, setBackups] = useState(getBackups);
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const commit = useCallback((next: Map<string, Decision>) => {
    decisionsRef.current = next;
    setDecisions(next);
  }, []);

  useEffect(() => {
    listDecisions().then((list) => {
      commit(new Map(list.map((d) => [d.id, d])));
      setLoaded(true);
      // Only ask the browser to keep storage once there is something worth keeping.
      (list.length ? requestPersistence() : storagePersisted()).then(setPersisted);
    });
  }, [commit]);

  const backup = useCallback((id: string) => {
    const d = decisionsRef.current.get(id);
    if (!d) return;
    downloadBackup(d);
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

  /** Where an incoming envelope opens. Nothing is saved here: every path ends at a screen with a button. */
  const viewFor = useCallback((env: AnyEnvelope): View => {
    if (env.kind === 'ballot') {
      const d = findOrganizer(decisionsRef.current.values(), env.data);
      return d ? { name: 'review', decisionId: d.id, ballots: [env.data], skipped: 0 } : { name: 'error', code: 'ballot-unknown' };
    }
    return { name: 'incoming', env };
  }, []);

  // Incoming links: "#d=..." (someone's decision, template, invite or ballot) or "#t=name" (a built-in
  // template). They open as a read-only preview or a review screen; nothing is saved until the user says so.
  const readHash = useCallback(async () => {
    const req = readFragment(location.hash);
    if (req.type === 'none') return;
    try {
      if (req.type === 'data') setView(viewFor(await decodePayload(req.payload)));
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
  }, [viewFor]);

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

  useEffect(() => {
    const flush = () => {
      for (const [id, timer] of pending.current) {
        clearTimeout(timer);
        const d = decisionsRef.current.get(id);
        if (d) saveDecision(d);
      }
      pending.current.clear();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

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

  const edit = useCallback(
    (id: string, change: Edit) => {
      const current = decisionsRef.current.get(id);
      if (!current) return;
      const updated = change(current);
      if (updated === current) return;
      const next = new Map(decisionsRef.current);
      next.set(id, updated);
      commit(next);
      persist(updated);
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
      forgetBackup(id);
      setBackups(getBackups());
      go({ name: 'library' }, true);
    },
    [commit, go, ask],
  );

  const openFile = async () => {
    try {
      const text = await pickFileText(`${FILE_EXTENSION},.json,application/json`);
      if (text !== null) go(viewFor(parseAnyEnvelopeText(text)));
    } catch (e) {
      setView({ name: 'error', code: errorCode(e) });
    }
  };

  /** The organizer picks several ballot files at once; files that aren't ballots for this decision are counted, not opened. */
  const openBallots = async (d: Decision) => {
    const picked = await pickFilesText(`${FILE_EXTENSION},.json,application/json`);
    if (!picked) return;
    const ballots: Ballot[] = [];
    let skipped = picked.failed;
    for (const text of picked.texts) {
      try {
        const env = parseAnyEnvelopeText(text);
        if (env.kind === 'ballot' && findOrganizer([d], env.data)) ballots.push(env.data);
        else skipped++;
      } catch {
        skipped++;
      }
    }
    if (ballots.length === 0) return toast(t('review.noneFound'));
    go({ name: 'review', decisionId: d.id, ballots, skipped });
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
            edit(d.id, addBallots(chosen));
            toast(t('review.added', { count: chosen.length }));
            go({ name: 'decision', id: d.id }, true);
          }}
          onDiscard={() => go({ name: 'decision', id: d.id }, true)}
        />
      );
    }
  }

  if (view.name === 'incoming') {
    const { env } = view;
    if (env.kind === 'invite') {
      const invite = env.data;
      const joined = findJoined(decisions.values(), invite);
      return (
        <DecisionView
          d={{ ...invite.decision, ...(invite.result && { groupResult: invite.result }) }}
          incoming={{
            kind: 'invite',
            invite: { settings: invite.settings, ...(invite.organizerName && { organizerName: invite.organizerName }), joined: Boolean(joined) },
            onSave: () => {
              if (joined) {
                edit(joined.id, refreshFromInvite(invite));
                go({ name: 'decision', id: joined.id }, true);
              } else {
                add(joinInvite(invite, getLang()));
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
    return (
      <DecisionView
        d={current}
        onEdit={(change) => edit(current.id, change)}
        onBack={() => go({ name: 'library' })}
        onBackup={() => backup(current.id)}
        onDuplicate={() => add({ ...adopt(current, getLang()), title: t('decision.copyOf', { title: decisionTitle(current) }) })}
        onDelete={() => remove(current.id)}
        onOpenBallots={() => openBallots(current)}
      />
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
      />
      {dialog === 'templates' && <TemplatesDialog onPick={pickTemplate} onClose={() => setDialog(null)} />}
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
