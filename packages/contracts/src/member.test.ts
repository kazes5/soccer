import { describe, expect, it } from 'vitest';
import {
  addParentRequestSchema,
  teamRosterResponseSchema,
  updateMemberRoleResponseSchema,
} from './member';

const BASE_ADD_PARENT = {
  name: 'Avi Levi',
  password: 'Cedar-River!Otter-52',
  passwordConfirmation: 'Cedar-River!Otter-52',
};
const VALID_ADD_PARENT = { ...BASE_ADD_PARENT, phone: '+15550002222' };

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

describe('addParentRequestSchema', () => {
  it('accepts a valid request identified by phone', () => {
    expect(addParentRequestSchema.safeParse(VALID_ADD_PARENT).success).toBe(true);
  });

  it('accepts a valid request identified by email', () => {
    expect(
      addParentRequestSchema.safeParse({ ...BASE_ADD_PARENT, email: 'avi@example.com' }).success,
    ).toBe(true);
  });

  it('rejects neither phone nor email', () => {
    expect(addParentRequestSchema.safeParse(BASE_ADD_PARENT).success).toBe(false);
  });

  it('rejects both phone and email', () => {
    expect(
      addParentRequestSchema.safeParse({ ...VALID_ADD_PARENT, email: 'avi@example.com' }).success,
    ).toBe(false);
  });

  it('rejects a mismatched password confirmation', () => {
    expect(
      addParentRequestSchema.safeParse({ ...VALID_ADD_PARENT, passwordConfirmation: 'different' })
        .success,
    ).toBe(false);
  });

  it('rejects a password shorter than 15 characters', () => {
    expect(
      addParentRequestSchema.safeParse({
        ...VALID_ADD_PARENT,
        password: 'short12',
        passwordConfirmation: 'short12',
      }).success,
    ).toBe(false);
  });

  it('defaults language to en and players to an empty list', () => {
    const result = addParentRequestSchema.parse(VALID_ADD_PARENT);
    expect(result).toMatchObject({ language: 'en', players: [] });
  });
});
