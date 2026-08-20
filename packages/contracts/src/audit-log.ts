import { z } from 'zod';

export const auditSourceSchema = z.enum(['app', 'ai_chat']);
export type AuditSource = z.infer<typeof auditSourceSchema>;

export const auditLogActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type AuditLogActor = z.infer<typeof auditLogActorSchema>;

/**
 * CLAUDE.md §6.3: every AI-chat action logs the natural-language request, the
 * translated (structured) action, and the outcome. `result` is stored
 * explicitly rather than left implicit in `actionType` naming, so the audit
 * UI can render success/failure without parsing action-type strings — chat
 * actions are audited on both outcomes (an app-sourced action only ever logs
 * on success; a failed chat tool call — permission denied, conflict, bad
 * input — gets its own `result: 'failure'` row instead of vanishing).
 */
export const auditLogAiContextSchema = z.object({
  transcript: z.string().max(2000),
  translatedAction: z.string().max(500),
  result: z.enum(['success', 'failure']),
});
export type AuditLogAiContext = z.infer<typeof auditLogAiContextSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  actor: auditLogActorSchema.nullable(),
  actionType: z.string(),
  targetEntity: z.string(),
  targetId: z.string().nullable(),
  beforeState: z.unknown().nullable(),
  afterState: z.unknown().nullable(),
  source: auditSourceSchema,
  aiContext: auditLogAiContextSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogListResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  nextCursor: z.string().uuid().nullable(),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

/**
 * Shared literal filters for the JSON list and CSV export. Text values are
 * intentionally bounded and later passed through Prisma's parameterized
 * query builder; neither endpoint interpolates user input into SQL.
 */
export const auditLogFilterSchema = z.object({
  actor: z.string().trim().min(1).max(100).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  target: z.string().trim().min(1).max(100).optional(),
  source: auditSourceSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type AuditLogFilter = z.infer<typeof auditLogFilterSchema>;

export const auditLogListQuerySchema = auditLogFilterSchema
  .extend({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
    message: '`from` must not be after `to`.',
    path: ['from'],
  });
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
