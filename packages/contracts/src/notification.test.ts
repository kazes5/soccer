import { describe, expect, it } from 'vitest';
import { notificationSchema } from './notification';

describe('notificationSchema', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    eventType: 'shift_claimed' as const,
    category: 'shift_changes' as const,
    severity: 'normal' as const,
    payload: { sessionId: 'session-1', shiftId: 'shift-1' },
    readAt: null,
    dismissedAt: null,
    createdAt: '2026-08-12T00:00:00.000Z',
  };

  it('accepts a well-formed unread notification', () => {
    expect(notificationSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a read and dismissed notification', () => {
    const result = notificationSchema.safeParse({
      ...base,
      readAt: '2026-08-12T01:00:00.000Z',
      dismissedAt: '2026-08-12T01:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid event type', () => {
    const result = notificationSchema.safeParse({ ...base, eventType: 'not_a_real_event' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid severity', () => {
    const result = notificationSchema.safeParse({ ...base, severity: 'urgent' });
    expect(result.success).toBe(false);
  });
});
