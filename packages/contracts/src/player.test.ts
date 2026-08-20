import { describe, expect, it } from 'vitest';
import {
  acceptInvitePlayerSchema,
  createPlayerRequestSchema,
  playerListResponseSchema,
  updatePlayerRequestSchema,
} from './player';

const PARENT_ID_A = '11111111-1111-4111-8111-111111111111';
const PARENT_ID_B = '22222222-2222-4222-8222-222222222222';

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
      players: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Yossi Levi',
          age: null,
          parentNames: [],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a player missing a valid id', () => {
    const result = playerListResponseSchema.safeParse({
      players: [{ id: 'not-a-uuid', name: 'Yossi Levi', age: null, parentNames: [] }],
    });

    expect(result.success).toBe(false);
  });

  it('accepts age 0, since the response schema describes what is storable, not the stricter registration business rule', () => {
    const result = playerListResponseSchema.safeParse({
      players: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Newborn Sibling',
          age: 0,
          parentNames: [],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('denormalizes linked parent names onto each entry', () => {
    const result = playerListResponseSchema.safeParse({
      players: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Yossi Levi',
          age: 11,
          parentNames: ['Avi Levi'],
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe('createPlayerRequestSchema', () => {
  it('accepts a player with just a name', () => {
    expect(createPlayerRequestSchema.safeParse({ name: 'Yossi Levi' }).success).toBe(true);
  });

  it('defaults parentUserIds to an empty array', () => {
    expect(createPlayerRequestSchema.parse({ name: 'Yossi Levi' }).parentUserIds).toEqual([]);
  });

  it('rejects an unreasonable age, same bound as onboarding', () => {
    expect(createPlayerRequestSchema.safeParse({ name: 'Yossi Levi', age: 40 }).success).toBe(
      false,
    );
  });

  it('accepts up to 10 parent user ids', () => {
    const parentUserIds = Array.from(
      { length: 10 },
      (_, i) => `1111111${i}-1111-4111-8111-11111111111${i}`,
    );
    expect(createPlayerRequestSchema.safeParse({ name: 'Yossi Levi', parentUserIds }).success).toBe(
      true,
    );
  });

  it('rejects more than 10 parent user ids', () => {
    const parentUserIds = Array.from({ length: 11 }, () => PARENT_ID_A);
    expect(createPlayerRequestSchema.safeParse({ name: 'Yossi Levi', parentUserIds }).success).toBe(
      false,
    );
  });

  it('rejects a malformed parent user id', () => {
    expect(
      createPlayerRequestSchema.safeParse({ name: 'Yossi Levi', parentUserIds: ['not-a-uuid'] })
        .success,
    ).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(createPlayerRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('updatePlayerRequestSchema', () => {
  it('accepts an empty object — every field is optional for a partial update', () => {
    expect(updatePlayerRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a name-only update', () => {
    expect(updatePlayerRequestSchema.safeParse({ name: 'New Name' }).success).toBe(true);
  });

  it('accepts a null age, unlike the create schema (clearing a previously set age)', () => {
    expect(updatePlayerRequestSchema.safeParse({ age: null }).success).toBe(true);
  });

  it('rejects an unreasonable age', () => {
    expect(updatePlayerRequestSchema.safeParse({ age: 40 }).success).toBe(false);
  });

  it('replaces, not merges — accepts a fresh parentUserIds list', () => {
    const result = updatePlayerRequestSchema.safeParse({
      parentUserIds: [PARENT_ID_A, PARENT_ID_B],
    });
    expect(result.success).toBe(true);
    expect(result.data?.parentUserIds).toEqual([PARENT_ID_A, PARENT_ID_B]);
  });

  it('rejects more than 10 parent user ids', () => {
    const parentUserIds = Array.from({ length: 11 }, () => PARENT_ID_A);
    expect(updatePlayerRequestSchema.safeParse({ parentUserIds }).success).toBe(false);
  });
});
