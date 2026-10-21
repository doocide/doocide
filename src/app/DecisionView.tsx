import { useMemo, useState } from 'react';
import { analyze, cellKey, computeResults, groupView, groupVoters } from '../engine';
import { toCSV } from '../format/table';
import type { Decision, GroupSettings, Kind } from '../format/types';
import { formatDate, t, useLang } from '../i18n';
import { BallotsPanel, ballotLabel } from './BallotsPanel';
import { Cards, Setup } from './Cards';
import { CompareCodes, useShortCode } from './codes';
import { DetailDialog } from './DetailDialog';
import { confirmOrganizer, scoringLocked, setTitle, structureLocked, tidyNames, weightsLocked, type Edit, type Target } from './edit';
import { downloadText, safeFileName } from './files';
import { Grid, type GroupCells, type VoterValue } from './Grid';
import { ResultsPanel } from './ResultsPanel';
import { SettingsDialog } from './SettingsDialog';
import { ShareDialog } from './ShareDialog';
import { Icon, Menu, Segmented, useMediaQuery } from './ui';

export interface Incoming {
  kind: Exclude<Kind, 'ballot'>;
  /** An invite to score: the group's rules, who sent it (and the key that signed it), and whether this person already started. */
  invite?: { settings: GroupSettings; organizerName?: string; organizerKey?: string; joined: boolean };
  onSave: () => void;
  onDiscard: () => void;
}

interface Props {
  d: Decision;
  incoming?: Incoming;
  onEdit: (edit: Edit) => void;
  onBack: () => void;
  onBackup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Organizer: pick ballot files to review. */
  onOpenBallots?: () => void;
}

/** A name someone else typed, kept apart from the app's own words and marked as unchecked until codes were compared. */
function TypedName({ name, verified = false }: { name: string; verified?: boolean }) {
  return (
    <>
      <bdi className="author">{name}</bdi> <span className="muted small">{verified ? t('incoming.verified') : t('incoming.notVerified')}</span>
    </>
  );
}

function IncomingBanner({ incoming, title }: { incoming: Incoming; title: string }) {
  const { kind, invite } = incoming;
  const code = useShortCode(invite?.organizerKey);
  return (
    <div className="incoming" role="region" aria-label={t('incoming.label')}>
      <Icon name={kind === 'backup' ? 'file' : kind === 'invite' ? 'people' : 'shield'} />
      <div className="incoming-text">
        <p>
          {kind === 'template' && t('incoming.template', { title })}
          {kind === 'decision' && t('incoming.decision')}
          {kind === 'backup' && t('incoming.backup')}
          {kind === 'invite' && t('incoming.invite')}
        </p>
        {invite?.organizerName && (
          <p className="small">
            {t('incoming.invitedBy')} <TypedName name={invite.organizerName} />
          </p>
        )}
        {invite && <p className="small">{invite.settings.anonymity === 'anonymous' ? t('group.anonymousPromise') : t('group.namedPromise')}</p>}
        {code && <p className="small muted">{t('incoming.signedCode', { code })}</p>}
      </div>
      <div className="actions">
        <button className="button" onClick={incoming.onDiscard}>
          {t('incoming.discard')}
        </button>
        <button className="button primary" onClick={incoming.onSave}>
          {kind === 'template'
            ? t('incoming.useTemplate')
            : kind === 'backup'
              ? t('incoming.restore')
              : kind === 'invite'
                ? invite?.joined
                  ? t('incoming.continue')
                  : t('incoming.startScoring')
                : t('incoming.save')}
        </button>
      </div>
    </div>
  );
}

