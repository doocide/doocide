// Phones: score one factor at a time with every option on a slider (the layout of the original
// mobile app), or, when the decision shows options as rows, one option at a time with every factor.

import { useMemo, useState, type ReactNode } from 'react';
import { cellKey, cellValues } from '../engine';
import type { Decision, Factor, Option } from '../format/types';
import { formatNumber, t } from '../i18n';
import { NameField, formatValue, useFocusNew } from './controls';
import { addFactor, addOption, renameFactor, renameOption, setRating, setScore, setWeight, tidyNames } from './edit';
import { ExternalLink } from './ExternalLink';
import { GroupValue, noteCounts, scoreLabel, type MatrixProps } from './Grid';
import { factorGuide, factorName, optionName } from './labels';
import { Icon, Stars } from './ui';

/** One option on one factor as a slider row: its name, its score, the fact behind it and its notes. */
function ScoreRow({ p, o, f, name, extra }: { p: MatrixProps & Lookups; o: Option; f: Factor; name: string; extra?: ReactNode }) {
  const { d, readOnly, onEdit, onDetail, group, uiLang } = p;
  const pugh = d.settings.mode === 'pugh';
  const lo = pugh ? -d.settings.pughSteps : 0;
  const hi = pugh ? d.settings.pughSteps : d.settings.scaleMax;
  const key = cellKey(o.id, f.id);
  const value = p.values.get(key);
  const fact = p.facts.get(key);
  const count = p.notes.get(key) ?? 0;
  const baseline = pugh && d.settings.baselineId === o.id;
  return (
    <li className={p.results.winnerId === o.id && d.settings.rows !== 'options' ? 'win' : ''}>
      <div className="row-head">
        <span className="name" dir="auto" lang={d.lang}>
          {name}
        </span>
        {group ? (
          !baseline && <GroupValue d={d} cell={group.cells.get(key)} />
        ) : (
          <span className={value === undefined && !baseline ? 'big-score empty' : 'big-score'}>{baseline ? '' : formatValue(d, value)}</span>
        )}
      </div>
      {extra}
      {baseline ? (
        <div className="muted small">{t('pugh.baselineCell')}</div>
      ) : group ? null : (
        <label className="slider-row">
          <span>{t('cards.worse')}</span>
          <input
            type="range"
            min={lo}
            max={hi}
            step={1}
            value={value ?? (pugh ? 0 : lo)}
            className={value === undefined ? 'unset' : ''}
            disabled={readOnly}
            aria-label={t('grid.cellLabel', { option: optionName(d, o, uiLang), factor: factorName(d, f, uiLang) })}
            onChange={(e) => {
              const v = Number(e.target.value);
              onEdit(pugh ? setRating(o.id, f.id, v) : setScore(o.id, f.id, v));
            }}
          />
          <span>{t('cards.better')}</span>
        </label>
      )}
      {fact && (
        <div className="fact" dir="auto" lang={d.lang}>
          {fact.text}
          {fact.url && <ExternalLink url={fact.url} />}
        </div>
      )}
      <button className="link-button small" onClick={() => onDetail({ optionId: o.id, factorId: f.id })}>
        <Icon name="note" size={14} />
        {count > 0 ? t('cards.notesCount', { count }) : t('cards.details')}
      </button>
    </li>
  );
}

interface Lookups {
  values: Map<string, number>;
  facts: Map<string, Decision['facts'][number]>;
  notes: Map<string, number>;
}

function useLookups(d: Decision): Lookups {
  const values = useMemo(() => cellValues(d), [d]);
  const facts = useMemo(() => new Map(d.facts.map((f) => [cellKey(f.optionId, f.factorId), f])), [d.facts]);
  const notes = useMemo(() => noteCounts(d), [d]);
  return { values, facts, notes };
}

function Pager({ i, total, label, previous, next, onMove }: { i: number; total: number; label: string; previous: string; next: string; onMove: (i: number) => void }) {
  return (
    <nav className="pager" aria-label={label}>
      <button className="icon-button" disabled={i === 0} onClick={() => onMove(i - 1)} aria-label={previous}>
        <Icon name="back" />
      </button>
      <span>
        {i + 1} / {total}
      </span>
      <button className="icon-button" disabled={i >= total - 1} onClick={() => onMove(i + 1)} aria-label={next}>
        <Icon name="next" />
      </button>
    </nav>
  );
}

/** One factor at a time: its importance on a slider, then every option. */
function FactorCards(props: MatrixProps) {
  const { d, readOnly, uiLang, onEdit, lock, group } = props;
  const [index, setIndex] = useState(0);
  const lookups = useLookups(d);
  const i = Math.min(index, Math.max(0, d.factors.length - 1));
  const f = d.factors[i];

  if (!f || d.options.length === 0) return <p className="empty-hint">{t('cards.empty')}</p>;

  const name = factorName(d, f, uiLang);
  const guide = factorGuide(d, f, uiLang);

  return (
    <div className="cards">
      <section className="factor-card">
        <div className="eyebrow">{t('cards.factorOf', { n: i + 1, total: d.factors.length })}</div>
        <h2 dir="auto" lang={d.lang}>
          {name}
        </h2>
        {guide && (
          <p className="guide" dir="auto" lang={d.lang}>
            {guide}
          </p>
        )}
        <label className="slider-row">
          <span>{t('cards.leastImportant')}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={Math.round(f.weight)}
            disabled={readOnly || Boolean(lock?.weights)}
            aria-label={t('grid.importanceOf', { name })}
            onChange={(e) => onEdit(setWeight(f.id, Number(e.target.value)))}
          />
          <span>{t('cards.veryImportant')}</span>
        </label>
        <div className="weight-name">
          {t(`weight.${Math.round(f.weight)}`)}
          {group?.weights?.has(f.id) && <span className="muted small"> · {t('group.weightAverage', { value: formatNumber(f.weight, 1) })}</span>}
        </div>
      </section>

      <ul className="option-sliders">
        {d.options.map((o) => (
          <ScoreRow key={o.id} p={{ ...props, ...lookups }} o={o} f={f} name={optionName(d, o, uiLang)} />
        ))}
      </ul>

      <Pager i={i} total={d.factors.length} label={t('cards.pager')} previous={t('cards.previous')} next={t('cards.next')} onMove={setIndex} />
    </div>
  );
}

