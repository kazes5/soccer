import { describe, expect, it } from 'vitest';
import { passkeyLoginOptionsRequestSchema, passkeyVerifyRequestSchema } from './auth';

describe('passkeyLoginOptionsRequestSchema', () => {
  it('rejects a request with neither phone nor email', () => {
    const result = passkeyLoginOptionsRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('accepts a request identified by phone', () => {
    const result = passkeyLoginOptionsRequestSchema.safeParse({ phone: '+15550000001' });

    expect(result.success).toBe(true);
  });
});

describe('passkeyVerifyRequestSchema', () => {
  it('requires a challengeId and a response', () => {
    const result = passkeyVerifyRequestSchema.safeParse({
      challengeId: '11111111-1111-4111-8111-111111111111',
      response: { id: 'fake-credential' },
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid challengeId', () => {
    const result = passkeyVerifyRequestSchema.safeParse({
      challengeId: 'not-a-uuid',
      response: {},
    });

    expect(result.success).toBe(false);
  });
});
