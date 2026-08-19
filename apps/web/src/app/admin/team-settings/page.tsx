'use client';

import type { CurrentUserResponse, TeamMembership } from '@soccer/contracts';
import type { MessageKey } from '@soccer/i18n';
import { brandColorKeys, brandColorPalette, type BrandColorKey } from '@soccer/ui-tokens';
import { Calendar, Home } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/locale-provider';
import { AppShell, type ShellNavItem } from '@/components/ui/shell';
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

/** Only `admin` memberships apply to this page — kept as one helper so the
 * initial-team-pick effect and the render-time filter can never disagree. */
function adminMembershipsOf(memberships: TeamMembership[]): TeamMembership[] {
  return memberships.filter((m) => m.role === 'admin');
}

const brandColorLabelKeys: Record<BrandColorKey, MessageKey> = {
  green: 'adminTeamSettings.colorGreen',
  blue: 'adminTeamSettings.colorBlue',
  indigo: 'adminTeamSettings.colorIndigo',
  purple: 'adminTeamSettings.colorPurple',
  fuchsia: 'adminTeamSettings.colorFuchsia',
  slate: 'adminTeamSettings.colorSlate',
  red: 'adminTeamSettings.colorRed',
  orange: 'adminTeamSettings.colorOrange',
  yellow: 'adminTeamSettings.colorYellow',
};

export default function AdminTeamSettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTeamId = searchParams.get('team');
  const { t } = useLocale();
  const { showToast } = useToast();
  const [session, setSession] = useState<CurrentUserResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'unauthenticated'>('loading');
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState<BrandColorKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        const adminMemberships = adminMembershipsOf(data.teamMemberships);
        const requested = adminMemberships.find((m) => m.teamId === requestedTeamId);
        setActiveTeamId(requested?.teamId ?? adminMemberships[0]?.teamId ?? null);
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

  // No team where this user is admin — nothing on this page applies to them.
  useEffect(() => {
    if (
      authStatus === 'ready' &&
      session &&
      adminMembershipsOf(session.teamMemberships).length === 0
    ) {
      router.replace('/home');
    }
  }, [authStatus, session, router]);

  if (authStatus !== 'ready' || !session) {
    return null;
  }

  const adminMemberships = adminMembershipsOf(session.teamMemberships);
  const firstAdminMembership = adminMemberships[0];
  if (!firstAdminMembership) return null;

  const navTeamId = activeTeamId ?? firstAdminMembership.teamId;
  const activeAdminMembership =
    adminMemberships.find((m) => m.teamId === navTeamId) ?? firstAdminMembership;
  const currentColor: BrandColorKey = activeAdminMembership.primaryColor ?? 'green';

  const navItems: ShellNavItem[] = [
    { href: '/home', label: t('nav.home'), icon: <Home className="size-full" /> },
    { href: '/schedule', label: t('nav.schedule'), icon: <Calendar className="size-full" /> },
    notificationsNavItem(navTeamId, t),
    swapsNavItem(navTeamId, t),
    settingsNavItem(t),
    ...adminNavItems(navTeamId, t, 'team-settings'),
  ];

  async function handlePick(color: BrandColorKey) {
    if (color === currentColor || savingColor) return;
    setSavingColor(color);
    try {
      await api.updateTeamAccentColor(navTeamId, {
        primaryColor: color === 'green' ? null : color,
      });
      setSession((prev) =>
        prev
          ? {
              ...prev,
              teamMemberships: prev.teamMemberships.map((m) =>
                m.teamId === navTeamId
                  ? { ...m, primaryColor: color === 'green' ? null : color }
                  : m,
              ),
            }
          : prev,
      );
      showToast(t('adminTeamSettings.saved'), 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setSavingColor(null);
    }
  }

  return (
    <AppShell
      brand={t('common.appName')}
      navItems={navItems}
      accentColor={activeAdminMembership.primaryColor}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('adminTeamSettings.title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('adminTeamSettings.subtitle')}</p>
        </div>

        {adminMemberships.length > 1 && (
          <TeamSwitcher
            ariaLabel={t('home.teamSwitcherLabel')}
            options={adminMemberships.map((m) => ({ id: m.teamId, label: m.teamName }))}
            activeId={navTeamId}
            onChange={setActiveTeamId}
          />
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-ink">
            {t('adminTeamSettings.colorLabel')}
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {brandColorKeys.map((color) => {
              const isSelected = color === currentColor;
              const swatch = brandColorPalette[color].light.base;
              return (
                <button
                  key={color}
                  type="button"
                  disabled={savingColor !== null}
                  aria-pressed={isSelected}
                  onClick={() => handlePick(color)}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-start text-sm font-medium disabled:pointer-events-none disabled:opacity-50 ${
                    isSelected
                      ? 'border-ink ring-2 ring-ink'
                      : 'border-surface-border hover:bg-surface-soft'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="size-6 shrink-0 rounded-full border border-surface-border"
                    style={{ backgroundColor: swatch }}
                  />
                  {t(brandColorLabelKeys[color])}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </AppShell>
  );
}
