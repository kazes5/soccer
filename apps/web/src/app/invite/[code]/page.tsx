'use client';

import type { InvitePreview } from '@soccer/contracts';
import { WebAuthnError, browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Field,
  FormError,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';
import { IconButton } from '@/components/ui/icon-button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

interface PlayerDraft {
  name: string;
  age: string;
}

/** Mirrors the server's `acceptInvitePlayerSchema` age bounds (positive integer, max 25). */
function parsePlayerAge(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 25 ? parsed : undefined;
}

export default function AcceptInvitePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();
  const { t } = useLocale();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewErrorDetail, setPreviewErrorDetail] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [onboardingCode, setOnboardingCode] = useState('');
  const [verificationToken, setVerificationToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.sessionStorage.getItem(`invite-grant:${code}`),
  );
  const [existingAccount, setExistingAccount] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.sessionStorage.getItem(`invite-grant:${code}`) !== null,
  );
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [players, setPlayers] = useState<PlayerDraft[]>([{ name: '', age: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    api
      .getInvitePreview(code)
      .then(setPreview)
      .catch((err) => {
        setPreviewFailed(true);
        setPreviewErrorDetail(err instanceof ApiError ? err.message : null);
      });
  }, [code]);

  function updatePlayer(index: number, patch: Partial<PlayerDraft>) {
    setPlayers((current) =>
      current.map((player, i) => (i === index ? { ...player, ...patch } : player)),
    );
  }

  function addPlayer() {
    setPlayers((current) => [...current, { name: '', age: '' }]);
  }

  function removePlayer(index: number) {
    setPlayers((current) => current.filter((_, i) => i !== index));
  }

  async function registerPasskey() {
    setError(null);
    if (!browserSupportsWebAuthn()) {
      setError(t('invite.passkeyNotSupported'));
      return;
    }
    setIsSubmitting(true);
    try {
      const { challengeId, options } = await api.getInvitePasskeyRegisterOptions(code);
      const response = await startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      });
      await api.verifyInvitePasskeyRegister(code, { challengeId, response });
      router.push('/home');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof WebAuthnError) {
        setError(t('invite.passkeyCancelled'));
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
      if (preview?.requiresCode) {
        if (!verificationToken) {
          const verified = await api.verifyInviteCode(code, { code: onboardingCode });
          setVerificationToken(verified.verificationToken);
          setExistingAccount(verified.existingAccount);
          setIsSubmitting(false);
          return;
        }
        if (existingAccount) {
          try {
            await api.attachExistingAccountInvite(code, { verificationToken });
            window.sessionStorage.removeItem(`invite-grant:${code}`);
            router.push('/home');
          } catch (attachError) {
            if (attachError instanceof ApiError && attachError.status === 401) {
              window.sessionStorage.setItem(`invite-grant:${code}`, verificationToken);
              router.push(`/login?next=${encodeURIComponent(`/invite/${code}`)}`);
              return;
            }
            throw attachError;
          }
          return;
        }
        await api.completePasswordOnboarding(code, {
          verificationToken,
          name,
          password,
          passwordConfirmation,
          players: players
            .filter((player) => player.name.trim().length > 0)
            .map((player) => ({ name: player.name.trim(), age: parsePlayerAge(player.age) })),
        });
        router.push('/home');
        return;
      }
      await api.acceptInvite(code, {
        name,
        players: players
          .filter((player) => player.name.trim().length > 0)
          .map((player) => ({
            name: player.name.trim(),
            age: parsePlayerAge(player.age),
          })),
      });
      // The account now exists — from here on, failure only affects passkey
      // setup, never re-accepts the invite.
      setAccepted(true);
      await registerPasskey();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
      setIsSubmitting(false);
    }
  }

  if (accepted) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t('invite.acceptedTitle')}</h1>
        <p className="text-sm text-ink-muted">{t('invite.acceptedBody')}</p>
        {error && <FormError>{error}</FormError>}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={registerPasskey}
          className={buttonClassName}
        >
          {isSubmitting ? t('invite.passkeySettingUp') : t('common.retry')}
        </button>
      </main>
    );
  }

  if (previewFailed) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
        <ErrorState
          title={t('invite.notFoundTitle')}
          description={previewErrorDetail ?? t('invite.notFoundBody')}
        />
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
        <LoadingState label={t('invite.loading')} />
      </main>
    );
  }

  if (preview.status !== 'pending') {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
        <EmptyState title={t('invite.expiredTitle')} description={t('invite.expiredBody')} />
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div className="absolute top-4 end-4">
        <LanguageToggle />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t('invite.joinTitle', { teamName: preview.team.name })}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t('invite.joinSubtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {preview.requiresCode && !verificationToken && (
          <Field label={t('invite.codeLabel')}>
            <input
              required
              autoFocus
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={onboardingCode}
              onChange={(event) => setOnboardingCode(event.target.value.replace(/\D/g, ''))}
              className={inputClassName}
            />
          </Field>
        )}
        {(!preview.requiresCode || verificationToken) && !existingAccount && (
          <>
            <Field label={t('invite.yourNameLabel')}>
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClassName}
                placeholder="Avi Levi"
              />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('invite.playersLabel')}</span>
              {players.map((player, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={player.name}
                    onChange={(e) => updatePlayer(index, { name: e.target.value })}
                    className={`${inputClassName} flex-1`}
                    placeholder={t('invite.playerNamePlaceholder')}
                  />
                  <input
                    value={player.age}
                    onChange={(e) => updatePlayer(index, { age: e.target.value })}
                    className={`${inputClassName} w-20`}
                    placeholder={t('invite.agePlaceholder')}
                    inputMode="numeric"
                  />
                  <IconButton
                    label={t('invite.removePlayerAriaLabel')}
                    icon={<X className="size-4" aria-hidden="true" />}
                    variant="danger"
                    onClick={() => removePlayer(index)}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addPlayer}
                className={`${secondaryButtonClassName} text-sm`}
              >
                {t('invite.addPlayer')}
              </button>
            </div>

            {preview.requiresCode && (
              <>
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
              </>
            )}
          </>
        )}

        {existingAccount && (
          <p className="text-sm text-ink-muted">{t('invite.existingAccountBody')}</p>
        )}

        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting
            ? t('invite.submitting')
            : preview.requiresCode && !verificationToken
              ? t('invite.verifyCode')
              : existingAccount
                ? t('invite.attachExistingAccount')
                : t('invite.submit')}
        </button>
      </form>
    </main>
  );
}
