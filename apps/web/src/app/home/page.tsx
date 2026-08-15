'use client';

import type {
  CurrentUserResponse,
  PracticeSession,
  SessionPoint,
  ShiftStatsResponse,
  SwapRequest,
  TeamMembership,
} from '@soccer/contracts';
import type { Locale } from '@soccer/i18n';
import { Calendar, Copy, Home, LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import {
  adminNavItems,
  notificationsNavItem,
  settingsNavItem,
  swapsNavItem,
} from '@/lib/admin-nav';
import { ApiError, api } from '@/lib/api';
import { buildLoginRedirect } from '@/lib/safe-redirect';
import { formatSessionStartsAt, updateShiftInSessions } from '@/lib/sessions';

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
    if (session?.systemRole === 'system_admin' && session.teamMemberships.length === 0) {
      router.replace('/system');
    }
  }, [router, session]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(buildLoginRedirect(pathname, searchParams.toString()));
    }
  }, [status, router, pathname, searchParams]);

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
  const hasMultipleTeams = session.teamMemberships.length > 1;
  const isSingleTeamParent =
    session.teamMemberships.length === 1 && activeMembership?.role === 'parent';

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" />, active: true },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    ...(activeMembership ? [notificationsNavItem(activeMembership.teamId, t)] : []),
    ...(activeMembership ? [swapsNavItem(activeMembership.teamId, t)] : []),
    settingsNavItem(t),
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
    ...(session.systemRole === 'system_admin' && session.authMethod === 'passkey'
      ? [{ href: '/system', label: t('system.title'), icon: <ShieldCheck className="size-full" /> }]
      : []),
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

        {hasMultipleTeams && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={session.teamMemberships.map((membership) => ({
              id: membership.teamId,
              label: membership.teamName,
            }))}
            activeId={activeMembership?.teamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {/* Keyed on team so switching teams remounts this subtree and fetches
            fresh — avoids a synchronous setState-on-dependency-change effect. */}
        {activeTeamId && (
          <HomeWorkspace
            key={activeTeamId}
            teamId={activeTeamId}
            currentUserId={session.user.id}
            timeZone={activeMembership?.timezone ?? 'UTC'}
          />
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t(isSingleTeamParent ? 'home.yourTeam' : 'home.yourTeams')}
          </h2>
          {activeMembership && (
            <DataList ariaLabel={t(isSingleTeamParent ? 'home.yourTeam' : 'home.yourTeams')}>
              <TeamCard membership={activeMembership} />
            </DataList>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmingLogOut}
        title={t('home.logOutConfirmTitle')}
        description={t(
          isSingleTeamParent ? 'home.logOutConfirmBodySingleTeam' : 'home.logOutConfirmBody',
        )}
        confirmLabel={t('home.logOut')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onConfirm={handleLogOut}
        onCancel={() => setConfirmingLogOut(false)}
      />
    </AppShell>
  );
}

function HomeWorkspace({
  teamId,
  currentUserId,
  timeZone,
}: {
  teamId: string;
  currentUserId: string;
  timeZone: string;
}) {
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  const [sessionsState, setSessionsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stats, setStats] = useState<ShiftStatsResponse | null>(null);
  const [statsState, setStatsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pendingSwaps, setPendingSwaps] = useState<SwapRequest[] | null>(null);
  const [pendingSwapsState, setPendingSwapsState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null);
  const [pendingSwapActionId, setPendingSwapActionId] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    return api.listSessions(teamId).then((data) => {
      setSessions(data.sessions);
      setSessionsState('ready');
    });
  }, [teamId]);

  const loadStats = useCallback(() => {
    return api.getShiftStats(teamId).then((data) => {
      setStats(data);
      setStatsState('ready');
    });
  }, [teamId]);

  // "Needs your response" for this widget — swap requests where the current
  // user is the holder being asked to accept/decline, not every swap they're
  // any part of (the full picture, including their own sent requests, lives
  // on /swaps).
  const loadPendingSwaps = useCallback(() => {
    return api.listSwapRequests(teamId).then((data) => {
      setPendingSwaps(
        data.swapRequests.filter(
          (swapRequest) =>
            swapRequest.status === 'pending' && swapRequest.currentHolderId === currentUserId,
        ),
      );
      setPendingSwapsState('ready');
    });
  }, [teamId, currentUserId]);

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

  useEffect(() => {
    let cancelled = false;
    loadStats().catch(() => {
      if (!cancelled) setStatsState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [loadStats]);

  useEffect(() => {
    let cancelled = false;
    loadPendingSwaps().catch(() => {
      if (!cancelled) setPendingSwapsState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [loadPendingSwaps]);

  // Only used to resync after a claim/release conflict, where the local list is
  // known-stale — a normal success patches the one changed shift in place
  // instead (see handleClaim/handleRelease below), so the rest of the
  // workspace never flashes back to a full loading state.
  const reloadSessions = useCallback(() => {
    setSessionsState('loading');
    loadSessions().catch(() => setSessionsState('error'));
  }, [loadSessions]);

  async function handleClaim(shiftId: string) {
    setPendingShiftId(shiftId);
    try {
      const updated = await api.claimShift(teamId, shiftId);
      setSessions((prev) => (prev ? updateShiftInSessions(prev, shiftId, updated) : prev));
      loadStats().catch(() => setStatsState('error'));
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
      const updated = await api.releaseShift(teamId, shiftId);
      setSessions((prev) => (prev ? updateShiftInSessions(prev, shiftId, updated) : prev));
      loadStats().catch(() => setStatsState('error'));
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

  async function handleAcceptSwap(swapRequestId: string) {
    setPendingSwapActionId(swapRequestId);
    try {
      await api.acceptSwapRequest(teamId, swapRequestId);
      setPendingSwaps((prev) => (prev ? prev.filter((s) => s.id !== swapRequestId) : prev));
      loadSessions().catch(() => setSessionsState('error'));
      // Unlike decline (the holder keeps the shift), accepting hands it to
      // the requester — the same "My Stats" refresh claim/release already do.
      loadStats().catch(() => setStatsState('error'));
    } catch (err) {
      showToast(
        err instanceof ApiError && err.status === 409
          ? t('swaps.actionConflict')
          : t('common.somethingWentWrong'),
        'error',
      );
      loadPendingSwaps().catch(() => setPendingSwapsState('error'));
    } finally {
      setPendingSwapActionId(null);
    }
  }

  async function handleDeclineSwap(swapRequestId: string) {
    setPendingSwapActionId(swapRequestId);
    try {
      await api.declineSwapRequest(teamId, swapRequestId);
      setPendingSwaps((prev) => (prev ? prev.filter((s) => s.id !== swapRequestId) : prev));
    } catch (err) {
      showToast(
        err instanceof ApiError && err.status === 409
          ? t('swaps.actionConflict')
          : t('common.somethingWentWrong'),
        'error',
      );
      loadPendingSwaps().catch(() => setPendingSwapsState('error'));
    } finally {
      setPendingSwapActionId(null);
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
  const visiblePendingSwaps = (pendingSwaps ?? []).slice(0, HELP_NEEDED_DISPLAY_CAP);
  const remainingPendingSwapsCount = (pendingSwaps?.length ?? 0) - visiblePendingSwaps.length;

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
                timeZone={timeZone}
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
                  timeZone={timeZone}
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
                href={`/schedule?team=${encodeURIComponent(teamId)}`}
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
        {pendingSwapsState === 'error' && <ErrorState title={t('swaps.loadError')} />}
        {pendingSwapsState === 'ready' &&
          pendingSwaps &&
          (visiblePendingSwaps.length === 0 ? (
            <EmptyState title={t('home.pendingSwapsEmpty')} />
          ) : (
            <>
              <DataList ariaLabel={t('home.pendingSwapsTitle')}>
                {visiblePendingSwaps.map((swapRequest) => (
                  <SwapRequestRow
                    key={swapRequest.id}
                    swapRequest={swapRequest}
                    locale={locale}
                    timeZone={timeZone}
                    isPending={pendingSwapActionId === swapRequest.id}
                    onAccept={() => handleAcceptSwap(swapRequest.id)}
                    onDecline={() => handleDeclineSwap(swapRequest.id)}
                  />
                ))}
              </DataList>
              {remainingPendingSwapsCount > 0 && (
                <Link
                  href={`/swaps?team=${encodeURIComponent(teamId)}`}
                  className="text-sm font-medium text-status-mine-on hover:underline"
                >
                  {t('home.pendingSwapsMore', { count: remainingPendingSwapsCount })}
                </Link>
              )}
            </>
          ))}
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

function SwapRequestRow({
  swapRequest,
  locale,
  timeZone,
  isPending,
  onAccept,
  onDecline,
}: {
  swapRequest: SwapRequest;
  locale: Locale;
  timeZone: string;
  isPending: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useLocale();
  const formatted = formatSessionStartsAt(locale, swapRequest.sessionStartsAt, timeZone);
  const directionLabel =
    swapRequest.direction === 'to_practice' ? t('schedule.toPractice') : t('schedule.fromPractice');

  return (
    <DataListItem className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">
          {t('swaps.requestedBy', { name: swapRequest.requestingUserName })}
        </p>
        <p className="text-xs text-ink-muted">
          {formatted} · {directionLabel} · {swapRequest.pointName}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          className={`${secondaryButtonClassName} text-sm`}
          onClick={onDecline}
        >
          {isPending ? t('swaps.declining') : t('swaps.decline')}
        </button>
        <button
          type="button"
          disabled={isPending}
          className={`${buttonClassName} text-sm`}
          onClick={onAccept}
        >
          {isPending ? t('swaps.accepting') : t('swaps.accept')}
        </button>
      </div>
    </DataListItem>
  );
}

function ShiftRow({
  entry,
  locale,
  timeZone,
  variant,
  actionLabel,
  actionPendingLabel,
  isPending,
  onAction,
}: {
  entry: UpcomingShift;
  locale: Locale;
  timeZone: string;
  variant: 'primary' | 'secondary';
  actionLabel: string;
  actionPendingLabel: string;
  isPending: boolean;
  onAction: () => void;
}) {
  const { t } = useLocale();
  const formatted = formatSessionStartsAt(locale, entry.session.startsAt, timeZone);

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
  const [onboardingCode, setOnboardingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const invite = await api.createInvite(membership.teamId, { phone });
      setInviteCode(invite.code);
      setOnboardingCode(invite.onboardingCode ?? null);
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
            <div className="flex flex-wrap items-center gap-2 text-sm text-status-mine-on">
              <span>
                {t('home.inviteLinkLabel')} <code>/invite/{inviteCode}</code>
              </span>
              <IconButton
                label={t('home.copyInviteLinkAriaLabel')}
                icon={<Copy className="size-4" aria-hidden="true" />}
                onClick={handleCopyInviteLink}
              />
              {onboardingCode && (
                <span>
                  {t('home.inviteCodeLabel')} <code dir="ltr">{onboardingCode}</code>
                </span>
              )}
            </div>
          )}
        </form>
      )}
    </DataListItem>
  );
}
