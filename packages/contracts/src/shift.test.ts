import { describe, expect, it } from 'vitest';
import { shiftStatsResponseSchema } from './shift';

describe('shiftStatsResponseSchema', () => {
  it('accepts integer personal counts and a float team average', () => {
    const result = shiftStatsResponseSchema.safeParse({
      mine: { toPractice: 3, fromPractice: 2, total: 5 },
      teamAverage: { toPractice: 2.5, fromPractice: 1.75, total: 4.25 },
    });

    expect(result.success).toBe(true);
  });

  it('rejects a response missing the team average', () => {
    const result = shiftStatsResponseSchema.safeParse({
      mine: { toPractice: 3, fromPractice: 2, total: 5 },
    });

    expect(result.success).toBe(false);
  });
});
