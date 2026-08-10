'use client';

import {
  WebAuthnError,
  browserSupportsWebAuthn,
  startAuthentication,
} from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [phone, setPhone] = useState(searchParams.get('phone') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!browserSupportsWebAuthn()) {
      setError(t('login.notSupported'));
      return;
    }

    setIsSubmitting(true);
    try {
      const { challengeId, options } = await api.getPasskeyLoginOptions({ phone });
      const response = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
      await api.verifyPasskeyLogin({ challengeId, response });
      router.push('/home');
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
      <Field label={t('login.phoneLabel')}>
        <input
          required
          type="tel"
          autoFocus
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClassName}
          placeholder="+15551234567"
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <button type="submit" disabled={isSubmitting} className={buttonClassName}>
        {isSubmitting ? t('login.authenticating') : t('login.continueWithPasskey')}
      </button>
    </form>
  );
}
