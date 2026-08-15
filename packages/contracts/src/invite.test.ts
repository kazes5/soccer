import { describe, expect, it } from 'vitest';
import { acceptInviteRequestSchema, createInviteRequestSchema } from './invite';

describe('createInviteRequestSchema', () => {
  it('defaults expiresInDays to 7', () => {
    const result = createInviteRequestSchema.parse({ phone: '+15550000002' });

    expect(result.expiresInDays).toBe(7);
  });

  it('rejects an invite with neither phone nor email', () => {
    const result = createInviteRequestSchema.safeParse({ expiresInDays: 3 });

    expect(result.success).toBe(false);
  });

  it('rejects an invite with both phone and email', () => {
    const result = createInviteRequestSchema.safeParse({
      phone: '+15550000003',
      email: 'parent@example.com',
    });

    expect(result.success).toBe(false);
  });
});

describe('acceptInviteRequestSchema', () => {
  it('defaults language to en and players to an empty list', () => {
    const result = acceptInviteRequestSchema.parse({ name: 'Avi Levi' });

    expect(result).toMatchObject({ language: 'en', players: [] });
  });
});
