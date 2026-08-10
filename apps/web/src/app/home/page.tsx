'use client';

import type {
  CurrentUserResponse,
  PracticeSession,
  SessionPoint,
  ShiftStatsResponse,
  TeamMembership,
} from '@soccer/contracts';
import { formatDate, type Locale } from '@soccer/i18n';
import { Calendar, Copy, Home, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  FormError,
  buttonClassName,
  inputClassName,
  secondaryButtonClassName,
} from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { IconButton } from '@/components/ui/icon-button';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';

interface UpcomingShift {
  session: PracticeSession;
  point: SessionPoint;
}

const HELP_NEEDED_DISPLAY_CAP = 5;

function flattenUpcoming(sessions: PracticeSession[]): UpcomingShift[] {
  const now = Date.now();
  return sessions
    .filter(
      (session) => session.status === 'scheduled' && new Date(session.startsAt).getTime() >= now,
    )
    .flatMap((session) => session.points.map((point) => ({ session, point })))
    .sort(
      (a, b) => new Date(a.session.startsAt).getTime() - new Date(b.session.startsAt).getTime(),
    );
}

function formatAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function HomePage() {
  const router = useRouter();
  const { t } = useLocale();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [confirmingLogOut, setConfirmingLogOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setActiveTeamId(data.teamMemberships[0]?.teamId ?? null);
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
    setConfirmingLogOut(false);
    await api.logout().catch(() => {
      // Best-effort: even if the server call fails, still send the user home.
    });
    router.push('/');
  }

  if (status !== 'ready' || !session) {
    return null;
  }

  const activeMembership =
    session.teamMemberships.find((membership) => membership.teamId === activeTeamId) ??
    session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" />, active: true },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
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

        {/* Keyed on team so switching teams remounts this subtree and fetches
            fresh — avoids a synchronous setState-on-dependency-change effect. */}
        {activeTeamId && (
          <HomeWorkspace key={activeTeamId} teamId={activeTeamId} currentUserId={session.user.id} />
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('home.yourTeams')}
          </h2>
          {activeMembership && (
            <DataList ariaLabel={t('home.yourTeams')}>
              <TeamCard membership={activeMembership} />
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

function HomeWorkspace({ teamId, currentUserId }: { teamId: string; currentUserId: string }) {
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  const [sessionsState, setSessionsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stats, setStats] = useState<ShiftStatsResponse | null>(null);
  const [statsState, setStatsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    return api.listSessions(teamId).then((data) => {
      setSessions(data.sessions);
      setSessionsState('ready');
    });
  }, [teamId]);

  const loadStats = useCallback(() => {
    return api
      .getShiftStats(teamId)
      .then((data) => {
        setStats(data);
        setStatsState('ready');
      })
      .catch(() => setStatsState('error'));
  }, [teamId]);

  // Initial fetch: `sessionsState`/`statsState` already start as 'loading' via
  // useState, so there's nothing to reset here — every setState happens inside
  // the promise continuation, not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    loadSessions().catch(() => {
      if (!cancelled) setSessionsState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  // loadStats already guards its own failure with .catch internally, so there's
  // no cancellation flag needed here (unlike loadSessions above).
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const reloadSessions = useCallback(() => {
    setSessionsState('loading');
    loadSessions().catch(() => setSessionsState('error'));
  }, [loadSessions]);

  async function handleClaim(shiftId: string) {
    setPendingShiftId(shiftId);
    try {
      await api.claimShift(teamId, shiftId);
      reloadSessions();
      loadStats();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const holderName =
          typeof err.details?.holderName === 'string' ? err.details.holderName : null;
        showToast(
          holderName
            ? t('schedule.claimConflictWithName', { name: holderName })
            : t('schedule.claimConflictUnknown'),
          'error',
        );
        reloadSessions();
      } else {
        showToast(t('common.somethingWentWrong'), 'error');
      }
    } finally {
      setPendingShiftId(null);
    }
  }

  async function handleRelease(shiftId: string) {
    setPendingShiftId(shiftId);
    try {
      await api.releaseShift(teamId, shiftId);
      reloadSessions();
      loadStats();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(t('schedule.releaseConflict'), 'error');
        reloadSessions();
      } else {
        showToast(t('common.somethingWentWrong'), 'error');
      }
    } finally {
      setPendingShiftId(null);
    }
  }

  if (sessionsState === 'loading') {
    return <LoadingState label={t('home.workspaceLoading')} />;
  }

  if (sessionsState === 'error' || !sessions) {
    return (
      <ErrorState
        title={t('home.workspaceError')}
        action={
          <button type="button" className={secondaryButtonClassName} onClick={reloadSessions}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  const upcoming = flattenUpcoming(sessions);
  const myAssignments = upcoming.filter(
    (entry) => entry.point.shift.assignedUserId === currentUserId,
  );
  const openShifts = upcoming.filter((entry) => entry.point.shift.status === 'open');
  const visibleOpenShifts = openShifts.slice(0, HELP_NEEDED_DISPLAY_CAP);
  const remainingOpenCount = openShifts.length - visibleOpenShifts.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <StatusBadge
          tone="mine"
          label={t('home.upcomingShiftsCount', { count: myAssignments.length })}
        />
        <StatusBadge tone="open" label={t('home.openShiftsCount', { count: openShifts.length })} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('home.myAssignmentsTitle')}
        </h2>
        {myAssignments.length === 0 ? (
          <EmptyState title={t('home.myAssignmentsEmpty')} />
        ) : (
          <DataList ariaLabel={t('home.myAssignmentsTitle')}>
            {myAssignments.map((entry) => (
              <ShiftRow
                key={entry.point.shift.id}
                entry={entry}
                locale={locale}
                variant="secondary"
                actionLabel={t('schedule.release')}
                actionPendingLabel={t('schedule.releasing')}
                isPending={pendingShiftId === entry.point.shift.id}
                onAction={() => handleRelease(entry.point.shift.id)}
              />
            ))}
          </DataList>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('home.helpNeededTitle')}
        </h2>
        {visibleOpenShifts.length === 0 ? (
          <EmptyState title={t('home.helpNeededEmpty')} />
        ) : (
          <>
            <DataList ariaLabel={t('home.helpNeededTitle')}>
              {visibleOpenShifts.map((entry) => (
                <ShiftRow
                  key={entry.point.shift.id}
                  entry={entry}
                  locale={locale}
                  variant="primary"
                  actionLabel={t('schedule.claim')}
                  actionPendingLabel={t('schedule.claiming')}
                  isPending={pendingShiftId === entry.point.shift.id}
                  onAction={() => handleClaim(entry.point.shift.id)}
                />
              ))}
            </DataList>
            {remainingOpenCount > 0 && (
              <Link
                href="/schedule"
                className="text-sm font-medium text-status-mine-on hover:underline"
              >
                {t('home.helpNeededMore', { count: remainingOpenCount })}
              </Link>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('home.pendingSwapsTitle')}
        </h2>
        <DataList ariaLabel={t('home.pendingSwapsTitle')}>
          <DataListItem>
            <span className="text-sm text-ink-muted">{t('home.pendingSwapsPlaceholder')}</span>
          </DataListItem>
        </DataList>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('home.statsTitle')}
        </h2>
        {statsState === 'error' && <ErrorState title={t('home.statsError')} />}
        {statsState === 'ready' && stats && (
          <DataList ariaLabel={t('home.statsTitle')}>
            <DataListItem>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-ink-muted">{t('home.statsMineLabel')}</p>
                  <p className="mt-1 text-sm">
                    {t('schedule.toPractice')}: {stats.mine.toPractice}
                  </p>
                  <p className="text-sm">
                    {t('schedule.fromPractice')}: {stats.mine.fromPractice}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-muted">
                    {t('home.statsTeamAverageLabel')}
                  </p>
                  <p className="mt-1 text-sm">
                    {t('schedule.toPractice')}: {formatAverage(stats.teamAverage.toPractice)}
                  </p>
                  <p className="text-sm">
                    {t('schedule.fromPractice')}: {formatAverage(stats.teamAverage.fromPractice)}
                  </p>
                </div>
              </div>
            </DataListItem>
          </DataList>
        )}
      </section>
    </div>
  );
}

function ShiftRow({
  entry,
  locale,
  variant,
  actionLabel,
  actionPendingLabel,
  isPending,
  onAction,
}: {
  entry: UpcomingShift;
  locale: Locale;
  variant: 'primary' | 'secondary';
  actionLabel: string;
  actionPendingLabel: string;
  isPending: boolean;
  onAction: () => void;
}) {
  const { t } = useLocale();
  const formatted = formatDate(locale, new Date(entry.session.startsAt), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    // See schedule/page.tsx's SessionCard for why this is pinned to UTC.
    timeZone: 'UTC',
  });

  return (
    <DataListItem className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">{formatted}</p>
        <p className="text-xs text-ink-muted">
          {entry.point.direction === 'to_practice'
            ? t('schedule.toPractice')
            : t('schedule.fromPractice')}
          {' · '}
          {entry.point.pointName}
        </p>
      </div>
      <button
        type="button"
        disabled={isPending}
        className={`${variant === 'primary' ? buttonClassName : secondaryButtonClassName} text-sm`}
        onClick={onAction}
      >
        {isPending ? actionPendingLabel : actionLabel}
      </button>
    </DataListItem>
  );
}

function TeamCard({ membership }: { membership: TeamMembership }) {
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
      const invite = await api.createInvite(membership.teamId, { phone });
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
