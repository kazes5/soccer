import { Gauge, History } from 'lucide-react';
import type { ShellNavItem } from '@/components/ui/shell';
import type { MessageKey } from '@soccer/i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function systemNavItems(t: Translate, active?: 'overview' | 'audit'): ShellNavItem[] {
  return [
    {
      href: '/system',
      label: t('system.title'),
      icon: <Gauge className="size-full" />,
      active: active === 'overview',
    },
    {
      href: '/system/audit-logs',
      label: t('system.auditLogs'),
      icon: <History className="size-full" />,
      active: active === 'audit',
    },
  ];
}