/** A participant's own copy: whose decision it is, how anonymous the ballot is, and whether it went out. */
function ParticipantBar({ d, onSend, onEdit }: { d: Decision; onSend: () => void; onEdit: (edit: Edit) => void }) {
  const g = d.group!;
  const [checking, setChecking] = useState(false);
  const checkCode = g.organizerKey && (
    <button className="link-button small" onClick={() => setChecking(true)}>
      {g.organizerConfirmed ? t('code.title') : t('participant.checkCode')}
    </button>
  );
  return (
    <div className="group-bar" role="region" aria-label={t('participant.label')}>
      <Icon name="people" />
      <div className="group-bar-text">
        <p>
          {g.settings.anonymity === 'anonymous' ? t('participant.anonymous') : t('participant.named')}{' '}
          {g.sentAt ? t('participant.sent', { date: formatDate(g.sentAt) }) : t('participant.notSent')}
        </p>
        {g.organizerName ? (
          <p className="small">
            {t('incoming.invitedBy')} <TypedName name={g.organizerName} verified={g.organizerConfirmed} /> {checkCode}
          </p>
        ) : (
          g.organizerKey && (
            <p className="small">
              {t('participant.organizerSigned')} {checkCode}
            </p>
          )
        )}
      </div>
      <button className="button primary" onClick={onSend}>
        <Icon name="share" size={18} />
        {t('participant.send')}
      </button>
      {checking && g.organizerKey && (
        <CompareCodes
          intro={t('code.organizer')}
          publicKey={g.organizerKey}
          matched={Boolean(g.organizerConfirmed)}
          onMatch={() => onEdit(confirmOrganizer)}
          onClose={() => setChecking(false)}
        />
      )}
    </div>
  );
}

