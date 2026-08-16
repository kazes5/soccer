'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword({ identifier });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-5 p-8">
      <div>
        <h1 className="text-xl font-semibold">{t('recovery.forgotTitle')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('recovery.forgotBody')}</p>
      </div>
      {sent ? (
        <p>{t('recovery.sent')}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t('login.identifierLabel')}>
            <input
              required
              autoComplete="username"
              dir="ltr"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className={inputClassName}
            />
          </Field>
          {error && <FormError>{error}</FormError>}
          <button disabled={busy} className={buttonClassName}>
            {t('recovery.send')}
          </button>
        </form>
      )}
      <Link href="/login" className="text-sm underline">
        {t('common.logIn')}
      </Link>
    </main>
  );
}
