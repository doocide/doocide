// The organizer's ballots: who's in, who's left out, and how to collect more. The 2010 "merge these
// perspectives" screen, without a server.

import { useState } from 'react';
import { ballotStatus } from '../engine';
import type { Decision, GroupResult, StoredBallot } from '../format/types';
import { formatDate, t } from '../i18n';
import { CompareCodes, useDeviceKey, useShortCode } from './codes';
import { confirmKey, removeBallot, setBallotIncluded, setIncludeOwn, unconfirmKey, type Edit } from './edit';
import { editedSinceInvite } from './invites';
import { SharedFolder, afterApproval } from './SharedFolder';
import { Icon, useConfirm, useToast } from './ui';

/** A ballot's name: the one its sender typed (named groups), or a number. */
export function ballotLabel(d: Decision, b: StoredBallot, index: number): string {
  if (b.author) return b.author;
  return d.group?.settings.anonymity === 'named' ? t('ballots.noName', { n: index + 1 }) : t('ballots.anonymousN', { n: index + 1 });
}

interface Props {
  d: Decision;
  /** Ballots counting in the group result right now, the organizer's own included. */
  voters: number;
  /** The group's combined result right now. */
  result: GroupResult | null;
  onEdit: (edit: Edit) => void;
  onInvite: () => void;
  onOpenBallots: () => void;
  /** Check the shared folder for new ballots. */
  onCollect: () => void;
}

export function BallotsPanel({ d, voters, result, onEdit, onInvite, onOpenBallots, onCollect }: Props) {
  const ask = useConfirm();
  const toast = useToast();
  /** Who counts changed: with "after each approval", the results in the shared folder follow. */
  const changeCount = (change: Edit) => {
    onEdit(change);
    void afterApproval(change(d), onEdit, toast);
  };
  const [comparing, setComparing] = useState<{ ballot: StoredBallot; label: string } | null>(null);
  const myCode = useShortCode(useDeviceKey());
  const g = d.group;
  if (g?.role !== 'organizer') return null;
  const own = (d.settings.mode === 'pugh' ? d.pugh : d.scores).length;
  const count = g.ballots.length;
  const { expected, anonymity } = g.settings;

  return (
    <section className="ballots" aria-labelledby="ballots-title">
      <h2 id="ballots-title">{t('ballots.title')}</h2>
      <p className="muted small">
        {expected ? t('ballots.countOf', { count, expected }) : t('ballots.count', { count })} ·{' '}
        {anonymity === 'anonymous' ? t('group.anonymousShort') : t('group.namedShort')}
      </p>
      {expected !== undefined && count > expected && <p className="callout warn small">{t('ballots.overCount', { count, expected })}</p>}
      {editedSinceInvite(d) && <p className="callout warn small">{t('ballots.editedSinceInvite')}</p>}
      {anonymity === 'anonymous' && voters === 2 && <p className="callout small">{t('ballots.twoReveal')}</p>}

      <ul className="ballot-list">
        <li>
          <label className="check">
            <input type="checkbox" checked={g.includeOwn} onChange={(e) => changeCount(setIncludeOwn(e.target.checked))} />
            {t('ballots.you')}
          </label>
          <span className="muted small">{own ? t('ballots.yourScores', { count: own }) : t('ballots.youNoScores')}</span>
        </li>
        {g.ballots.map((b, i) => {
          const label = ballotLabel(d, b, i);
          const status = ballotStatus(b, g);
          return (
            <li key={b.voterId}>
              <label className="check">
                <input type="checkbox" checked={b.included} onChange={(e) => changeCount(setBallotIncluded(b.voterId, e.target.checked))} />
                <bdi>{label}</bdi>
              </label>
              {status === 'verified' && (
                <button className="badge verified" onClick={() => setComparing({ ballot: b, label })} title={t('code.matched')}>
                  <Icon name="check" size={12} /> {t('ballots.verified')}
                </button>
              )}
              {status === 'self-declared' && (
                <span className="muted small" title={t('notes.authorUnverified')}>
                  {t('review.selfDeclared')}
                </span>
              )}
              {status === 'self-declared' && b.signed && b.key && (
                <button className="link-button small" onClick={() => setComparing({ ballot: b, label })}>
                  {t('ballots.compare')}
                </button>
              )}
              <span className="muted small">
                {formatDate(b.receivedAt)}
                {b.revision > 1 && ` · ${t('ballots.updated')}`}
              </span>
              <button
                className="icon-button small"
                aria-label={t('ballots.remove', { name: label })}
                title={t('ballots.remove', { name: label })}
                onClick={async () => {
                  const ok = await ask({ title: t('ballots.removeTitle'), message: t('ballots.confirmRemove'), confirmLabel: t('ballots.removeTitle'), danger: true });
                  if (ok) changeCount(removeBallot(b.voterId));
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {count === 0 && <p className="muted small">{t('ballots.none')}</p>}

      <p className="muted small">{t('ballots.how')}</p>
      <div className="actions start">
        <button className="button primary" onClick={onInvite}>
          <Icon name="people" size={18} />
          {t('ballots.invite')}
        </button>
        <button className="button" onClick={onOpenBallots}>
          <Icon name="file" size={18} />
          {t('ballots.open')}
        </button>
      </div>
      {/* Right under the buttons, so it shows without scrolling far: the folder is how many groups collect. */}
      <SharedFolder d={d} result={result} onEdit={onEdit} onCollect={onCollect} />
      <p className="muted small">
        <Icon name="lock" size={12} /> {t('ballots.sameDevice')}
      </p>
      {myCode && (
        <p className="muted small">
          {t('ballots.yourCode', { code: myCode })} {t('ballots.yourCodeHelp')}
        </p>
      )}
      {comparing?.ballot.key && (
        <CompareCodes
          intro={t('code.ballot', { name: comparing.label })}
          publicKey={comparing.ballot.key}
          matched={ballotStatus(comparing.ballot, g) === 'verified'}
          onMatch={() => onEdit(confirmKey(comparing.ballot.key!))}
          onUnmatch={() => onEdit(unconfirmKey(comparing.ballot.key!))}
          onClose={() => setComparing(null)}
        />
      )}
    </section>
  );
}
