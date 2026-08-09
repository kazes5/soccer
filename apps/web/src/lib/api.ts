import {
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type CreateInviteRequest,
  type CreateTeamRequest,
  type CreateTeamResponse,
  type CurrentUserResponse,
  type InvitePreview,
  type InviteSummary,
  type RequestOtpRequest,
  type RequestOtpResponse,
  type VerifyOtpRequest,
  type VerifyOtpResponse,
  acceptInviteResponseSchema,
  createTeamResponseSchema,
  currentUserResponseSchema,
  invitePreviewSchema,
  inviteSummarySchema,
  requestOtpResponseSchema,
  verifyOtpResponseSchema,
} from '@soccer/contracts';
import { z, type ZodType } from 'zod';
import { env } from '../env';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : 'Something went wrong. Please try again.';
    throw new ApiError(response.status, message);
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

  requestOtp: (body: RequestOtpRequest) =>
    request<RequestOtpResponse>('/auth/otp/request', {
      method: 'POST',
      body,
      responseSchema: requestOtpResponseSchema,
    }),

  verifyOtp: (body: VerifyOtpRequest) =>
    request<VerifyOtpResponse>('/auth/otp/verify', {
      method: 'POST',
      body,
      responseSchema: verifyOtpResponseSchema,
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
};
