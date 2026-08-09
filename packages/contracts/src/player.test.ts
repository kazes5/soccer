import { describe, expect, it } from 'vitest';
import { acceptInvitePlayerSchema } from './player';

describe('acceptInvitePlayerSchema', () => {
  it('accepts a player with no age given', () => {
    const result = acceptInvitePlayerSchema.safeParse({ name: 'Yossi Levi' });

    expect(result.success).toBe(true);
  });

  it('rejects an unreasonable age', () => {
    const result = acceptInvitePlayerSchema.safeParse({ name: 'Yossi Levi', age: 40 });

    expect(result.success).toBe(false);
  });
});
