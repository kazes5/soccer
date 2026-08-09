import { z } from 'zod';

export const teamRoleSchema = z.enum(['parent', 'admin']);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const languageSchema = z.enum(['en', 'he']);
export type Language = z.infer<typeof languageSchema>;
