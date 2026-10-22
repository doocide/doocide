// Desktop and tablet: the StudentGrader-style matrix, in either layout the decision asks for.
// Factors as rows (the default): options are columns, each headed by its rank and three summary rows.
// Options as rows: each option row starts with its rank, name and summaries; factors are columns,
// headed by their name and importance. Headers stay pinned while scrolling either way.

import { useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { cellKey, cellValues, spreadLevel, type Results } from '../engine';
import type { CellResult, Decision, Fact, Factor, Option, WeightResult } from '../format/types';
import { formatNumber, t } from '../i18n';
import { NameField, PughInput, ScoreInput, formatValue, heat, useFocusNew, useHoverTip } from './controls';
import { abstainedOptions } from '../format/share';
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

/** Everything both layouts need, worked out once. */
/**
 * Which option's cells the pointer is over. Only the option heads listen, so moving across the grid
 * re-renders one or two heads, never every cell.
 */
interface HoverStore {
  set: (optionId: string | null) => void;
  is: (optionId: string) => boolean;
  subscribe: (listener: () => void) => () => void;
}

function hoverStore(): HoverStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    set: (optionId) => {
      if (optionId === current) return;
      current = optionId;
      for (const l of listeners) l();
    },
    is: (optionId) => current === optionId,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** True while the pointer is over one of this option's score cells. */
const useOptionHovered = (c: Ctx, optionId: string) => useSyncExternalStore(c.hover.subscribe, () => c.hover.is(optionId));

interface Ctx extends MatrixProps {
  /** Names, options and factors can't change (read-only, or a participant's copy). */
  fixed: boolean;
  pugh: boolean;
  scored: boolean;
  values: Map<string, number>;
  facts: Map<string, Fact>;
  notes: Map<string, number>;
  /** An option or factor just added: its name field takes focus. */
  focusId: string | null;
  hover: HoverStore;
  /** Options this person abstains from: no scoring there. */
  abstain: Set<string>;
  addOption: () => void;
  addFactor: () => void;
}

/** Rank, trophy and the three summary values of an option. */
function optionSummary(c: Ctx, o: Option) {
  const r = c.results.byOption.get(o.id);
  const win = c.results.winnerId === o.id;
  const baseline = c.pugh && c.d.settings.baselineId === o.id;
  const { rows, fill } = summaryRows(c.d, c.results, o.id);
  const rank = c.scored && r && !c.results.needsBaseline ? r.rank : '';
  return { win, baseline, rows, rank, style: { '--fill': Math.max(0, Math.min(1, fill)) } as CSSProperties };
}

/** An option's name on its dark strip, with its details button. */
function OptionStrip({ c, o }: { c: Ctx; o: Option }) {
  const name = optionName(c.d, o, c.uiLang);
  const count = c.notes.get(`${o.id} `) ?? 0;
  return (
    <div className="opt-strip">
      <NameField
        className="opt-name"
        value={o.name}
        placeholder={name}
        lang={c.d.lang}
        readOnly={c.fixed}
        label={t('grid.optionName')}
        autoFocus={c.focusId === o.id}
        onChange={(v) => c.onEdit(renameOption(o.id, v))}
        onBlur={() => c.onEdit(tidyNames)}
      />
      <button className="icon-button small" onClick={() => c.onDetail({ optionId: o.id })} aria-label={t('grid.optionDetails', { name })}>
        <Icon name={count ? 'note' : 'more'} size={16} />
        {count > 0 && <span className="count">{count}</span>}
      </button>
    </div>
  );
}

/** A factor's name with its details button, anything passed in, and its scoring guide underneath. */
function FactorName({ c, f, children }: { c: Ctx; f: Factor; children?: ReactNode }) {
  const name = factorName(c.d, f, c.uiLang);
  const guide = factorGuide(c.d, f, c.uiLang);
  const count = c.notes.get(` ${f.id}`) ?? 0;
  return (
    <>
      <div className="factor-cell">
        <NameField
          value={f.name}
          placeholder={name}
          lang={c.d.lang}
          readOnly={c.fixed}
          label={t('grid.factorName')}
          autoFocus={c.focusId === f.id}
          onChange={(v) => c.onEdit(renameFactor(f.id, v))}
          onBlur={() => c.onEdit(tidyNames)}
        />
        <button className="icon-button small" onClick={() => c.onDetail({ factorId: f.id })} aria-label={t('grid.factorDetails', { name })}>
          <Icon name={count ? 'note' : 'more'} size={16} />
          {count > 0 && <span className="count">{count}</span>}
        </button>
      </div>
      {children}
      {guide && (
        <div className="guide" dir="auto" lang={c.d.lang}>
          {guide}
        </div>
      )}
    </>
  );
}

function Importance({ c, f }: { c: Ctx; f: Factor }) {
  return (
    <>
      <Stars
        value={Math.round(f.weight)}
        readOnly={c.readOnly || Boolean(c.lock?.weights)}
        label={t('grid.importanceOf', { name: factorName(c.d, f, c.uiLang) })}
        onChange={(w) => c.onEdit(setWeight(f.id, w))}
      />
      {c.group?.weights?.has(f.id) && <div className="muted small">{t('group.weightAverage', { value: formatNumber(f.weight, 1) })}</div>}
    </>
  );
}

/** One option on one factor: the score (or the group's value), its fact, and the details button. */
function Cell({ c, o, f }: { c: Ctx; o: Option; f: Factor }) {
  const { d, results, readOnly, group, pugh } = c;
  const key = cellKey(o.id, f.id);
  const value = c.values.get(key);
  const fact = c.facts.get(key);
  const cellNotes = c.notes.get(key) ?? 0;
  const baseline = pugh && d.settings.baselineId === o.id;
  const label = t('grid.cellLabel', { option: optionName(d, o, c.uiLang), factor: factorName(d, f, c.uiLang) });
  const h = heat(d, value);
  const groupCell = group?.cells.get(key);
  if (c.abstain.has(o.id)) {
    return (
      <td className="cell abstained" onMouseEnter={() => c.hover.set(o.id)} onMouseLeave={() => c.hover.set(null)}>
        <span className="abstained-label">{t('abstain.cell')}</span>
      </td>
    );
  }
  return (
    <td
      onMouseEnter={() => c.hover.set(o.id)}
      onMouseLeave={() => c.hover.set(null)}
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
        <PughInput d={d} value={value} readOnly={readOnly} label={label} onChange={(v) => c.onEdit(setRating(o.id, f.id, v))} />
      ) : (
        <ScoreInput d={d} value={value} readOnly={readOnly} label={label} onChange={(v) => c.onEdit(setScore(o.id, f.id, v))} />
      )}
      {fact && (
        <div className="fact" dir="auto" lang={d.lang}>
          {fact.text}
          {fact.url && <ExternalLink url={fact.url} />}
        </div>
      )}
      <button className="cell-more" onClick={() => c.onDetail({ optionId: o.id, factorId: f.id })} aria-label={t('grid.cellDetails', { name: label })}>
        <Icon name={cellNotes ? 'note' : 'more'} size={14} />
        {cellNotes > 0 && <span className="count">{cellNotes}</span>}
      </button>
    </td>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="button ghost" onClick={onClick}>
      <Icon name="plus" size={18} />
      {label}
    </button>
  );
}

