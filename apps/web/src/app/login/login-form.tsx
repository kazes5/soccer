'use client';

import {
  WebAuthnError,
  browserSupportsWebAuthn,
  startAuthentication,
} from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
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
      if (err instanceof ApiError && err.status === 404) {
        // Password auth is disabled server-side (PASSWORD_AUTH_ENABLED=false)
        // — the raw "Not found." body would otherwise read as a bug, so
        // point at the passkey button below instead, which still works.
        setError(t('login.passwordAuthUnavailable'));
      } else {
        setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasskeyLogin() {
    setError(null);

    if (!browserSupportsWebAuthn()) {
      setError(t('login.notSupported'));
      return;
    }

    setIsSubmitting(true);
    try {
      const loginIdentifier = identifier.includes('@')
        ? { email: identifier }
        : { phone: identifier };
      const { challengeId, options } = await api.getPasskeyLoginOptions(loginIdentifier);
      const response = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
      const session = await api.verifyPasskeyLogin({ challengeId, response });
      const fallback =
        session.systemRole === 'system_admin' && session.teamMemberships.length === 0
          ? '/system'
          : '/home';
      router.push(searchParams.get('next') ? safeNextPath(searchParams.get('next')) : fallback);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof WebAuthnError) {
        setError(t('login.cancelled'));
      } else {
        setError(t('common.somethingWentWrong'));
      }
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
      <button
        type="button"
        disabled={isSubmitting || !identifier.trim()}
        className={buttonClassName}
        onClick={handlePasskeyLogin}
      >
        {t('login.continueWithPasskey')}
      </button>
      <Link href="/forgot-password" className="text-center text-sm text-ink-muted underline">
        {t('login.forgotPassword')}
      </Link>
    </form>
  );
}
