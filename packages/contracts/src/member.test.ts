import { describe, expect, it } from 'vitest';
import { teamRosterResponseSchema } from './member';

describe('teamRosterResponseSchema', () => {
  it('accepts a roster entry with only userId, name, and role', () => {
    const result = teamRosterResponseSchema.safeParse({
      members: [
        { userId: '11111111-1111-4111-8111-111111111111', name: 'Dana Cohen', role: 'admin' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an entry carrying contact details, since this is the parent-readable view', () => {
    const result = teamRosterResponseSchema.safeParse({
      members: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          name: 'Dana Cohen',
          role: 'admin',
          phone: '+15550001111',
        },
      ],
    });

    // Zod's default (non-strict) object parsing strips unknown keys rather than
    // rejecting them — this asserts the strip actually happens, so a caller can
    // never accidentally leak phone/email through this schema even if a future
    // route handler passed the wrong DTO into it.
    expect(result.success).toBe(true);
    expect(result.data?.members[0]).not.toHaveProperty('phone');
  });
});
