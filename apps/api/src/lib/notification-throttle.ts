/** A prior non-urgent push send to this same recipient/team, for deciding
 * what the current one should do. `entityKey` is `null` when the event type
 * has no natural entity to collapse repeats of. */
export interface RecentPush {
  createdAt: Date;
  entityKey: string | null;
}

export type PushAction = 'send' | 'summary' | 'collapse' | 'throttle';

export const COLLAPSE_WINDOW_MS = 60_000;
export const THROTTLE_WINDOW_MS = 5 * 60_000;
/** After this many non-urgent pushes in the window, the next one becomes a
 * single summary; every one after *that* is suppressed (still in-app-only)
 * until the window rolls forward — see {@link decidePushAction}. */
const THROTTLE_THRESHOLD = 5;

/**
 * Extracts a comparable "what did this change" key from an event's payload,
 * for the collapse rule below. Covers every event type Checkpoint 4
 * retrofitted (see `packages/contracts/src/notification.ts`); an
 * unrecognized event type or a payload missing the expected id has nothing
 * to collapse against, so it always sends.
 */
export function entityKeyFor(eventType: string, payload: Record<string, unknown>): string | null {
  switch (eventType) {
    case 'shift_claimed':
    case 'shift_released':
      return typeof payload.shiftId === 'string' ? `shift:${payload.shiftId}` : null;
    case 'session_updated':
    case 'session_cancelled':
    case 'session_point_players_updated':
      return typeof payload.sessionId === 'string' ? `session:${payload.sessionId}` : null;
    case 'schedule_template_created':
    case 'schedule_template_updated':
      return typeof payload.templateId === 'string' ? `template:${payload.templateId}` : null;
    case 'member_promoted':
    case 'member_demoted':
    case 'member_removed':
    case 'member_added_directly':
    case 'invite_accepted':
      return typeof payload.userId === 'string' ? `member:${payload.userId}` : null;
    case 'swap_requested':
    case 'swap_accepted':
    case 'swap_declined':
    case 'swap_expired':
    case 'swap_cancelled':
      return typeof payload.swapRequestId === 'string' ? `swap:${payload.swapRequestId}` : null;
    // Its own namespace, not `shift:${shiftId}` — a reminder isn't a
    // "change" to the shift the way claim/release are, so it shouldn't
    // collapse against (or be collapsed by) one of those.
    case 'shift_reminder':
      return typeof payload.shiftId === 'string' ? `reminder:${payload.shiftId}` : null;
    default:
      return null;
  }
}

/**
 * Decides what a non-urgent push should do, given the recipient's recent
 * non-urgent push history for this team (already scoped to the trailing
 * {@link THROTTLE_WINDOW_MS} — see `entityKeyFor` for how `entityKey` is
 * derived from the *new* event). Per ADR 0001: repeated changes to the same
 * entity within 60s collapse into the push already sent for it; otherwise, a
 * recipient who'd get more than 5 non-urgent pushes for one team within 5
 * minutes gets one "team has updates" summary instead of the 6th, and every
 * push after that in the window is suppressed entirely — the underlying
 * events still appear in full in-app throughout, this only ever changes
 * whether a *push* goes out. Emergency-severity events bypass this function
 * altogether (call site decides that before ever calling this), so
 * `recentPushes` should only ever contain non-urgent sends.
 */
export function decidePushAction(
  recentPushes: RecentPush[],
  now: Date,
  entityKey: string | null,
): PushAction {
  if (entityKey) {
    const collapseSince = now.getTime() - COLLAPSE_WINDOW_MS;
    const hasRecentSameEntity = recentPushes.some(
      (push) => push.entityKey === entityKey && push.createdAt.getTime() >= collapseSince,
    );
    if (hasRecentSameEntity) return 'collapse';
  }

  if (recentPushes.length < THROTTLE_THRESHOLD) return 'send';
  if (recentPushes.length === THROTTLE_THRESHOLD) return 'summary';
  return 'throttle';
}
