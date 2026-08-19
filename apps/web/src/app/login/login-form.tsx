'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';
import { safeNextPath } from '@/lib/safe-redirect';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [identifier, setIdentifier] = useState(searchParams.get('phone') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);
    try {
      const session = await api.passwordLogin({ identifier, password });
      const fallback =
        session.systemRole === 'system_admin' && session.teamMemberships.length === 0
          ? '/system'
          : '/home';
      router.push(searchParams.get('next') ? safeNextPath(searchParams.get('next')) : fallback);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col gap-4">
      <Field label={t('login.identifierLabel')}>
        <input
          required
          type="text"
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className={inputClassName}
          placeholder="+15551234567"
          dir="ltr"
          autoComplete="username"
        />
      </Field>
      <Field label={t('login.passwordLabel')}>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClassName}
          autoComplete="current-password"
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <button type="submit" disabled={isSubmitting} className={buttonClassName}>
        {isSubmitting ? t('login.authenticating') : t('common.logIn')}
      </button>
      <Link href="/forgot-password" className="text-center text-sm text-ink-muted underline">
        {t('login.forgotPassword')}
      </Link>
    </form>
  );
}
