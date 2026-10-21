// Every share starts here, and shows exactly what goes out before anything does. The lists below
// are counted from the very envelope that will be sent (see src/format/share.ts).

import { useEffect, useState } from 'react';
import { makeEncryptedLink, makeLink } from '../format/codec';
import { lockWithPassphrase, sealTo, signBallot, signInvite } from '../format/crypto';
import { newId } from '../format/ids';
import { LIMITS } from '../format/limits';
import {
  assertShareable,
  ballotEnvelope,
  ballotSummary,
  inviteEnvelope,
  inviteSummary,
  resultsEnvelope,
  resultsSummary,
  shareEnvelope,
  shareSummary,
  type ShareKind,
} from '../format/share';
import type { AnyEnvelope, BallotEnvelope, Decision, EncryptedEnvelope, GroupResult } from '../format/types';
import { t } from '../i18n';
import { useDeviceKey, useShortCode } from './codes';
import { markSent, restartVoter, setMyName, type Edit } from './edit';
import { FILE_EXTENSION, canShareNatively, copyText, downloadText, safeFileName, shareNatively } from './files';
import { ballotKey, deviceKey, sealingKey } from './keys';
import { decisionTitle } from './labels';
import { Dialog, Icon, Segmented, useToast } from './ui';

/** Some chat apps cut links around this length. */
const LONG_LINK = 8_000;

type Kind = ShareKind | 'invite' | 'results';

interface Props {
  d: Decision;
  /** Organizer: the group's combined result, for open invites and the results share. */
  result: GroupResult | null;
  initial?: Kind;
  onEdit: (edit: Edit) => void;
  onClose: () => void;
}

