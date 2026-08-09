'use client';

import type { CurrentUserResponse, TeamMembership } from '@soccer/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { buttonClassName, inputClassName } from '@/components/form-controls';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';
import { ApiError, api } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const { t } = useLocale();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  async function handleLogOut() {
    await api.logout().catch(() => {
      // Best-effort: even if the server call fails, still send the user home.
    });
    router.push('/');
  }

  if (status !== 'ready' || !session) {
    return null;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t('home.welcome', { name: session.user.name })}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {session.user.phone ?? session.user.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <button
            onClick={handleLogOut}
            className="text-sm text-zinc-500 underline hover:text-zinc-700"
          >
            {t('home.logOut')}
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          {t('home.yourTeams')}
        </h2>
        {session.teamMemberships.map((membership) => (
          <TeamCard key={membership.teamId} membership={membership} />
        ))}
      </section>
    </main>
  );
}

function TeamCard({ membership }: { membership: TeamMembership }) {
  const { t } = useLocale();
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const invite = await api.createInvite(membership.teamId, { phone });
      setInviteCode(invite.code);
      setPhone('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">{membership.teamName}</span>
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          {membership.role === 'admin' ? t('home.roleAdmin') : t('home.roleParent')}
        </span>
      </div>

      {membership.role === 'admin' && (
        <form onSubmit={handleInvite} className="mt-4 flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t('home.inviteLabel')}
          </label>
          <div className="flex gap-2">
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`${inputClassName} flex-1`}
              placeholder="+15551234567"
            />
            <button type="submit" disabled={isSubmitting} className={`${buttonClassName} text-sm`}>
              {isSubmitting ? t('home.inviteSubmitting') : t('home.inviteSubmit')}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {inviteCode && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {t('home.inviteLinkLabel')} <code>/invite/{inviteCode}</code>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
