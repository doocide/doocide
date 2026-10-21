// Desktop and tablet: the StudentGrader-style matrix. Factors as rows, options as columns,
// factor names and option headers pinned while scrolling.

import { useMemo, type CSSProperties } from 'react';
import { cellKey, cellValues, spreadLevel, type Results } from '../engine';
import type { CellResult, Decision, WeightResult } from '../format/types';
import { formatNumber, t } from '../i18n';
import { PughInput, ScoreInput, formatValue, heat } from './controls';
import { addFactor, addOption, renameFactor, renameOption, setRating, setScore, setWeight, tidyNames, type Edit, type Target } from './edit';
import { ExternalLink } from './ExternalLink';
import { factorGuide, factorName, optionName } from './labels';
import { Icon, Stars } from './ui';

/** What can't be changed even when the decision is editable: a participant's copy belongs to the organizer. */
export interface Lock {
  structure: boolean;
  weights: boolean;
}

/** One person's value on a cell, for the organizer's view of how the group scored it. */
export interface VoterValue {
  label: string;
  value: number;
}

/** The group's combined values, shown instead of anyone's own scores. */
export interface GroupCells {
  cells: Map<string, CellResult>;
  weights?: Map<string, WeightResult>;
  /** Organizer only: each ballot's value per cell. */
  voters?: Map<string, VoterValue[]>;
}

export interface MatrixProps {
  d: Decision;
  results: Results;
  readOnly: boolean;
  uiLang: string;
  onEdit: (edit: Edit) => void;
  onDetail: (target: Target) => void;
  lock?: Lock;
  group?: GroupCells;
}

/** A combined value: one decimal, and a sign for Pugh ratings. */
export function formatGroupValue(d: Decision, v: number): string {
  if (d.settings.mode !== 'pugh') return formatNumber(v, 1);
  const n = Math.round(v * 10) / 10;
  return n === 0 ? 'S' : `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n), 1)}`;
}

/** The group's value for a cell, with the range of the ballots when they differ. */
export function GroupValue({ d, cell }: { d: Decision; cell: CellResult | undefined }) {
  if (!cell) return <span className="group-value empty">–</span>;
  return (
    <span className="group-value">
      <strong>{formatGroupValue(d, cell.value)}</strong>
      {cell.n > 1 && cell.low !== cell.high && (
        <span className="range" title={t('group.rangeTitle', { count: cell.n })}>
          {formatValue(d, cell.low)}–{formatValue(d, cell.high)}
        </span>
      )}
    </span>
  );
}

