import { z } from 'zod';

export const teamRoleSchema = z.enum(['parent', 'admin']);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const languageSchema = z.enum(['en', 'he']);
export type Language = z.infer<typeof languageSchema>;

export const collectionPointTypeSchema = z.enum(['pickup', 'dropoff', 'both']);
export type CollectionPointType = z.infer<typeof collectionPointTypeSchema>;

export const shiftDirectionSchema = z.enum(['to_practice', 'from_practice']);
export type ShiftDirection = z.infer<typeof shiftDirectionSchema>;

export const sessionStatusSchema = z.enum(['scheduled', 'completed', 'cancelled']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const shiftStatusSchema = z.enum(['open', 'claimed', 'pending_swap']);
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;
