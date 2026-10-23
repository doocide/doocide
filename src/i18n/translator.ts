// Text in one chosen language, apart from the interface's: for writing meant for others, like a
// selection summary in the language its readers need. Plain functions, no app state.

import { formatMessage, type Vars } from './format';

export type Pack = Record<string, string>;

export interface Translator {
  lang: string;
  t: (key: string, vars?: Vars) => string;
  number: (n: number, digits?: number) => string;
}

/** Messages from `pack`, falling back to `fallback` (English) for anything missing; numbers in that language's format. */
export function makeTranslator(lang: string, pack: Pack, fallback: Pack): Translator {
  return {
    lang,
    t: (key, vars) => formatMessage(pack[key] ?? fallback[key] ?? key, vars, lang),
    number: (n, digits = 0) => new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(n),
  };
}
