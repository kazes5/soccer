'use client';

import { useLocale } from './locale-provider';

const buttonBase = 'rounded px-2 py-1 text-sm font-medium';
const activeClassName = `${buttonBase} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`;
const inactiveClassName = `${buttonBase} text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100`;

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="flex items-center gap-1" aria-label="Language">
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={locale === 'en' ? activeClassName : inactiveClassName}
        aria-pressed={locale === 'en'}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale('he')}
        className={locale === 'he' ? activeClassName : inactiveClassName}
        aria-pressed={locale === 'he'}
      >
        עב
      </button>
    </div>
  );
}
