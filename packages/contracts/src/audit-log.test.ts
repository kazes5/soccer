import { describe, expect, it } from 'vitest';
import {
  auditLogEntrySchema,
  auditLogListQuerySchema,
  auditLogListResponseSchema,
} from './audit-log';

const entry = {
  id: '11111111-1111-4111-8111-111111111111',
  teamId: '22222222-2222-4222-8222-222222222222',
  actor: { id: '33333333-3333-4333-8333-333333333333', name: 'Dana Cohen' },
  actionType: 'member_promoted',
  targetEntity: 'team_member',
  targetId: '44444444-4444-4444-8444-444444444444',
  beforeState: { role: 'parent' },
  afterState: { role: 'admin' },
  source: 'app' as const,
  aiContext: null,
  createdAt: '2026-08-13T10:00:00.000Z',
};

describe('audit log contracts', () => {
  it('accepts an entry with a named actor and structured state', () => {
    expect(auditLogEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('accepts a system-authored entry with no actor', () => {
    expect(auditLogEntrySchema.safeParse({ ...entry, actor: null }).success).toBe(true);
  });

  it('validates a cursor-paginated list response', () => {
    expect(
      auditLogListResponseSchema.safeParse({
        entries: [entry],
        nextCursor: '55555555-5555-4555-8555-555555555555',
      }).success,
    ).toBe(true);
  });

  it('coerces the page size and accepts all supported literal filters', () => {
    const parsed = auditLogListQuerySchema.parse({
      actor: 'Dana',
      action: 'member_promoted',
      target: 'team_member',
      source: 'ai_chat',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      search: 'role',
      limit: '50',
    });

    expect(parsed.limit).toBe(50);
    expect(parsed.actor).toBe('Dana');
  });

  it('rejects invalid sources, cursors, oversized search, and inverted dates', () => {
    expect(auditLogListQuerySchema.safeParse({ source: 'script' }).success).toBe(false);
    expect(auditLogListQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success).toBe(false);
    expect(auditLogListQuerySchema.safeParse({ search: 'x'.repeat(201) }).success).toBe(false);
    expect(
      auditLogListQuerySchema.safeParse({
        from: '2026-08-14T00:00:00.000Z',
        to: '2026-08-13T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
