'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, buttonClassName, inputClassName } from '@/components/form-controls';
import { ApiError, api } from '@/lib/api';
import { saveSession } from '@/lib/session';

export default function CreateTeamPage() {
  const router = useRouter();
  const [teamName, setTeamName] = useState('');
  const [season, setSeason] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await api.createTeam({ teamName, season, adminName, adminPhone });
      saveSession({
        token: response.sessionToken,
        expiresAt: response.sessionExpiresAt,
        user: response.admin,
        teamMemberships: [
          { teamId: response.team.id, teamName: response.team.name, role: 'admin' },
        ],
      });
      router.push('/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create a team</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          You&apos;ll be set up as the team&apos;s first admin.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Team name">
          <input
            required
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className={inputClassName}
            placeholder="U-12 Wildcats"
          />
        </Field>
        <Field label="Season">
          <input
            required
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className={inputClassName}
            placeholder="Fall 2026"
          />
        </Field>
        <Field label="Your name">
          <input
            required
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            className={inputClassName}
            placeholder="Dana Cohen"
          />
        </Field>
        <Field label="Your phone number">
          <input
            required
            type="tel"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value)}
            className={inputClassName}
            placeholder="+15551234567"
          />
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={isSubmitting} className={buttonClassName}>
          {isSubmitting ? 'Creating…' : 'Create team'}
        </button>
      </form>
    </main>
  );
}
