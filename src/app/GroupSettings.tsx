// "Score this with others": starting a group, its rules, and (for participants) the rules they joined under.

import { useState } from 'react';
import { LIMITS } from '../format/limits';
import type { Anonymity, Decision, GroupSettings } from '../format/types';
import { t } from '../i18n';
import { endGroup, setGroupSettings, setMyName, startGroup, type Edit } from './edit';
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
  const [rules, setRules] = useState<Rules>({ scoring: 'blind', weights: 'organizer', combine: 'mean' });
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
      <RuleFields rules={rules} onChange={(patch) => setRules({ ...rules, ...patch })} />
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
