// "Score this with others": starting a group, its rules, and (for participants) the rules they joined under.

import { useEffect, useState } from 'react';
import { keyFromPassphrase, newKdf } from '../format/crypto';
import { LIMITS } from '../format/limits';
import type { Anonymity, Decision, FolderResults, GroupSettings } from '../format/types';
import { t } from '../i18n';
import { defaultFolderResults, endGroup, setGroupSettings, setMyName, setResultsLock, startGroup, type Edit } from './edit';
import { forgetResultsKey, keepResultsKey, resultsKey } from './keys';
import { passphraseStrength } from './ShareDialog';
import { Icon, Segmented, useConfirm } from './ui';

/** Anonymous or named: shown side by side, with nothing picked until the organizer picks. */
function AnonymityChoice({ value, locked, onChange }: { value: Anonymity | null; locked: boolean; onChange: (a: Anonymity) => void }) {
  const choice = (a: Anonymity, title: string, help: string) => (
    <label className={value === a ? 'choice-card on' : 'choice-card'}>
      <input type="radio" name="anonymity" checked={value === a} disabled={locked && value !== a} onChange={() => onChange(a)} />
      <span>
        <strong>{title}</strong>
        <span className="muted small">{help}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="field choice">
      <legend className="field-label">{t('group.ballots')}</legend>
      {choice('anonymous', t('group.anonymous'), t('group.anonymousHelp'))}
      {choice('named', t('group.named'), t('group.namedHelp'))}
      <p className="muted small">
        {locked ? (
          <>
            <Icon name="lock" size={14} /> {t('group.anonymityLocked')}
          </>
        ) : (
          t('group.anonymityLockNote')
        )}
      </p>
    </fieldset>
  );
}

type Rules = Omit<GroupSettings, 'anonymity'>;

