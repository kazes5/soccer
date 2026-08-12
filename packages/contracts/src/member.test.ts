import { describe, expect, it } from 'vitest';
import { teamRosterResponseSchema, updateMemberRoleResponseSchema } from './member';

describe('teamRosterResponseSchema', () => {
  it('accepts a roster entry with only userId, name, and role', () => {
    const result = teamRosterResponseSchema.safeParse({
      members: [
        { userId: '11111111-1111-4111-8111-111111111111', name: 'Dana Cohen', role: 'admin' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('strips contact details from the parent-readable view', () => {
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

    // Zod's default object parsing strips unknown keys. This prevents a caller
    // from leaking contact details if a future handler passes the wrong DTO.
    expect(result.success).toBe(true);
    expect(result.data?.members[0]).not.toHaveProperty('phone');
  });
});

describe('updateMemberRoleResponseSchema', () => {
  it('accepts a role-change response', () => {
    expect(
      updateMemberRoleResponseSchema.safeParse({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'admin',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(
      updateMemberRoleResponseSchema.safeParse({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'owner',
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed user id', () => {
    expect(
      updateMemberRoleResponseSchema.safeParse({ userId: 'not-a-uuid', role: 'parent' }).success,
    ).toBe(false);
  });
});
