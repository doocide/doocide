// Every share starts here, and shows exactly what goes out before anything does.

import { useState } from 'react';
import { makeLink } from '../format/codec';
import { shareEnvelope, shareSummary, assertShareable, type ShareKind } from '../format/share';
import type { Decision } from '../format/types';
import { t } from '../i18n';
import { FILE_EXTENSION, canShareNatively, copyText, downloadText, safeFileName, shareNatively } from './files';
import { decisionTitle } from './labels';
import { Dialog, Icon, Segmented, useToast } from './ui';

/** Some chat apps cut links around this length. */
const LONG_LINK = 8_000;

export function ShareDialog({ d, onClose }: { d: Decision; onClose: () => void }) {
  const [kind, setKind] = useState<ShareKind>('decision');
  const [link, setLink] = useState<string | null>(null);
  const toast = useToast();
  const s = shareSummary(d, kind);

  const included = [
    t('share.countOptions', { count: s.options }),
    t('share.countFactors', { count: s.factors }),
    t('share.countFacts', { count: s.facts }),
    ...(kind === 'decision' ? [t('share.countScores', { count: s.scores }), t('share.countSharedNotes', { count: s.sharedNotes })] : []),
  ];
  const leftOut = [
    t('share.privateNotesStay', { count: s.privateNotes }),
    ...(kind === 'template' && s.scoresLeftOut ? [t('share.countScores', { count: s.scoresLeftOut })] : []),
    ...(kind === 'template' && s.notesLeftOut ? [t('share.countSharedNotes', { count: s.notesLeftOut })] : []),
  ];

  const build = async () => {
    const env = shareEnvelope(d, kind);
    assertShareable(env);
    setLink(await makeLink(env, location.href));
  };

  const saveFile = () => {
    const env = shareEnvelope(d, kind);
    assertShareable(env);
    const name = safeFileName(d.title, kind === 'template' ? 'template' : 'decision');
    downloadText(JSON.stringify(env, null, 2), `${name}${FILE_EXTENSION}`, 'application/json');
  };

  return (
    <Dialog title={t('share.title')} onClose={onClose}>
      <Segmented
        value={kind}
        label={t('share.what')}
        onChange={(k) => {
          setKind(k);
          setLink(null);
        }}
        options={[
          { value: 'decision', label: t('share.kindDecision') },
          { value: 'template', label: t('share.kindTemplate') },
        ]}
      />
      <p className="muted small">{kind === 'decision' ? t('share.kindDecisionHelp') : t('share.kindTemplateHelp')}</p>

      <div className="share-preview">
        <div>
          <h3>{t('share.included')}</h3>
          <ul>
            <li dir="auto">{decisionTitle(d)}</li>
            {included.map((x) => (
              <li key={x}>{x}</li>
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

      <p className="callout">{t('share.forever')}</p>

      {!link ? (
        <div className="actions">
          <button className="button" onClick={saveFile}>
            <Icon name="download" size={18} />
            {t('share.saveFile')}
          </button>
          <button className="button primary" onClick={build}>
            <Icon name="link" size={18} />
            {t('share.makeLink')}
          </button>
        </div>
      ) : (
        <>
          <textarea className="link-box" readOnly rows={3} value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={t('share.link')} />
          {link.length > LONG_LINK && <p className="callout warn small">{t('share.longLink')}</p>}
          <div className="actions">
            {canShareNatively() && (
              <button className="button" onClick={() => shareNatively({ title: decisionTitle(d), url: link })}>
                <Icon name="share" size={18} />
                {t('share.shareVia')}
              </button>
            )}
            <button
              className="button primary"
              onClick={async () => toast((await copyText(link)) ? t('share.copied') : t('share.copyFailed'))}
            >
              {t('share.copy')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
