import type { MessageKey } from '@soccer/i18n';
import { MapPin, Repeat } from 'lucide-react';
import type { ShellNavItem } from '@/components/ui/shell';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Shared by Home and both admin pages so the two admin destinations always
 * appear together, in the same order, with the same labels/icons/hrefs — used
 * on Home (gated to the active team being one the user admins) and
 * unconditionally on the admin pages themselves (which only ever operate on
 * an admin team by construction).
 */
export function adminNavItems(
  teamId: string,
  t: Translate,
  activePage?: 'collection-points' | 'schedule-templates',
): ShellNavItem[] {
  return [
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
  ];
}
