import { z } from 'zod';
import { sessionKindSchema } from './enums';

/**
 * Coach-message import: a team member pastes the coach's WhatsApp-style
 * schedule message, the AI extracts the practices/games it describes, and the
 * server turns that into a reviewable list of concrete schedule changes
 * (create / update / cancel) against the team's real sessions. Nothing is
 * written until the member applies the proposal — see
 * apps/api/src/routes/schedule-import.ts.
 */

const localDateSchema = z.string().date();
const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour).');

/** Team admin / system admin toggle — `enabled: false` hides and blocks the
 *  feature for every member of the team, admins included. */
export const coachMessageImportSettingsSchema = z.object({
  enabled: z.boolean(),
});
export type CoachMessageImportSettings = z.infer<typeof coachMessageImportSettingsSchema>;

export const scheduleImportPreviewRequestSchema = z.object({
  // Matches the audit log's `aiContext.transcript` cap, so the full message
  // the AI acted on is always what gets recorded.
  message: z.string().trim().min(1).max(2000),
  /** The day the coach sent the message, in the team's local calendar —
   *  "next week" / "Tuesday" are resolved relative to it. Defaults to today. */
  referenceDate: localDateSchema.optional(),
  locale: z.enum(['en', 'he']).default('en'),
  /** Start the message's week over: cancel every upcoming session in it and
   *  create the message's events fresh, instead of matching and updating. */
  replaceWeek: z.boolean().default(false),
});
export type ScheduleImportPreviewRequest = z.input<typeof scheduleImportPreviewRequestSchema>;

/** A session's schedule-relevant fields, in team-local wall-clock terms. */
export const scheduleImportSessionFieldsSchema = z.object({
  date: localDateSchema,
  time: localTimeSchema,
  kind: sessionKindSchema,
  title: z.string().max(255).nullable(),
  fieldLocation: z.string().min(1).max(255),
  notes: z.string().max(1000).nullable(),
});
export type ScheduleImportSessionFields = z.infer<typeof scheduleImportSessionFieldsSchema>;

export const scheduleImportOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    after: scheduleImportSessionFieldsSchema,
  }),
  z.object({
    type: z.literal('update'),
    sessionId: z.string().uuid(),
    /** Optimistic-concurrency guard: applying fails if the session changed
     *  after this proposal was built. */
    expectedUpdatedAt: z.string().datetime(),
    before: scheduleImportSessionFieldsSchema,
    after: scheduleImportSessionFieldsSchema,
  }),
  z.object({
    type: z.literal('cancel'),
    sessionId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
    before: scheduleImportSessionFieldsSchema,
    /** `explicit`: the message says it's off. `not_in_message`: the message
     *  is a full schedule for the period and this session isn't in it.
     *  `replaced`: the member chose to replace the week's schedule. */
    reason: z.enum(['explicit', 'not_in_message', 'replaced']),
  }),
]);
export type ScheduleImportOperation = z.infer<typeof scheduleImportOperationSchema>;

export const scheduleImportPreviewResponseSchema = z.object({
  operations: z.array(scheduleImportOperationSchema),
  /** Things the message mentions that couldn't be turned into a change —
   *  e.g. "cup game vs. Kfar Saba, date still pending" — shown to the
   *  member as-is so nothing the coach said silently disappears. */
  unresolved: z.array(z.string()),
  /** The Sunday–Saturday week whose sessions were proposed for replacement,
   *  when `replaceWeek` was requested and the message gave a week. */
  replacedWeek: z.object({ start: localDateSchema, end: localDateSchema }).nullable(),
  /** Signs `operations` (see chat-confirmation.ts); applying requires it, so
   *  only what the AI actually proposed — or a subset — can be applied. */
  proposalToken: z.string(),
});
export type ScheduleImportPreviewResponse = z.infer<typeof scheduleImportPreviewResponseSchema>;

export const scheduleImportApplyRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  operations: z.array(scheduleImportOperationSchema).max(50),
  proposalToken: z.string(),
  /** Indexes into `operations` the member kept checked. */
  selected: z.array(z.number().int().min(0)).min(1).max(50),
});
export type ScheduleImportApplyRequest = z.infer<typeof scheduleImportApplyRequestSchema>;

export const scheduleImportApplyResponseSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  cancelled: z.number().int(),
});
export type ScheduleImportApplyResponse = z.infer<typeof scheduleImportApplyResponseSchema>;
