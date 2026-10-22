// The shared folder on screen: the organizer's block in the Ballots panel, and publishing results after
// approvals. Where the browser can't write to folders, the same buttons download the files instead, to
// be moved into the folder by hand.

import { useCallback, useEffect, useState } from 'react';
import type { Decision, GroupResult } from '../format/types';
import { formatDate, t } from '../i18n';
import { markInvited, markPublished, type Edit } from './edit';
import { canUseFolders, connectFolder, forgetFolder, rememberedFolder, saveToFolder, type FolderHandle } from './folder';
import { publishAfterApproval, publishResults, signedInvite, type Published } from './groupFiles';
import { inviteShape } from './invites';
import { Icon, useToast } from './ui';

/** Told to every screen showing a decision's folder when it changes, so they all show the same one. */
const FOLDER_CHANGED = 'doocide-folder-changed';
const announce = (decisionId: string) => window.dispatchEvent(new CustomEvent(FOLDER_CHANGED, { detail: decisionId }));

/** The folder remembered for a decision, and ways to pick another or forget it. */
export function useFolder(decisionId: string) {
  const [folder, setFolder] = useState<FolderHandle | null>(null);
  const reload = useCallback(() => {
    rememberedFolder(decisionId).then(setFolder, () => setFolder(null));
  }, [decisionId]);
  useEffect(() => {
    reload();
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail === decisionId) reload();
    };
    window.addEventListener(FOLDER_CHANGED, onChange);
    return () => window.removeEventListener(FOLDER_CHANGED, onChange);
  }, [decisionId, reload]);
  const connect = useCallback(async () => {
    const picked = await connectFolder(decisionId);
    if (picked) announce(decisionId);
    return picked;
  }, [decisionId]);
  const forget = useCallback(async () => {
    await forgetFolder(decisionId);
    announce(decisionId);
  }, [decisionId]);
  return { folder, connect, forget, reload };
}

function publishedLine(r: Published, folder?: string): string {
  switch (r) {
    case 'written':
      return t('folder.published', { folder: folder ?? '' });
    case 'downloaded':
      return t('folder.resultsDownloaded');
    case 'denied':
      return t('folder.denied');
    case 'empty':
      return t('folder.nothingYet');
    case 'no-key':
      return t('folder.noKey');
  }
}

/**
 * After ballots were approved, left out or removed: results go to the folder when the organizer chose
 * "after each approval". The tap that approved is what lets the browser ask for folder access again.
 */
export async function afterApproval(next: Decision, onEdit: (e: Edit) => unknown, toast: (message: string) => void): Promise<void> {
  try {
    const r = await publishAfterApproval(next);
    if (r === null || r === 'empty') return;
    if (r === 'written') onEdit(markPublished);
    toast(r === 'written' ? t('folder.publishedAuto') : publishedLine(r));
  } catch {
    toast(t('folder.failed'));
  }
}

interface Props {
  d: Decision;
  /** The group's combined result right now. */
  result: GroupResult | null;
  onEdit: (e: Edit) => void;
  onCollect: () => void;
}

/** Organizer: connect a shared folder, collect ballots from it, put the invite and the results in it. */
export function SharedFolder({ d, result, onEdit, onCollect }: Props) {
  const toast = useToast();
  const api = canUseFolders();
  const { folder, connect, forget } = useFolder(d.id);
  const [busy, setBusy] = useState(false);
  const g = d.group;
  if (g?.role !== 'organizer') return null;
  const folderResults = g.settings.folderResults ?? 'never';
  const target = api ? folder : null;
  const ready = !api || folder !== null;
  const changedSince = Boolean(g.publishedAt && d.updatedAt > g.publishedAt);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch {
      toast(t('folder.failed'));
    } finally {
      setBusy(false);
    }
  };

  const putInvite = () =>
    run(async () => {
      const saved = await saveToFolder(target, { kind: 'invite', env: await signedInvite(d, result ?? undefined) });
      // It's out: later edits get flagged as not yet sent, like any invite.
      if (saved !== 'denied') onEdit(markInvited(inviteShape(d)));
      toast(saved === 'written' ? t('folder.inviteWritten', { folder: folder?.name ?? '' }) : saved === 'downloaded' ? t('folder.inviteDownloaded') : t('folder.denied'));
    });

  const publish = () =>
    run(async () => {
      const r = await publishResults(d, target);
      if (r === 'written' || r === 'downloaded') onEdit(markPublished);
      toast(publishedLine(r, folder?.name));
    });

  const resultsHelp =
    folderResults === 'publish'
      ? t('folder.whenPublish')
      : folderResults === 'approval'
        ? target
          ? t('folder.afterApproval')
          : t('folder.afterApprovalManual')
        : '';

  return (
    <section className="shared-folder" aria-labelledby="folder-title">
      <h3 id="folder-title">
        <Icon name="folder" size={18} /> {t('folder.title')}
      </h3>
      {!api && <p className="muted small">{t('folder.introManual')}</p>}
      {api && !folder && (
        <>
          <p className="muted small">{t('folder.intro')}</p>
          <div className="actions start">
            <button className="button" onClick={() => void connect()}>
              <Icon name="folder" size={18} />
              {t('folder.connect')}
            </button>
          </div>
        </>
      )}
      {api && folder && (
        <p className="small">
          {t('folder.connected')} <bdi className="folder-name">{folder.name}</bdi> ·{' '}
          <button className="link-button small" onClick={() => void connect()}>
            {t('folder.change')}
          </button>{' '}
          ·{' '}
          <button className="link-button small" onClick={() => void forget()}>
            {t('folder.forget')}
          </button>
        </p>
      )}
      {ready && (
        <div className="actions start">
          <button className="button" disabled={busy} onClick={onCollect}>
            <Icon name="refresh" size={18} />
            {t('folder.collect')}
          </button>
          <button className="button" disabled={busy} onClick={putInvite}>
            <Icon name="people" size={18} />
            {api ? t('folder.putInvite') : t('folder.saveInvite')}
          </button>
          {folderResults !== 'never' && (
            <button className="button" disabled={busy || !result} onClick={publish}>
              <Icon name="trophy" size={18} />
              {api ? t('folder.publish') : t('folder.saveResults')}
            </button>
          )}
        </div>
      )}
      {folderResults !== 'never' && (
        <p className="muted small">
          {resultsHelp}
          {g.resultsKdf && ` ${t('folder.resultsLocked')}`}
          {g.publishedAt && ` ${t('folder.publishedAt', { date: formatDate(g.publishedAt) })}`}
          {changedSince && ` ${t('folder.changedSince')}`}
        </p>
      )}
      <p className="muted small">{t('folder.seen')}</p>
    </section>
  );
}
