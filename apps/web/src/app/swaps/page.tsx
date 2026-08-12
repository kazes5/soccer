'use client';

import type { CurrentUserResponse, SwapRequest, SwapRequestStatus } from '@soccer/contracts';
import type { Locale, MessageKey } from '@soccer/i18n';
import type { StatusTone } from '@soccer/ui-tokens';
import { Calendar, Home } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { buttonClassName, secondaryButtonClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { DataList, DataListItem } from '@/components/ui/data-list';
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
import { formatSessionStartsAt } from '@/lib/sessions';

function statusTone(status: SwapRequestStatus): StatusTone {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'accepted':
      return 'mine';
    case 'expired':
      return 'attention';
    case 'declined':
    case 'cancelled':
      return 'covered';
  }
}

const statusLabelKey: Record<SwapRequestStatus, MessageKey> = {
  pending: 'swaps.statusPending',
  accepted: 'swaps.statusAccepted',
  declined: 'swaps.statusDeclined',
  expired: 'swaps.statusExpired',
  cancelled: 'swaps.statusCancelled',
};

export default function SwapsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTeamId = searchParams.get('team');
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
        const requested = data.teamMemberships.find((m) => m.teamId === requestedTeamId);
        setActiveTeamId(requested?.teamId ?? data.teamMemberships[0]?.teamId ?? null);
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
      router.replace(buildLoginRedirect(pathname, searchParams.toString()));
    }
  }, [authStatus, router, pathname, searchParams]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const activeMembership =
    session.teamMemberships.find((m) => m.teamId === activeTeamId) ?? session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    ...(activeMembership ? [notificationsNavItem(activeMembership.teamId, t)] : []),
    ...(activeMembership ? [swapsNavItem(activeMembership.teamId, t, true)] : []),
    settingsNavItem(t),
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('swaps.title')}</h1>

        {session.teamMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={session.teamMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {activeTeamId && session && (
          <SwapsWorkspace
            key={activeTeamId}
            teamId={activeTeamId}
            currentUserId={session.user.id}
            timeZone={activeMembership?.timezone ?? 'UTC'}
          />
        )}
      </div>
    </AppShell>
  );
}

