'use client';

import Link from 'next/link';
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
        <p className="text-zinc-600 dark:text-zinc-400">{t('common.tagline')}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login"
          className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
        >
          {t('common.logIn')}
        </Link>
        <Link
          href="/teams/new"
          className="rounded-md border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t('common.createNewTeam')}
        </Link>
      </div>
    </main>
  );
}
