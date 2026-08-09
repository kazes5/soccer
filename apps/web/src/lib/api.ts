import {
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type CreateInviteRequest,
  type CreateTeamRequest,
  type CreateTeamResponse,
  type InvitePreview,
  type InviteSummary,
  type RequestOtpRequest,
  type RequestOtpResponse,
  type VerifyOtpRequest,
  type VerifyOtpResponse,
  acceptInviteResponseSchema,
  createTeamResponseSchema,
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

interface RequestOptions<TResponse> {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  responseSchema: ZodType<TResponse>;
}

async function request<TResponse>(
  path: string,
  { method = 'GET', body, token, responseSchema }: RequestOptions<TResponse>,
): Promise<TResponse> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  createInvite: (teamId: string, body: CreateInviteRequest, token: string) =>
    request<InviteSummary>(`/teams/${encodeURIComponent(teamId)}/invites`, {
      method: 'POST',
      body,
      token,
      responseSchema: inviteSummarySchema,
    }),

  logout: (token: string) =>
    request<unknown>('/auth/logout', { method: 'POST', token, responseSchema: z.unknown() }),
};
