import { z } from 'zod';

export const createScheduleTemplateRequestSchema = z.object({
  recurrenceRule: z.string().min(1).max(255),
  startDate: z.string().date(),
  defaultTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour).'),
  defaultFieldLocation: z.string().min(1).max(255),
  horizonWeeks: z.number().int().min(1).max(52).default(8),
  collectionPointIds: z.array(z.string().uuid()).min(1),
});
export type CreateScheduleTemplateRequest = z.input<typeof createScheduleTemplateRequestSchema>;

/**
 * `startDate` is deliberately excluded — it's the recurrence anchor; changing it
 * would shift the phase of every future occurrence in a way CLAUDE.md doesn't ask
 * for. All other fields are optional (partial update).
 */
export const updateScheduleTemplateRequestSchema = z.object({
  recurrenceRule: z.string().min(1).max(255).optional(),
  defaultTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour).')
    .optional(),
  defaultFieldLocation: z.string().min(1).max(255).optional(),
  horizonWeeks: z.number().int().min(1).max(52).optional(),
  collectionPointIds: z.array(z.string().uuid()).min(1).optional(),
});
export type UpdateScheduleTemplateRequest = z.input<typeof updateScheduleTemplateRequestSchema>;

export const scheduleTemplateSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  recurrenceRule: z.string(),
  startDate: z.string().date(),
  defaultTime: z.string(),
  defaultFieldLocation: z.string(),
  horizonWeeks: z.number().int(),
  collectionPointIds: z.array(z.string().uuid()),
  createdByUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type ScheduleTemplate = z.infer<typeof scheduleTemplateSchema>;

export const createScheduleTemplateResponseSchema = z.object({
  template: scheduleTemplateSchema,
  sessionsCreated: z.number().int(),
});
export type CreateScheduleTemplateResponse = z.infer<typeof createScheduleTemplateResponseSchema>;

/** Same shape as create's response — an edit is purely additive (see the route for why). */
export const updateScheduleTemplateResponseSchema = createScheduleTemplateResponseSchema;
export type UpdateScheduleTemplateResponse = z.infer<typeof updateScheduleTemplateResponseSchema>;

export const scheduleTemplateListResponseSchema = z.object({
  templates: z.array(scheduleTemplateSchema),
});
export type ScheduleTemplateListResponse = z.infer<typeof scheduleTemplateListResponseSchema>;
