import type { MessageKey } from '@soccer/i18n';
import {
  ArrowLeftRight,
  Bell,
  History,
  Inbox,
  MapPin,
  Paintbrush,
  Repeat,
  Settings,
  Users,
} from 'lucide-react';
import type { ShellNavItem } from '@/components/ui/shell';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Every authenticated user gets this destination (the Settings hub, which
 * fans out to Notifications and Account) regardless of role — shared the
 * same way `adminNavItems` below shares the admin-only destinations, so
 * every page's nav stays in sync without hand-copying the entry. */
export function settingsNavItem(t: Translate, active = false): ShellNavItem {
  return {
    href: '/settings',
    label: t('nav.settings'),
    icon: <Settings className="size-full" />,
    active,
  };
}

/** The notification center — team-scoped like Schedule/admin pages, so the
 * href carries `?team=`. Distinct icon from `adminNotificationSettings`'s
 * `Bell` (that page configures *how* notifications behave; this one *is*
 * the notifications) even though both are notification-related. */
export function notificationsNavItem(teamId: string, t: Translate, active = false): ShellNavItem {
  return {
    href: `/notifications?team=${encodeURIComponent(teamId)}`,
    label: t('nav.notifications'),
    icon: <Inbox className="size-full" />,
    active,
  };
}

/** Every team member's shift-swap inbox/sent list — team-scoped like
 * `notificationsNavItem`, and equally available to parents and admins. */
export function swapsNavItem(teamId: string, t: Translate, active = false): ShellNavItem {
  return {
    href: `/swaps?team=${encodeURIComponent(teamId)}`,
    label: t('nav.swaps'),
    icon: <ArrowLeftRight className="size-full" />,
    active,
  };
}

/**
 * Shared by Home and all admin pages so the admin destinations always appear
 * together, in the same order, with the same labels/icons/hrefs — used on
 * Home (gated to the active team being one the user admins) and
 * unconditionally on the admin pages themselves (which only ever operate on
 * an admin team by construction).
 */
export function adminNavItems(
  teamId: string,
  t: Translate,
  activePage?:
    | 'members'
    | 'collection-points'
    | 'schedule-templates'
    | 'notification-settings'
    | 'audit-logs'
    | 'team-settings',
): ShellNavItem[] {
  return [
    {
      href: `/admin/members?team=${encodeURIComponent(teamId)}`,
      label: t('adminMembers.title'),
      icon: <Users className="size-full" />,
      active: activePage === 'members',
    },
    {
      href: `/admin/collection-points?team=${encodeURIComponent(teamId)}`,
      label: t('adminCollectionPoints.title'),
      icon: <MapPin className="size-full" />,
      active: activePage === 'collection-points',
    },
    {
      href: `/admin/schedule-templates?team=${encodeURIComponent(teamId)}`,
      label: t('adminScheduleTemplates.title'),
      icon: <Repeat className="size-full" />,
      active: activePage === 'schedule-templates',
    },
    {
      href: `/admin/notification-settings?team=${encodeURIComponent(teamId)}`,
      label: t('adminNotificationSettings.title'),
      icon: <Bell className="size-full" />,
      active: activePage === 'notification-settings',
    },
    {
      href: `/admin/audit-logs?team=${encodeURIComponent(teamId)}`,
      label: t('adminAuditLogs.title'),
      icon: <History className="size-full" />,
      active: activePage === 'audit-logs',
    },
    {
      href: `/admin/team-settings?team=${encodeURIComponent(teamId)}`,
      label: t('adminTeamSettings.title'),
      icon: <Paintbrush className="size-full" />,
      active: activePage === 'team-settings',
    },
  ];
}
