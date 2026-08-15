import { z } from 'zod';
import { authMethodSchema, systemRoleSchema } from './enums';
import { teamMembershipSchema, userSummarySchema } from './user';

export const passkeyLoginOptionsRequestSchema = z
  .object({
    phone: z.string().min(1).max(20).optional(),
    email: z.string().email().optional(),
  })
  .refine((data) => Boolean(data.phone ?? data.email), {
    message: 'Provide phone or email.',
    path: ['phone'],
  });
export type PasskeyLoginOptionsRequest = z.input<typeof passkeyLoginOptionsRequestSchema>;

/**
 * Shared by every "start a WebAuthn ceremony" response (registration or
 * authentication) — `options` is the JSON options object handed straight to
 * `@simplewebauthn/browser`'s `startRegistration`/`startAuthentication`. Its
 * exact shape is owned by that library, not our own domain data, so it isn't
 * re-validated field-by-field here.
 */
export const passkeyChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  options: z.unknown(),
});
export type PasskeyChallengeResponse = z.infer<typeof passkeyChallengeResponseSchema>;

/** Shared by every "complete a WebAuthn ceremony" request. */
export const passkeyVerifyRequestSchema = z.object({
  challengeId: z.string().uuid(),
  response: z.unknown(),
});
export type PasskeyVerifyRequest = z.infer<typeof passkeyVerifyRequestSchema>;

/** Returned by any endpoint that establishes a new session (passkey login or registration). */
export const authSessionResponseSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string().datetime(),
  user: userSummarySchema,
  teamMemberships: z.array(teamMembershipSchema),
  systemRole: systemRoleSchema.nullable().optional(),
  authMethod: authMethodSchema.optional(),
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const currentUserResponseSchema = z.object({
  user: userSummarySchema,
  teamMemberships: z.array(teamMembershipSchema),
  systemRole: systemRoleSchema.nullable().optional(),
  authMethod: authMethodSchema.optional(),
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
