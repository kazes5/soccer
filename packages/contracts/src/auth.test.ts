import { describe, expect, it } from 'vitest';
import { requestOtpRequestSchema, verifyOtpRequestSchema } from './auth';

describe('requestOtpRequestSchema', () => {
  it('rejects a request with neither phone nor email', () => {
    const result = requestOtpRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

describe('verifyOtpRequestSchema', () => {
  it('rejects a code that is not 6 digits long', () => {
    const result = verifyOtpRequestSchema.safeParse({
      challengeId: '11111111-1111-1111-1111-111111111111',
      code: '123',
    });

    expect(result.success).toBe(false);
  });
});
