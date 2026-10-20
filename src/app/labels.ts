import type { Decision, Factor, Option } from '../format/types';
import { t } from '../i18n';

/** Name in the viewer's language when the author added a translation, else the original. */
export function optionName(d: Decision, o: Option, uiLang: string): string {
  const name = (uiLang !== d.lang && o.l10n?.[uiLang]?.name) || o.name;
  return name || t('option.unnamed', { n: d.options.indexOf(o) + 1 });
}

export function factorName(d: Decision, f: Factor, uiLang: string): string {
  const name = (uiLang !== d.lang && f.l10n?.[uiLang]?.name) || f.name;
  return name || t('factor.unnamed', { n: d.factors.indexOf(f) + 1 });
}

export function factorGuide(d: Decision, f: Factor, uiLang: string): string | undefined {
  return (uiLang !== d.lang && f.l10n?.[uiLang]?.guide) || f.guide;
}

export const decisionTitle = (d: Decision) => d.title || t('decision.untitled');
