'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';

export default function ResetPasswordPage() {
  const [token] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''),
  );
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({ token, password, passwordConfirmation });
      setComplete(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <h1 className="text-xl font-semibold">{t('recovery.resetTitle')}</h1>
      {complete ? (
        <>
          <p>{t('recovery.complete')}</p>
          <Link href="/login" className={buttonClassName}>
            {t('common.logIn')}
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t('invite.passwordLabel')}>
            <input
              required
              type="password"
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClassName}
            />
          </Field>
          <Field label={t('invite.passwordConfirmationLabel')}>
            <input
              required
              type="password"
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              className={inputClassName}
            />
          </Field>
          {error && <FormError>{error}</FormError>}
          <button disabled={busy || !token} className={buttonClassName}>
            {t('recovery.reset')}
          </button>
        </form>
      )}
    </main>
  );
}
