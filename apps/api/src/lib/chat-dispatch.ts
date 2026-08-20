import type { FastifyInstance } from 'fastify';
import { recordAuditLog } from './audit';
import { createConfirmationToken, verifyConfirmationToken } from './chat-confirmation';
import { findTool } from './chat-tools';
import { HttpError } from './errors';
import type { TeamRole } from '../../generated/prisma/client';
import type { CurrentUser } from '../plugins/auth';

export type ToolCallOutcome =
  // `data` is what's fed back to the model as the tool-call response (so it
  // can actually answer using real results, e.g. a schedule query) — `summary`
  // is the short human-readable chip the SSE stream shows in the UI. They
  // diverge: `data` can be a whole session list, `summary` is one line.
  | { kind: 'result'; ok: boolean; summary: string; data: unknown }
  | { kind: 'confirmation_required'; token: string; summary: string };

/**
 * Resolves one tool call end to end: allowlist check, argument validation,
 * the (currently always-skipped, since no shipped tool sets
 * `confirmationRequired`) confirmation gate, execution, and — for any
 * outcome that never reaches the action's own `recordAuditLog` call inside
 * chat-actions.ts (denied, invalid, or a thrown HttpError) — a dedicated
 * `source: 'ai_chat', result: 'failure'` audit row, so a refused or failed
 * AI attempt is traceable the same way a successful one is (CLAUDE.md §6.3).
 * Kept independent of the SSE route so both can be unit-tested without a
 * real stream — see chat-dispatch.test.ts.
 */
export async function executeToolCall(
  app: FastifyInstance,
  currentUser: CurrentUser,
  teamId: string,
  role: TeamRole,
  transcript: string,
  toolCall: { name: string; argsJson: string; confirmedToken?: string },
): Promise<ToolCallOutcome> {
  async function recordFailure(translatedAction: string, reason: string) {
    await recordAuditLog(app.prisma, {
      teamId,
      actorId: currentUser.id,
      actionType: 'ai_chat_action_failed',
      targetEntity: 'chat_tool',
      targetId: null,
      source: 'ai_chat',
      aiContext: { transcript, translatedAction, result: 'failure' },
    });
    return { kind: 'result' as const, ok: false, summary: reason, data: { error: reason } };
  }

  const tool = findTool(toolCall.name, role);
  if (!tool) {
    return recordFailure(
      `${toolCall.name}(${toolCall.argsJson})`,
      "You don't have permission to do that.",
    );
  }

  const translatedAction = `${tool.name}(${toolCall.argsJson})`;

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(toolCall.argsJson || '{}');
  } catch {
    return recordFailure(translatedAction, "I couldn't understand the arguments for that action.");
  }
  const argsResult = tool.argsSchema.safeParse(parsedArgs);
  if (!argsResult.success) {
    return recordFailure(translatedAction, 'Some required details were missing or invalid.');
  }

  if (tool.confirmationRequired) {
    // Only reachable once a future tool actually sets this flag — no
    // shipped tool does (see chat-tools.ts) — at which point
    // `app.chatConfirmationSecret` (falls back to `app.openRouterApiKey`,
    // see app.ts) is guaranteed set, since the chat route already gates on
    // `openRouterApiKey` before ever reaching here.
    const secret = app.chatConfirmationSecret;
    if (!secret) {
      return recordFailure(translatedAction, 'Something went wrong.');
    }
    const canonicalArgsJson = JSON.stringify(argsResult.data);
    const confirmed =
      toolCall.confirmedToken !== undefined &&
      verifyConfirmationToken(
        toolCall.confirmedToken,
        { userId: currentUser.id, teamId, toolName: tool.name, argsJson: canonicalArgsJson },
        secret,
      );
    if (!confirmed) {
      const token = createConfirmationToken(
        { userId: currentUser.id, teamId, toolName: tool.name, argsJson: canonicalArgsJson },
        secret,
      );
      return { kind: 'confirmation_required', token, summary: `Confirm: ${tool.description}` };
    }
  }

  try {
    const result = await tool.run(app, currentUser, teamId, argsResult.data, {
      source: 'ai_chat',
      transcript,
    });
    return { kind: 'result', ok: true, summary: summarize(tool.name), data: result };
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Something went wrong.';
    return recordFailure(translatedAction, message);
  }
}

function summarize(toolName: string): string {
  if (toolName === 'get_schedule' || toolName === 'get_my_stats') return 'Retrieved.';
  return `Done: ${toolName.replace(/_/g, ' ')}.`;
}
