import { en, he, type MessageKey } from './messages';

export type { MessageKey } from './messages';

export const locales = ['en', 'he'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return locale === 'he';
}

export function directionFor(locale: Locale): 'ltr' | 'rtl' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, he };

const intlLocaleTag: Record<Locale, string> = {
  en: 'en-US',
  he: 'he-IL',
};

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, paramName: string) => {
    const value = params[paramName];
    return value === undefined ? match : String(value);
  });
}

export function formatDate(
  locale: Locale,
  value: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(intlLocaleTag[locale], options).format(value);
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocaleTag[locale], options).format(value);
}
