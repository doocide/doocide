import { useMemo, useState } from 'react';
import { computeResults } from '../engine';
import type { Decision } from '../format/types';
import { formatDate, setLang, t, useLang } from '../i18n';
import { UI_LANGUAGES } from '../i18n/languages';
import { backupStatus, type BackupStatus } from './backup';
import { AboutDialog, SafetyDialog } from './InfoDialogs';
import { decisionTitle, optionName } from './labels';
import { applyTheme, getTheme, setPrefLang, type Theme } from './prefs';
import { Icon, Logo, REPO_URL, useToast } from './ui';

interface Props {
  decisions: Decision[];
  /** Saving works at all in this browser. */
  persistent: boolean;
  /** The browser promised not to clear storage on its own (null: unknown). */
  persisted: boolean | null;
  /** Last backup time per decision id. */
  backups: Record<string, string>;
  onBackup: (id: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onTemplates: () => void;
  onImportTable: () => void;
  onOpenFile: () => void;
  onDelete: (id: string) => void;
  /** The library lock is on (and this library is unlocked, or it wouldn't show). */
  lockEnabled: boolean;
  onLockSettings: () => void;
  onLockNow: () => void;
}

export function LanguagePicker() {
  const lang = useLang();
  const toast = useToast();
  return (
    <label className="lang-picker">
      <Icon name="globe" size={18} />
      <select
        value={lang}
        aria-label={t('common.language')}
        onChange={async (e) => {
          const code = e.target.value;
          if (await setLang(code)) setPrefLang(code);
          else toast(t('common.languageFailed'));
        }}
      >
        {UI_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const next: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  return (
    <button
      className="icon-button"
      aria-label={t('theme.label', { theme: t(`theme.${theme}`) })}
      title={t('theme.label', { theme: t(`theme.${theme}`) })}
      onClick={() => {
        applyTheme(next[theme]);
        setTheme(next[theme]);
      }}
    >
      <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'contrast'} />
    </button>
  );
}

export function Library({
  decisions,
  persistent,
  persisted,
  backups,
  onBackup,
  onOpen,
  onNew,
  onTemplates,
  onImportTable,
  onOpenFile,
  onDelete,
  lockEnabled,
  onLockSettings,
  onLockNow,
}: Props) {
  const uiLang = useLang();
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<null | 'safety' | 'about'>(null);

  const cards = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return [...decisions]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((d) => !q || [d.title, ...d.options.map((o) => o.name), ...d.factors.map((f) => f.name)].some((s) => s.toLocaleLowerCase().includes(q)))
      .map((d) => {
        const winner = d.options.find((o) => o.id === computeResults(d).winnerId);
        return { d, best: winner ? optionName(d, winner, uiLang) : null, backup: backupStatus(d.updatedAt, backups[d.id]) };
      });
  }, [decisions, query, uiLang, backups]);

  const notBackedUp = decisions.filter((d) => backupStatus(d.updatedAt, backups[d.id]) !== 'current').length;

  /** The second line of a card: the best option, or where a participant's ballot stands. */
  const bestLine = (d: Decision, best: string | null) => {
    if (d.group?.role === 'participant') return d.group.sentAt ? t('library.ballotSent', { date: formatDate(d.group.sentAt) }) : t('library.ballotNotSent');
    return best ? t('library.best', { name: best }) : t('library.noWinner');
  };

  const backupLabel = (status: BackupStatus, id: string) => {
    const at = backups[id];
    if (status === 'never' || !at) return t('library.backupNever');
    return status === 'changed' ? t('library.backupChanged', { date: formatDate(at) }) : t('library.backupCurrent', { date: formatDate(at) });
  };

