import { useMemo, useState } from 'react';
import { analyze, computeResults } from '../engine';
import { toCSV } from '../format/table';
import type { Decision, Kind } from '../format/types';
import { t, useLang } from '../i18n';
import { Cards, Setup } from './Cards';
import { DetailDialog } from './DetailDialog';
import { setTitle, tidyNames, type Edit, type Target } from './edit';
import { downloadText, safeFileName } from './files';
import { Grid } from './Grid';
import { ResultsPanel } from './ResultsPanel';
import { SettingsDialog } from './SettingsDialog';
import { ShareDialog } from './ShareDialog';
import { Icon, Menu, useMediaQuery } from './ui';

export interface Incoming {
  kind: Kind;
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
}

function IncomingBanner({ incoming, title }: { incoming: Incoming; title: string }) {
  const { kind } = incoming;
  return (
    <div className="incoming" role="region" aria-label={t('incoming.label')}>
      <Icon name={kind === 'backup' ? 'file' : 'shield'} />
      <p>
        {kind === 'template' && t('incoming.template', { title })}
        {kind === 'decision' && t('incoming.decision')}
        {kind === 'backup' && t('incoming.backup')}
      </p>
      <div className="actions">
        <button className="button" onClick={incoming.onDiscard}>
          {t('incoming.discard')}
        </button>
        <button className="button primary" onClick={incoming.onSave}>
          {kind === 'template' ? t('incoming.useTemplate') : kind === 'backup' ? t('incoming.restore') : t('incoming.save')}
        </button>
      </div>
    </div>
  );
}

export function DecisionView({ d, incoming, onEdit, onBack, onBackup, onDuplicate, onDelete }: Props) {
  const uiLang = useLang();
  const isPhone = useMediaQuery('(max-width: 760px)');
  const readOnly = Boolean(incoming);
  const results = useMemo(() => computeResults(d), [d]);
  const analysis = useMemo(() => analyze(d, results), [d, results]);
  const [tab, setTab] = useState<'score' | 'results' | 'setup'>(d.options.length && d.factors.length ? 'score' : 'setup');
  const [detail, setDetail] = useState<Target | null>(null);
  const [dialog, setDialog] = useState<null | 'share' | 'settings'>(null);
  const pugh = d.settings.mode === 'pugh';

  const exportCsv = () => {
    const totals = new Map(results.ranking.map((r) => [r.optionId, pugh ? r.total : Math.round(r.percent * 10) / 10]));
    const csv = toCSV(d, totals, { factor: t('grid.factors'), weight: t('grid.importance'), total: pugh ? t('csv.total') : t('csv.percent') });
    downloadText(csv, `${safeFileName(d.title, 'decision')}.csv`, 'text/csv');
  };

  const matrixProps = { d, results, readOnly, uiLang, onEdit, onDetail: setDetail };
  const modeLine = pugh ? t('mode.pugh', { steps: d.settings.pughSteps === 2 ? '−− − S + ++' : '− S +' }) : t('mode.weighted', { max: d.settings.scaleMax });

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
          readOnly={readOnly}
          aria-label={t('decision.title')}
          onChange={(e) => onEdit(setTitle(e.target.value))}
          onBlur={() => onEdit(tidyNames)}
        />
        {!readOnly && (
          <>
            <button className="button" onClick={() => setDialog('share')}>
              <Icon name="share" size={18} />
              <span className="hide-narrow">{t('decision.share')}</span>
            </button>
            <Menu
              label={t('decision.more')}
              items={[
                { label: t('settings.title'), icon: 'template', onSelect: () => setDialog('settings') },
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

      <div className="modebar">
        <span>{modeLine}</span>
        {!readOnly && (
          <button className="link-button small" onClick={() => setDialog('settings')}>
            {t('decision.changeScoring')}
          </button>
        )}
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
            {tab === 'results' && <ResultsPanel d={d} results={results} analysis={analysis} uiLang={uiLang} />}
            {tab === 'setup' && <Setup {...matrixProps} />}
          </div>
        </>
      ) : (
        <div className="decision-main">
          <Grid {...matrixProps} />
          <aside className="results-side">
            <ResultsPanel d={d} results={results} analysis={analysis} uiLang={uiLang} />
          </aside>
        </div>
      )}

      {detail && <DetailDialog d={d} target={detail} readOnly={readOnly} uiLang={uiLang} onEdit={onEdit} onClose={() => setDetail(null)} />}
      {dialog === 'share' && <ShareDialog d={d} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog d={d} uiLang={uiLang} onEdit={onEdit} onClose={() => setDialog(null)} />}
    </div>
  );
}
