// The lock badge on a decision's page: where the decision lives. A saved one is on this device only; a
// preview came inside a link or a file, never from the site, which only delivers the app. Tapping it
// says so in a few lines, including what it doesn't protect against (anyone who can open this browser).

import { useState } from 'react';
import { t } from '../i18n';
import { isPersistent, lockOn } from './store';
import { Dialog, Icon } from './ui';

/** Where the decision on screen is: saved here, or a preview of a link or file someone opened. */
export type Whereabouts = 'saved' | 'link' | 'file';

export function PrivacyBadge({ where }: { where: Whereabouts }) {
  const [open, setOpen] = useState(false);
  const label = where === 'saved' ? t('privacy.badge') : where === 'link' ? t('privacy.badgeLink') : t('privacy.badgeFile');
  const lines =
    where === 'saved'
      ? [
          isPersistent() ? t('privacy.saved1') : t('library.notSaved'),
          t('privacy.saved2'),
          t('privacy.saved3'),
          lockOn() ? t('privacy.locked') : t('privacy.unlocked'),
        ]
      : [t('privacy.incoming1'), t('privacy.incoming2')];
  return (
    <>
      <button className="privacy-badge" aria-haspopup="dialog" aria-label={label} onClick={() => setOpen(true)}>
        <Icon name="lock" size={16} />
        <span className="hide-narrow">{label}</span>
      </button>
      {open && (
        <Dialog title={where === 'saved' ? t('privacy.savedTitle') : t('privacy.incomingTitle')} onClose={() => setOpen(false)}>
          <ul className="safety">
            {lines.map((line) => (
              <li key={line}>
                <Icon name="lock" size={18} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}
