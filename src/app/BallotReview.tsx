// The organizer reviews incoming ballots before anything is added. Each ballot is someone else's
// content, so it sits in a marked frame with its sender named (or marked anonymous); the checks
// above each frame are the app's own.

import { useMemo, useState } from 'react';
import { reviewBallots, type BallotFlag } from '../engine';
import type { Ballot, Decision, Note, ReceivedBallot } from '../format/types';
import { formatDate, t, useLang } from '../i18n';
import { formatValue } from './controls';
import { decisionTitle, factorName, optionName } from './labels';
import { Icon } from './ui';

function flagText(f: BallotFlag, d: Decision, uiLang: string): string {
  switch (f.kind) {
    case 'abstained':
      return t('review.flagAbstained', {
        names: d.options
          .filter((o) => f.options.includes(o.id))
          .map((o) => optionName(d, o, uiLang))
          .join(', '),
      });
    case 'replaces':
      return t('review.flagReplaces');
    case 'outdated':
      return t('review.flagOutdated');
    case 'badSignature':
      return t('review.flagBadSignature');
    case 'keyChanged':
      return t('review.flagKeyChanged');
    case 'unsigned':
      return t('review.flagUnsigned');
    case 'copy':
      return t('review.flagCopy');
    case 'sameName':
      return t('review.flagSameName');
    case 'overCount':
      return t('review.flagOverCount', { count: f.count, expected: f.expected });
    case 'missing':
      return t('review.flagMissing');
    case 'nameRemoved':
      return t('review.flagNameRemoved');
    case 'empty':
      return t('review.flagEmpty');
    case 'otherRound':
      return t('review.flagOtherRound');
  }
}

/** Flags that only inform, as opposed to ones worth a second look. */
const INFO = new Set<BallotFlag['kind']>(['replaces', 'otherRound', 'nameRemoved', 'missing', 'unsigned', 'abstained']);