function RuleFields({ rules, onChange }: { rules: Rules; onChange: (patch: Partial<Rules>) => void }) {
  return (
    <>
      <div className="field">
        <span className="field-label">{t('group.scoring')}</span>
        <Segmented
          value={rules.scoring}
          label={t('group.scoring')}
          onChange={(scoring) => onChange({ scoring })}
          options={[
            { value: 'blind', label: t('group.blind') },
            { value: 'open', label: t('group.open') },
          ]}
        />
        <span className="muted small">{rules.scoring === 'blind' ? t('group.blindHelp') : t('group.openHelp')}</span>
      </div>
      <div className="field">
        <span className="field-label">{t('group.importance')}</span>
        <Segmented
          value={rules.weights}
          label={t('group.importance')}
          onChange={(weights) => onChange({ weights })}
          options={[
            { value: 'organizer', label: t('group.importanceOrganizer') },
            { value: 'everyone', label: t('group.importanceEveryone') },
          ]}
        />
        <span className="muted small">{rules.weights === 'organizer' ? t('group.importanceOrganizerHelp') : t('group.importanceEveryoneHelp')}</span>
      </div>
      <div className="field">
        <span className="field-label">{t('group.combine')}</span>
        <Segmented
          value={rules.combine}
          label={t('group.combine')}
          onChange={(combine) => onChange({ combine })}
          options={[
            { value: 'mean', label: t('group.mean') },
            { value: 'median', label: t('group.median') },
          ]}
        />
        <span className="muted small">{rules.combine === 'mean' ? t('group.meanHelp') : t('group.medianHelp')}</span>
      </div>
      <div className="field">
        <span className="field-label">{t('group.folderResults')}</span>
        <Segmented<FolderResults>
          value={rules.folderResults ?? 'never'}
          label={t('group.folderResults')}
          onChange={(folderResults) => onChange({ folderResults })}
          options={[
            { value: 'never', label: t('group.folderNever') },
            { value: 'publish', label: t('group.folderPublish') },
            // With blind scoring, nobody sees the group's scores until the organizer chooses to publish them.
            ...(rules.scoring === 'open' ? [{ value: 'approval' as const, label: t('group.folderApproval') }] : []),
          ]}
        />
        <span className="muted small">{t(`group.folderHelp.${rules.folderResults ?? 'never'}`)}</span>
      </div>
      <label className="field">
        <span className="field-label">{t('group.expected')}</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.expected}
          value={rules.expected ?? ''}
          placeholder={t('group.expectedPlaceholder')}
          onChange={(e) => onChange({ expected: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
        <span className="muted small">{t('group.expectedHelp')}</span>
      </label>
    </>
  );
}

function NameField({ value, help, onChange, onBlur }: { value: string; help: string; onChange: (v: string) => void; onBlur?: () => void }) {
  return (
    <label className="field">
      <span className="field-label">{t('group.yourName')}</span>
      <input value={value} dir="auto" maxLength={LIMITS.text.author} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      <span className="muted small">{help}</span>
    </label>
  );
}

function Setup({ onEdit }: { onEdit: (e: Edit) => void }) {
  const [open, setOpen] = useState(false);
  const [anonymity, setAnonymity] = useState<Anonymity | null>(null);
  const [rules, setRules] = useState<Rules>({ scoring: 'blind', weights: 'organizer', combine: 'mean', folderResults: defaultFolderResults('blind') });
  // Switching blind or open while setting up moves the folder choice to that mode's default, unless it's "never".
  const changeRules = (patch: Partial<Rules>) =>
    setRules((r) => {
      const next = { ...r, ...patch };
      if (patch.scoring && !patch.folderResults && next.folderResults !== 'never') next.folderResults = defaultFolderResults(patch.scoring);
      return next;
    });
  const [name, setName] = useState('');

  if (!open) {
    return (
      <>
        <p className="muted small">{t('group.intro')}</p>
        <button className="button" onClick={() => setOpen(true)}>
          <Icon name="people" size={18} />
          {t('group.setUp')}
        </button>
      </>
    );
  }
  return (
    <>
      <p className="muted small">{t('group.intro')}</p>
      <AnonymityChoice value={anonymity} locked={false} onChange={setAnonymity} />
      {anonymity === 'named' && <NameField value={name} help={t('group.yourNameHelp')} onChange={setName} />}
      <RuleFields rules={rules} onChange={changeRules} />
      <div className="actions">
        <button className="button" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
        <button className="button primary" disabled={!anonymity} onClick={() => anonymity && onEdit(startGroup({ ...rules, anonymity }, name))}>
          {t('group.start')}
        </button>
      </div>
      {!anonymity && <p className="muted small">{t('group.pickAnonymity')}</p>}
    </>
  );
}

function OrganizerRules({ d, onEdit }: { d: Decision; onEdit: (e: Edit) => void }) {
  const ask = useConfirm();
  const g = d.group!;
  const [name, setName] = useState(g.myName ?? '');
  return (
    <>
      <AnonymityChoice value={g.settings.anonymity} locked={g.anonymityLocked} onChange={(anonymity) => onEdit(setGroupSettings({ anonymity }))} />
      {g.settings.anonymity === 'named' && <NameField value={name} help={t('group.yourNameHelp')} onChange={setName} onBlur={() => onEdit(setMyName(name))} />}
      <RuleFields rules={g.settings} onChange={(patch) => onEdit(setGroupSettings(patch))} />
      {(g.settings.folderResults ?? 'never') !== 'never' && <ResultsLock d={d} onEdit={onEdit} />}
      {!g.anonymityLocked && (
        <button
          className="link-button small danger"
          onClick={async () => {
            const ok = await ask({ title: t('group.stop'), message: t('group.confirmStop'), confirmLabel: t('group.stop'), danger: true });
            if (ok) onEdit(endGroup);
          }}
        >
          {t('group.stop')}
        </button>
      )}
    </>
  );
}

/**
 * Organizer: lock the results file in the shared folder with a passphrase. Only the key it makes is kept
 * on this device (non-extractable), never the passphrase; people enter it once on theirs.
 */
function ResultsLock({ d, onEdit }: { d: Decision; onEdit: (e: Edit) => void }) {
  const kdf = d.group?.resultsKdf;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (kdf) resultsKey(d.id, kdf).then((k) => live && setHasKey(k !== null), () => live && setHasKey(false));
    return () => {
      live = false;
    };
  }, [d.id, kdf]);
  const strength = passphraseStrength(value);

  const save = async () => {
    setBusy(true);
    try {
      // A new passphrase always gets new settings, so nobody's old key opens files made with it.
      const next = newKdf();
      await keepResultsKey(d.id, await keyFromPassphrase(value, next), next);
      onEdit(setResultsLock(next));
      setEditing(false);
      setValue('');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    await forgetResultsKey(d.id);
    onEdit(setResultsLock(null));
  };

  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={Boolean(kdf) || editing} onChange={(e) => (e.target.checked ? setEditing(true) : kdf ? void turnOff() : setEditing(false))} />
        {t('group.resultsLock')}
      </label>
      {kdf && !editing && (
        <>
          <span className="muted small">{t('group.resultsLockOn')}</span>
          {hasKey === false && <span className="callout warn small">{t('group.resultsLockLost')}</span>}
          <button className="link-button small" onClick={() => setEditing(true)}>
            {t('group.resultsLockChange')}
          </button>
        </>
      )}
      {editing && (
        <>
          <input value={value} autoComplete="off" spellCheck={false} aria-label={t('share.passphrase')} placeholder={t('share.passphrase')} onChange={(e) => setValue(e.target.value)} />
          <span className={strength === 'short' ? 'muted small warn-text' : 'muted small'}>{t(`share.strength.${strength}`)}</span>
          <span className="muted small">{t('group.resultsLockApart')}</span>
          <div className="actions start">
            <button
              className="button"
              onClick={() => {
                setEditing(false);
                setValue('');
              }}
            >
              {t('common.cancel')}
            </button>
            <button className="button primary" disabled={busy || strength === 'short'} onClick={save}>
              {t('group.resultsLockSet')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ParticipantRules({ d, onEdit }: { d: Decision; onEdit: (e: Edit) => void }) {
  const g = d.group!;
  const s = g.settings;
  const [name, setName] = useState(g.myName ?? '');
  return (
    <>
      <ul className="rules">
        <li>{s.anonymity === 'anonymous' ? t('group.anonymousPromise') : t('group.namedPromise')}</li>
        <li>{s.scoring === 'blind' ? t('group.blindHelp') : t('group.openHelp')}</li>
        <li>{s.weights === 'organizer' ? t('group.importanceOrganizerHelp') : t('group.importanceEveryoneHelp')}</li>
        <li>{s.combine === 'mean' ? t('group.meanHelp') : t('group.medianHelp')}</li>
        {(s.folderResults ?? 'never') !== 'never' && <li>{t(`group.folderPromise.${s.folderResults}`)}</li>}
      </ul>
      {s.anonymity === 'named' && <NameField value={name} help={t('participant.nameHelp')} onChange={setName} onBlur={() => onEdit(setMyName(name))} />}
    </>
  );
}

export function GroupSection({ d, onEdit }: { d: Decision; onEdit: (e: Edit) => void }) {
  const role = d.group?.role;
  return (
    <section className="group-section" aria-labelledby="group-title">
      <h3 id="group-title">
        <Icon name="people" size={18} /> {t('group.title')}
      </h3>
      {role === 'participant' ? <ParticipantRules d={d} onEdit={onEdit} /> : role === 'organizer' ? <OrganizerRules d={d} onEdit={onEdit} /> : <Setup onEdit={onEdit} />}
    </section>
  );
}
