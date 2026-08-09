import { describe, expect, it } from 'vitest';
import { createTeamRequestSchema } from './team';

describe('createTeamRequestSchema', () => {
  it('accepts an admin identified by phone only', () => {
    const result = createTeamRequestSchema.safeParse({
      teamName: 'U-12 Wildcats',
      season: 'Fall 2026',
      adminName: 'Dana Cohen',
      adminPhone: '+15550000001',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an admin with neither phone nor email', () => {
    const result = createTeamRequestSchema.safeParse({
      teamName: 'U-12 Wildcats',
      season: 'Fall 2026',
      adminName: 'Dana Cohen',
    });

    expect(result.success).toBe(false);
  });
});