export function BallotTable({ d, ballot, uiLang }: { d: Decision; ballot: Pick<Ballot, 'scores' | 'pugh' | 'weights' | 'abstain'>; uiLang: string }) {
  const pugh = d.settings.mode === 'pugh';
  const abstained = new Set(ballot.abstain ?? []);
  const values = new Map((pugh ? ballot.pugh : ballot.scores).map((s) => [`${s.optionId} ${s.factorId}`, s.value]));
  const weights = new Map(ballot.weights?.map((w) => [w.factorId, w.weight]));
  const options = d.options.filter((o) => !(pugh && o.id === d.settings.baselineId));
  return (
    <div className="table-scroll">
      <table className="mini-table">
        <thead>
          <tr>
            <th scope="col">{t('grid.factors')}</th>
            {weights.size > 0 && <th scope="col">{t('grid.importance')}</th>}
            {options.map((o) => (
              <th key={o.id} scope="col" dir="auto" lang={d.lang}>
                {optionName(d, o, uiLang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.factors.map((f) => (
            <tr key={f.id}>
              <th scope="row" dir="auto" lang={d.lang}>
                {factorName(d, f, uiLang)}
              </th>
              {weights.size > 0 && <td>{weights.has(f.id) ? '★'.repeat(weights.get(f.id)!) : '–'}</td>}
              {options.map((o) => (
                <td key={o.id} className={abstained.has(o.id) ? 'abstained' : undefined}>
                  {abstained.has(o.id) ? t('abstain.cell') : formatValue(d, values.get(`${o.id} ${f.id}`))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function noteTarget(d: Decision, n: Pick<Note, 'optionId' | 'factorId'>, uiLang: string): string {
  const o = d.options.find((x) => x.id === n.optionId);
  const f = d.factors.find((x) => x.id === n.factorId);
  if (o && f) return `${optionName(d, o, uiLang)} · ${factorName(d, f, uiLang)}`;
  if (o) return optionName(d, o, uiLang);
  if (f) return factorName(d, f, uiLang);
  return t('notes.decisionNotes');
}

interface Props {
  d: Decision;
  ballots: ReceivedBallot[];
  /** Files picked along with the ballots that weren't ballots for this decision. */
  skipped: number;
  onApprove: (ballots: ReceivedBallot[]) => void;
  onDiscard: () => void;
}

export function BallotReview({ d, ballots, skipped, onApprove, onDiscard }: Props) {
  const uiLang = useLang();
  const reviews = useMemo(() => reviewBallots(d, ballots), [d, ballots]);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(reviews.flatMap((r, i) => (r.adds ? [i] : []))));
  const many = reviews.length > 1;
  const named = d.group?.settings.anonymity === 'named';
  const picked = reviews.filter((r, i) => r.adds && chosen.has(i)).map((r) => ({ ballot: r.ballot, signature: r.signature }));
  // Verified only when the signature checked out and its key is one the organizer already confirmed.
  const verified = (b: Ballot, signature: ReceivedBallot['signature']) => signature === 'valid' && Boolean(b.key && d.group?.confirmed?.includes(b.key));

  const toggle = (i: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="review">
      <header className="topbar">
        <button className="icon-button" onClick={onDiscard} aria-label={t('decision.back')}>
          <Icon name="back" />
        </button>
        <h1 className="review-title" dir="auto">
          {t('review.title', { title: decisionTitle(d) })}
        </h1>
      </header>

      <main className="review-main">
        <p className="callout">{t('review.intro', { count: reviews.length })}</p>
        {skipped > 0 && <p className="callout warn small">{t('review.skipped', { count: skipped })}</p>}

        <ol className="review-list">
          {reviews.map((r, i) => (
            <li key={`${r.ballot.voterId}-${r.ballot.revision}-${i}`}>
              <div className="review-head">
                {many ? (
                  <label className="check">
                    <input type="checkbox" checked={r.adds && chosen.has(i)} disabled={!r.adds} onChange={() => toggle(i)} />
                    {t('review.ballotN', { n: i + 1 })}
                  </label>
                ) : (
                  <span>{t('review.ballotN', { n: i + 1 })}</span>
                )}
              </div>
              {r.flags.length > 0 && (
                <ul className="flags">
                  {r.flags.map((f) => (
                    <li key={f.kind} className={INFO.has(f.kind) ? 'info' : 'warn'}>
                      <Icon name={INFO.has(f.kind) ? 'check' : 'warn'} size={14} />
                      {flagText(f, d, uiLang)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="ballot-frame" role="group" aria-label={t('review.frame')}>
                <p className="ballot-from">
                  {r.ballot.author ? (
                    <>
                      {t('review.from')} <bdi className="author">{r.ballot.author}</bdi>{' '}
                      {verified(r.ballot, r.signature) ? (
                        <span className="badge verified">{t('ballots.verified')}</span>
                      ) : (
                        <span className="muted small">{t('review.selfDeclared')}</span>
                      )}
                    </>
                  ) : (
                    <strong>{named ? t('review.noName') : t('review.anonymous')}</strong>
                  )}
                  <span className="muted small"> · {formatDate(r.ballot.createdAt, !r.ballot.author)}</span>
                </p>
                <BallotTable d={d} ballot={r.ballot} uiLang={uiLang} />
                {r.ballot.notes.length > 0 && (
                  <div className="ballot-notes">
                    <h3>{t('review.notes', { count: r.ballot.notes.length })}</h3>
                    <ul>
                      {r.ballot.notes.map((n) => (
                        <li key={n.id}>
                          <span className="muted small" dir="auto">
                            {noteTarget(d, n, uiLang)}
                          </span>
                          <p dir="auto" lang={d.lang}>
                            {n.text}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="actions">
          <button className="button" onClick={onDiscard}>
            {t('review.discard')}
          </button>
          <button className="button primary" disabled={picked.length === 0} onClick={() => onApprove(picked)}>
            {t('review.add', { count: picked.length })}
          </button>
        </div>
      </main>
    </div>
  );
}
