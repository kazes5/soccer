import { describe, expect, it } from 'vitest';
import { coordinationSettingsRequestSchema } from './coordination-settings';

describe('coordinationSettingsRequestSchema', () => {
  it('accepts the documented defaults', () => {
    const result = coordinationSettingsRequestSchema.safeParse({
      swapExpiryHours: 24,
      reminderOffsetMinutes: [1440, 120],
      escalationLeadMinutes: 120,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a swap expiry outside 1-168 hours', () => {
    const result = coordinationSettingsRequestSchema.safeParse({
      swapExpiryHours: 169,
      reminderOffsetMinutes: [120],
      escalationLeadMinutes: 120,
    });

    expect(result.success).toBe(false);
  });

  it('rejects more than four reminder offsets', () => {
    const result = coordinationSettingsRequestSchema.safeParse({
      swapExpiryHours: 24,
      reminderOffsetMinutes: [1440, 720, 120, 60, 30],
      escalationLeadMinutes: 120,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty reminder offset list', () => {
    const result = coordinationSettingsRequestSchema.safeParse({
      swapExpiryHours: 24,
      reminderOffsetMinutes: [],
      escalationLeadMinutes: 120,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an escalation lead time at or below the fixed 60-minute admin alert', () => {
    const result = coordinationSettingsRequestSchema.safeParse({
      swapExpiryHours: 24,
      reminderOffsetMinutes: [120],
      escalationLeadMinutes: 60,
    });

    expect(result.success).toBe(false);
  });

  it('accepts an escalation lead time just above the fixed admin alert', () => {
    const result = coordinationSettingsRequestSchema.safeParse({
      swapExpiryHours: 24,
      reminderOffsetMinutes: [120],
      escalationLeadMinutes: 61,
    });

    expect(result.success).toBe(true);
  });
});
