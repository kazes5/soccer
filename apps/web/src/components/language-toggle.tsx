'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { useLocale } from './locale-provider';

const buttonBase = `flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm font-medium ${focusRingClassName}`;
const activeClassName = `${buttonBase} bg-ink text-surface`;
const inactiveClassName = `${buttonBase} text-ink-muted hover:bg-surface-soft hover:text-ink`;

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
