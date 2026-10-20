// Paste a table from any spreadsheet app to start a decision.

import { useMemo, useState } from 'react';
import { emptyDecision } from '../format/create';
import { LIMITS } from '../format/limits';
import { parseTable, tableToDecision } from '../format/table';
import type { Decision } from '../format/types';
import { FormatError } from '../format/validate';
import { getLang, t } from '../i18n';
import { Dialog, Segmented } from './ui';

export function ImportDialog({ onCreate, onClose }: { onCreate: (d: Decision) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [optionsInColumns, setOptionsInColumns] = useState(true);
  const [title, setTitle] = useState('');

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const d = tableToDecision(parseTable(text), { optionsInColumns, scaleMax: 10 }, emptyDecision(getLang(), title));
      return { d, error: null };
    } catch (e) {
      return { d: null, error: e instanceof FormatError && e.code === 'too-big' ? t('import.tooBig') : t('import.unreadable') };
    }
  }, [text, optionsInColumns, title]);

  return (
    <Dialog title={t('import.title')} onClose={onClose} wide>
      <p className="muted">{t('import.help')}</p>
      <label className="field">
        <span className="field-label">{t('import.decisionTitle')}</span>
        <input value={title} dir="auto" maxLength={LIMITS.text.title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{t('import.table')}</span>
        <textarea className="mono" rows={8} value={text} maxLength={LIMITS.pastedTableChars} onChange={(e) => setText(e.target.value)} placeholder={t('import.placeholder')} />
      </label>
      <div className="field">
        <span className="field-label">{t('import.orientation')}</span>
        <Segmented
          value={optionsInColumns ? 'columns' : 'rows'}
          label={t('import.orientation')}
          onChange={(v) => setOptionsInColumns(v === 'columns')}
          options={[
            { value: 'columns', label: t('import.optionsInColumns') },
            { value: 'rows', label: t('import.optionsInRows') },
          ]}
        />
      </div>
      {preview?.error && <p className="callout warn">{preview.error}</p>}
      {preview?.d && (
        <p className="callout">
          {t('import.preview', { options: preview.d.options.length, factors: preview.d.factors.length })}{' '}
          {preview.d.scores.length ? t('import.cellsAreScores') : preview.d.facts.length ? t('import.cellsAreFacts') : ''}
        </p>
      )}
      <div className="actions">
        <button className="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="button primary" disabled={!preview?.d || preview.d.options.length === 0} onClick={() => preview?.d && onCreate(preview.d)}>
          {t('import.create')}
        </button>
      </div>
    </Dialog>
  );
}
