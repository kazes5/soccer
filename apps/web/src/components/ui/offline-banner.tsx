import { WifiOff } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';

/**
 * Shown whenever `useOnlineStatus` reports offline — CLAUDE.md's "cached
 * schedules are clearly read-only" requirement. `aria-live="polite"` so
 * screen-reader users are told the moment connectivity drops, not just
 * sighted users noticing the banner appear.
 */
export function OfflineBanner() {
  const { t } = useLocale();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-lg border border-status-attention/25 bg-status-attention-subtle px-4 py-2 text-sm text-status-attention-on dark:border-status-attention/40"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      {t('common.offlineBanner')}
    </div>
  );
}
