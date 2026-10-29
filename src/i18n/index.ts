import { getLocales } from 'expo-localization';

import { useSettings } from '@/state/settingsStore';
import { de, type TranslationKey } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';
export type LanguageSetting = 'system' | Lang;
export type { TranslationKey };

const DICTS: Record<Lang, Record<TranslationKey, string>> = { de, en };

/** Phone language → app language. Everything that isn't German falls back to English. */
export function systemLang(): Lang {
  try {
    return getLocales()[0]?.languageCode === 'de' ? 'de' : 'en';
  } catch {
    return 'en';
  }
}

export function resolveLang(setting: LanguageSetting | undefined): Lang {
  return setting === 'de' || setting === 'en' ? setting : systemLang();
}

/** BCP 47 tag for number/date formatting. */
export const localeOf = (lang: Lang) => (lang === 'de' ? 'de-DE' : 'en-US');

type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: TranslationKey, vars?: Vars): string {
  const text = DICTS[lang][key] ?? DICTS.de[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Plural helper: uses "<base>.one" for 1, otherwise "<base>.other"; {count} is filled in. */
export function translatePlural(lang: Lang, base: 'common.tracks', count: number, vars?: Vars): string {
  const key = `${base}.${count === 1 ? 'one' : 'other'}` as TranslationKey;
  return translate(lang, key, { count, ...vars });
}

/** Current app language (outside React, e.g. in error messages). */
export const currentLang = (): Lang => resolveLang(useSettings.getState().language);

/** Non-React translation using the current language. */
export const t = (key: TranslationKey, vars?: Vars) => translate(currentLang(), key, vars);
export const tn = (base: 'common.tracks', count: number, vars?: Vars) => translatePlural(currentLang(), base, count, vars);

/** React hook: re-renders when the language setting changes. */
export function useT() {
  const setting = useSettings((s) => s.language);
  const lang = resolveLang(setting);
  return {
    lang,
    locale: localeOf(lang),
    t: (key: TranslationKey, vars?: Vars) => translate(lang, key, vars),
    tn: (base: 'common.tracks', count: number, vars?: Vars) => translatePlural(lang, base, count, vars),
  };
}
