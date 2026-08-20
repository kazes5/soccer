import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as actions from './chat-actions';
import type { ChatAuditSource } from './chat-actions';
import type { TeamRole } from '../../generated/prisma/client';
import type { CurrentUser } from '../plugins/auth';

/**
 * The tool allowlist CLAUDE.md §6.1 calls for. `allowedRoles` is a
 * *pre-filter*: it decides which tool definitions are even sent to
 * OpenRouter for a given caller (a parent's model context never sees
 * `remove_user`-shaped tools once those exist) and lets the dispatcher fail
 * fast, in-thread, with no model turn spent, if the model somehow proposes a
 * disallowed tool anyway. It is not the authorization boundary — every
 * action in chat-actions.ts re-runs `requireTeamRole` itself, exactly as it
 * would for the manual UI's HTTP route, so this list disagreeing with an
 * action's own check can never *grant* anything; the action's check always
 * wins.
 *
 * `confirmationRequired` is unused by every tool below — none of the six
 * in-scope actions are destructive under CLAUDE.md §3.3/§3.4 (claim/release
 * are one-tap self-service; swap accept/decline/cancel *is* the consent
 * step, not a second one on top of it) — but the field, and the dispatcher
 * branch that honors it (chat.ts), exist and are tested now so the
 * mechanism is ready when an admin-only destructive tool needs it.
 */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  argsSchema: z.ZodType<Record<string, unknown>>;
  allowedRoles: readonly TeamRole[];
  confirmationRequired: boolean;
  run: (
    app: FastifyInstance,
    currentUser: CurrentUser,
    teamId: string,
    args: Record<string, unknown>,
    audit: ChatAuditSource,
  ) => Promise<unknown>;
}

const uuidParam = { type: 'string', format: 'uuid' } as const;

export const CHAT_TOOLS: ChatTool[] = [
  {
    name: 'get_schedule',
    description:
      "Get the team's practice sessions, with each shift's status and who (if anyone) holds it. Use this to answer questions about the schedule, who's covering a shift, or which shifts are still open. Optionally bound by date range.",
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601, inclusive lower bound',
        },
        to: { type: 'string', format: 'date-time', description: 'ISO 8601, inclusive upper bound' },
      },
    },
    argsSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args) =>
      actions.getSchedule(app, currentUser, teamId, args as { from?: string; to?: string }),
  },
  {
    name: 'get_my_stats',
    description:
      'Get the caller\'s own shift counts this season (pickups/drop-offs) and the team average, for questions like "how many shifts have I covered?"',
    parameters: { type: 'object', properties: {} },
    argsSchema: z.object({}),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId) => actions.getMyStats(app, currentUser, teamId),
  },
  {
    name: 'claim_shift',
    description:
      'Claim an open shift on behalf of the caller. One-tap self-service, no confirmation needed.',
    parameters: {
      type: 'object',
      properties: { shiftId: uuidParam },
      required: ['shiftId'],
    },
    argsSchema: z.object({ shiftId: z.string().uuid() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args, audit) =>
      actions.claimShift(app, currentUser, teamId, args.shiftId as string, audit),
  },
  {
    name: 'release_shift',
    description:
      "Release a shift the caller currently holds, returning it to open. Only affects the caller's own shift.",
    parameters: {
      type: 'object',
      properties: { shiftId: uuidParam },
      required: ['shiftId'],
    },
    argsSchema: z.object({ shiftId: z.string().uuid() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args, audit) =>
      actions.releaseShift(app, currentUser, teamId, args.shiftId as string, audit),
  },
  {
    name: 'create_swap_request',
    description:
      'Ask the current holder of a claimed shift to hand it over to the caller. Does not move the shift — the holder must separately accept.',
    parameters: {
      type: 'object',
      properties: { shiftId: uuidParam },
      required: ['shiftId'],
    },
    argsSchema: z.object({ shiftId: z.string().uuid() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args, audit) =>
      actions.createSwapRequest(app, currentUser, teamId, args.shiftId as string, audit),
  },
  {
    name: 'accept_swap_request',
    description:
      'Accept a pending swap request for a shift the caller currently holds, reassigning it to the requester.',
    parameters: {
      type: 'object',
      properties: { swapRequestId: uuidParam },
      required: ['swapRequestId'],
    },
    argsSchema: z.object({ swapRequestId: z.string().uuid() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args, audit) =>
      actions.acceptSwapRequest(app, currentUser, teamId, args.swapRequestId as string, audit),
  },
  {
    name: 'decline_swap_request',
    description:
      'Decline a pending swap request for a shift the caller currently holds. The shift stays with the caller.',
    parameters: {
      type: 'object',
      properties: { swapRequestId: uuidParam },
      required: ['swapRequestId'],
    },
    argsSchema: z.object({ swapRequestId: z.string().uuid() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args, audit) =>
      actions.declineSwapRequest(app, currentUser, teamId, args.swapRequestId as string, audit),
  },
  {
    name: 'cancel_swap_request',
    description: 'Cancel a swap request the caller sent, before the holder responds.',
    parameters: {
      type: 'object',
      properties: { swapRequestId: uuidParam },
      required: ['swapRequestId'],
    },
    argsSchema: z.object({ swapRequestId: z.string().uuid() }),
    allowedRoles: ['parent', 'admin'],
    confirmationRequired: false,
    run: (app, currentUser, teamId, args, audit) =>
      actions.cancelSwapRequest(app, currentUser, teamId, args.swapRequestId as string, audit),
  },
];

export function toolsAllowedFor(role: TeamRole): ChatTool[] {
  return CHAT_TOOLS.filter((tool) => tool.allowedRoles.includes(role));
}

export function findTool(name: string, role: TeamRole): ChatTool | null {
  const tool = CHAT_TOOLS.find((candidate) => candidate.name === name);
  if (!tool || !tool.allowedRoles.includes(role)) return null;
  return tool;
}
