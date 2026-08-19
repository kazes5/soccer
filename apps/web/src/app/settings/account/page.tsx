'use client';

import type { CurrentUserResponse } from '@soccer/contracts';
import { Calendar, Home } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { useToast } from '@/components/ui/toast';
import {
  adminNavItems,
  notificationsNavItem,
  settingsNavItem,
  swapsNavItem,
} from '@/lib/admin-nav';
import { ApiError, api } from '@/lib/api';
import { buildLoginRedirect } from '@/lib/safe-redirect';

export default function AccountSettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setAuthStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setAuthStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace(buildLoginRedirect(pathname, searchParams.toString()));
    }
  }, [authStatus, router, pathname, searchParams]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const activeMembership = session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    ...(activeMembership ? [notificationsNavItem(activeMembership.teamId, t)] : []),
    ...(activeMembership ? [swapsNavItem(activeMembership.teamId, t)] : []),
    settingsNavItem(t, true),
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('settingsAccount.title')}</h1>

        <PasswordChangeSection />
      </div>
    </AppShell>
  );
}

function PasswordChangeSection() {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.passwordChange({
        currentPassword,
        password: newPassword,
        passwordConfirmation: newPasswordConfirmation,
      });
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirmation('');
      showToast(t('settingsAccount.passwordChanged'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-ink">
        {t('settingsAccount.passwordSectionTitle')}
      </h2>
      <Field label={t('settingsAccount.currentPasswordLabel')}>
        <input
          required
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className={inputClassName}
        />
      </Field>
      <Field label={t('settingsAccount.newPasswordLabel')}>
        <input
          required
          type="password"
          minLength={15}
          maxLength={128}
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className={inputClassName}
        />
      </Field>
      <Field label={t('settingsAccount.newPasswordConfirmationLabel')}>
        <input
          required
          type="password"
          minLength={15}
          maxLength={128}
          autoComplete="new-password"
          value={newPasswordConfirmation}
          onChange={(event) => setNewPasswordConfirmation(event.target.value)}
          className={inputClassName}
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <button type="submit" disabled={isSubmitting} className={`${buttonClassName} self-start`}>
        {isSubmitting
          ? t('settingsAccount.changingPassword')
          : t('settingsAccount.changePasswordButton')}
      </button>
    </form>
  );
}
