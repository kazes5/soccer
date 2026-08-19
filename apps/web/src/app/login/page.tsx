'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';
import LoginForm from './login-form';

// The system-admin console has no self-service onboarding (CLAUDE.md §9.2) —
// this exceptional MVP-pilot admin account (see
// apps/api/src/scripts/bootstrap-super-admin.ts) is the only way in, so a
// plain "sign in" form makes little sense for it. Detected the same way
// LoginForm already picks its post-login destination for this account
// (?next=/system, or the systemRole+no-team-memberships fallback after a
// normal login) — not a separate route, so the CSRF-protected POST target
// and redirect handling stay unified.
function LoginHeading() {
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const isSystemLogin = searchParams.get('next') === '/system';

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">
        {isSystemLogin ? t('login.systemWelcomeTitle') : t('login.title')}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {isSystemLogin ? t('login.systemPasswordSubtitle') : t('login.passwordSubtitle')}
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <Suspense>
        <LoginHeading />
      </Suspense>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
