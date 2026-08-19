'use client';

import type { CurrentUserResponse } from '@soccer/contracts';
import { Bell, Calendar, ChevronRight, Home, UserCog } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/locale-provider';
import { DataList, DataListItem } from '@/components/ui/data-list';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
import {
  adminNavItems,
  notificationsNavItem,
  settingsNavItem,
  swapsNavItem,
} from '@/lib/admin-nav';
import { api } from '@/lib/api';
import { buildLoginRedirect } from '@/lib/safe-redirect';

export default function SettingsHubPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setAuthStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setAuthStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.replace(buildLoginRedirect(pathname, searchParams.toString()));
    }
  }, [authStatus, router, pathname, searchParams]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const activeMembership = session.teamMemberships[0];

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    ...(activeMembership ? [notificationsNavItem(activeMembership.teamId, t)] : []),
    ...(activeMembership ? [swapsNavItem(activeMembership.teamId, t)] : []),
    settingsNavItem(t, true),
    ...(activeMembership?.role === 'admin' ? adminNavItems(activeMembership.teamId, t) : []),
  ];

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      accentColor={activeMembership?.primaryColor}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('settingsHub.title')}</h1>

        <DataList ariaLabel={t('settingsHub.title')}>
          <DataListItem>
            <Link
              href="/settings/notifications"
              className="flex min-h-11 items-center gap-3 focus-visible:outline-none"
            >
              <Bell className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">
                  {t('settingsHub.notificationsCardTitle')}
                </span>
                <span className="block text-xs text-ink-muted">
                  {t('settingsHub.notificationsCardDescription')}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 rtl:rotate-180 text-ink-muted"
                aria-hidden="true"
              />
            </Link>
          </DataListItem>
          <DataListItem>
            <Link
              href="/settings/account"
              className="flex min-h-11 items-center gap-3 focus-visible:outline-none"
            >
              <UserCog className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">
                  {t('settingsHub.accountCardTitle')}
                </span>
                <span className="block text-xs text-ink-muted">
                  {t('settingsHub.accountCardDescription')}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 rtl:rotate-180 text-ink-muted"
                aria-hidden="true"
              />
            </Link>
          </DataListItem>
        </DataList>
      </div>
    </AppShell>
  );
}
