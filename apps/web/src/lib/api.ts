import {
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type AuthSessionResponse,
  type CreateInviteRequest,
  type CreateTeamRequest,
  type CreateTeamResponse,
  type CurrentUserResponse,
  type InvitePreview,
  type InviteSummary,
  type PasskeyChallengeResponse,
  type PasskeyLoginOptionsRequest,
  type PasskeyVerifyRequest,
  type SessionListResponse,
  type ShiftStatsResponse,
  type ShiftSummary,
  acceptInviteResponseSchema,
  authSessionResponseSchema,
  createTeamResponseSchema,
  currentUserResponseSchema,
  invitePreviewSchema,
  inviteSummarySchema,
  passkeyChallengeResponseSchema,
  sessionListResponseSchema,
  shiftStatsResponseSchema,
  shiftSummarySchema,
} from '@soccer/contracts';
import { z, type ZodType } from 'zod';
import { env } from '../env';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Extra JSON fields the server attached to the error, e.g. a conflict's holderName. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/** Session auth rides on the httpOnly `soccer_session` cookie; this reads its readable CSRF pair. */
function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\s*)soccer_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

interface RequestOptions<TResponse> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  responseSchema: ZodType<TResponse>;
}

async function request<TResponse>(
  path: string,
  { method = 'GET', body, responseSchema }: RequestOptions<TResponse>,
): Promise<TResponse> {
  const csrfToken = MUTATING_METHODS.has(method) ? readCsrfCookie() : undefined;

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const isRecord = typeof data === 'object' && data !== null;
    const message =
      isRecord && 'message' in data && typeof data.message === 'string'
        ? data.message
        : 'Something went wrong. Please try again.';
    throw new ApiError(
      response.status,
      message,
      isRecord ? (data as Record<string, unknown>) : undefined,
    );
  }

  return responseSchema.parse(data);
}

export const api = {
  createTeam: (body: CreateTeamRequest) =>
    request<CreateTeamResponse>('/teams', {
      method: 'POST',
      body,
      responseSchema: createTeamResponseSchema,
    }),

  // Log in on a device that already has a registered passkey.
  getPasskeyLoginOptions: (body: PasskeyLoginOptionsRequest) =>
    request<PasskeyChallengeResponse>('/auth/passkey/login/options', {
      method: 'POST',
      body,
      responseSchema: passkeyChallengeResponseSchema,
    }),
  verifyPasskeyLogin: (body: PasskeyVerifyRequest) =>
    request<AuthSessionResponse>('/auth/passkey/login/verify', {
      method: 'POST',
      body,
      responseSchema: authSessionResponseSchema,
    }),

  // Register an additional passkey for the *currently authenticated* user —
  // used right after `createTeam` (which issues a session with no invite
  // involved) and for adding a second device later.
  getPasskeyRegisterOptions: () =>
    request<PasskeyChallengeResponse>('/auth/passkey/register/options', {
      method: 'POST',
      responseSchema: passkeyChallengeResponseSchema,
    }),
  verifyPasskeyRegister: (body: PasskeyVerifyRequest) =>
    request<unknown>('/auth/passkey/register/verify', {
      method: 'POST',
      body,
      responseSchema: z.unknown(),
    }),

  // Register a brand-new parent's first passkey, scoped by the invite code
  // they just accepted — no session exists yet at this point.
  getInvitePasskeyRegisterOptions: (code: string) =>
    request<PasskeyChallengeResponse>(
      `/invites/${encodeURIComponent(code)}/passkey/register/options`,
      {
        method: 'POST',
        responseSchema: passkeyChallengeResponseSchema,
      },
    ),
  verifyInvitePasskeyRegister: (code: string, body: PasskeyVerifyRequest) =>
    request<AuthSessionResponse>(`/invites/${encodeURIComponent(code)}/passkey/register/verify`, {
      method: 'POST',
      body,
      responseSchema: authSessionResponseSchema,
    }),

  me: () => request<CurrentUserResponse>('/auth/me', { responseSchema: currentUserResponseSchema }),

  getInvitePreview: (code: string) =>
    request<InvitePreview>(`/invites/${encodeURIComponent(code)}`, {
      responseSchema: invitePreviewSchema,
    }),

  acceptInvite: (code: string, body: AcceptInviteRequest) =>
    request<AcceptInviteResponse>(`/invites/${encodeURIComponent(code)}/accept`, {
      method: 'POST',
      body,
      responseSchema: acceptInviteResponseSchema,
    }),

  createInvite: (teamId: string, body: CreateInviteRequest) =>
    request<InviteSummary>(`/teams/${encodeURIComponent(teamId)}/invites`, {
      method: 'POST',
      body,
      responseSchema: inviteSummarySchema,
    }),

  logout: () => request<unknown>('/auth/logout', { method: 'POST', responseSchema: z.unknown() }),

  listSessions: (teamId: string) =>
    request<SessionListResponse>(`/teams/${encodeURIComponent(teamId)}/sessions`, {
      responseSchema: sessionListResponseSchema,
    }),

  claimShift: (teamId: string, shiftId: string) =>
    request<ShiftSummary>(
      `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}/claim`,
      { method: 'POST', responseSchema: shiftSummarySchema },
    ),

  releaseShift: (teamId: string, shiftId: string) =>
    request<ShiftSummary>(
      `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}/release`,
      { method: 'POST', responseSchema: shiftSummarySchema },
    ),

  getShiftStats: (teamId: string) =>
    request<ShiftStatsResponse>(`/teams/${encodeURIComponent(teamId)}/shifts/stats`, {
      responseSchema: shiftStatsResponseSchema,
    }),
};
