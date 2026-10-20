import { useEffect, useState } from 'react';
import { loadTemplateIndexText } from '@packs';
import { t } from '../i18n';
import { nativeName } from '../i18n/languages';
import { Dialog, Icon, REPO_URL } from './ui';

export function SafetyDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t('safety.title')} onClose={onClose}>
      <ul className="safety">
        {[1, 2, 3, 4, 5].map((n) => (
          <li key={n}>
            <Icon name="shield" size={18} />
            <span>{t(`safety.${n}`)}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t('about.title')} onClose={onClose}>
      <p>{t('about.body')}</p>
      <p>{t('about.method')}</p>
      <p className="muted">{t('about.license')}</p>
      <p>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          {REPO_URL.replace('https://', '')}
        </a>
      </p>
      <p className="muted small">{t('about.version', { version: '0.1.0' })}</p>
    </Dialog>
  );
}

interface TemplateInfo {
  name: string;
  title: string;
  lang: string;
  options: number;
  factors: number;
}

function readIndex(text: string | null): TemplateInfo[] | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return null;
    return raw.flatMap((x) =>
      x && typeof x.name === 'string' && /^[a-z0-9-]{1,64}$/.test(x.name)
        ? [{ name: x.name, title: String(x.title).slice(0, 200), lang: String(x.lang).slice(0, 35), options: Number(x.options) || 0, factors: Number(x.factors) || 0 }]
        : [],
    );
  } catch {
    return null;
  }
}

export function TemplatesDialog({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<TemplateInfo[] | null | 'loading'>('loading');
  useEffect(() => {
    loadTemplateIndexText().then((text) => setTemplates(readIndex(text)));
  }, []);
  return (
    <Dialog title={t('templates.title')} onClose={onClose}>
      {templates === 'loading' && <p className="muted">{t('common.loading')}</p>}
      {templates === null && <p className="callout warn">{t('templates.unavailable')}</p>}
      {Array.isArray(templates) && (
        <ul className="template-list">
          {templates.map((tpl) => (
            <li key={tpl.name}>
              <button className="template-card" onClick={() => onPick(tpl.name)}>
                <span className="dc-title" dir="auto" lang={tpl.lang}>
                  {tpl.title}
                </span>
                <span className="dc-meta">
                  {t('library.counts', { options: tpl.options, factors: tpl.factors })} · {nativeName(tpl.lang)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
