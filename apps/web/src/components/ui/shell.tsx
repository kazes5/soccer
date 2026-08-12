'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageToggle } from '@/components/language-toggle';
import { useLocale } from '@/components/locale-provider';

export interface ShellNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

/**
 * Application shell: a mobile top bar + bottom tab bar under the md breakpoint,
 * a desktop sidebar above it. `navItems` is expected to grow as more
 * authenticated destinations (schedule, fairness stats, admin) land. The
 * mobile bar becomes horizontally scrollable once its items no longer fit.
 */
export function AppShell({
  brand,
  navItems,
  actions,
  children,
}: {
  brand: string;
  navItems: ShellNavItem[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLocale();

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-ink focus-visible:px-4 focus-visible:py-2 focus-visible:text-surface"
      >
        {t('nav.skipToContent')}
      </a>

      <header className="flex items-center justify-between gap-4 border-b border-surface-border px-4 py-3 md:hidden">
        <span className="text-lg font-semibold tracking-tight">{brand}</span>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          {actions}
        </div>
      </header>

      <aside className="hidden w-60 shrink-0 flex-col gap-1 border-e border-surface-border p-4 md:flex">
        <span className="mb-4 px-2 text-lg font-semibold tracking-tight">{brand}</span>
        <nav className="flex flex-1 flex-col gap-1" aria-label={t('nav.primaryLabel')}>
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-surface-border px-2 pt-4">
          <LanguageToggle />
          {actions}
        </div>
      </aside>

      <main id="main-content" className="flex flex-1 flex-col pb-20 md:pb-0">
        {children}
      </main>

      <nav
        aria-label={t('nav.primaryLabel')}
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around overflow-x-auto border-t border-surface-border bg-surface md:hidden"
      >
        {navItems.map((item) => (
          <BottomNavLink key={item.href} item={item} />
        ))}
      </nav>
    </div>
  );
}

function NavLink({ item }: { item: ShellNavItem }) {
  return (
    <Link
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
        item.active
          ? 'bg-surface-soft text-ink'
          : 'text-ink-muted hover:bg-surface-soft hover:text-ink'
      } ${focusRingClassName}`}
    >
      <span className="size-5 shrink-0" aria-hidden="true">
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

function BottomNavLink({ item }: { item: ShellNavItem }) {
  return (
    <Link
      href={item.href}
      aria-current={item.active ? 'page' : undefined}
      className={`flex min-h-14 min-w-20 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium ${
        item.active ? 'text-status-mine-on' : 'text-ink-muted'
      } ${focusRingClassName}`}
    >
      <span className="size-5" aria-hidden="true">
        {item.icon}
      </span>
      <span className="max-w-20 truncate px-1">{item.label}</span>
    </Link>
  );
}
