// Per-device conveniences only (language, theme). Never decision data.

export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'doocide.prefs';

interface Prefs {
  lang?: string;
  theme?: Theme;
  /** When each decision was last backed up to a file, by decision id. Ids and dates only. */
  backups?: Record<string, string>;
}

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

function write(patch: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // Storage blocked (private window, file://): preferences just won't persist.
  }
}

export const getPrefLang = () => (typeof read().lang === 'string' ? read().lang : undefined);
export const setPrefLang = (lang: string) => write({ lang });

export function getTheme(): Theme {
  const theme = read().theme;
  return theme === 'light' || theme === 'dark' ? theme : 'auto';
}

export function getBackups(): Record<string, string> {
  const raw = read().backups;
  if (typeof raw !== 'object' || raw === null) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string'));
}

export function markBackedUp(id: string) {
  write({ backups: { ...getBackups(), [id]: new Date().toISOString() } });
}

export function forgetBackup(id: string) {
  const backups = getBackups();
  delete backups[id];
  write({ backups });
}

export function applyTheme(theme: Theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  write({ theme });
}
