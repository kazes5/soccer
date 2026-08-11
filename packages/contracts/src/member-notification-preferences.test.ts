import { describe, expect, it } from 'vitest';
import { updateMemberNotificationPreferencesRequestSchema } from './member-notification-preferences';

describe('updateMemberNotificationPreferencesRequestSchema', () => {
  const teamId = '11111111-1111-4111-8111-111111111111';

  it('accepts a teamId-only request that touches nothing', () => {
    const result = updateMemberNotificationPreferencesRequestSchema.safeParse({ teamId });

    expect(result.success).toBe(true);
  });

  it('distinguishes an explicit null (clear override) from an omitted field', () => {
    const result = updateMemberNotificationPreferencesRequestSchema.safeParse({
      teamId,
      quietHoursStart: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quietHoursStart).toBeNull();
      expect(result.data.quietHoursEnd).toBeUndefined();
    }
  });

  it('accepts an empty reminderOffsetMinutes array to clear the personal override', () => {
    const result = updateMemberNotificationPreferencesRequestSchema.safeParse({
      teamId,
      reminderOffsetMinutes: [],
    });

    expect(result.success).toBe(true);
  });

  it('rejects more than four reminder offsets', () => {
    const result = updateMemberNotificationPreferencesRequestSchema.safeParse({
      teamId,
      reminderOffsetMinutes: [1440, 720, 120, 60, 30],
    });

    expect(result.success).toBe(false);
  });

  it('defaults a category preference channel to push when omitted', () => {
    const result = updateMemberNotificationPreferencesRequestSchema.safeParse({
      teamId,
      categoryPreferences: [{ category: 'swaps', enabled: false }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryPreferences?.[0]?.channel).toBe('push');
    }
  });

  it('rejects an invalid category', () => {
    const result = updateMemberNotificationPreferencesRequestSchema.safeParse({
      teamId,
      categoryPreferences: [{ category: 'not_a_real_category', enabled: false }],
    });

    expect(result.success).toBe(false);
  });
});
