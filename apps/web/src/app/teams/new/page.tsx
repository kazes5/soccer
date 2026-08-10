'use client';

import { WebAuthnError, browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';

export default function CreateTeamPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [teamName, setTeamName] = useState('');
  const [season, setSeason] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [teamCreated, setTeamCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function registerPasskey() {
    setError(null);
    if (!browserSupportsWebAuthn()) {
      setError(t('teamsNew.passkeyNotSupported'));
      return;
    }
    setIsSubmitting(true);
    try {
      const { challengeId, options } = await api.getPasskeyRegisterOptions();
      const response = await startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      });
      await api.verifyPasskeyRegister({ challengeId, response });
      router.push('/home');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof WebAuthnError) {
        setError(t('teamsNew.passkeyCancelled'));
      } else {
        setError(t('common.somethingWentWrong'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.createTeam({ teamName, season, adminName, adminPhone });
      // The team (and the admin's cookie session) now exist — from here on,
      // failure only affects passkey setup, never re-creates the team.
      setTeamCreated(true);
      await registerPasskey();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
      setIsSubmitting(false);
    }
  }

  if (teamCreated) {
    return (
      <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8 text-center">
        <div className="absolute top-4 end-4">
          <LanguageToggle />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('teamsNew.passkeyTitle')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('teamsNew.passkeySubtitle')}</p>
        </div>
        {error && <FormError>{error}</FormError>}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={registerPasskey}
          className={buttonClassName}
        >
          {isSubmitting ? t('teamsNew.passkeySettingUp') : t('common.retry')}
        </button>
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('teamsNew.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('teamsNew.subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('teamsNew.teamNameLabel')}>
          <input
            required
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className={inputClassName}
            placeholder="U-12 Wildcats"
          />
        </Field>
        <Field label={t('teamsNew.seasonLabel')}>
          <input
            required
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className={inputClassName}
            placeholder="Fall 2026"
          />
        </Field>
        <Field label={t('teamsNew.yourNameLabel')}>
          <input
            required
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            className={inputClassName}
            placeholder="Dana Cohen"
          />
        </Field>
        <Field label={t('teamsNew.phoneLabel')}>
          <input
            required
            type="tel"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value)}
            className={inputClassName}
            placeholder="+15551234567"
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting ? t('teamsNew.submitting') : t('teamsNew.submit')}
        </button>
      </form>
    </main>
  );
}
