import {
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type AuditLogFilter,
  type AuditLogListQuery,
  type AuditLogListResponse,
  type AuthSessionResponse,
  type CollectionPoint,
  type CollectionPointListResponse,
  type CollectionPointRequest,
  type CreateInviteRequest,
  type CreateTeamRequest,
  type CreateTeamResponse,
  type CurrentUserResponse,
  type InvitePreview,
  type InviteSummary,
  type CreateScheduleTemplateRequest,
  type CreateScheduleTemplateResponse,
  type CoordinationSettings,
  type CoordinationSettingsRequest,
  type CreatePushSubscriptionRequest,
  type DeletePushSubscriptionRequest,
  type MemberNotificationPreferences,
  type TeamMemberListResponse,
  type UpdateMemberRoleRequest,
  type UpdateMemberRoleResponse,
  type NotificationListResponse,
  type PasskeyChallengeResponse,
  type PasskeyLoginOptionsRequest,
  type PasskeyVerifyRequest,
  type PasswordLoginRequest,
  type PasswordChangeRequest,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type VerifyInviteCodeRequest,
  type VerifyInviteCodeResponse,
  type CompletePasswordOnboardingRequest,
  type AttachExistingAccountInviteRequest,
  type SystemOverview,
  type SystemTeamListResponse,
  type SystemTeamMemberListResponse,
  type SystemUserListResponse,
  type SystemAuditListResponse,
  type UpdateSystemRoleRequest,
  type PlayerListResponse,
  type PracticeSession,
  type PushConfigResponse,
  type ScheduleTemplateListResponse,
  type SessionListResponse,
  type ShiftStatsResponse,
  type ShiftSummary,
  type SwapRequest,
  type SwapRequestListResponse,
  type TeamNotificationSettings,
  type TeamNotificationSettingsRequest,
  type TeamRosterResponse,
  type UnreadNotificationCountResponse,
  type UpdateMemberNotificationPreferencesRequest,
  type UpdateScheduleTemplateRequest,
  type UpdateScheduleTemplateResponse,
  type UpdateSessionPointPlayersRequest,
  type UpdateSessionRequest,
  acceptInviteResponseSchema,
  auditLogListResponseSchema,
  authSessionResponseSchema,
  collectionPointListResponseSchema,
  collectionPointSchema,
  coordinationSettingsSchema,
  createScheduleTemplateResponseSchema,
  createTeamResponseSchema,
  currentUserResponseSchema,
  invitePreviewSchema,
  inviteSummarySchema,
  memberNotificationPreferencesSchema,
  notificationListResponseSchema,
  passkeyChallengeResponseSchema,
  verifyInviteCodeResponseSchema,
  systemOverviewSchema,
  systemTeamListResponseSchema,
  systemTeamMemberListResponseSchema,
  systemUserListResponseSchema,
  systemAuditListResponseSchema,
  playerListResponseSchema,
  practiceSessionSchema,
  pushConfigResponseSchema,
  scheduleTemplateListResponseSchema,
  sessionListResponseSchema,
  shiftStatsResponseSchema,
  shiftSummarySchema,
  swapRequestListResponseSchema,
  swapRequestSchema,
  teamNotificationSettingsSchema,
  teamMemberListResponseSchema,
  teamRosterResponseSchema,
  unreadNotificationCountResponseSchema,
  updateScheduleTemplateResponseSchema,
  updateMemberRoleResponseSchema,
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

function auditLogQuery(options?: Partial<AuditLogListQuery>): string {
  const query = new URLSearchParams();
  if (!options) return '';
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
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
  passwordLogin: (body: PasswordLoginRequest) =>
    request<AuthSessionResponse>('/auth/password/login', {
      method: 'POST',
      body,
      responseSchema: authSessionResponseSchema,
    }),
  forgotPassword: (body: ForgotPasswordRequest) =>
    request<{ message: string }>('/auth/password/forgot', {
      method: 'POST',
      body,
      responseSchema: z.object({ message: z.string() }),
    }),
  resetPassword: (body: ResetPasswordRequest) =>
    request<unknown>('/auth/password/reset', { method: 'POST', body, responseSchema: z.unknown() }),
  passwordChange: (body: PasswordChangeRequest) =>
    request<unknown>('/auth/password/change', {
      method: 'POST',
      body,
      responseSchema: z.unknown(),
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
  verifyInviteCode: (token: string, body: VerifyInviteCodeRequest) =>
    request<VerifyInviteCodeResponse>(`/invites/${encodeURIComponent(token)}/verify-code`, {
      method: 'POST',
      body,
      responseSchema: verifyInviteCodeResponseSchema,
    }),
  completePasswordOnboarding: (token: string, body: CompletePasswordOnboardingRequest) =>
    request<AuthSessionResponse>(
      `/invites/${encodeURIComponent(token)}/complete-password-onboarding`,
      {
        method: 'POST',
        body,
        responseSchema: authSessionResponseSchema,
      },
    ),
  attachExistingAccountInvite: (token: string, body: AttachExistingAccountInviteRequest) =>
    request<unknown>(`/invites/${encodeURIComponent(token)}/attach-account`, {
      method: 'POST',
      body,
      responseSchema: z.unknown(),
    }),

  createInvite: async (teamId: string, body: CreateInviteRequest) => {
    try {
      return await request<InviteSummary>(`/teams/${encodeURIComponent(teamId)}/password-invites`, {
        method: 'POST',
        body,
        responseSchema: inviteSummarySchema,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      return request<InviteSummary>(`/teams/${encodeURIComponent(teamId)}/invites`, {
        method: 'POST',
        body,
        responseSchema: inviteSummarySchema,
      });
    }
  },

  logout: () => request<unknown>('/auth/logout', { method: 'POST', responseSchema: z.unknown() }),

  getSystemOverview: () =>
    request<SystemOverview>('/system/overview', { responseSchema: systemOverviewSchema }),
  listSystemTeams: (cursor?: string) =>
    request<SystemTeamListResponse>(
      `/system/teams${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      {
        responseSchema: systemTeamListResponseSchema,
      },
    ),
  listSystemTeamMembers: (teamId: string) =>
    request<SystemTeamMemberListResponse>(`/system/teams/${encodeURIComponent(teamId)}/members`, {
      responseSchema: systemTeamMemberListResponseSchema,
    }),
  listSystemUsers: (cursor?: string) =>
    request<SystemUserListResponse>(
      `/system/users${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      {
        responseSchema: systemUserListResponseSchema,
      },
    ),
  listSystemAuditLogs: (cursor?: string) =>
    request<SystemAuditListResponse>(
      `/system/audit-logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      {
        responseSchema: systemAuditListResponseSchema,
      },
    ),
  updateSystemRole: (userId: string, body: UpdateSystemRoleRequest) =>
    request<{ id: string; systemRole: 'system_admin' | null }>(
      `/system/users/${encodeURIComponent(userId)}/system-role`,
      {
        method: 'PATCH',
        body,
        responseSchema: z.object({
          id: z.string().uuid(),
          systemRole: z.enum(['system_admin']).nullable(),
        }),
      },
    ),
  updateSystemTeamMemberRole: (teamId: string, userId: string, body: UpdateMemberRoleRequest) =>
    request<UpdateMemberRoleResponse>(
      `/system/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body, responseSchema: updateMemberRoleResponseSchema },
    ),

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

  listCollectionPoints: (teamId: string) =>
    request<CollectionPointListResponse>(`/teams/${encodeURIComponent(teamId)}/collection-points`, {
      responseSchema: collectionPointListResponseSchema,
    }),

  createCollectionPoint: (teamId: string, body: CollectionPointRequest) =>
    request<CollectionPoint>(`/teams/${encodeURIComponent(teamId)}/collection-points`, {
      method: 'POST',
      body,
      responseSchema: collectionPointSchema,
    }),

  updateCollectionPoint: (teamId: string, pointId: string, body: CollectionPointRequest) =>
    request<CollectionPoint>(
      `/teams/${encodeURIComponent(teamId)}/collection-points/${encodeURIComponent(pointId)}`,
      { method: 'PATCH', body, responseSchema: collectionPointSchema },
    ),

  deleteCollectionPoint: (teamId: string, pointId: string) =>
    request<unknown>(
      `/teams/${encodeURIComponent(teamId)}/collection-points/${encodeURIComponent(pointId)}`,
      { method: 'DELETE', responseSchema: z.unknown() },
    ),

  listScheduleTemplates: (teamId: string) =>
    request<ScheduleTemplateListResponse>(
      `/teams/${encodeURIComponent(teamId)}/schedule-templates`,
      {
        responseSchema: scheduleTemplateListResponseSchema,
      },
    ),

  createScheduleTemplate: (teamId: string, body: CreateScheduleTemplateRequest) =>
    request<CreateScheduleTemplateResponse>(
      `/teams/${encodeURIComponent(teamId)}/schedule-templates`,
      { method: 'POST', body, responseSchema: createScheduleTemplateResponseSchema },
    ),

  updateScheduleTemplate: (
    teamId: string,
    templateId: string,
    body: UpdateScheduleTemplateRequest,
  ) =>
    request<UpdateScheduleTemplateResponse>(
      `/teams/${encodeURIComponent(teamId)}/schedule-templates/${encodeURIComponent(templateId)}`,
      { method: 'PATCH', body, responseSchema: updateScheduleTemplateResponseSchema },
    ),

  updateSession: (teamId: string, sessionId: string, body: UpdateSessionRequest) =>
    request<PracticeSession>(
      `/teams/${encodeURIComponent(teamId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', body, responseSchema: practiceSessionSchema },
    ),

  cancelSession: (teamId: string, sessionId: string) =>
    request<PracticeSession>(
      `/teams/${encodeURIComponent(teamId)}/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: 'POST', responseSchema: practiceSessionSchema },
    ),

  updateSessionPointPlayers: (
    teamId: string,
    sessionId: string,
    pointId: string,
    body: UpdateSessionPointPlayersRequest,
  ) =>
    request<PracticeSession>(
      `/teams/${encodeURIComponent(teamId)}/sessions/${encodeURIComponent(sessionId)}/points/${encodeURIComponent(pointId)}`,
      { method: 'PATCH', body, responseSchema: practiceSessionSchema },
    ),

  listPlayers: (teamId: string) =>
    request<PlayerListResponse>(`/teams/${encodeURIComponent(teamId)}/players`, {
      responseSchema: playerListResponseSchema,
    }),

  listTeamRoster: (teamId: string) =>
    request<TeamRosterResponse>(`/teams/${encodeURIComponent(teamId)}/roster`, {
      responseSchema: teamRosterResponseSchema,
    }),

  listTeamMembers: (teamId: string) =>
    request<TeamMemberListResponse>(`/teams/${encodeURIComponent(teamId)}/members`, {
      responseSchema: teamMemberListResponseSchema,
    }),

  updateTeamMemberRole: (teamId: string, userId: string, body: UpdateMemberRoleRequest) =>
    request<UpdateMemberRoleResponse>(
      `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body, responseSchema: updateMemberRoleResponseSchema },
    ),

  removeTeamMember: (teamId: string, userId: string) =>
    request<unknown>(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      responseSchema: z.unknown(),
    }),

  listAuditLogs: (teamId: string, options?: Partial<AuditLogListQuery>) =>
    request<AuditLogListResponse>(
      `/teams/${encodeURIComponent(teamId)}/audit-logs${auditLogQuery(options)}`,
      { responseSchema: auditLogListResponseSchema },
    ),

  exportAuditLogs: async (teamId: string, filters?: AuditLogFilter) => {
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/teams/${encodeURIComponent(teamId)}/audit-logs/export${auditLogQuery(filters)}`,
      { credentials: 'include' },
    );
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => ({}));
      const message =
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof data.message === 'string'
          ? data.message
          : 'Something went wrong. Please try again.';
      throw new ApiError(response.status, message);
    }
    return response.blob();
  },

  getCoordinationSettings: (teamId: string) =>
    request<CoordinationSettings>(`/teams/${encodeURIComponent(teamId)}/coordination-settings`, {
      responseSchema: coordinationSettingsSchema,
    }),

  updateCoordinationSettings: (teamId: string, body: CoordinationSettingsRequest) =>
    request<CoordinationSettings>(`/teams/${encodeURIComponent(teamId)}/coordination-settings`, {
      method: 'PATCH',
      body,
      responseSchema: coordinationSettingsSchema,
    }),

  getNotificationSettings: (teamId: string) =>
    request<TeamNotificationSettings>(
      `/teams/${encodeURIComponent(teamId)}/notification-settings`,
      { responseSchema: teamNotificationSettingsSchema },
    ),

  updateNotificationSettings: (teamId: string, body: TeamNotificationSettingsRequest) =>
    request<TeamNotificationSettings>(
      `/teams/${encodeURIComponent(teamId)}/notification-settings`,
      { method: 'PATCH', body, responseSchema: teamNotificationSettingsSchema },
    ),

  getMemberPreferences: (teamId: string) =>
    request<MemberNotificationPreferences>(
      `/users/me/preferences?teamId=${encodeURIComponent(teamId)}`,
      { responseSchema: memberNotificationPreferencesSchema },
    ),

  updateMemberPreferences: (body: UpdateMemberNotificationPreferencesRequest) =>
    request<MemberNotificationPreferences>('/users/me/preferences', {
      method: 'PATCH',
      body,
      responseSchema: memberNotificationPreferencesSchema,
    }),

  listNotifications: (teamId: string, options?: { cursor?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (options?.cursor) query.set('cursor', options.cursor);
    if (options?.limit) query.set('limit', String(options.limit));
    const queryString = query.toString();
    return request<NotificationListResponse>(
      `/teams/${encodeURIComponent(teamId)}/notifications${queryString ? `?${queryString}` : ''}`,
      { responseSchema: notificationListResponseSchema },
    );
  },

  getUnreadNotificationCount: (teamId: string) =>
    request<UnreadNotificationCountResponse>(
      `/teams/${encodeURIComponent(teamId)}/notifications/unread-count`,
      { responseSchema: unreadNotificationCountResponseSchema },
    ),

  markNotificationRead: (teamId: string, notificationId: string) =>
    request<unknown>(
      `/teams/${encodeURIComponent(teamId)}/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: 'POST', responseSchema: z.unknown() },
    ),

  dismissNotification: (teamId: string, notificationId: string) =>
    request<unknown>(
      `/teams/${encodeURIComponent(teamId)}/notifications/${encodeURIComponent(notificationId)}/dismiss`,
      { method: 'POST', responseSchema: z.unknown() },
    ),

  markAllNotificationsRead: (teamId: string) =>
    request<unknown>(`/teams/${encodeURIComponent(teamId)}/notifications/read-all`, {
      method: 'POST',
      responseSchema: z.unknown(),
    }),

  listSwapRequests: (teamId: string) =>
    request<SwapRequestListResponse>(`/teams/${encodeURIComponent(teamId)}/swap-requests`, {
      responseSchema: swapRequestListResponseSchema,
    }),

  createSwapRequest: (teamId: string, shiftId: string) =>
    request<SwapRequest>(
      `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}/swap-requests`,
      { method: 'POST', responseSchema: swapRequestSchema },
    ),

  acceptSwapRequest: (teamId: string, swapRequestId: string) =>
    request<SwapRequest>(
      `/teams/${encodeURIComponent(teamId)}/swap-requests/${encodeURIComponent(swapRequestId)}/accept`,
      { method: 'POST', responseSchema: swapRequestSchema },
    ),

  declineSwapRequest: (teamId: string, swapRequestId: string) =>
    request<SwapRequest>(
      `/teams/${encodeURIComponent(teamId)}/swap-requests/${encodeURIComponent(swapRequestId)}/decline`,
      { method: 'POST', responseSchema: swapRequestSchema },
    ),

  cancelSwapRequest: (teamId: string, swapRequestId: string) =>
    request<SwapRequest>(
      `/teams/${encodeURIComponent(teamId)}/swap-requests/${encodeURIComponent(swapRequestId)}/cancel`,
      { method: 'POST', responseSchema: swapRequestSchema },
    ),

  getPushConfig: () =>
    request<PushConfigResponse>('/push-subscriptions/config', {
      responseSchema: pushConfigResponseSchema,
    }),

  createPushSubscription: (body: CreatePushSubscriptionRequest) =>
    request<unknown>('/push-subscriptions', { method: 'POST', body, responseSchema: z.unknown() }),

  deletePushSubscription: (body: DeletePushSubscriptionRequest) =>
    request<unknown>('/push-subscriptions', {
      method: 'DELETE',
      body,
      responseSchema: z.unknown(),
    }),
};