/** One option at a time: its rank and score, then every factor with its importance. */
function OptionCards(props: MatrixProps) {
  const { d, results, readOnly, uiLang, onEdit, lock, group } = props;
  const [index, setIndex] = useState(0);
  const lookups = useLookups(d);
  const i = Math.min(index, Math.max(0, d.options.length - 1));
  const o = d.options[i];

  if (!o || d.factors.length === 0) return <p className="empty-hint">{t('cards.empty')}</p>;

  const r = results.byOption.get(o.id);
  const win = results.winnerId === o.id;
  const ranked = r && lookups.values.size > 0 && !results.needsBaseline;

  return (
    <div className="cards">
      <section className={win ? 'factor-card option-card win' : 'factor-card option-card'}>
        <div className="eyebrow">{t('cards.optionOf', { n: i + 1, total: d.options.length })}</div>
        <h2 dir="auto" lang={d.lang}>
          {optionName(d, o, uiLang)}
        </h2>
        {o.description && (
          <p className="guide" dir="auto" lang={d.lang}>
            {o.description}
          </p>
        )}
        {ranked && (
          <div className="weight-name">
            #{r.rank} · {scoreLabel(d, results, o.id)} {win && <Icon name="trophy" size={16} />}
          </div>
        )}
      </section>

      <ul className="option-sliders">
        {d.factors.map((f) => {
          const name = factorName(d, f, uiLang);
          const guide = factorGuide(d, f, uiLang);
          const extra = (
            <div className="factor-extra">
              {guide && (
                <div className="guide" dir="auto" lang={d.lang}>
                  {guide}
                </div>
              )}
              <Stars
                value={Math.round(f.weight)}
                readOnly={readOnly || Boolean(lock?.weights)}
                label={t('grid.importanceOf', { name })}
                onChange={(w) => onEdit(setWeight(f.id, w))}
              />
              {group?.weights?.has(f.id) && <span className="muted small"> {t('group.weightAverage', { value: formatNumber(f.weight, 1) })}</span>}
            </div>
          );
          return <ScoreRow key={f.id} p={{ ...props, ...lookups }} o={o} f={f} name={name} extra={extra} />;
        })}
      </ul>

      <Pager i={i} total={d.options.length} label={t('cards.optionPager')} previous={t('cards.previousOption')} next={t('cards.nextOption')} onMove={setIndex} />
    </div>
  );
}

export function Cards(props: MatrixProps) {
  return props.d.settings.rows === 'options' ? <OptionCards {...props} /> : <FactorCards {...props} />;
}

/** Phones: add and rename options and factors. */
export function Setup({ d, results, readOnly, uiLang, onEdit, onDetail, lock }: MatrixProps) {
  const fixed = readOnly || Boolean(lock?.structure);
  const { focusId, nextId } = useFocusNew();
  return (
    <div className="setup">
      <section>
        <h2>{t('setup.options')}</h2>
        <ul className="setup-list">
          {d.options.map((o) => (
            <li key={o.id}>
              <NameField
                value={o.name}
                placeholder={optionName(d, o, uiLang)}
                lang={d.lang}
                readOnly={fixed}
                label={t('grid.optionName')}
                autoFocus={focusId === o.id}
                onChange={(v) => onEdit(renameOption(o.id, v))}
                onBlur={() => onEdit(tidyNames)}
              />
              <span className="muted small">{results.byOption.has(o.id) ? scoreLabel(d, results, o.id) : ''}</span>
              <button className="icon-button small" onClick={() => onDetail({ optionId: o.id })} aria-label={t('grid.optionDetails', { name: optionName(d, o, uiLang) })}>
                <Icon name="more" size={16} />
              </button>
            </li>
          ))}
        </ul>
        {!fixed && (
          <button className="button ghost" onClick={() => onEdit(addOption('', nextId()))}>
            <Icon name="plus" size={18} />
            {t('grid.addOption')}
          </button>
        )}
      </section>
      <section>
        <h2>{t('setup.factors')}</h2>
        <ul className="setup-list">
          {d.factors.map((f) => {
            const name = factorName(d, f, uiLang);
            return (
              <li key={f.id}>
                <NameField
                  value={f.name}
                  placeholder={name}
                  lang={d.lang}
                  readOnly={fixed}
                  label={t('grid.factorName')}
                  autoFocus={focusId === f.id}
                  onChange={(v) => onEdit(renameFactor(f.id, v))}
                  onBlur={() => onEdit(tidyNames)}
                />
                <Stars value={Math.round(f.weight)} readOnly={readOnly || Boolean(lock?.weights)} label={t('grid.importanceOf', { name })} onChange={(w) => onEdit(setWeight(f.id, w))} />
                <button className="icon-button small" onClick={() => onDetail({ factorId: f.id })} aria-label={t('grid.factorDetails', { name })}>
                  <Icon name="more" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
        {!fixed && (
          <button className="button ghost" onClick={() => onEdit(addFactor('', nextId()))}>
            <Icon name="plus" size={18} />
            {t('grid.addFactor')}
          </button>
        )}
      </section>
    </div>
  );
}
