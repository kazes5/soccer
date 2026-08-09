import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-12 text-ink-muted">
      <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-surface-border px-6 py-12 text-center">
      <Inbox className="size-6 text-ink-muted" aria-hidden="true" />
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-status-open/25 bg-status-open-subtle px-6 py-12 text-center dark:border-status-open/40"
    >
      <AlertTriangle className="size-6 text-status-open-on" aria-hidden="true" />
      <p className="font-medium text-status-open-on">{title}</p>
      {description && <p className="max-w-xs text-sm text-status-open-on">{description}</p>}
      {action}
    </div>
  );
}