/** An option's column head (factors as rows). Its description shows the moment the pointer is over it. */
function OptionHead({ c, o }: { c: Ctx; o: Option }) {
  const s = optionSummary(c, o);
  const hover = useHoverTip(o.description, c.d.lang);
  const lit = useOptionHovered(c, o.id);
  return (
    <th scope="col" className={['col-option', s.win ? 'win' : '', s.baseline ? 'baseline' : '', lit ? 'hover' : ''].join(' ')} style={s.style} {...hover.props}>
      <div className="opt-head">
        <div className="opt-big" title={s.win ? t('results.winner') : undefined}>
          {s.rank}
          {s.win && <Icon name="trophy" size={22} />}
        </div>
        <div className="opt-row row-blue">{s.rows[0]}</div>
        <div className="opt-row row-green">{s.rows[1]}</div>
        <div className="opt-row row-gold">{s.rows[2]}</div>
        <OptionStrip c={c} o={o} />
        {c.abstain.has(o.id) && <div className="abstain-badge">{t('abstain.cell')}</div>}
      </div>
      {hover.tip}
    </th>
  );
}

/** An option's row head (options as rows), with the same instant description. */
function OptionRowHead({ c, o }: { c: Ctx; o: Option }) {
  const s = optionSummary(c, o);
  const hover = useHoverTip(o.description, c.d.lang);
  const lit = useOptionHovered(c, o.id);
  return (
    <th scope="row" className={['row-option', s.win ? 'win' : '', s.baseline ? 'baseline' : '', lit ? 'hover' : ''].join(' ')} style={s.style} {...hover.props}>
      <div className="opt-line">
        <div className="opt-rank" title={s.win ? t('results.winner') : undefined}>
          {s.rank}
          {s.win && <Icon name="trophy" size={18} />}
        </div>
        <OptionStrip c={c} o={o} />
      </div>
      {c.abstain.has(o.id) && <div className="abstain-badge">{t('abstain.cell')}</div>}
      <div className="opt-sums">
        <span className="opt-row row-blue">{s.rows[0]}</span>
        <span className="opt-row row-green">{s.rows[1]}</span>
        <span className="opt-row row-gold">{s.rows[2]}</span>
      </div>
      {hover.tip}
    </th>
  );
}

