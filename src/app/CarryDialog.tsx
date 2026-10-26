// "Carry your scores over": copies this person's scores from another of their decisions, usually an
// earlier version, into this one. They see and change which old option or factor becomes which new
// one before anything happens, and the other decision stays as it is (see src/format/carry.ts).

import { useMemo, useState } from 'react';
import { carryScores, declarationsApply, earlierVersions, suggestMatches, type CarryChoice, type Match } from '../format/carry';
import type { Decision } from '../format/types';
import { formatDate, t } from '../i18n';
import { decisionTitle, factorName, optionName } from './labels';
import { Dialog, Icon } from './ui';

interface Props {
  target: Decision;
  /** This person's other decisions. */
  others: Decision[];
  /** The decision to start from, when the page suggested one. */
  initialSourceId?: string;
  uiLang: string;
  onCarry: (source: Decision, choice: CarryChoice, count: number) => void;
  onClose: () => void;
}

const somethingToCarry = (d: Decision) => d.scores.length + d.pugh.length > 0;

export function CarryDialog({ target, others, initialSourceId, uiLang, onCarry, onClose }: Props) {
  // Likely earlier versions first, then any other decision with scores, newest first.
  const sources = useMemo(() => {
    const earlier = earlierVersions(target, others);
    const likely = new Set(earlier.map((e) => e.id));
    const byId = new Map(others.map((d) => [d.id, d]));
    const rest = others.filter((d) => !likely.has(d.id) && d.id !== target.id && somethingToCarry(d)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return [...earlier.map((e) => ({ d: byId.get(e.id)!, likely: true })), ...rest.map((d) => ({ d, likely: false }))];
  }, [target, others]);
  const [sourceId, setSourceId] = useState(initialSourceId ?? sources[0]?.d.id ?? '');
  const source = sources.find((s) => s.d.id === sourceId)?.d;

  return (
    <Dialog title={t('carry.title')} onClose={onClose} wide>
      <p className="muted small">{t('carry.intro')}</p>
      {sources.length === 0 ? (
        <>
          <p className="callout small">{t('carry.none')}</p>
          <div className="actions">
            <button className="button" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">{t('carry.from')}</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map(({ d, likely }) => (
                <option key={d.id} value={d.id}>
                  {decisionTitle(d)} · {formatDate(d.updatedAt)}
                  {likely ? ` · ${t('carry.likely')}` : ''}
                </option>
              ))}
            </select>
          </label>
          {source && <Mapping key={source.id} source={source} target={target} uiLang={uiLang} onCarry={onCarry} onCancel={onClose} />}
        </>
      )}
    </Dialog>
  );
}

const asRecord = (matches: Match[]) => Object.fromEntries(matches.map((m) => [m.from, m.to]));

