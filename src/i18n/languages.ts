/** Interface languages with a pack in src/i18n/locales. Add a pack file and a line here. */
export const UI_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ro', name: 'Română' },
];

/** Languages a decision's content can be marked as written in. */
export const CONTENT_LANGUAGES = [
  'en', 'zh-Hans', 'zh-Hant', 'hi', 'es', 'fr', 'ar', 'bn', 'pt-BR', 'pt-PT', 'ru', 'ur', 'id', 'de', 'ja',
  'sw', 'mr', 'te', 'tr', 'ta', 'vi', 'ko', 'it', 'fa', 'pl', 'uk', 'nl', 'th', 'ro', 'he', 'fil', 'ms',
  'el', 'cs', 'sv', 'hu', 'da', 'fi', 'no', 'sk', 'bg', 'hr', 'sr', 'lt', 'lv', 'et', 'sl', 'ca', 'ha', 'yo',
];

const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ckb', 'ug']);

export const isRtl = (code: string) => RTL.has(code.split('-')[0]!.toLowerCase());

export const isUiLanguage = (code: string) => UI_LANGUAGES.some((l) => l.code === code);

/** Language name in its own language, e.g. "Deutsch", falling back to the code. */
export function nativeName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
}