export function DecisionView({ d, incoming, onEdit, onBack, onBackup, onDuplicate, onDelete, onOpenBallots }: Props) {
  const uiLang = useLang();
  const isPhone = useMediaQuery('(max-width: 760px)');
  const readOnly = Boolean(incoming);
  const role = d.group?.role;
  const gv = useMemo(() => groupView(d), [d]);
  const ownScores = (d.settings.mode === 'pugh' ? d.pugh : d.scores).length > 0;
  // A group results share has no scores of its own: there's only the group's to show.
  const onlyGroup = gv !== null && !d.group && !ownScores;
  const [view, setView] = useState<'mine' | 'group'>(onlyGroup || (readOnly && gv) ? 'group' : 'mine');
  const showGroup = view === 'group' && gv !== null;
  const shown = showGroup ? gv.merged : d;
  const results = useMemo(() => computeResults(shown), [shown]);
  const analysis = useMemo(() => analyze(shown, results), [shown, results]);
  const [tab, setTab] = useState<'score' | 'results' | 'setup'>(d.options.length && d.factors.length ? 'score' : 'setup');
  const [detail, setDetail] = useState<Target | null>(null);
  const [dialog, setDialog] = useState<null | 'share' | 'invite' | 'settings'>(null);
  const pugh = d.settings.mode === 'pugh';
  const lock = { structure: structureLocked(d), weights: weightsLocked(d) };

  const group = useMemo((): GroupCells | undefined => {
    if (!showGroup) return undefined;
    const cells = new Map(gv.result.cells.map((c) => [cellKey(c.optionId, c.factorId), c]));
    const weights = gv.result.weights && new Map(gv.result.weights.map((w) => [w.factorId, w]));
    let voters: Map<string, VoterValue[]> | undefined;
    if (d.group?.role === 'organizer') {
      // Who gave what, for the organizer's eyes only: names in named groups, numbers otherwise.
      voters = new Map();
      const g = d.group;
      const own = g.includeOwn ? [{ label: t('ballots.you'), cells: pugh ? d.pugh : d.scores }] : [];
      const others = g.ballots.flatMap((b, i) => (b.included ? [{ label: ballotLabel(d, b, i), cells: pugh ? b.pugh : b.scores }] : []));
      for (const { label, cells: list } of [...own, ...others]) {
        for (const s of list) {
          const key = cellKey(s.optionId, s.factorId);
          voters.set(key, [...(voters.get(key) ?? []), { label, value: s.value }]);
        }
      }
    }
    return { cells, ...(weights && { weights }), ...(voters && { voters }) };
  }, [showGroup, gv, d, pugh]);

  const exportCsv = () => {
    const totals = new Map(results.ranking.map((r) => [r.optionId, pugh ? r.total : Math.round(r.percent * 10) / 10]));
    const csv = toCSV(shown, totals, { factor: t('grid.factors'), weight: t('grid.importance'), total: pugh ? t('csv.total') : t('csv.percent') });
    downloadText(csv, `${safeFileName(d.title, 'decision')}.csv`, 'text/csv');
  };

  const matrixProps = { d: shown, results, readOnly: readOnly || showGroup, uiLang, onEdit, onDetail: setDetail, lock, ...(group && { group }) };
  const modeLine = pugh ? t('mode.pugh', { steps: d.settings.pughSteps === 2 ? '−− − S + ++' : '− S +' }) : t('mode.weighted', { max: d.settings.scaleMax });

  const resultsPanel = <ResultsPanel d={shown} results={results} analysis={analysis} uiLang={uiLang} {...(showGroup && { group: gv.result })} />;
  const ballotsPanel =
    role === 'organizer' && !readOnly ? (
      <BallotsPanel d={d} voters={groupVoters(d).length} onEdit={onEdit} onInvite={() => setDialog('invite')} onOpenBallots={() => onOpenBallots?.()} />
    ) : null;

  return (
    <div className="decision">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label={t('decision.back')}>
          <Icon name="back" />
        </button>
        <input
          className="title-input"
          value={d.title}
          placeholder={t('decision.titlePlaceholder')}
          dir="auto"
          lang={d.lang}
          maxLength={200}
          readOnly={readOnly || lock.structure}
          aria-label={t('decision.title')}
          onChange={(e) => onEdit(setTitle(e.target.value))}
          onBlur={() => onEdit(tidyNames)}
        />
        {!readOnly && (
          <>
            {role !== 'participant' && (
              <button className="button" onClick={() => setDialog('share')}>
                <Icon name="share" size={18} />
                <span className="hide-narrow">{t('decision.share')}</span>
              </button>
            )}
            <Menu
              label={t('decision.more')}
              items={[
                { label: t('settings.title'), icon: 'template', onSelect: () => setDialog('settings') },
                { label: t('ballots.open'), icon: 'file', onSelect: () => onOpenBallots?.(), hidden: role !== 'organizer' },
                { label: t('decision.exportCsv'), icon: 'table', onSelect: exportCsv },
                { label: t('decision.backup'), icon: 'download', onSelect: onBackup },
                { label: t('decision.duplicate'), icon: 'file', onSelect: onDuplicate },
                { label: t('decision.delete'), icon: 'trash', onSelect: onDelete, danger: true },
              ]}
            />
          </>
        )}
      </header>

      {incoming && <IncomingBanner incoming={incoming} title={d.title || t('decision.untitled')} />}
      {!readOnly && role === 'participant' && <ParticipantBar d={d} onSend={() => setDialog('share')} onEdit={onEdit} />}

      <div className="modebar">
        <span>{modeLine}</span>
        {!readOnly && !scoringLocked(d) && (
          <button className="link-button small" onClick={() => setDialog('settings')}>
            {t('decision.changeScoring')}
          </button>
        )}
        {gv && !onlyGroup && (
          <Segmented
            value={view}
            label={t('group.view')}
            onChange={setView}
            options={[
              { value: 'mine', label: role === 'organizer' || role === 'participant' ? t('group.mine') : t('group.scores') },
              { value: 'group', label: t('group.groupN', { count: gv.result.ballots }) },
            ]}
          />
        )}
        {onlyGroup && <span className="badge shared">{t('group.groupN', { count: gv.result.ballots })}</span>}
        {d.description && (
          <p className="description" dir="auto" lang={d.lang}>
            {d.description}
          </p>
        )}
      </div>

      {isPhone ? (
        <>
          <nav className="tabs" role="tablist">
            {(['score', 'results', 'setup'] as const).map((name) => (
              <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? 'on' : ''} onClick={() => setTab(name)}>
                {t(`tabs.${name}`)}
              </button>
            ))}
          </nav>
          <div className="phone-body">
            {tab === 'score' && <Cards {...matrixProps} />}
            {tab === 'results' && (
              <>
                {resultsPanel}
                {ballotsPanel}
              </>
            )}
            {tab === 'setup' && <Setup {...matrixProps} />}
          </div>
        </>
      ) : (
        <div className="decision-main">
          <Grid {...matrixProps} />
          <aside className="results-side">
            {resultsPanel}
            {ballotsPanel}
          </aside>
        </div>
      )}

      {detail && (
        <DetailDialog
          d={shown}
          target={detail}
          readOnly={readOnly || showGroup}
          uiLang={uiLang}
          onEdit={onEdit}
          onClose={() => setDetail(null)}
          lock={lock}
          {...(group && { group })}
        />
      )}
      {(dialog === 'share' || dialog === 'invite') && (
        <ShareDialog
          d={d}
          result={role === 'organizer' && gv ? gv.result : null}
          {...(dialog === 'invite' && { initial: 'invite' as const })}
          onEdit={onEdit}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'settings' && <SettingsDialog d={d} uiLang={uiLang} onEdit={onEdit} onClose={() => setDialog(null)} />}
    </div>
  );
}
