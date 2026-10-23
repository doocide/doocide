import { useSyncExternalStore } from 'react';
import { loadLocaleText } from '@packs';
import en from './locales/en.json';
import { formatMessage, type Vars } from './format';
import { isRtl, isUiLanguage } from './languages';
import { makeTranslator, type Translator } from './translator';

type Dict = Record<string, string>;

const english: Dict = en;
let lang = 'en';
let dict: Dict = english;
const listeners = new Set<() => void>();

/** Language packs are plain string maps; anything else is ignored. */
function readPack(text: string | null): Dict | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const out: Dict = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.length <= 2_000 && Object.hasOwn(english, key)) out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

export const getLang = () => lang;

const packs = new Map<string, Dict>([['en', english]]);

/**
 * A translator for one supported language, apart from the interface's (a summary written for others,
 * say). Its pack loads the first time, from the app's own address. null when it can't be loaded.
 */
export async function translatorFor(code: string): Promise<Translator | null> {
  if (!isUiLanguage(code)) return null;
  let pack = code === lang ? dict : packs.get(code);
  if (!pack) {
    const loaded = readPack(await loadLocaleText(code));
    if (!loaded) return null;
    packs.set(code, loaded);
    pack = loaded;
  }
  return makeTranslator(code, pack, english);
}

export async function setLang(code: string): Promise<boolean> {
  if (!isUiLanguage(code)) return false;
  const next = code === 'en' ? english : readPack(await loadLocaleText(code));
  if (!next) return false;
  lang = code;
  dict = next;
  document.documentElement.lang = code;
  document.documentElement.dir = isRtl(code) ? 'rtl' : 'ltr';
  listeners.forEach((l) => l());
  return true;
}

export function t(key: string, vars?: Vars): string {
  return formatMessage(dict[key] ?? english[key] ?? key, vars, lang);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders the calling component when the interface language changes. */
export const useLang = () => useSyncExternalStore(subscribe, getLang);

/** `day`: the date was cut back to midnight UTC (anonymous ballots), so show it in UTC or it may read as the day before. */
export function formatDate(iso: string, day = false): string {
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', ...(day && { timeZone: 'UTC' }) }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(n);
}
