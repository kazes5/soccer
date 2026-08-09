'use client';

import Link from 'next/link';
import { buttonClassName, secondaryButtonClassName } from '@/components/form-controls';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';

export default function Home() {
  const { t } = useLocale();

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-6 p-16 text-center">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('common.appName')}</h1>
        <p className="text-ink-muted">{t('common.tagline')}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/login" className={buttonClassName}>
          {t('common.logIn')}
        </Link>
        <Link href="/teams/new" className={secondaryButtonClassName}>
          {t('common.createNewTeam')}
        </Link>
      </div>
    </main>
  );
}
