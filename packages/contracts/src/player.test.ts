import { describe, expect, it } from 'vitest';
import { acceptInvitePlayerSchema, playerListResponseSchema } from './player';

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

describe('playerListResponseSchema', () => {
  it('accepts a roster with a null age', () => {
    const result = playerListResponseSchema.safeParse({
      players: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Yossi Levi', age: null }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a player missing a valid id', () => {
    const result = playerListResponseSchema.safeParse({
      players: [{ id: 'not-a-uuid', name: 'Yossi Levi', age: null }],
    });

    expect(result.success).toBe(false);
  });

  it('accepts age 0, since the response schema describes what is storable, not the stricter registration business rule', () => {
    const result = playerListResponseSchema.safeParse({
      players: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Newborn Sibling', age: 0 }],
    });

    expect(result.success).toBe(true);
  });
});
