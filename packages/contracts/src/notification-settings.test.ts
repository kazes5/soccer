import { describe, expect, it } from 'vitest';
import { teamNotificationSettingsRequestSchema } from './notification-settings';

describe('teamNotificationSettingsRequestSchema', () => {
  it('accepts the documented default quiet-hours window', () => {
    const result = teamNotificationSettingsRequestSchema.safeParse({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-24-hour time string', () => {
    const result = teamNotificationSettingsRequestSchema.safeParse({
      quietHoursStart: '10:00 PM',
      quietHoursEnd: '07:00',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range hour', () => {
    const result = teamNotificationSettingsRequestSchema.safeParse({
      quietHoursStart: '24:00',
      quietHoursEnd: '07:00',
    });

    expect(result.success).toBe(false);
  });
});