  return (
    <div className="library">
      <header className="topbar">
        <Logo />
        <span className="tagline">{t('app.tagline')}</span>
        <span className="spacer" />
        {lockEnabled && (
          <button className="icon-button" onClick={onLockNow} aria-label={t('lock.lockNow')} title={t('lock.lockNow')}>
            <Icon name="lock" />
          </button>
        )}
        <LanguagePicker />
        <ThemeToggle />
      </header>

      <main className="library-main">
        {!persistent && <p className="callout warn">{t('library.notSaved')}</p>}
        <section className={decisions.length ? 'hero compact' : 'hero'}>
          <h1>{t('library.heading')}</h1>
          {decisions.length === 0 && (
            <ol className="steps">
              <li>{t('library.step1')}</li>
              <li>{t('library.step2')}</li>
              <li>{t('library.step3')}</li>
            </ol>
          )}
          <div className="library-actions">
            <button className="button primary" onClick={onNew}>
              <Icon name="plus" size={18} />
              {t('library.new')}
            </button>
            <button className="button" onClick={onTemplates}>
              <Icon name="template" size={18} />
              {t('library.fromTemplate')}
            </button>
            <button className="button" onClick={onImportTable}>
              <Icon name="table" size={18} />
              {t('library.pasteTable')}
            </button>
            <button className="button" onClick={onOpenFile}>
              <Icon name="file" size={18} />
              {t('library.openFile')}
            </button>
          </div>
        </section>

        {decisions.length > 0 && (
          <section aria-labelledby="your-decisions">
            <div className="list-head">
              <h2 id="your-decisions">{t('library.yours')}</h2>
              <input type="search" className="search" placeholder={t('library.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('library.search')} />
            </div>
            {persistent && (
              <p className="storage-line">
                <Icon name="shield" size={16} />
                {persisted ? t('library.storageKept') : t('library.storageAtRisk')}
              </p>
            )}
            {persistent && notBackedUp > 0 && <p className={persisted ? 'callout small backup-nudge' : 'callout warn small backup-nudge'}>{t('library.nudge', { count: notBackedUp })}</p>}
            <ul className="decision-list">
              {cards.map(({ d, best, backup }) => (
                <li key={d.id}>
                  <button className="decision-card" onClick={() => onOpen(d.id)}>
                    <span className="dc-title" dir="auto" lang={d.lang}>
                      {decisionTitle(d)}
                    </span>
                    <span className="dc-best" dir="auto">
                      {bestLine(d, best)}
                    </span>
                    <span className="dc-meta">
                      {t('library.counts', { options: d.options.length, factors: d.factors.length })} ·{' '}
                      {d.group?.role === 'organizer' && <>{t('library.ballots', { count: d.group.ballots.length })} · </>}
                      {formatDate(d.updatedAt)} ·{' '}
                      <span className={`dc-backup ${backup}`}>{backupLabel(backup, d.id)}</span>
                    </span>
                  </button>
                  <button className="icon-button" onClick={() => onBackup(d.id)} aria-label={t('library.backup', { title: decisionTitle(d) })} title={t('library.backup', { title: decisionTitle(d) })}>
                    <Icon name="download" size={18} />
                  </button>
                  <button className="icon-button" onClick={() => onDelete(d.id)} aria-label={t('library.delete', { title: decisionTitle(d) })}>
                    <Icon name="trash" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="library-foot">
        <button className="link-button" onClick={() => setDialog('safety')}>
          <Icon name="shield" size={16} />
          {t('safety.title')}
        </button>
        {persistent && (
          <button className="link-button" onClick={onLockSettings}>
            <Icon name="lock" size={16} />
            {t('lock.title')}
          </button>
        )}
        <button className="link-button" onClick={() => setDialog('about')}>
          {t('about.title')}
        </button>
        {!__OFFLINE__ && (
          <a className="link-button" href="./doocide.html" download="doocide.html">
            <Icon name="download" size={16} />
            {t('library.offline')}
          </a>
        )}
        <a className="link-button" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          {t('about.contribute')}
        </a>
      </footer>
      {dialog === 'safety' && <SafetyDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
