import { describe, expect, it } from 'vitest';
import { systemAddMemberRequestSchema, systemCreateTeamResponseSchema } from './system';

const BASE_ADD_MEMBER = {
  role: 'parent' as const,
  name: 'Avi Levi',
  password: 'Cedar-River!Otter-52',
  passwordConfirmation: 'Cedar-River!Otter-52',
};
const VALID_ADD_MEMBER = { ...BASE_ADD_MEMBER, phone: '+15550002222' };

describe('systemAddMemberRequestSchema', () => {
  it('accepts a valid parent request', () => {
    expect(systemAddMemberRequestSchema.safeParse(VALID_ADD_MEMBER).success).toBe(true);
  });

  it('accepts a valid admin request', () => {
    expect(
      systemAddMemberRequestSchema.safeParse({ ...VALID_ADD_MEMBER, role: 'admin' }).success,
    ).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(
      systemAddMemberRequestSchema.safeParse({ ...VALID_ADD_MEMBER, role: 'owner' }).success,
    ).toBe(false);
  });

  it('rejects neither phone nor email', () => {
    expect(systemAddMemberRequestSchema.safeParse(BASE_ADD_MEMBER).success).toBe(false);
  });

  it('rejects both phone and email', () => {
    expect(
      systemAddMemberRequestSchema.safeParse({ ...VALID_ADD_MEMBER, email: 'avi@example.com' })
        .success,
    ).toBe(false);
  });

  it('rejects a mismatched password confirmation', () => {
    expect(
      systemAddMemberRequestSchema.safeParse({
        ...VALID_ADD_MEMBER,
        passwordConfirmation: 'different',
      }).success,
    ).toBe(false);
  });

  it('rejects a password shorter than 15 characters', () => {
    expect(
      systemAddMemberRequestSchema.safeParse({
        ...VALID_ADD_MEMBER,
        password: 'short12',
        passwordConfirmation: 'short12',
      }).success,
    ).toBe(false);
  });
});

describe('systemCreateTeamResponseSchema', () => {
  it('accepts a team + admin, with no sessionToken field', () => {
    const result = systemCreateTeamResponseSchema.safeParse({
      team: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
      },
      admin: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
    });
    expect(result.success).toBe(true);
  });

  it('strips a sessionToken if one is present, since the response schema never declares it', () => {
    const result = systemCreateTeamResponseSchema.safeParse({
      team: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'U-12 Wildcats',
        season: 'Fall 2026',
        timezone: 'Asia/Jerusalem',
      },
      admin: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Dana Cohen',
        phone: '+15550001111',
        email: null,
        languagePreference: 'en',
      },
      sessionToken: 'leaked-token',
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('sessionToken');
  });
});
