'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';
import { saveSession } from '@/lib/session';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [phone, setPhone] = useState(searchParams.get('phone') ?? '');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequestOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await api.requestOtp({ phone });
      setChallengeId(response.challengeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!challengeId) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await api.verifyOtp({ challengeId, code });
      saveSession({
        token: response.sessionToken,
        expiresAt: response.expiresAt,
        user: response.user,
        teamMemberships: response.teamMemberships,
      });
      router.push('/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{t('login.codeSentTo', { phone })}</p>
        <Field label={t('login.codeLabel')}>
          <input
            required
            autoFocus
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClassName}
            placeholder="123456"
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting ? t('login.verifying') : t('login.verifyCode')}
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setCode('');
            setError(null);
          }}
          className="min-h-11 text-sm text-ink-muted underline hover:text-ink"
        >
          {t('login.useDifferentPhone')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
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
        {isSubmitting ? t('login.sending') : t('login.sendCode')}
      </button>
    </form>
  );
}
