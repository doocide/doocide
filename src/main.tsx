import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme, getPrefLang, getTheme } from './app/prefs';
import { ConfirmHost, ToastHost } from './app/ui';
import { setLang } from './i18n';
import { isUiLanguage } from './i18n/languages';
import './styles.css';

function preferredLanguage(): string {
  const saved = getPrefLang();
  if (saved && isUiLanguage(saved)) return saved;
  for (const lang of navigator.languages ?? []) {
    if (isUiLanguage(lang)) return lang;
    const base = lang.split('-')[0]!;
    if (isUiLanguage(base)) return base;
  }
  return 'en';
}

async function start() {
  applyTheme(getTheme());
  await setLang(preferredLanguage());
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ToastHost>
        <ConfirmHost>
          <App />
        </ConfirmHost>
      </ToastHost>
    </StrictMode>,
  );
}

start();
