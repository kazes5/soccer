import { describe, expect, it } from 'vitest';
import { healthStatusSchema } from './health';

describe('healthStatusSchema', () => {
  it('accepts a well-formed health payload', () => {
    const result = healthStatusSchema.safeParse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it('rejects a payload with the wrong status literal', () => {
    const result = healthStatusSchema.safeParse({
      status: 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });
});