export function noteCounts(d: Decision): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of d.notes) {
    const key = `${n.optionId ?? ''} ${n.factorId ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The three StudentGrader summary rows for an option, plus how full each row's color is (0..1).
 * weighted: score on the decision's scale, percent, weighted points (like grade, %, points).
 * pugh: net rating, better/same/worse counts, percent of the best possible.
 */
export function summaryRows(d: Decision, results: Results, optionId: string): { rows: [string, string, string]; fill: number } {
  const r = results.byOption.get(optionId);
  if (!r || results.needsBaseline) return { rows: ['–', '–', '–'], fill: 0 };
  if (d.settings.mode === 'pugh') {
    const sign = (n: number) => `${n > 0 ? '+' : ''}${formatNumber(n)}`;
    const counts = r.isBaseline ? '–' : `+${r.better ?? 0} S${r.same ?? 0} −${r.worse ?? 0}`;
    return { rows: [sign(r.total), counts, `${sign(Math.round(r.percent))}%`], fill: (r.percent + 100) / 200 };
  }
  return {
    rows: [formatNumber((r.percent / 100) * d.settings.scaleMax, 1), `${formatNumber(r.percent, 1)}%`, formatNumber(r.total, 1)],
    fill: r.percent / 100,
  };
}

export function scoreLabel(d: Decision, results: Results, optionId: string): string {
  const r = results.byOption.get(optionId);
  if (!r) return '';
  if (d.settings.mode !== 'pugh') return `${formatNumber(r.percent, 1)}%`;
  if (r.isBaseline) return t('pugh.baseline');
  return `${r.total > 0 ? '+' : ''}${formatNumber(r.total)}`;
}

export function Grid({ d, results, readOnly, uiLang, onEdit, onDetail, lock, group }: MatrixProps) {
  const values = useMemo(() => cellValues(d), [d]);
  const fixed = readOnly || Boolean(lock?.structure);
  const facts = useMemo(() => new Map(d.facts.map((f) => [cellKey(f.optionId, f.factorId), f])), [d.facts]);
  const notes = useMemo(() => noteCounts(d), [d]);
  const pugh = d.settings.mode === 'pugh';
  const scored = values.size > 0;

  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="col-factor corner" scope="col">
              <div className="head-label">{t('grid.factors')}</div>
            </th>
            <th className="col-weight corner" scope="col">
              <div className="head-label">{t('grid.importance')}</div>
            </th>
            {d.options.map((o) => {
              const r = results.byOption.get(o.id);
              const win = results.winnerId === o.id;
              const baseline = pugh && d.settings.baselineId === o.id;
              const name = optionName(d, o, uiLang);
              const count = notes.get(`${o.id} `) ?? 0;
              const { rows, fill } = summaryRows(d, results, o.id);
              const ranked = scored && r && !results.needsBaseline;
              return (
                <th
                  key={o.id}
                  scope="col"
                  className={['col-option', win ? 'win' : '', baseline ? 'baseline' : ''].join(' ')}
                  style={{ '--fill': Math.max(0, Math.min(1, fill)) } as CSSProperties}
                >
                  <div className="opt-head">
                    <div className="opt-big" title={win ? t('results.winner') : undefined}>
                      {ranked ? r.rank : ''}
                      {win && <Icon name="trophy" size={22} />}
                    </div>
                    <div className="opt-row row-blue">{rows[0]}</div>
                    <div className="opt-row row-green">{rows[1]}</div>
                    <div className="opt-row row-gold">{rows[2]}</div>
                    <div className="opt-strip">
                      <input
                        className="opt-name"
                        value={o.name}
                        placeholder={name}
                        dir="auto"
                        lang={d.lang}
                        maxLength={200}
                        readOnly={fixed}
                        aria-label={t('grid.optionName')}
                        onChange={(e) => onEdit(renameOption(o.id, e.target.value))}
                        onBlur={() => onEdit(tidyNames)}
                      />
                      <button className="icon-button small" onClick={() => onDetail({ optionId: o.id })} aria-label={t('grid.optionDetails', { name })}>
                        <Icon name={count ? 'note' : 'more'} size={16} />
                        {count > 0 && <span className="count">{count}</span>}
                      </button>
                    </div>
                  </div>
                </th>
              );
            })}
            {!fixed && (
              <th className="col-add" scope="col">
                <button className="button ghost" onClick={() => onEdit(addOption(''))}>
                  <Icon name="plus" size={18} />
                  {t('grid.addOption')}
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {d.factors.map((f) => {
            const name = factorName(d, f, uiLang);
            const guide = factorGuide(d, f, uiLang);
            const count = notes.get(` ${f.id}`) ?? 0;
            return (
              <tr key={f.id}>
                <th scope="row" className="col-factor">
                  <div className="factor-cell">
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
                    <button className="icon-button small" onClick={() => onDetail({ factorId: f.id })} aria-label={t('grid.factorDetails', { name })}>
                      <Icon name={count ? 'note' : 'more'} size={16} />
                      {count > 0 && <span className="count">{count}</span>}
                    </button>
                  </div>
                  {guide && (
                    <div className="guide" dir="auto" lang={d.lang}>
                      {guide}
                    </div>
                  )}
                </th>
                <td className="col-weight">
                  <Stars value={Math.round(f.weight)} readOnly={readOnly || Boolean(lock?.weights)} label={t('grid.importanceOf', { name })} onChange={(w) => onEdit(setWeight(f.id, w))} />
                  {group?.weights?.has(f.id) && <div className="muted small">{t('group.weightAverage', { value: formatNumber(f.weight, 1) })}</div>}
                </td>
                {d.options.map((o) => {
                  const key = cellKey(o.id, f.id);
                  const value = values.get(key);
                  const fact = facts.get(key);
                  const cellNotes = notes.get(key) ?? 0;
                  const baseline = pugh && d.settings.baselineId === o.id;
                  const label = t('grid.cellLabel', { option: optionName(d, o, uiLang), factor: name });
                  const h = heat(d, value);
                  const groupCell = group?.cells.get(key);
                  return (
                    <td
                      key={o.id}
                      className={[
                        'cell',
                        value !== undefined ? 'scored' : '',
                        baseline ? 'baseline' : '',
                        results.winnerId === o.id ? 'win' : '',
                        h < 0 ? 'neg' : '',
                        groupCell && groupCell.n > 1 ? `split-${spreadLevel(groupCell.spread)}` : '',
                      ].join(' ')}
                      style={{ '--heat': Math.abs(h) } as CSSProperties}
                    >
                      {baseline ? (
                        <span className="muted small">{t('pugh.baselineCell')}</span>
                      ) : group ? (
                        <GroupValue d={d} cell={groupCell} />
                      ) : pugh ? (
                        <PughInput d={d} value={value} readOnly={readOnly} label={label} onChange={(v) => onEdit(setRating(o.id, f.id, v))} />
                      ) : (
                        <ScoreInput d={d} value={value} readOnly={readOnly} label={label} onChange={(v) => onEdit(setScore(o.id, f.id, v))} />
                      )}
                      {fact && (
                        <div className="fact" dir="auto" lang={d.lang}>
                          {fact.text}
                          {fact.url && <ExternalLink url={fact.url} />}
                        </div>
                      )}
                      <button className="cell-more" onClick={() => onDetail({ optionId: o.id, factorId: f.id })} aria-label={t('grid.cellDetails', { name: label })}>
                        <Icon name={cellNotes ? 'note' : 'more'} size={14} />
                        {cellNotes > 0 && <span className="count">{cellNotes}</span>}
                      </button>
                    </td>
                  );
                })}
                {!fixed && <td className="col-add" />}
              </tr>
            );
          })}
          {!fixed && (
            <tr className="add-row">
              <th className="col-factor" scope="row">
                <button className="button ghost" onClick={() => onEdit(addFactor(''))}>
                  <Icon name="plus" size={18} />
                  {t('grid.addFactor')}
                </button>
              </th>
              <td colSpan={d.options.length + 2} />
            </tr>
          )}
        </tbody>
      </table>
      {d.options.length === 0 && d.factors.length === 0 && <p className="empty-hint">{t('grid.emptyHint')}</p>}
    </div>
  );
}