function SwapsWorkspace({
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
  const [swapRequests, setSwapRequests] = useState<SwapRequest[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const load = useCallback(() => api.listSwapRequests(teamId), [teamId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) {
          setSwapRequests(data.swapRequests);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function reload() {
    setLoadState('loading');
    load()
      .then((data) => {
        setSwapRequests(data.swapRequests);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }

  async function runAction(
    swapRequestId: string,
    action: (teamId: string, swapRequestId: string) => Promise<SwapRequest>,
  ) {
    setPendingActionId(swapRequestId);
    try {
      const updated = await action(teamId, swapRequestId);
      setSwapRequests((prev) =>
        prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev,
      );
    } catch (err) {
      showToast(
        err instanceof ApiError && err.status === 409
          ? t('swaps.actionConflict')
          : t('common.somethingWentWrong'),
        'error',
      );
      reload();
    } finally {
      setPendingActionId(null);
    }
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('swaps.loading')} />;
  }

  if (loadState === 'error' || !swapRequests) {
    return (
      <ErrorState
        title={t('swaps.loadError')}
        action={
          <button type="button" className={secondaryButtonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  const needsResponse = swapRequests.filter(
    (s) => s.status === 'pending' && s.currentHolderId === currentUserId,
  );
  const yourRequests = swapRequests.filter((s) => s.requestingUserId === currentUserId);
  // Everything not already shown above — including a *resolved* request
  // where this user was the original holder (accepted/declined it): once
  // it's no longer pending it drops out of "needs your response", but it's
  // still this team's history and must land somewhere, not disappear.
  const shownElsewhereIds = new Set([...needsResponse, ...yourRequests].map((s) => s.id));
  const teamActivity = swapRequests.filter((s) => !shownElsewhereIds.has(s.id));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('swaps.needsResponseTitle')}
        </h2>
        {needsResponse.length === 0 ? (
          <EmptyState title={t('swaps.needsResponseEmpty')} />
        ) : (
          <DataList ariaLabel={t('swaps.needsResponseTitle')}>
            {needsResponse.map((swapRequest) => (
              <DataListItem
                key={swapRequest.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <SwapRequestSummary swapRequest={swapRequest} locale={locale} timeZone={timeZone}>
                  {t('swaps.requestedBy', { name: swapRequest.requestingUserName })}
                </SwapRequestSummary>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pendingActionId === swapRequest.id}
                    className={`${secondaryButtonClassName} text-sm`}
                    onClick={() => runAction(swapRequest.id, api.declineSwapRequest)}
                  >
                    {pendingActionId === swapRequest.id ? t('swaps.declining') : t('swaps.decline')}
                  </button>
                  <button
                    type="button"
                    disabled={pendingActionId === swapRequest.id}
                    className={`${buttonClassName} text-sm`}
                    onClick={() => runAction(swapRequest.id, api.acceptSwapRequest)}
                  >
                    {pendingActionId === swapRequest.id ? t('swaps.accepting') : t('swaps.accept')}
                  </button>
                </div>
              </DataListItem>
            ))}
          </DataList>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('swaps.yourRequestsTitle')}
        </h2>
        {yourRequests.length === 0 ? (
          <EmptyState title={t('swaps.yourRequestsEmpty')} />
        ) : (
          <DataList ariaLabel={t('swaps.yourRequestsTitle')}>
            {yourRequests.map((swapRequest) => (
              <DataListItem
                key={swapRequest.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <SwapRequestSummary swapRequest={swapRequest} locale={locale} timeZone={timeZone}>
                  {t('swaps.heldBy', { name: swapRequest.currentHolderName })}
                </SwapRequestSummary>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={statusTone(swapRequest.status)}
                    label={t(statusLabelKey[swapRequest.status])}
                  />
                  {swapRequest.status === 'pending' && (
                    <button
                      type="button"
                      disabled={pendingActionId === swapRequest.id}
                      className={`${secondaryButtonClassName} text-sm`}
                      onClick={() => runAction(swapRequest.id, api.cancelSwapRequest)}
                    >
                      {pendingActionId === swapRequest.id
                        ? t('swaps.cancelling')
                        : t('swaps.cancel')}
                    </button>
                  )}
                </div>
              </DataListItem>
            ))}
          </DataList>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {t('swaps.teamActivityTitle')}
        </h2>
        {teamActivity.length === 0 ? (
          <EmptyState title={t('swaps.teamActivityEmpty')} />
        ) : (
          <DataList ariaLabel={t('swaps.teamActivityTitle')}>
            {teamActivity.map((swapRequest) => (
              <DataListItem
                key={swapRequest.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <SwapRequestSummary swapRequest={swapRequest} locale={locale} timeZone={timeZone}>
                  {t('swaps.requestedBy', { name: swapRequest.requestingUserName })} ·{' '}
                  {t('swaps.heldBy', { name: swapRequest.currentHolderName })}
                </SwapRequestSummary>
                <StatusBadge
                  tone={statusTone(swapRequest.status)}
                  label={t(statusLabelKey[swapRequest.status])}
                />
              </DataListItem>
            ))}
          </DataList>
        )}
      </section>
    </div>
  );
}

function SwapRequestSummary({
  swapRequest,
  locale,
  timeZone,
  children,
}: {
  swapRequest: SwapRequest;
  locale: Locale;
  timeZone: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const formatted = formatSessionStartsAt(locale, swapRequest.sessionStartsAt, timeZone);
  const directionLabel =
    swapRequest.direction === 'to_practice' ? t('schedule.toPractice') : t('schedule.fromPractice');

  return (
    <div>
      <p className="text-sm font-medium">{children}</p>
      <p className="text-xs text-ink-muted">
        {formatted} · {directionLabel} · {swapRequest.pointName}
      </p>
    </div>
  );
}
