'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, buttonClassName, inputClassName } from '@/components/form-controls';
import { ApiError, api } from '@/lib/api';
import { saveSession } from '@/lib/session';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          We sent a 6-digit code to <span className="font-medium">{phone}</span>.
        </p>
        <Field label="Code">
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
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting ? 'Verifying…' : 'Verify code'}
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setCode('');
            setError(null);
          }}
          className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Use a different phone number
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
      <Field label="Phone number">
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
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={isSubmitting} className={buttonClassName}>
        {isSubmitting ? 'Sending…' : 'Send code'}
      </button>
    </form>
  );
}