/** One old item and where it goes. The badge says why it was suggested, or what to check. */
function Row({
  name,
  lang,
  value,
  targets,
  match,
  onChange,
}: {
  name: string;
  lang: string;
  value: string | null;
  targets: { id: string; label: string }[];
  match: Match;
  onChange: (to: string | null) => void;
}) {
  const suggested = value !== null && value === match.to && match.reason;
  const flagged = value === null && match.flag;
  return (
    <li className="carry-row">
      <bdi className="carry-from" dir="auto" lang={lang}>
        {name}
      </bdi>
      <Icon name="next" size={14} />
      <div className="carry-to">
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={t('carry.into', { name })}>
          <option value="">{t('carry.dontCarry')}</option>
          {targets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        {suggested && <span className="badge">{t(`carry.reason.${match.reason}`)}</span>}
        {flagged && <span className="badge warn">{t(`carry.flag.${match.flag}`)}</span>}
      </div>
    </li>
  );
}

function Mapping({ source, target, uiLang, onCarry, onCancel }: { source: Decision; target: Decision; uiLang: string; onCarry: Props['onCarry']; onCancel: () => void }) {
  const declared = declarationsApply(source, target);
  const optionMatches = useMemo(() => suggestMatches(source.options, target.options, declared), [source, target, declared]);
  const factorMatches = useMemo(() => suggestMatches(source.factors, target.factors, declared), [source, target, declared]);
  const [options, setOptions] = useState<Record<string, string | null>>(() => asRecord(optionMatches));
  const [factors, setFactors] = useState<Record<string, string | null>>(() => asRecord(factorMatches));
  const [importance, setImportance] = useState(true);
  const [notes, setNotes] = useState(true);
  // Factors are often many and all matched: shown when something there needs a look.
  const [showFactors, setShowFactors] = useState(() => factorMatches.some((m) => m.to === null));

  const choice: CarryChoice = { options, factors, importance, notes };
  const preview = useMemo(() => carryScores(source, target, { options, factors, importance, notes }, () => 'preview'), [source, target, options, factors, importance, notes]);

  /** One new item takes one old item: picking one already taken frees it from the other. */
  const pick = (set: typeof setOptions) => (fromId: string, to: string | null) =>
    set((prev) => Object.fromEntries(Object.entries({ ...prev, [fromId]: to }).map(([k, v]) => [k, k !== fromId && v === to && to !== null ? null : v])));

  const optionTargets = target.options.map((o) => ({ id: o.id, label: optionName(target, o, uiLang) }));
  const factorTargets = target.factors.map((f) => ({ id: f.id, label: factorName(target, f, uiLang) }));
  const matchedFactors = Object.values(factors).filter(Boolean).length;
  const filledOptions = new Set(Object.values(options));
  const empty = target.options.filter((o) => !filledOptions.has(o.id)).map((o) => optionName(target, o, uiLang));
  const title = decisionTitle(source);
  const anything = preview.scores + preview.notes + preview.weights > 0;

  return (
    <>
      <section className="carry-section" aria-labelledby="carry-options">
        <h3 id="carry-options">{t('carry.options')}</h3>
        <ul className="carry-list">
          {source.options.map((o, i) => (
            <Row
              key={o.id}
              name={optionName(source, o, uiLang)}
              lang={source.lang}
              value={options[o.id] ?? null}
              targets={optionTargets}
              match={optionMatches[i]!}
              onChange={(to) => pick(setOptions)(o.id, to)}
            />
          ))}
        </ul>
      </section>
      <section className="carry-section" aria-labelledby="carry-factors">
        <div className="carry-head">
          <h3 id="carry-factors">{t('carry.factorsMatched', { matched: matchedFactors, total: source.factors.length })}</h3>
          <button className="link-button small" onClick={() => setShowFactors(!showFactors)} aria-expanded={showFactors}>
            {showFactors ? t('carry.hideFactors') : t('carry.showFactors')}
          </button>
        </div>
        {showFactors && (
          <ul className="carry-list">
            {source.factors.map((f, i) => (
              <Row
                key={f.id}
                name={factorName(source, f, uiLang)}
                lang={source.lang}
                value={factors[f.id] ?? null}
                targets={factorTargets}
                match={factorMatches[i]!}
                onChange={(to) => pick(setFactors)(f.id, to)}
              />
            ))}
          </ul>
        )}
      </section>
      <div className="carry-options">
        <label className="check">
          <input type="checkbox" checked={importance} onChange={(e) => setImportance(e.target.checked)} />
          {t('carry.importance')}
        </label>
        <label className="check">
          <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
          {t('carry.notes')}
        </label>
      </div>
      <ul className="carry-summary small">
        <li>{t('carry.willCarry', { count: preview.scores })}</li>
        {preview.kept > 0 && <li>{t('carry.kept', { count: preview.kept })}</li>}
        {preview.left > 0 && <li>{t('carry.left', { count: preview.left, title })}</li>}
        {preview.ratingsLeft > 0 && <li>{t('carry.ratingsLeft', { count: preview.ratingsLeft })}</li>}
        {preview.rescaled && <li>{t('carry.rescaled', { from: source.settings.scaleMax, to: target.settings.scaleMax })}</li>}
        {notes && preview.notes > 0 && <li>{t('carry.notesCount', { count: preview.notes })}</li>}
        {empty.length > 0 && <li>{t('carry.newEmpty', { count: empty.length, names: empty.join(', ') })}</li>}
        <li>{t('carry.sourceStays', { title })}</li>
      </ul>
      <div className="actions">
        <button className="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="button primary" disabled={!anything} onClick={() => onCarry(source, choice, preview.scores)}>
          {t('carry.carry')}
        </button>
      </div>
    </>
  );
}
