import { statusTones, type StatusIconKey, type StatusTone } from '@soccer/ui-tokens';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Siren,
  Timer,
  User,
  type LucideIcon,
} from 'lucide-react';

const icons: Record<StatusIconKey, LucideIcon> = {
  'check-circle': CheckCircle2,
  user: User,
  'alert-circle': AlertCircle,
  siren: Siren,
  clock: Clock,
  timer: Timer,
};

/**
 * Never conveys state through color alone (CLAUDE.md §3.8): every tone pairs a
 * fixed icon with the label text.
 */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  const style = statusTones[tone];
  const Icon = icons[style.icon];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.badgeClassName}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
