// Details for one cell, option or factor: facts, guides and notes.

import { useState } from 'react';
import { cellKey, cellValues } from '../engine';
import { checkLink } from '../format/sanitize';
import { LIMITS } from '../format/limits';
import type { Decision, Visibility } from '../format/types';
import { formatDate, t } from '../i18n';
import { NameField, PughInput, ScoreInput, formatValue } from './controls';
import {
  addNote,
  moveFactor,
  moveOption,
  removeFactor,
  removeNote,
  removeOption,
  renameFactor,
  renameOption,
  sameTarget,
  setFact,
  setGuide,
  setNoteVisibility,
  setOptionDescription,
  setRating,
  setScore,
  setSettings,
  setWeight,
  tidyNames,
  type Edit,
  type Target,
} from './edit';
import { ExternalLink } from './ExternalLink';
import { formatGroupValue, type GroupCells, type Lock } from './Grid';
import { factorGuide, factorName, optionName } from './labels';
import { Dialog, Icon, Segmented, Stars, useConfirm } from './ui';

interface Props {
  d: Decision;
  target: Target;
  readOnly: boolean;
  uiLang: string;
  onEdit: (edit: Edit) => void;
  onClose: () => void;
  lock?: Lock;
  /** Showing the group's combined values instead of anyone's own. */
  group?: GroupCells;
}

const NO_LOCK: Lock = { structure: false, weights: false };

export function DetailDialog({ d, target, readOnly, uiLang, onEdit, onClose, lock = NO_LOCK, group }: Props) {
  const option = d.options.find((o) => o.id === target.optionId);
  const factor = d.factors.find((f) => f.id === target.factorId);
  if ((target.optionId && !option) || (target.factorId && !factor)) return null;

  const title =
    option && factor
      ? `${optionName(d, option, uiLang)} · ${factorName(d, factor, uiLang)}`
      : option
        ? optionName(d, option, uiLang)
        : factor
          ? factorName(d, factor, uiLang)
          : t('notes.decisionNotes');

  return (
    <Dialog title={<span dir="auto">{title}</span>} onClose={onClose}>
      {option && factor && <CellSection d={d} optionId={option.id} factorId={factor.id} readOnly={readOnly} fixed={readOnly || lock.structure} group={group} uiLang={uiLang} onEdit={onEdit} />}
      {option && !factor && <OptionSection d={d} optionId={option.id} readOnly={readOnly || lock.structure} uiLang={uiLang} onEdit={onEdit} onClose={onClose} />}
      {factor && !option && <FactorSection d={d} factorId={factor.id} readOnly={readOnly || lock.structure} weightsReadOnly={readOnly || lock.weights} uiLang={uiLang} onEdit={onEdit} onClose={onClose} />}
      <NotesEditor d={d} target={target} readOnly={readOnly} onEdit={onEdit} />
    </Dialog>
  );
}

