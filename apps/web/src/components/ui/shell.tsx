'use client';

import { focusRingClassName, type BrandColorKey } from '@soccer/ui-tokens';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { LanguageToggle } from '@/components/language-toggle';
import { LogOutDialog, LogOutTrigger } from '@/components/log-out';
import { useLocale } from '@/components/locale-provider';
import { TeamBrandStyle } from '@/components/team-brand-style';
import { api } from '@/lib/api';

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
 * Renders a logout trigger itself so every authenticated page reachable
 * through this shell has a way to log out, not just the pages that think to
 * pass one.
 *
 * The mobile header and desktop sidebar are both always mounted (visibility
 * is CSS-only, to avoid layout shift across the md breakpoint), so there are
 * two LogOutTrigger buttons but exactly one LogOutDialog + one piece of
 * confirm-open state shared between them — otherwise two independent
 * <dialog> elements would each carry the confirm copy in the DOM at once.
 *
 * `isSingleTeamParent` only affects the confirm dialog's wording, so it's an
 * optional pass-through (defaulting to the generic copy) rather than a fetch
 * of its own here — a page that already loaded its session data (Home does)
 * can pass the accurate value; one that hasn't isn't worth a fetch just for
 * this.
 */
export function AppShell({
  brand,
  navItems,
  isSingleTeamParent = false,
  accentColor = null,
  hideChatBubble = false,
  children,
}: {
  brand: string;
  navItems: ShellNavItem[];
  isSingleTeamParent?: boolean;
  /** The active team's chosen accent color (from `teamMemberships[].primaryColor`),
   *  or `null` for the default brand color — omitted entirely on pages with no
   *  team context (e.g. the system console). */
  accentColor?: BrandColorKey | null;
  /** Set on the system console's pages, which have no team context for the
   *  chat bubble to operate against (it resolves its own team on mount —
   *  see chat-bubble.tsx — so without this it would render on `/system/*`
   *  too, uselessly). */
  hideChatBubble?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [confirmingLogOut, setConfirmingLogOut] = useState(false);

  async function handleLogOut() {
    setConfirmingLogOut(false);
    await api.logout().catch(() => {
      // Best-effort: even if the server call fails, still send the user home.
    });
    router.push('/');
  }

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <TeamBrandStyle color={accentColor} />
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
          <LogOutTrigger onClick={() => setConfirmingLogOut(true)} />
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
          <LogOutTrigger onClick={() => setConfirmingLogOut(true)} />
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

      <LogOutDialog
        open={confirmingLogOut}
        isSingleTeamParent={isSingleTeamParent}
        onConfirm={handleLogOut}
        onCancel={() => setConfirmingLogOut(false)}
      />

      {!hideChatBubble && <ChatBubble />}
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
        item.active ? 'text-brand-on' : 'text-ink-muted'
      } ${focusRingClassName}`}
    >
      <span className="size-5" aria-hidden="true">
        {item.icon}
      </span>
      <span className="max-w-20 truncate px-1">{item.label}</span>
    </Link>
  );
}
