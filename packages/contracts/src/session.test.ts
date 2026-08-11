import { describe, expect, it } from 'vitest';
import { updateSessionRequestSchema } from './session';

describe('updateSessionRequestSchema', () => {
  it('accepts date and time independently or together', () => {
    expect(updateSessionRequestSchema.safeParse({ date: '2026-08-17' }).success).toBe(true);
    expect(updateSessionRequestSchema.safeParse({ time: '19:30' }).success).toBe(true);
    expect(
      updateSessionRequestSchema.safeParse({ date: '2026-08-17', time: '19:30' }).success,
    ).toBe(true);
  });

  it('accepts an empty body (fieldLocation-only edits omit date/time)', () => {
    expect(updateSessionRequestSchema.safeParse({ fieldLocation: 'North Field' }).success).toBe(
      true,
    );
  });

  it('rejects a time not in 24-hour HH:MM form', () => {
    expect(updateSessionRequestSchema.safeParse({ time: '7:30pm' }).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(updateSessionRequestSchema.safeParse({ date: '17-08-2026' }).success).toBe(false);
  });
});
