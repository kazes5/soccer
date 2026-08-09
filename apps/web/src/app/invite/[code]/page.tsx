'use client';

import type { InvitePreview } from '@soccer/contracts';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Field,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';
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
  const [players, setPlayers] = useState<PlayerDraft[]>([{ name: '', age: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedPhone, setAcceptedPhone] = useState<string | null>(null);

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await api.acceptInvite(code, {
        name,
        players: players
          .filter((player) => player.name.trim().length > 0)
          .map((player) => ({
            name: player.name.trim(),
            age: parsePlayerAge(player.age),
          })),
      });
      setAcceptedPhone(response.user.phone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (acceptedPhone) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t('invite.acceptedTitle')}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('invite.acceptedBody')}</p>
        <button
          onClick={() => router.push(`/login?phone=${encodeURIComponent(acceptedPhone)}`)}
          className={buttonClassName}
        >
          {t('invite.continueToLogin')}
        </button>
      </main>
    );
  }

  if (previewFailed) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t('invite.notFoundTitle')}</h1>
        <p className="text-sm text-red-600 dark:text-red-400">
          {previewErrorDetail ?? t('invite.notFoundTitle')}
        </p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('invite.loading')}</p>
      </main>
    );
  }

  if (preview.status !== 'pending') {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t('invite.expiredTitle')}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('invite.expiredBody')}</p>
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
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('invite.joinSubtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <button
                type="button"
                onClick={() => removePlayer(index)}
                className="px-2 text-zinc-500 hover:text-red-600"
                aria-label={t('invite.removePlayerAriaLabel')}
              >
                ✕
              </button>
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

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting ? t('invite.submitting') : t('invite.submit')}
        </button>
      </form>
    </main>
  );
}
