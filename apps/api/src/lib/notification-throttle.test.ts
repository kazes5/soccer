import { describe, expect, it } from 'vitest';
import { decidePushAction, entityKeyFor, type RecentPush } from './notification-throttle';

describe('entityKeyFor', () => {
  it('keys shift events by shiftId', () => {
    expect(entityKeyFor('shift_claimed', { shiftId: 'shift-1' })).toBe('shift:shift-1');
    expect(entityKeyFor('shift_released', { shiftId: 'shift-1' })).toBe('shift:shift-1');
  });

  it('keys session-level events by sessionId', () => {
    expect(entityKeyFor('session_updated', { sessionId: 'session-1' })).toBe('session:session-1');
    expect(entityKeyFor('session_cancelled', { sessionId: 'session-1' })).toBe('session:session-1');
  });

  it('keys schedule template events by templateId', () => {
    expect(entityKeyFor('schedule_template_created', { templateId: 'template-1' })).toBe(
      'template:template-1',
    );
  });

  it('keys member/admin events by the target userId', () => {
    expect(entityKeyFor('member_promoted', { userId: 'user-1' })).toBe('member:user-1');
  });

  it('keys every swap lifecycle event by swapRequestId', () => {
    for (const eventType of [
      'swap_requested',
      'swap_accepted',
      'swap_declined',
      'swap_expired',
      'swap_cancelled',
    ]) {
      expect(entityKeyFor(eventType, { swapRequestId: 'swap-1' })).toBe('swap:swap-1');
    }
  });

  it('returns null for an unrecognized event type or a missing id', () => {
    expect(entityKeyFor('some_future_event_type', { shiftId: 'shift-1' })).toBeNull();
    expect(entityKeyFor('shift_claimed', {})).toBeNull();
  });
});

describe('decidePushAction', () => {
  const now = new Date('2026-08-12T12:00:00.000Z');

  it('sends when there is no recent history', () => {
    expect(decidePushAction([], now, 'shift:shift-1')).toBe('send');
  });

  it('collapses a second change to the same entity within 60s', () => {
    const recent: RecentPush[] = [
      { createdAt: new Date(now.getTime() - 30_000), entityKey: 'shift:shift-1' },
    ];
    expect(decidePushAction(recent, now, 'shift:shift-1')).toBe('collapse');
  });

  it('does not collapse a change to the same entity once 60s have passed', () => {
    const recent: RecentPush[] = [
      { createdAt: new Date(now.getTime() - 61_000), entityKey: 'shift:shift-1' },
    ];
    expect(decidePushAction(recent, now, 'shift:shift-1')).toBe('send');
  });

  it('does not collapse a change to a different entity', () => {
    const recent: RecentPush[] = [
      { createdAt: new Date(now.getTime() - 10_000), entityKey: 'shift:shift-1' },
    ];
    expect(decidePushAction(recent, now, 'shift:shift-2')).toBe('send');
  });

  it('sends normally under the 5-push throttle threshold', () => {
    const recent: RecentPush[] = Array.from({ length: 4 }, (_, i) => ({
      createdAt: new Date(now.getTime() - (i + 1) * 1000),
      entityKey: `shift:shift-${i}`,
    }));
    expect(decidePushAction(recent, now, 'shift:shift-99')).toBe('send');
  });

  it('sends a summary for exactly the 6th non-urgent push in the window', () => {
    const recent: RecentPush[] = Array.from({ length: 5 }, (_, i) => ({
      createdAt: new Date(now.getTime() - (i + 1) * 1000),
      entityKey: `shift:shift-${i}`,
    }));
    expect(decidePushAction(recent, now, 'shift:shift-99')).toBe('summary');
  });

  it('throttles (suppresses) every push after the summary, within the same window', () => {
    const recent: RecentPush[] = Array.from({ length: 6 }, (_, i) => ({
      createdAt: new Date(now.getTime() - (i + 1) * 1000),
      entityKey: `shift:shift-${i}`,
    }));
    expect(decidePushAction(recent, now, 'shift:shift-99')).toBe('throttle');
  });

  it('collapse takes priority over an already-exhausted throttle window', () => {
    const recent: RecentPush[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        createdAt: new Date(now.getTime() - (i + 10) * 1000),
        entityKey: `shift:shift-${i}`,
      })),
      { createdAt: new Date(now.getTime() - 5_000), entityKey: 'shift:shift-1' },
    ];
    expect(decidePushAction(recent, now, 'shift:shift-1')).toBe('collapse');
  });

  it('treats a null entityKey as never collapsible', () => {
    const recent: RecentPush[] = [{ createdAt: new Date(now.getTime() - 1_000), entityKey: null }];
    expect(decidePushAction(recent, now, null)).toBe('send');
  });
});
