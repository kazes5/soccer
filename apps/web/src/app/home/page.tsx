'use client';

import { Copy, Home, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError, buttonClassName, inputClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { IconButton } from '@/components/ui/icon-button';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { clearSession, loadSession, type StoredSession } from '@/lib/session';

export default function HomePage() {
  const router = useRouter();
  const { t } = useLocale();
  const [session] = useState<StoredSession | null>(() => loadSession());
  const [activeTeamId, setActiveTeamId] = useState<string | null>(
    () => session?.teamMemberships[0]?.teamId ?? null,
  );
  const [confirmingLogOut, setConfirmingLogOut] = useState(false);

  useEffect(() => {
    if (!session) {
      router.replace('/login');
    }
  }, [session, router]);

  async function handleLogOut() {
    setConfirmingLogOut(false);
    if (session) {
      await api.logout(session.token).catch(() => {
        // Best-effort: even if the server call fails, still clear the local session.
      });
    }
    clearSession();
    router.push('/');
  }

  if (!session) {
    return null;
  }

  const activeMembership =
    session.teamMemberships.find((membership) => membership.teamId === activeTeamId) ??
    session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" />, active: true },
  ];

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      actions={
        <IconButton
          label={t('home.logOut')}
          icon={<LogOut className="size-5" aria-hidden="true" />}
          onClick={() => setConfirmingLogOut(true)}
        />
      }
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t('home.welcome', { name: session.user.name })}
          </h1>
          <p className="text-sm text-ink-muted">{session.user.phone ?? session.user.email}</p>
        </div>

        <TeamSwitcher
          ariaLabel={t('home.teamSwitcherLabel')}
          options={session.teamMemberships.map((membership) => ({
            id: membership.teamId,
            label: membership.teamName,
          }))}
          activeId={activeMembership?.teamId ?? ''}
          onChange={setActiveTeamId}
        />

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('home.yourTeams')}
          </h2>
          {activeMembership && (
            <DataList ariaLabel={t('home.yourTeams')}>
              <TeamCard membership={activeMembership} sessionToken={session.token} />
            </DataList>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmingLogOut}
        title={t('home.logOutConfirmTitle')}
        description={t('home.logOutConfirmBody')}
        confirmLabel={t('home.logOut')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onConfirm={handleLogOut}
        onCancel={() => setConfirmingLogOut(false)}
      />
    </AppShell>
  );
}

function TeamCard({
  membership,
  sessionToken,
}: {
  membership: StoredSession['teamMemberships'][number];
  sessionToken: string;
}) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const invite = await api.createInvite(membership.teamId, { phone }, sessionToken);
      setInviteCode(invite.code);
      setPhone('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteCode) return;
    const url = `${window.location.origin}/invite/${inviteCode}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      showToast(t('home.inviteCopied'), 'success');
    } catch {
      // Clipboard access can be denied or unavailable (e.g. non-HTTPS); the link
      // text stays visible on-screen either way, but don't claim success it didn't have.
      showToast(t('home.inviteCopyFailed'), 'error');
    }
  }

  return (
    <DataListItem>
      <div className="flex items-center justify-between">
        <span className="font-medium">{membership.teamName}</span>
        <span className="rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {membership.role === 'admin' ? t('home.roleAdmin') : t('home.roleParent')}
        </span>
      </div>

      {membership.role === 'admin' && (
        <form onSubmit={handleInvite} className="mt-4 flex flex-col gap-2">
          <label className="text-xs font-medium text-ink-muted">{t('home.inviteLabel')}</label>
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
          {error && <FormError>{error}</FormError>}
          {inviteCode && (
            <div className="flex items-center gap-2 text-sm text-status-mine-on">
              <span>
                {t('home.inviteLinkLabel')} <code>/invite/{inviteCode}</code>
              </span>
              <IconButton
                label={t('home.copyInviteLinkAriaLabel')}
                icon={<Copy className="size-4" aria-hidden="true" />}
                onClick={handleCopyInviteLink}
              />
            </div>
          )}
        </form>
      )}
    </DataListItem>
  );
}
