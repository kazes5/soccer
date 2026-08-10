'use client';

import type { CurrentUserResponse, PracticeSession, ShiftSummary } from '@soccer/contracts';
import type { Locale } from '@soccer/i18n';
import type { StatusTone } from '@soccer/ui-tokens';
import { Calendar, Home } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { buttonClassName, secondaryButtonClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { formatSessionStartsAt, updateShiftInSessions } from '@/lib/sessions';

function toneFor(shift: ShiftSummary, currentUserId: string): StatusTone {
  if (shift.status === 'open') return 'open';
  return shift.assignedUserId === currentUserId ? 'mine' : 'covered';
}

export default function SchedulePage() {
  const router = useRouter();
  // Lets a link from another page (e.g. Home's "+N more" under a specific
  // team's help-needed list) open the schedule already scoped to that team,
  // instead of always defaulting to the user's first membership.
  const requestedTeamId = useSearchParams().get('team');
  const { t } = useLocale();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        const requestedMembership = data.teamMemberships.find(
          (membership) => membership.teamId === requestedTeamId,
        );
        setActiveTeamId(requestedMembership?.teamId ?? data.teamMemberships[0]?.teamId ?? null);
        setAuthStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setAuthStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, [requestedTeamId]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace('/login');
    }
  }, [authStatus, router]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    {
      href: '/schedule',
      label: t('nav.schedule'),
      icon: <Calendar className="size-full" />,
      active: true,
    },
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('schedule.title')}</h1>

        {session.teamMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={session.teamMemberships.map((membership) => ({
              id: membership.teamId,
              label: membership.teamName,
            }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {/* Keyed on team so switching teams remounts this subtree and fetches
            fresh — avoids a synchronous setState-on-dependency-change effect. */}
        {activeTeamId && (
          <ScheduleSessions
            key={activeTeamId}
            teamId={activeTeamId}
            currentUserId={session.user.id}
          />
        )}
      </div>
    </AppShell>
  );
}

function ScheduleSessions({ teamId, currentUserId }: { teamId: string; currentUserId: string }) {
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null);

  // The mount effect below fetches without an eager `setLoadState('loading')` —
  // `loadState` already starts as 'loading' via useState, so there's nothing to
  // reset on first mount, and every setState here happens inside the promise
  // continuation rather than synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    api
      .listSessions(teamId)
      .then((data) => {
        if (cancelled) return;
        setSessions(data.sessions);
        setLoadState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Used for the retry button and for re-syncing after a claim/release conflict —
  // both are event-driven (not inside an effect body), so the eager
  // `setLoadState('loading')` here is fine.
  const reload = useCallback(() => {
    setLoadState('loading');
    api
      .listSessions(teamId)
      .then((data) => {
        setSessions(data.sessions);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, [teamId]);

  async function handleClaim(shiftId: string) {
    setPendingShiftId(shiftId);
    try {
      const updated = await api.claimShift(teamId, shiftId);
      setSessions((prev) => (prev ? updateShiftInSessions(prev, shiftId, updated) : prev));
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
        reload();
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
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(t('schedule.releaseConflict'), 'error');
        reload();
      } else {
        showToast(t('common.somethingWentWrong'), 'error');
      }
    } finally {
      setPendingShiftId(null);
    }
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('schedule.loading')} />;
  }

  if (loadState === 'error') {
    return (
      <ErrorState
        title={t('schedule.loadError')}
        action={
          <button type="button" className={secondaryButtonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  if (!sessions || sessions.length === 0) {
    return <EmptyState title={t('schedule.empty')} />;
  }

  return (
    <DataList ariaLabel={t('schedule.title')}>
      {sessions.map((practiceSession) => (
        <SessionCard
          key={practiceSession.id}
          practiceSession={practiceSession}
          currentUserId={currentUserId}
          locale={locale}
          pendingShiftId={pendingShiftId}
          onClaim={handleClaim}
          onRelease={handleRelease}
        />
      ))}
    </DataList>
  );
}

function SessionCard({
  practiceSession,
  currentUserId,
  locale,
  pendingShiftId,
  onClaim,
  onRelease,
}: {
  practiceSession: PracticeSession;
  currentUserId: string;
  locale: Locale;
  pendingShiftId: string | null;
  onClaim: (shiftId: string) => void;
  onRelease: (shiftId: string) => void;
}) {
  const { t } = useLocale();
  const formatted = formatSessionStartsAt(locale, practiceSession.startsAt);

  return (
    <DataListItem className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{formatted}</p>
          <p className="text-sm text-ink-muted">{practiceSession.fieldLocation}</p>
        </div>
        {practiceSession.status === 'cancelled' && (
          <span className="rounded-full bg-surface-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t('schedule.cancelled')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {practiceSession.points.map((point) => {
          const tone = toneFor(point.shift, currentUserId);
          const label =
            tone === 'mine'
              ? t('schedule.statusMine')
              : tone === 'covered'
                ? t('schedule.statusCoveredBy', { name: point.shift.assignedUserName ?? '' })
                : t('schedule.statusOpen');
          const isPending = pendingShiftId === point.shift.id;
          const canClaim = practiceSession.status === 'scheduled' && point.shift.status === 'open';
          const canRelease = practiceSession.status === 'scheduled' && tone === 'mine';

          return (
            <div
              key={`${point.pointId}-${point.direction}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-soft p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {point.direction === 'to_practice'
                    ? t('schedule.toPractice')
                    : t('schedule.fromPractice')}
                  {' · '}
                  {point.pointName}
                </p>
                <p className="text-xs text-ink-muted">
                  {point.playerIds.length > 0
                    ? t('schedule.playersCount', { count: point.playerIds.length })
                    : t('schedule.noPlayersAssigned')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={tone} label={label} />
                {canClaim && (
                  <button
                    type="button"
                    disabled={isPending}
                    className={`${buttonClassName} text-sm`}
                    onClick={() => onClaim(point.shift.id)}
                  >
                    {isPending ? t('schedule.claiming') : t('schedule.claim')}
                  </button>
                )}
                {canRelease && (
                  <button
                    type="button"
                    disabled={isPending}
                    className={`${secondaryButtonClassName} text-sm`}
                    onClick={() => onRelease(point.shift.id)}
                  >
                    {isPending ? t('schedule.releasing') : t('schedule.release')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </DataListItem>
  );
}