/** How the group scored one cell: the combined value, the range, and (for the organizer) each ballot. */
function GroupCellInfo({ d, cellKeyValue, group }: { d: Decision; cellKeyValue: string; group: GroupCells }) {
  const cell = group.cells.get(cellKeyValue);
  const voters = group.voters?.get(cellKeyValue);
  if (!cell) return <p className="muted small">{t('group.cellNone')}</p>;
  return (
    <div className="field">
      <span className="field-label">{t('group.cellTitle')}</span>
      <p>
        <strong>{formatGroupValue(d, cell.value)}</strong> · {t('group.cellFrom', { count: cell.n })}
        {cell.n > 1 && cell.low !== cell.high && ` · ${t('group.cellRange', { low: formatValue(d, cell.low), high: formatValue(d, cell.high) })}`}
      </p>
      {voters && voters.length > 0 && (
        <ul className="dist">
          {[...voters]
            .sort((a, b) => a.value - b.value)
            .map((v, i) => (
              <li key={i}>
                <bdi>{v.label}</bdi>
                <span>{formatValue(d, v.value)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function CellSection({
  d,
  optionId,
  factorId,
  readOnly,
  fixed,
  group,
  uiLang,
  onEdit,
}: {
  d: Decision;
  optionId: string;
  factorId: string;
  readOnly: boolean;
  /** Facts belong to the decision's structure. */
  fixed: boolean;
  group: GroupCells | undefined;
  uiLang: string;
  onEdit: (e: Edit) => void;
}) {
  const key = cellKey(optionId, factorId);
  const value = cellValues(d).get(key);
  const fact = d.facts.find((f) => f.optionId === optionId && f.factorId === factorId);
  const factor = d.factors.find((f) => f.id === factorId)!;
  const guide = factorGuide(d, factor, uiLang);
  const [text, setText] = useState(fact?.text ?? '');
  const [url, setUrl] = useState(fact?.url ?? '');
  const pugh = d.settings.mode === 'pugh';
  const baseline = pugh && d.settings.baselineId === optionId;
  const link = url.trim() ? checkLink(url) : null;
  const commit = () => onEdit(setFact(optionId, factorId, text, link ? link.href : ''));

  return (
    <>
      {guide && (
        <p className="guide-box" dir="auto" lang={d.lang}>
          <strong>{t('detail.howToScore')}</strong> {guide}
        </p>
      )}
      {!baseline && group && <GroupCellInfo d={d} cellKeyValue={key} group={group} />}
      {!baseline && !group && (
        <div className="field">
          <span className="field-label">{pugh ? t('detail.ratingVsBaseline') : t('detail.score', { max: d.settings.scaleMax })}</span>
          <div className="row">
            {pugh ? (
              <PughInput d={d} value={value} readOnly={readOnly} label={t('detail.rating')} onChange={(v) => onEdit(setRating(optionId, factorId, v))} />
            ) : (
              <ScoreInput d={d} value={value} readOnly={readOnly} label={t('detail.scoreLabel')} onChange={(v) => onEdit(setScore(optionId, factorId, v))} />
            )}
            {!readOnly && value !== undefined && (
              <button className="link-button small" onClick={() => onEdit(pugh ? setRating(optionId, factorId, undefined) : setScore(optionId, factorId, undefined))}>
                {t('detail.clearScore')}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor="fact-text">
          {t('detail.fact')}
        </label>
        <p className="muted small">{t('detail.factHelp')}</p>
        {fixed ? (
          <p dir="auto" lang={d.lang}>
            {fact?.text || '–'} {fact?.url && <ExternalLink url={fact.url} />}
          </p>
        ) : (
          <>
            <textarea id="fact-text" rows={2} value={text} dir="auto" lang={d.lang} maxLength={LIMITS.text.fact} onChange={(e) => setText(e.target.value)} onBlur={commit} />
            <input
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              dir="ltr"
              maxLength={LIMITS.text.url}
              aria-label={t('detail.factLink')}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={commit}
            />
            {url.trim() && !link && <p className="callout warn small">{t('detail.badLink')}</p>}
            {link?.lookalike && <p className="callout warn small">{t('link.lookalike')}</p>}
          </>
        )}
      </div>
    </>
  );
}

function OptionSection({ d, optionId, readOnly, uiLang, onEdit, onClose }: { d: Decision; optionId: string; readOnly: boolean; uiLang: string; onEdit: (e: Edit) => void; onClose: () => void }) {
  const option = d.options.find((o) => o.id === optionId)!;
  const ask = useConfirm();
  const [description, setDescription] = useState(option.description ?? '');
  const pugh = d.settings.mode === 'pugh';
  const isBaseline = d.settings.baselineId === optionId;
  return (
    <>
      <label className="field">
        <span className="field-label">{t('detail.name')}</span>
        <NameField
          className="name-box"
          value={option.name}
          placeholder={optionName(d, option, uiLang)}
          lang={d.lang}
          readOnly={readOnly}
          label={t('detail.name')}
          onChange={(v) => onEdit(renameOption(optionId, v))}
          onBlur={() => onEdit(tidyNames)}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('detail.description')}</span>
        <textarea rows={3} value={description} dir="auto" lang={d.lang} readOnly={readOnly} maxLength={LIMITS.text.description} onChange={(e) => setDescription(e.target.value)} onBlur={() => onEdit(setOptionDescription(optionId, description))} />
      </label>
      {!readOnly && (
        <div className="actions start">
          {pugh && (
            <button className="button" disabled={isBaseline} onClick={() => onEdit(setSettings({ baselineId: optionId }))}>
              {isBaseline ? t('detail.isBaseline') : t('detail.makeBaseline')}
            </button>
          )}
          <button className="button" onClick={() => onEdit(moveOption(optionId, -1))} aria-label={t('detail.moveEarlier')}>
            <Icon name="back" size={18} />
          </button>
          <button className="button" onClick={() => onEdit(moveOption(optionId, 1))} aria-label={t('detail.moveLater')}>
            <Icon name="next" size={18} />
          </button>
          <button
            className="button danger"
            onClick={async () => {
              const ok = await ask({ title: t('detail.removeOption'), message: t('detail.confirmRemoveOption'), confirmLabel: t('detail.removeOption'), danger: true });
              if (ok) {
                onEdit(removeOption(optionId));
                onClose();
              }
            }}
          >
            <Icon name="trash" size={18} />
            {t('detail.removeOption')}
          </button>
        </div>
      )}
    </>
  );
}

function FactorSection({
  d,
  factorId,
  readOnly,
  weightsReadOnly,
  uiLang,
  onEdit,
  onClose,
}: {
  d: Decision;
  factorId: string;
  readOnly: boolean;
  weightsReadOnly: boolean;
  uiLang: string;
  onEdit: (e: Edit) => void;
  onClose: () => void;
}) {
  const factor = d.factors.find((f) => f.id === factorId)!;
  const ask = useConfirm();
  const [guide, setGuideText] = useState(factor.guide ?? '');
  const name = factorName(d, factor, uiLang);
  return (
    <>
      <label className="field">
        <span className="field-label">{t('detail.name')}</span>
        <NameField
          className="name-box"
          value={factor.name}
          placeholder={name}
          lang={d.lang}
          readOnly={readOnly}
          label={t('detail.name')}
          onChange={(v) => onEdit(renameFactor(factorId, v))}
          onBlur={() => onEdit(tidyNames)}
        />
      </label>
      <div className="field">
        <span className="field-label">{t('grid.importance')}</span>
        <div className="row">
          <Stars value={Math.round(factor.weight)} readOnly={weightsReadOnly} label={t('grid.importanceOf', { name })} onChange={(w) => onEdit(setWeight(factorId, w))} />
          <span className="muted">{t(`weight.${Math.round(factor.weight)}`)}</span>
        </div>
      </div>
      <label className="field">
        <span className="field-label">{t('detail.guide')}</span>
        <span className="muted small">{t('detail.guideHelp')}</span>
        <textarea rows={3} value={guide} dir="auto" lang={d.lang} readOnly={readOnly} maxLength={LIMITS.text.guide} onChange={(e) => setGuideText(e.target.value)} onBlur={() => onEdit(setGuide(factorId, guide))} />
      </label>
      {!readOnly && (
        <div className="actions start">
          <button className="button" onClick={() => onEdit(moveFactor(factorId, -1))} aria-label={t('detail.moveUp')}>
            <Icon name="up" size={18} />
          </button>
          <button className="button" onClick={() => onEdit(moveFactor(factorId, 1))} aria-label={t('detail.moveDown')}>
            <Icon name="down" size={18} />
          </button>
          <button
            className="button danger"
            onClick={async () => {
              const ok = await ask({ title: t('detail.removeFactor'), message: t('detail.confirmRemoveFactor'), confirmLabel: t('detail.removeFactor'), danger: true });
              if (ok) {
                onEdit(removeFactor(factorId));
                onClose();
              }
            }}
          >
            <Icon name="trash" size={18} />
            {t('detail.removeFactor')}
          </button>
        </div>
      )}
    </>
  );
}

export function NotesEditor({ d, target, readOnly, onEdit }: { d: Decision; target: Target; readOnly: boolean; onEdit: (e: Edit) => void }) {
  const notes = d.notes.filter((n) => sameTarget(n, target));
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  return (
    <section className="notes">
      <h3>{t('notes.title')}</h3>
      {notes.length === 0 && <p className="muted small">{t('notes.none')}</p>}
      <ul className="note-list">
        {notes.map((n) => (
          <li key={n.id} className={n.visibility}>
            <p dir="auto" lang={d.lang}>
              {n.text}
            </p>
            <div className="note-meta">
              <span className={`badge ${n.visibility}`}>
                <Icon name={n.visibility === 'private' ? 'lock' : 'people'} size={14} />
                {n.visibility === 'private' ? t('notes.private') : t('notes.shared')}
              </span>
              {n.author && (
                <span className="muted small" title={t('notes.authorUnverified')} dir="auto">
                  {n.author}
                </span>
              )}
              <span className="muted small">{formatDate(n.createdAt)}</span>
              {!readOnly && (
                <>
                  <button className="link-button small" onClick={() => onEdit(setNoteVisibility(n.id, n.visibility === 'private' ? 'shared' : 'private'))}>
                    {n.visibility === 'private' ? t('notes.makeShared') : t('notes.makePrivate')}
                  </button>
                  <button className="link-button small danger" onClick={() => onEdit(removeNote(n.id))}>
                    {t('notes.delete')}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="note-add">
          <textarea rows={2} value={text} dir="auto" lang={d.lang} placeholder={t('notes.placeholder')} maxLength={LIMITS.text.note} onChange={(e) => setText(e.target.value)} aria-label={t('notes.add')} />
          <div className="row">
            <Segmented
              value={visibility}
              label={t('notes.visibility')}
              onChange={setVisibility}
              options={[
                { value: 'private', label: t('notes.private'), title: t('notes.privateHelp') },
                { value: 'shared', label: t('notes.shared'), title: t('notes.sharedHelp') },
              ]}
            />
            <button
              className="button primary"
              disabled={!text.trim()}
              onClick={() => {
                onEdit(addNote(target, text, visibility));
                setText('');
              }}
            >
              {t('notes.add')}
            </button>
          </div>
          <p className="muted small">{visibility === 'private' ? t('notes.privateHelp') : t('notes.sharedHelp')}</p>
        </div>
      )}
    </section>
  );
}
