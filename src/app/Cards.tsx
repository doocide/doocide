// Phones: one factor at a time, every option on a slider. The layout of the original mobile app.

import { useMemo, useState } from 'react';
import { cellKey, cellValues } from '../engine';
import { formatNumber, t } from '../i18n';
import { formatValue } from './controls';
import { addFactor, addOption, renameFactor, renameOption, setRating, setScore, setWeight, tidyNames } from './edit';
import { ExternalLink } from './ExternalLink';
import { GroupValue, noteCounts, scoreLabel, type MatrixProps } from './Grid';
import { factorGuide, factorName, optionName } from './labels';
import { Icon, Stars } from './ui';

export function Cards({ d, results, readOnly, uiLang, onEdit, onDetail, lock, group }: MatrixProps) {
  const [index, setIndex] = useState(0);
  const values = useMemo(() => cellValues(d), [d]);
  const facts = useMemo(() => new Map(d.facts.map((f) => [cellKey(f.optionId, f.factorId), f])), [d.facts]);
  const notes = useMemo(() => noteCounts(d), [d]);
  const i = Math.min(index, Math.max(0, d.factors.length - 1));
  const f = d.factors[i];
  const pugh = d.settings.mode === 'pugh';

  if (!f || d.options.length === 0) return <p className="empty-hint">{t('cards.empty')}</p>;

  const lo = pugh ? -d.settings.pughSteps : 0;
  const hi = pugh ? d.settings.pughSteps : d.settings.scaleMax;
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
        {d.options.map((o) => {
          const key = cellKey(o.id, f.id);
          const value = values.get(key);
          const fact = facts.get(key);
          const count = notes.get(key) ?? 0;
          const optName = optionName(d, o, uiLang);
          const baseline = pugh && d.settings.baselineId === o.id;
          return (
            <li key={o.id} className={results.winnerId === o.id ? 'win' : ''}>
              <div className="row-head">
                <span className="name" dir="auto" lang={d.lang}>
                  {optName}
                </span>
                {group ? (
                  !baseline && <GroupValue d={d} cell={group.cells.get(key)} />
                ) : (
                  <span className={value === undefined && !baseline ? 'big-score empty' : 'big-score'}>{baseline ? '' : formatValue(d, value)}</span>
                )}
              </div>
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
                    aria-label={t('grid.cellLabel', { option: optName, factor: name })}
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
        })}
      </ul>

      <nav className="pager" aria-label={t('cards.pager')}>
        <button className="icon-button" disabled={i === 0} onClick={() => setIndex(i - 1)} aria-label={t('cards.previous')}>
          <Icon name="back" />
        </button>
        <span>
          {i + 1} / {d.factors.length}
        </span>
        <button className="icon-button" disabled={i >= d.factors.length - 1} onClick={() => setIndex(i + 1)} aria-label={t('cards.next')}>
          <Icon name="next" />
        </button>
      </nav>
    </div>
  );
}

/** Phones: add and rename options and factors. */
export function Setup({ d, results, readOnly, uiLang, onEdit, onDetail, lock }: MatrixProps) {
  const fixed = readOnly || Boolean(lock?.structure);
  return (
    <div className="setup">
      <section>
        <h2>{t('setup.options')}</h2>
        <ul className="setup-list">
          {d.options.map((o) => (
            <li key={o.id}>
              <input
                className="name-input"
                value={o.name}
                placeholder={optionName(d, o, uiLang)}
                dir="auto"
                lang={d.lang}
                maxLength={200}
                readOnly={fixed}
                aria-label={t('grid.optionName')}
                onChange={(e) => onEdit(renameOption(o.id, e.target.value))}
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
          <button className="button ghost" onClick={() => onEdit(addOption(''))}>
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
                <input
                  className="name-input"
                  value={f.name}
                  placeholder={name}
                  dir="auto"
                  lang={d.lang}
                  maxLength={200}
                  readOnly={fixed}
                  aria-label={t('grid.factorName')}
                  onChange={(e) => onEdit(renameFactor(f.id, e.target.value))}
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
          <button className="button ghost" onClick={() => onEdit(addFactor(''))}>
            <Icon name="plus" size={18} />
            {t('grid.addFactor')}
          </button>
        )}
      </section>
    </div>
  );
}
