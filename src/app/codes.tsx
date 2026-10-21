// Short codes: twelve digits two people read to each other to check that a ballot or an invite
// really comes from the key they think it does.

import { useEffect, useState } from 'react';
import { shortCode } from '../format/crypto';
import { t } from '../i18n';
import { deviceKey } from './keys';
import { Dialog, Icon } from './ui';

/** The short code for a public key, once it's computed. */
export function useShortCode(key: string | undefined): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCode(null);
    if (key) shortCode(key).then((c) => live && setCode(c), () => {});
    return () => {
      live = false;
    };
  }, [key]);
  return code;
}

/** This device's public key (made the first time it's needed). */
export function useDeviceKey(enabled = true): string | undefined {
  const [key, setKey] = useState<string>();
  useEffect(() => {
    let live = true;
    if (enabled) deviceKey().then((s) => live && setKey(s.publicKey), () => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  return key;
}

interface Props {
  /** What to ask the other person to do. */
  intro: string;
  publicKey: string;
  matched: boolean;
  onMatch: () => void;
  /** Undo a match made by mistake. */
  onUnmatch?: () => void;
  onClose: () => void;
}

export function CompareCodes({ intro, publicKey, matched, onMatch, onUnmatch, onClose }: Props) {
  const code = useShortCode(publicKey);
  return (
    <Dialog title={t('code.title')} onClose={onClose}>
      <p>{intro}</p>
      <p className="code" aria-live="polite">
        {code ?? '…'}
      </p>
      {matched ? (
        <>
          <p className="callout small">
            <Icon name="check" size={14} /> {t('code.matched')}
          </p>
          <div className="actions">
            {onUnmatch && (
              <button
                className="button"
                onClick={() => {
                  onUnmatch();
                  onClose();
                }}
              >
                {t('code.undo')}
              </button>
            )}
            <button className="button primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">{t('code.differ')}</p>
          <div className="actions">
            <button className="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              className="button primary"
              disabled={!code}
              onClick={() => {
                onMatch();
                onClose();
              }}
            >
              {t('code.match')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
