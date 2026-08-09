/**
 * Semantic shift/session states from CLAUDE.md §3.8: green for "I'm assigned",
 * gray/white for "covered by someone else", red/orange for "open" (urgent once
 * inside the escalation window), amber for "needs attention", teal for "pending".
 *
 * Every tone pairs a color with an icon key so status is never conveyed by color
 * alone (color-blind friendliness is a hard requirement, not a nice-to-have).
 */
export type StatusTone = 'mine' | 'covered' | 'open' | 'urgent' | 'attention' | 'pending';

export type StatusIconKey = 'check-circle' | 'user' | 'alert-circle' | 'siren' | 'clock' | 'timer';

export interface StatusToneStyle {
  /** Subtle background + on-tone text/border, for inline badges and list rows. */
  badgeClassName: string;
  /** Small solid indicator dot, for compact list contexts. */
  dotClassName: string;
  icon: StatusIconKey;
}

export const statusTones: Record<StatusTone, StatusToneStyle> = {
  mine: {
    badgeClassName:
      'bg-status-mine-subtle text-status-mine-on border border-status-mine/25 dark:border-status-mine/40',
    dotClassName: 'bg-status-mine',
    icon: 'check-circle',
  },
  covered: {
    badgeClassName: 'bg-surface-soft text-ink-muted border border-surface-border',
    dotClassName: 'bg-ink-muted',
    icon: 'user',
  },
  open: {
    badgeClassName:
      'bg-status-open-subtle text-status-open-on border border-status-open/25 dark:border-status-open/40',
    dotClassName: 'bg-status-open',
    icon: 'alert-circle',
  },
  urgent: {
    badgeClassName: 'bg-status-open text-status-open-contrast border border-status-open',
    dotClassName: 'bg-status-open',
    icon: 'siren',
  },
  attention: {
    badgeClassName:
      'bg-status-attention-subtle text-status-attention-on border border-status-attention/25 dark:border-status-attention/40',
    dotClassName: 'bg-status-attention',
    icon: 'clock',
  },
  pending: {
    badgeClassName:
      'bg-status-pending-subtle text-status-pending-on border border-status-pending/25 dark:border-status-pending/40',
    dotClassName: 'bg-status-pending',
    icon: 'timer',
  },
};
