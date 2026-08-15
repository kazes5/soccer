'use client';

import type { SystemOverview, SystemTeam, SystemUser } from '@soccer/contracts';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/components/locale-provider';
import { AppShell } from '@/components/ui/shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { buttonClassName, secondaryButtonClassName } from '@/components/form-controls';
import { api } from '@/lib/api';
import { systemNavItems } from '@/lib/system-nav';

export default function SystemPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [teams, setTeams] = useState<SystemTeam[] | null>(null);
  const [users, setUsers] = useState<SystemUser[] | null>(null);
  const [teamsCursor, setTeamsCursor] = useState<string | null>(null);
  const [usersCursor, setUsersCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<SystemUser | null>(null);

  const load = useCallback(async () => {
    let me;
    try {
      me = await api.me();
    } catch {
      router.replace('/login?next=%2Fsystem');
      return;
    }
    if (me.systemRole !== 'system_admin' || me.authMethod !== 'passkey') {
      router.replace(me.systemRole === 'system_admin' ? '/login?next=%2Fsystem' : '/home');
      return;
    }

    try {
      const [nextOverview, nextTeams, nextUsers] = await Promise.all([
        api.getSystemOverview(),
        api.listSystemTeams(),
        api.listSystemUsers(),
      ]);
      setOverview(nextOverview);
      setTeams(nextTeams.teams);
      setUsers(nextUsers.users);
      setTeamsCursor(nextTeams.nextCursor ?? null);
      setUsersCursor(nextUsers.nextCursor ?? null);
    } catch {
      setError(true);
    }
  }, [router]);

  useEffect(() => {
    // Loading external system data on mount is the synchronization this effect performs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggleSystemRole(user: SystemUser) {
    const granting = user.systemRole !== 'system_admin';
    setBusyUserId(user.id);
    try {
      await api.updateSystemRole(user.id, { systemRole: granting ? 'system_admin' : null });
      await load();
    } finally {
      setBusyUserId(null);
      setPendingUser(null);
    }
  }

  async function loadMoreTeams() {
    if (!teamsCursor) return;
    const next = await api.listSystemTeams(teamsCursor);
    setTeams((current) => [...(current ?? []), ...next.teams]);
    setTeamsCursor(next.nextCursor ?? null);
  }

  async function loadMoreUsers() {
    if (!usersCursor) return;
    const next = await api.listSystemUsers(usersCursor);
    setUsers((current) => [...(current ?? []), ...next.users]);
    setUsersCursor(next.nextCursor ?? null);
  }

  return (
    <AppShell brand={t('common.appName')} navItems={systemNavItems(t, 'overview')}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('system.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('system.subtitle')}</p>
        </div>
        {error ? (
          <ErrorState title={t('system.loadError')} />
        ) : !overview || !teams || !users ? (
          <LoadingState label={t('system.loading')} />
        ) : (
          <>
            <section
              aria-labelledby="system-overview"
              className="grid grid-cols-2 gap-3 md:grid-cols-4"
            >
              <h2 id="system-overview" className="sr-only">
                {t('system.overview')}
              </h2>
              {(
                [
                  ['system.teams', overview.teams],
                  ['system.users', overview.users],
                  ['system.teamAdmins', overview.teamAdmins],
                  ['system.systemAdmins', overview.systemAdmins],
                ] as const
              ).map(([key, count]) => (
                <div key={key} className="rounded-xl border border-surface-border bg-surface p-4">
                  <div className="text-2xl font-semibold tabular-nums">{count}</div>
                  <div className="text-sm text-ink-muted">{t(key)}</div>
                </div>
              ))}
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{t('system.teams')}</h2>
              {teams.length === 0 ? (
                <EmptyState title={t('system.noTeams')} />
              ) : (
                <DataList ariaLabel={t('system.teams')}>
                  {teams.map((team) => (
                    <DataListItem key={team.id}>
                      <div className="flex w-full justify-between gap-4">
                        <div>
                          <Link
                            href={`/system/teams/${team.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {team.name}
                          </Link>
                          <div className="text-sm text-ink-muted">
                            {team.season} · {team.timezone}
                          </div>
                        </div>
                        <div className="text-sm tabular-nums">
                          {t('system.teamCounts', {
                            members: team.memberCount,
                            admins: team.adminCount,
                          })}
                        </div>
                      </div>
                    </DataListItem>
                  ))}
                </DataList>
              )}
              {teamsCursor && (
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => void loadMoreTeams()}
                >
                  {t('system.loadMore')}
                </button>
              )}
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{t('system.users')}</h2>
              <DataList ariaLabel={t('system.users')}>
                {users.map((user) => (
                  <DataListItem key={user.id}>
                    <div className="flex w-full flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-sm text-ink-muted">
                          {user.email ?? user.phone ?? '—'} ·{' '}
                          {t('system.membershipCount', { count: user.membershipCount })}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`${
                          user.systemRole === 'system_admin'
                            ? t('system.revoke')
                            : t('system.grant')
                        }: ${user.name}`}
                        disabled={
                          busyUserId === user.id || (!user.hasPasskey && user.systemRole === null)
                        }
                        onClick={() => setPendingUser(user)}
                        className={
                          user.systemRole === 'system_admin'
                            ? secondaryButtonClassName
                            : buttonClassName
                        }
                      >
                        {user.systemRole === 'system_admin'
                          ? t('system.revoke')
                          : t('system.grant')}
                      </button>
                    </div>
                  </DataListItem>
                ))}
              </DataList>
              {usersCursor && (
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => void loadMoreUsers()}
                >
                  {t('system.loadMore')}
                </button>
              )}
            </section>
          </>
        )}
      </div>
      <ConfirmDialog
        open={pendingUser !== null}
        title={
          pendingUser
            ? t(
                pendingUser.systemRole === 'system_admin'
                  ? 'system.revokeConfirm'
                  : 'system.grantConfirm',
                { name: pendingUser.name },
              )
            : ''
        }
        confirmLabel={
          pendingUser?.systemRole === 'system_admin' ? t('system.revoke') : t('system.grant')
        }
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        danger={pendingUser?.systemRole === 'system_admin'}
        confirmDisabled={busyUserId !== null}
        cancelDisabled={busyUserId !== null}
        onCancel={() => setPendingUser(null)}
        onConfirm={() => {
          if (pendingUser) void toggleSystemRole(pendingUser);
        }}
      />
    </AppShell>
  );
}
