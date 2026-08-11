'use client';

import type { CurrentUserResponse, Notification } from '@soccer/contracts';
import { Calendar, Home, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { buttonClassName, secondaryButtonClassName } from '@/components/form-controls';
import { useLocale } from '@/components/locale-provider';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { IconButton } from '@/components/ui/icon-button';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TeamSwitcher } from '@/components/ui/team-switcher';
import { useToast } from '@/components/ui/toast';
import { adminNavItems, notificationsNavItem, settingsNavItem } from '@/lib/admin-nav';
import { ApiError, api } from '@/lib/api';
import { describeNotification } from '@/lib/notifications';

export default function NotificationsPage() {
  const router = useRouter();
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
      router.replace('/login');
    }
  }, [authStatus, router]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const activeMembership =
    session.teamMemberships.find((m) => m.teamId === activeTeamId) ?? session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    ...(activeMembership ? [notificationsNavItem(activeMembership.teamId, t, true)] : []),
    settingsNavItem(t),
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
  ];

  return (
    <AppShell brand={t('common.appName')} navItems={navItems}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('notifications.title')}</h1>

        {session.teamMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={session.teamMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={activeTeamId ?? ''}
            onChange={setActiveTeamId}
          />
        )}

        {activeTeamId && activeMembership && (
          <NotificationsWorkspace
            key={activeTeamId}
            teamId={activeTeamId}
            timeZone={activeMembership.timezone}
          />
        )}
      </div>
    </AppShell>
  );
}

function NotificationsWorkspace({ teamId, timeZone }: { teamId: string; timeZone: string }) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const load = useCallback(() => api.listNotifications(teamId), [teamId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (cancelled) return;
        setNotifications(data.notifications);
        setNextCursor(data.nextCursor);
        setUnreadCount(data.unreadCount);
        setLoadState('ready');
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
        setNotifications(data.notifications);
        setNextCursor(data.nextCursor);
        setUnreadCount(data.unreadCount);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }

  async function handleLoadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const data = await api.listNotifications(teamId, { cursor: nextCursor });
      setNotifications((prev) => (prev ? [...prev, ...data.notifications] : data.notifications));
      setNextCursor(data.nextCursor);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleOpen(notification: Notification, href: string | null) {
    if (!notification.readAt) {
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n,
          ) ?? null,
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      api.markNotificationRead(teamId, notification.id).catch(() => {
        // Best-effort: the read state is a convenience, not safety-critical —
        // worst case the item shows unread again on next reload.
      });
    }
    if (href) {
      router.push(href);
    }
  }

  async function handleDismiss(notificationId: string) {
    const wasUnread = notifications?.find((n) => n.id === notificationId)?.readAt == null;
    setNotifications((prev) => prev?.filter((n) => n.id !== notificationId) ?? null);
    if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await api.dismissNotification(teamId, notificationId);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
      reload();
    }
  }

  async function handleMarkAllRead() {
    const previous = notifications;
    setNotifications(
      (prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null,
    );
    setUnreadCount(0);
    try {
      await api.markAllNotificationsRead(teamId);
    } catch (err) {
      setNotifications(previous);
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    }
  }

  if (loadState === 'loading') {
    return <LoadingState label={t('notifications.loading')} />;
  }

  if (loadState === 'error' || !notifications) {
    return (
      <ErrorState
        title={t('notifications.loadError')}
        action={
          <button type="button" className={buttonClassName} onClick={reload}>
            {t('common.retry')}
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-muted">
          {t('notifications.unreadCount', { count: unreadCount })}
        </span>
        {unreadCount > 0 && (
          <button type="button" className={secondaryButtonClassName} onClick={handleMarkAllRead}>
            {t('notifications.markAllRead')}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState title={t('notifications.empty')} />
      ) : (
        <DataList ariaLabel={t('notifications.title')}>
          {notifications.map((notification) => {
            const { text, href } = describeNotification(t, locale, timeZone, teamId, notification);
            const isUnread = !notification.readAt;
            return (
              <DataListItem
                key={notification.id}
                className={isUnread ? 'border-status-mine/40 bg-status-mine-subtle' : ''}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => handleOpen(notification, href)}
                    className="flex-1 text-start text-sm"
                  >
                    <span className={isUnread ? 'font-semibold text-ink' : 'text-ink'}>{text}</span>
                  </button>
                  <IconButton
                    label={t('notifications.dismissAriaLabel')}
                    icon={<X className="size-4" aria-hidden="true" />}
                    onClick={() => handleDismiss(notification.id)}
                  />
                </div>
              </DataListItem>
            );
          })}
        </DataList>
      )}

      {nextCursor && (
        <button
          type="button"
          disabled={isLoadingMore}
          className={`${secondaryButtonClassName} self-center`}
          onClick={handleLoadMore}
        >
          {isLoadingMore ? t('notifications.loadingMore') : t('notifications.loadMore')}
        </button>
      )}
    </div>
  );
}
