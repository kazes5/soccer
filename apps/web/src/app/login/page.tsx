'use client';

import { Suspense } from 'react';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';
import LoginForm from './login-form';

export default function LoginPage() {
  const { t } = useLocale();

  return (
    <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('login.subtitle')}</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