/** Factors as rows, options as columns: the StudentGrader layout. */
function FactorRows({ c }: { c: Ctx }) {
  const { d } = c;
  return (
    <table className="grid">
      <thead>
        <tr>
          <th className="col-factor corner" scope="col">
            <div className="head-label">{t('grid.factors')}</div>
          </th>
          <th className="col-weight corner" scope="col">
            <div className="head-label">{t('grid.importance')}</div>
          </th>
          {d.options.map((o) => (
            <OptionHead key={o.id} c={c} o={o} />
          ))}
          {!c.fixed && (
            <th className="col-add" scope="col">
              <AddButton label={t('grid.addOption')} onClick={c.addOption} />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {d.factors.map((f) => (
          <tr key={f.id}>
            <th scope="row" className="col-factor">
              <FactorName c={c} f={f} />
            </th>
            <td className="col-weight">
              <Importance c={c} f={f} />
            </td>
            {d.options.map((o) => (
              <Cell key={o.id} c={c} o={o} f={f} />
            ))}
            {!c.fixed && <td className="col-add" />}
          </tr>
        ))}
        {!c.fixed && (
          <tr className="add-row">
            <th className="col-factor" scope="row">
              <AddButton label={t('grid.addFactor')} onClick={c.addFactor} />
            </th>
            <td colSpan={d.options.length + 2} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Options as rows, factors as columns: handy when there are many options and few factors. */
function OptionRows({ c }: { c: Ctx }) {
  const { d } = c;
  return (
    <table className="grid option-rows">
      <thead>
        <tr>
          <th className="row-option corner" scope="col">
            <div className="head-label">{t('grid.options')}</div>
          </th>
          {d.factors.map((f) => (
            <th key={f.id} scope="col" className="col-factor-head">
              <div className="factor-head">
                <FactorName c={c} f={f}>
                  <div className="factor-weight">
                    <Importance c={c} f={f} />
                  </div>
                </FactorName>
              </div>
            </th>
          ))}
          {!c.fixed && (
            <th className="col-add" scope="col">
              <AddButton label={t('grid.addFactor')} onClick={c.addFactor} />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {d.options.map((o) => (
          <tr key={o.id}>
            <OptionRowHead c={c} o={o} />
            {d.factors.map((f) => (
              <Cell key={f.id} c={c} o={o} f={f} />
            ))}
            {!c.fixed && <td className="col-add" />}
          </tr>
        ))}
        {!c.fixed && (
          <tr className="add-row">
            <th className="row-option" scope="row">
              <AddButton label={t('grid.addOption')} onClick={c.addOption} />
            </th>
            <td colSpan={d.factors.length + 1} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function Grid(props: MatrixProps) {
  const { d, readOnly, lock } = props;
  const values = useMemo(() => cellValues(d), [d]);
  const facts = useMemo(() => new Map(d.facts.map((f) => [cellKey(f.optionId, f.factorId), f])), [d.facts]);
  const notes = useMemo(() => noteCounts(d), [d]);
  const { focusId, nextId } = useFocusNew();
  const hover = useMemo(hoverStore, []);
  const c: Ctx = {
    ...props,
    fixed: readOnly || Boolean(lock?.structure),
    pugh: d.settings.mode === 'pugh',
    scored: values.size > 0,
    values,
    facts,
    notes,
    focusId,
    hover,
    abstain: abstainedOptions(d),
    addOption: () => props.onEdit(addOption('', nextId())),
    addFactor: () => props.onEdit(addFactor('', nextId())),
  };
  return (
    <div className="grid-wrap">
      {d.settings.rows === 'options' ? <OptionRows c={c} /> : <FactorRows c={c} />}
      {d.options.length === 0 && d.factors.length === 0 && <p className="empty-hint">{t('grid.emptyHint')}</p>}
    </div>
  );
}
