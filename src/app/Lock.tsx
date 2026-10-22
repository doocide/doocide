// Passphrases: opening a locked link or file, unlocking the library at start, and turning the library
// lock on or off. These are the only places Doocide asks for a passphrase, and never for an account
// password; every screen says so.

import { useState, type FormEvent, type ReactNode } from 'react';
import { WrongKey } from '../format/crypto';
import { t } from '../i18n';
import { passphraseStrength } from './ShareDialog';
import { Dialog, Icon, Logo, useConfirm } from './ui';

/** A passphrase form: the field, the button, and what went wrong. `onSubmit` throws WrongKey for a passphrase that doesn't fit. */
function PassphraseForm({ label, action, onSubmit }: { label: string; action: string; onSubmit: (passphrase: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (err) {
      setError(err instanceof WrongKey ? t('unlock.wrong') : t('unlock.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="unlock-form" onSubmit={submit}>
      <input type="password" autoFocus autoComplete="off" aria-label={label} placeholder={label} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="button primary" type="submit" disabled={busy || !value}>
        {busy ? t('unlock.opening') : action}
      </button>
      {error && (
        <p className="callout warn small" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** A passphrase asked for in a dialog, over the decision: a group's locked results file, for example. */
export function PassphraseDialog({ title, text, onSubmit, onClose }: { title: string; text: string; onSubmit: (passphrase: string) => Promise<void>; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="small">{text}</p>
      <PassphraseForm label={t('unlock.passphrase')} action={t('unlock.open')} onSubmit={onSubmit} />
      <p className="muted small">{t('unlock.never')}</p>
    </Dialog>
  );
}

/** Someone sent a link or file locked with a passphrase. */
export function PassphrasePrompt({ backup, onOpen, onCancel }: { backup: boolean; onOpen: (passphrase: string) => Promise<void>; onCancel: () => void }) {
  return (
    <div className="unlock-page">
      <Icon name="lock" size={32} />
      <h1>{backup ? t('unlock.backupTitle') : t('unlock.shareTitle')}</h1>
      <p>{backup ? t('unlock.backupText') : t('unlock.shareText')}</p>
      <PassphraseForm label={t('unlock.passphrase')} action={t('unlock.open')} onSubmit={onOpen} />
      <p className="muted small">{t('unlock.never')}</p>
      <button className="link-button" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

/** The library is locked: nothing is shown until the passphrase opens it. */
export function LockScreen({ onUnlock, onErase }: { onUnlock: (passphrase: string) => Promise<void>; onErase: () => Promise<void> }) {
  const ask = useConfirm();
  return (
    <div className="unlock-page">
      <Logo />
      <Icon name="lock" size={32} />
      <h1>{t('lock.lockedTitle')}</h1>
      <p>{t('lock.lockedText')}</p>
      <PassphraseForm label={t('unlock.passphrase')} action={t('lock.unlock')} onSubmit={onUnlock} />
      <p className="muted small">{t('unlock.never')}</p>
      <details className="forgot">
        <summary>{t('lock.forgot')}</summary>
        <p className="small">{t('lock.forgotText')}</p>
        <button
          className="button danger"
          onClick={async () => {
            const ok = await ask({ title: t('lock.erase'), message: t('lock.confirmErase'), confirmLabel: t('lock.erase'), danger: true });
            if (ok) await onErase();
          }}
        >
          {t('lock.erase')}
        </button>
      </details>
    </div>
  );
}

/** Turning the library lock on (with the warning first) or off, and locking it now. */
export function LockDialog({
  on,
  onTurnOn,
  onTurnOff,
  onLockNow,
  onClose,
}: {
  on: boolean;
  onTurnOn: (passphrase: string) => Promise<void>;
  onTurnOff: (passphrase: string) => Promise<void>;
  onLockNow: () => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = passphraseStrength(first);
  const ready = strength !== 'short' && first === second && understood;

  let body: ReactNode;
  if (on) {
    body = (
      <>
        <p>{t('lock.onText')}</p>
        <div className="actions start">
          <button
            className="button primary"
            onClick={() => {
              onLockNow();
              onClose();
            }}
          >
            <Icon name="lock" size={18} />
            {t('lock.lockNow')}
          </button>
        </div>
        <h3>{t('lock.turnOff')}</h3>
        <p className="muted small">{t('lock.turnOffText')}</p>
        <PassphraseForm label={t('unlock.passphrase')} action={t('lock.turnOff')} onSubmit={async (p) => {
          await onTurnOff(p);
          onClose();
        }} />
      </>
    );
  } else {
    body = (
      <>
        <p>{t('lock.offText')}</p>
        <p className="callout warn small">{t('lock.warning')}</p>
        <label className="field">
          <span className="field-label">{t('unlock.passphrase')}</span>
          <input type="password" autoComplete="new-password" value={first} onChange={(e) => setFirst(e.target.value)} />
          <span className={strength === 'short' ? 'muted small warn-text' : 'muted small'}>{t(`share.strength.${strength}`)}</span>
        </label>
        <label className="field">
          <span className="field-label">{t('lock.repeat')}</span>
          <input type="password" autoComplete="new-password" value={second} onChange={(e) => setSecond(e.target.value)} />
          {second && first !== second && <span className="muted small warn-text">{t('lock.mismatch')}</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          {t('lock.understood')}
        </label>
        <p className="muted small">{t('lock.oldCopies')}</p>
        <div className="actions">
          <button
            className="button primary"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onTurnOn(first);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('unlock.opening') : t('lock.turnOn')}
          </button>
        </div>
      </>
    );
  }

  return (
    <Dialog title={t('lock.title')} onClose={onClose}>
      {body}
    </Dialog>
  );
}
