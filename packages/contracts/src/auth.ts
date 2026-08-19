import { z } from 'zod';
import { systemRoleSchema } from './enums';
import { teamMembershipSchema, userSummarySchema } from './user';

/** Returned by any endpoint that establishes a new session. */
export const authSessionResponseSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string().datetime(),
  user: userSummarySchema,
  teamMemberships: z.array(teamMembershipSchema),
  systemRole: systemRoleSchema.nullable().optional(),
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const currentUserResponseSchema = z.object({
  user: userSummarySchema,
  teamMemberships: z.array(teamMembershipSchema),
  systemRole: systemRoleSchema.nullable().optional(),
});
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;

export const passwordLoginRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(128),
});
export type PasswordLoginRequest = z.infer<typeof passwordLoginRequestSchema>;

export const passwordChangeRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: z.string().min(15).max(128),
    passwordConfirmation: z.string().min(1).max(128),
  })
  .refine((body) => body.password === body.passwordConfirmation, {
    message: 'Passwords do not match.',
    path: ['passwordConfirmation'],
  });
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z
  .object({
    token: z.string().min(32).max(256),
    password: z.string().min(15).max(128),
    passwordConfirmation: z.string().min(1).max(128),
  })
  .refine((body) => body.password === body.passwordConfirmation, {
    message: 'Passwords do not match.',
    path: ['passwordConfirmation'],
  });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Shared by admin-set-password and system-admin-set-password — an admin
 *  choosing a password on someone else's behalf, no current password needed. */
export const setPasswordRequestSchema = z
  .object({
    password: z.string().min(15).max(128),
    passwordConfirmation: z.string().min(1).max(128),
  })
  .refine((body) => body.password === body.passwordConfirmation, {
    message: 'Passwords do not match.',
    path: ['passwordConfirmation'],
  });
export type SetPasswordRequest = z.infer<typeof setPasswordRequestSchema>;