function Preview({ included, leftOut, title }: { included: string[]; leftOut: string[]; title: string }) {
  return (
    <div className="share-preview">
      <div>
        <h3>{t('share.included')}</h3>
        <ul>
          <li dir="auto">{title}</li>
          {included.map((x) => (
            <li key={x} dir="auto">
              {x}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3>{t('share.leftOut')}</h3>
        <ul>
          {leftOut.map((x) => (
            <li key={x}>
              <Icon name="lock" size={14} /> {x}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The link once it's made: copy it, or hand it to the device's share sheet. */
function LinkBox({ link, title }: { link: string; title: string }) {
  const toast = useToast();
  return (
    <>
      <textarea className="link-box" readOnly rows={3} value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={t('share.link')} />
      {link.length > LONG_LINK && <p className="callout warn small">{t('share.longLink')}</p>}
      <div className="actions">
        {canShareNatively() && (
          <button className="button" onClick={() => shareNatively({ title, url: link })}>
            <Icon name="share" size={18} />
            {t('share.shareVia')}
          </button>
        )}
        <button className="button primary" onClick={async () => toast((await copyText(link)) ? t('share.copied') : t('share.copyFailed'))}>
          {t('share.copy')}
        </button>
      </div>
    </>
  );
}

function Actions({ onFile, onLink, disabled }: { onFile: () => void | Promise<void>; onLink: () => void | Promise<void>; disabled?: boolean }) {
  return (
    <div className="actions">
      <button className="button" disabled={disabled} onClick={onFile}>
        <Icon name="download" size={18} />
        {t('share.saveFile')}
      </button>
      <button className="button primary" disabled={disabled} onClick={onLink}>
        <Icon name="link" size={18} />
        {t('share.makeLink')}
      </button>
    </div>
  );
}

/** What leaves the device: a checked envelope, or one that was checked and then sealed or locked. */
type Outgoing = AnyEnvelope | EncryptedEnvelope;

const saveOutgoing = (out: Outgoing, name: string) => {
  if (out.enc === 'none') assertShareable(out);
  downloadText(JSON.stringify(out, null, 2), `${name}${FILE_EXTENSION}`, 'application/json');
};

const linkFor = (out: Outgoing) => (out.enc === 'none' ? makeLink(out, location.href) : makeEncryptedLink(out, location.href));

/** How good a passphrase is: too short to use, fine, or strong. Length matters most; several random words are best. */
export function passphraseStrength(p: string): 'short' | 'ok' | 'strong' {
  const chars = [...p.trim()].length;
  const words = p.trim().split(/\s+/).filter(Boolean).length;
  if (chars < 8) return 'short';
  return chars >= 16 || words >= 4 ? 'strong' : 'ok';
}

/** "Lock with a passphrase": off, or on with the passphrase typed in the open so it can be read out to others. */
function PassphraseOption({ on, value, onToggle, onChange }: { on: boolean; value: string; onToggle: (on: boolean) => void; onChange: (v: string) => void }) {
  const strength = passphraseStrength(value);
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        {t('share.lock')}
      </label>
      {on && (
        <>
          <input value={value} autoComplete="off" spellCheck={false} aria-label={t('share.passphrase')} placeholder={t('share.passphrase')} onChange={(e) => onChange(e.target.value)} />
          <span className={strength === 'short' ? 'muted small warn-text' : 'muted small'}>{t(`share.strength.${strength}`)}</span>
          <span className="muted small">{t('share.passphraseApart')}</span>
        </>
      )}
    </div>
  );
}

/** A participant sends their ballot back to the organizer. */
function BallotShare({ d, onEdit, onClose }: Omit<Props, 'result' | 'initial'>) {
  const g = d.group!;
  const named = g.settings.anonymity === 'named';
  const [name, setName] = useState(g.myName ?? '');
  const [link, setLink] = useState<string | null>(null);
  const [signingKey, setSigningKey] = useState<string>();
  const withName: Decision = { ...d, group: { ...g, myName: name } };
  const s = ballotSummary(withName);
  const missingName = named && !name.trim();
  // Named ballots are signed with this device's key, so the organizer can compare its code with you.
  const myCode = useShortCode(named ? signingKey : undefined);
  // This device can't sign as the person who sent the earlier ballot (a copy restored elsewhere, say).
  const newVoter = Boolean(g.key && signingKey && g.key !== signingKey);

  useEffect(() => {
    let live = true;
    ballotKey(d).then((k) => live && setSigningKey(k.publicKey), () => {});
    return () => {
      live = false;
    };
  }, [d]);

  // Each send counts up the revision, so the organizer's app keeps the newest ballot from this person.
  // The ballot is checked, signed, and then sealed so only the organizer can open it.
  const send = async (): Promise<Outgoing> => {
    const signer = await ballotKey(d);
    const base = g.key && g.key !== signer.publicKey ? restartVoter(withName) : withName;
    const next = markSent({ ...base, group: { ...base.group!, key: signer.publicKey } });
    onEdit(() => next);
    const env = ballotEnvelope(next);
    const signed: BallotEnvelope = { ...env, data: await signBallot(env.data, signer) };
    assertShareable(signed);
    return g.organizerSealKey ? sealTo(g.organizerSealKey, JSON.stringify(signed)) : signed;
  };

  const included = [
    t('share.yourScores', { count: s.scores }),
    ...(s.weights ? [t('share.yourImportance', { count: s.weights })] : []),
    t('share.countSharedNotes', { count: s.sharedNotes }),
    s.name ? t('share.asName', { name: s.name }) : named ? t('share.nameMissing') : t('share.noName'),
    named ? t('share.signedDevice', { code: myCode ?? '…' }) : t('share.signedDecision'),
    ...(g.organizerSealKey ? [t('share.sealedBallot')] : []),
  ];

  return (
    <Dialog title={t('share.ballotTitle')} onClose={onClose}>
      <p className="muted small">{named ? t('group.namedPromise') : t('group.anonymousPromise')}</p>
      {named && (
        <label className="field">
          <span className="field-label">{t('participant.nameLabel')}</span>
          <input
            value={name}
            dir="auto"
            maxLength={LIMITS.text.author}
            onChange={(e) => {
              setName(e.target.value);
              setLink(null);
            }}
            onBlur={() => onEdit(setMyName(name))}
          />
          <span className="muted small">{t('participant.nameHelp')}</span>
        </label>
      )}
      <Preview title={decisionTitle(d)} included={included} leftOut={[t('share.privateNotesStay', { count: s.privateNotes })]} />
      {s.scores === 0 && <p className="callout warn small">{t('share.ballotEmpty')}</p>}
      {newVoter && <p className="callout warn small">{t('participant.newVoter')}</p>}
      <p className="callout">{t('share.ballotHow')}</p>
      {named && myCode && <p className="muted small">{t('participant.yourCode', { code: myCode })}</p>}
      {!named && <p className="muted small">{t('participant.anonymousKey')}</p>}
      {!link ? (
        <Actions
          disabled={missingName || !signingKey}
          onFile={async () => saveOutgoing(await send(), `ballot-${newId(6)}`)}
          onLink={async () => setLink(await linkFor(await send()))}
        />
      ) : (
        <LinkBox link={link} title={decisionTitle(d)} />
      )}
      {missingName && <p className="muted small">{t('participant.nameNeeded')}</p>}
    </Dialog>
  );
}

export function ShareDialog({ d, result, initial, onEdit, onClose }: Props) {
  if (d.group?.role === 'participant') return <BallotShare d={d} onEdit={onEdit} onClose={onClose} />;
  return <OwnerShare d={d} result={result} onEdit={onEdit} onClose={onClose} {...(initial && { initial })} />;
}

function OwnerShare({ d, result, initial, onClose }: Props) {
  const organizer = d.group?.role === 'organizer';
  const [kind, setKind] = useState<Kind>(initial ?? (organizer ? 'invite' : 'decision'));
  const [link, setLink] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const g = d.group;
  // Invites are signed with this device's key, so people can check by its code that an invite is yours.
  const myKey = useDeviceKey(organizer);
  const myCode = useShortCode(myKey);

  const envelope = async (): Promise<AnyEnvelope> => {
    if (kind === 'invite') {
      // The sealing key rides in the invite, under its signature, so ballots come back sealed to it.
      const env = inviteEnvelope(d, result ?? undefined, (await sealingKey(d.id)).publicKey);
      return { ...env, data: await signInvite(env.data, await deviceKey()) };
    }
    return kind === 'results' && result ? resultsEnvelope(d, result) : shareEnvelope(d, kind === 'template' ? 'template' : 'decision');
  };

  /** Checked first, then locked when asked: the passphrase never leaves this device. */
  const outgoing = async (): Promise<Outgoing> => {
    const env = await envelope();
    assertShareable(env);
    return locking ? lockWithPassphrase(JSON.stringify(env), passphrase) : env;
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  let included: string[];
  let leftOut: string[];
  let help: string;
  let fileName = safeFileName(d.title, 'decision');

  if (kind === 'invite' && g) {
    const s = inviteSummary(d, result ?? undefined);
    included = [
      t('share.countOptions', { count: s.options }),
      t('share.countFactors', { count: s.factors }),
      t('share.countFacts', { count: s.facts }),
      g.settings.weights === 'organizer' ? t('share.importanceSet') : t('share.importanceStart'),
      g.settings.scoring === 'blind' ? t('share.blindNone') : s.resultBallots ? t('share.openResults', { count: s.resultBallots }) : t('share.openNone'),
      g.settings.anonymity === 'anonymous' ? t('share.inviteAnonymous') : s.organizerName ? t('share.inviteNamedAs', { name: s.organizerName }) : t('share.inviteNamed'),
      t('share.signedDevice', { code: myCode ?? '…' }),
      t('share.inviteSealed'),
    ];
    leftOut = [
      t('share.ownScores', { count: s.ownScores }),
      t('share.notesStay', { count: s.notes }),
      ...(s.ballots ? [t('share.ballotsStay', { count: s.ballots })] : []),
    ];
    help = t('share.inviteHow');
    fileName = `${fileName}-invite`;
  } else if (kind === 'results' && result) {
    const s = resultsSummary(d, result);
    included = [
      t('share.countOptions', { count: s.options }),
      t('share.countFactors', { count: s.factors }),
      t('share.countFacts', { count: s.facts }),
      t('share.combined', { count: s.ballots }),
      t('share.countSharedNotes', { count: s.sharedNotes }),
    ];
    leftOut = [t('share.individualBallots', { count: s.individualBallots }), t('share.privateNotesStay', { count: s.privateNotes })];
    help = t('share.resultsHelp');
    fileName = `${fileName}-results`;
  } else {
    const shareKind = kind === 'template' ? 'template' : 'decision';
    const s = shareSummary(d, shareKind);
    included = [
      t('share.countOptions', { count: s.options }),
      t('share.countFactors', { count: s.factors }),
      t('share.countFacts', { count: s.facts }),
      ...(shareKind === 'decision' ? [t('share.countScores', { count: s.scores }), t('share.countSharedNotes', { count: s.sharedNotes })] : []),
    ];
    leftOut = [
      t('share.privateNotesStay', { count: s.privateNotes }),
      ...(shareKind === 'template' && s.scoresLeftOut ? [t('share.countScores', { count: s.scoresLeftOut })] : []),
      ...(shareKind === 'template' && s.notesLeftOut ? [t('share.countSharedNotes', { count: s.notesLeftOut })] : []),
      ...(s.ballotsLeftOut ? [t('share.ballotsStay', { count: s.ballotsLeftOut })] : []),
    ];
    help = shareKind === 'decision' ? t('share.kindDecisionHelp') : t('share.kindTemplateHelp');
    if (shareKind === 'template') fileName = safeFileName(d.title, 'template');
  }

  const kinds: { value: Kind; label: string }[] = [
    ...(organizer ? [{ value: 'invite' as const, label: t('share.kindInvite') }] : []),
    ...(organizer && result ? [{ value: 'results' as const, label: t('share.kindResults') }] : []),
    { value: 'decision', label: t('share.kindDecision') },
    { value: 'template', label: t('share.kindTemplate') },
  ];

  return (
    <Dialog title={t('share.title')} onClose={onClose}>
      <Segmented
        value={kind}
        label={t('share.what')}
        onChange={(k) => {
          setKind(k);
          setLink(null);
        }}
        options={kinds}
      />
      <p className="muted small">{help}</p>
      <Preview title={decisionTitle(d)} included={locking ? [...included, t('share.locked')] : included} leftOut={leftOut} />
      <PassphraseOption
        on={locking}
        value={passphrase}
        onToggle={(on) => {
          setLocking(on);
          setLink(null);
        }}
        onChange={(v) => {
          setPassphrase(v);
          setLink(null);
        }}
      />
      <p className="callout">{locking ? t('share.foreverLocked') : t('share.forever')}</p>
      {!link ? (
        <Actions
          disabled={busy || (kind === 'invite' && !myKey) || (locking && passphraseStrength(passphrase) === 'short')}
          onFile={() => run(async () => saveOutgoing(await outgoing(), fileName))}
          onLink={() => run(async () => setLink(await linkFor(await outgoing())))}
        />
      ) : (
        <LinkBox link={link} title={decisionTitle(d)} />
      )}
    </Dialog>
  );
}
