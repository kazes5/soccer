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

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [players, setPlayers] = useState<PlayerDraft[]>([{ name: '', age: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedPhone, setAcceptedPhone] = useState<string | null>(null);

  useEffect(() => {
    api
      .getInvitePreview(code)
      .then(setPreview)
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : 'Invite not found.'));
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (acceptedPhone) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">You&apos;re on the team!</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Next, log in with your phone number to see the schedule.
        </p>
        <button
          onClick={() => router.push(`/login?phone=${encodeURIComponent(acceptedPhone)}`)}
          className={buttonClassName}
        >
          Continue to login
        </button>
      </main>
    );
  }

  if (previewError) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Invite not found</h1>
        <p className="text-sm text-red-600 dark:text-red-400">{previewError}</p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading invite…</p>
      </main>
    );
  }

  if (preview.status !== 'pending') {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight">This invite is no longer valid</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ask your team admin to send a new one.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Join {preview.team.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tell us who you are and which players are yours.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Your name">
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
          <span className="text-sm font-medium">Players (optional)</span>
          {players.map((player, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={player.name}
                onChange={(e) => updatePlayer(index, { name: e.target.value })}
                className={`${inputClassName} flex-1`}
                placeholder="Player name"
              />
              <input
                value={player.age}
                onChange={(e) => updatePlayer(index, { age: e.target.value })}
                className={`${inputClassName} w-20`}
                placeholder="Age"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={() => removePlayer(index)}
                className="px-2 text-zinc-500 hover:text-red-600"
                aria-label="Remove player"
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
            Add another player
          </button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting ? 'Joining…' : 'Join team'}
        </button>
      </form>
    </main>
  );
}
