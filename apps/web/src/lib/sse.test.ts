import type { Notification } from '@soccer/contracts';
import { describe, expect, it } from 'vitest';
import { shouldApply } from './sse';

function makeNotification(id: string): Notification {
  return {
    id,
    teamId: 'team-1',
    eventType: 'shift_claimed',
    category: 'shift_changes',
    severity: 'normal',
    payload: {},
    readAt: null,
    dismissedAt: null,
    createdAt: '2026-08-12T15:00:00.000Z',
  };
}

describe('shouldApply', () => {
  it('applies a notification id the first time it is seen', () => {
    const seenIds = new Set<string>();
    expect(shouldApply(seenIds, makeNotification('notif-1'))).toBe(true);
  });

  it('does not re-apply a notification id already seen', () => {
    const seenIds = new Set<string>(['notif-1']);
    expect(shouldApply(seenIds, makeNotification('notif-1'))).toBe(false);
  });

  it('tracks multiple distinct ids independently', () => {
    const seenIds = new Set<string>();
    expect(shouldApply(seenIds, makeNotification('notif-1'))).toBe(true);
    expect(shouldApply(seenIds, makeNotification('notif-2'))).toBe(true);
    expect(shouldApply(seenIds, makeNotification('notif-1'))).toBe(false);
    expect(shouldApply(seenIds, makeNotification('notif-2'))).toBe(false);
  });
});
