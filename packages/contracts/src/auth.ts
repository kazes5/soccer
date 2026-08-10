import { z } from 'zod';
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
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const currentUserResponseSchema = z.object({
  user: userSummarySchema,
  teamMemberships: z.array(teamMembershipSchema),
});
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;
