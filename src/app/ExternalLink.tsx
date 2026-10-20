import { useState } from 'react';
import { checkLink } from '../format/sanitize';
import { t } from '../i18n';
import { Dialog, Icon } from './ui';

/**
 * A link written by a decision's author. Shows the real domain, flags look-alike domains, and asks
 * before opening, because Doocide never checked where it leads.
 */
export function ExternalLink({ url }: { url: string }) {
  const [confirming, setConfirming] = useState(false);
  const link = checkLink(url);
  if (!link) return null;
  return (
    <>
      <button type="button" className="ext-link" onClick={() => setConfirming(true)} title={link.href}>
        <Icon name="link" size={14} />
        <span className="ext-host" dir="ltr">
          {link.host}
        </span>
        {link.lookalike && <span className="badge warn">{t('link.lookalikeBadge')}</span>}
      </button>
      {confirming && (
        <Dialog title={t('link.title')} onClose={() => setConfirming(false)}>
          <p>{t('link.leadsTo')}</p>
          <p className="ext-confirm-host" dir="ltr">
            {link.host}
          </p>
          <p className="muted break" dir="ltr">
            {link.href}
          </p>
          {link.lookalike && <p className="callout warn">{t('link.lookalike')}</p>}
          <p className="muted">{t('link.unchecked')}</p>
          <div className="actions">
            <button className="button" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="button primary"
              onClick={() => {
                window.open(link.href, '_blank', 'noopener,noreferrer');
                setConfirming(false);
              }}
            >
              {t('link.open')}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
