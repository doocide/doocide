// The organizer picks what they selected (the projects that get funded, say) and Doocide drafts what
// the ballots say about it, in the language their readers need. They edit it, copy it, and can add it
// to the group results, which every results share then carries.

import { useEffect, useMemo, useState } from 'react';
import { computeResults, groupView, selectionFacts } from '../engine';
import type { Decision } from '../format/types';
import { formatDate, formatNumber, getLang, t, translatorFor, useLang } from '../i18n';
import { UI_LANGUAGES, isUiLanguage } from '../i18n/languages';
import type { Translator } from '../i18n/translator';
import { setSummary, type Edit } from './edit';
import { copyText } from './files';
import { optionName } from './labels';
import { draftSummary } from './selectionText';
import { Dialog, Icon, useConfirm, useToast } from './ui';
import { LIMITS } from '../format/limits';

export function SummaryDialog({ d, onEdit, onClose }: { d: Decision; onEdit: (e: Edit) => void; onClose: () => void }) {
  const uiLang = useLang();
  const toast = useToast();
  const ask = useConfirm();
  const saved = d.group?.summary;
  const view = useMemo(() => groupView(d), [d]);
  const results = useMemo(() => (view ? computeResults(view.merged) : null), [view]);
  const [selected, setSelected] = useState<string[]>(saved?.selected ?? []);
  const [compare, setCompare] = useState(saved?.compare ?? true);
  // The readers' language: what it was saved in, else the decision's own language when Doocide speaks it.
  const [lang, setLang] = useState(saved?.lang ?? (isUiLanguage(d.lang) ? d.lang : getLang()));
  const [tr, setTr] = useState<Translator | null>(null);
  const [langFailed, setLangFailed] = useState(false);
  const [text, setText] = useState(saved?.text ?? '');
  // A saved or hand-edited text is never replaced silently: "Redraft" does that, on purpose.
  const [edited, setEdited] = useState(Boolean(saved));

  useEffect(() => {
    let live = true;
    translatorFor(lang).then((x) => {
      if (!live) return;
      setTr(x);
      setLangFailed(!x);
    });
    return () => {
      live = false;
    };
  }, [lang]);

  const draft = useMemo(() => {
    if (!tr || selected.length === 0) return '';
    const facts = selectionFacts(d, selected);
    return facts ? draftSummary(facts, d, { compare, tr }) : '';
  }, [tr, selected, compare, d]);

  useEffect(() => {
    if (!edited) setText(draft);
  }, [draft, edited]);

  if (!view || !results) return null;
  const pugh = d.settings.mode === 'pugh';
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const stale = edited && draft !== '' && text !== draft;

  const redraft = async () => {
    if (text.trim() && text !== draft) {
      const ok = await ask({ title: t('summary.redraft'), message: t('summary.confirmRedraft'), confirmLabel: t('summary.redraft') });
      if (!ok) return;
    }
    setEdited(false);
    setText(draft);
  };

  const save = () => {
    onEdit(setSummary({ text, selected, compare, ballots: view.result.ballots, at: new Date().toISOString(), lang }));
    toast(t('summary.savedToast'));
  };

  return (
    <Dialog title={t('summary.dialogTitle')} onClose={onClose} wide>
      <p className="muted small">{t('summary.intro')}</p>
      <fieldset className="field">
        <legend className="field-label">{t('summary.pick')}</legend>
        <ul className="summary-pick">
          {results.ranking.map((r) => {
            const o = d.options.find((x) => x.id === r.optionId);
            if (!o) return null;
            return (
              <li key={o.id}>
                <label className="check">
                  <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                  <span className="muted small">#{r.rank}</span>
                  <bdi lang={d.lang}>{optionName(d, o, uiLang)}</bdi>
                  <span className="muted small">{pugh ? formatNumber(r.total, 1) : `${formatNumber(r.percent, 1)}%`}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="summary-options">
        <label className="check">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          {t('summary.compare')}
        </label>
        <label className="summary-lang">
          <span>{t('summary.language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {langFailed && <p className="callout warn small">{t('common.languageFailed')}</p>}
      <label className="field">
        <span className="field-label">{t('summary.draft')}</span>
        <textarea
          className="summary-text"
          rows={14}
          value={text}
          dir="auto"
          lang={lang}
          maxLength={LIMITS.text.summary}
          placeholder={t('summary.empty')}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
        />
        <span className="muted small">{t('summary.note')}</span>
      </label>
      {stale && <p className="callout small">{t('summary.notRedrafted')}</p>}
      {saved && (
        <p className="muted small">
          <Icon name="check" size={12} /> {t('summary.savedAt', { date: formatDate(saved.at), count: saved.ballots })}
        </p>
      )}
      <div className="actions">
        {stale && (
          <button className="button" onClick={redraft}>
            <Icon name="refresh" size={18} />
            {t('summary.redraft')}
          </button>
        )}
        {saved && (
          <button
            className="button danger"
            onClick={() => {
              onEdit(setSummary(null));
              toast(t('summary.removedToast'));
            }}
          >
            {t('summary.remove')}
          </button>
        )}
        <button className="button" disabled={!text.trim()} onClick={async () => toast((await copyText(text)) ? t('summary.copied') : t('share.copyFailed'))}>
          {t('summary.copy')}
        </button>
        <button className="button primary" disabled={!text.trim() || selected.length === 0} onClick={save}>
          {saved ? t('summary.update') : t('summary.save')}
        </button>
      </div>
    </Dialog>
  );
}
