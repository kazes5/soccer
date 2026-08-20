import { chatMessageRequestSchema } from '@soccer/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireTeamRole } from '../lib/authorization';
import { assertChatRateLimit } from '../lib/chat-rate-limit';
import { executeToolCall } from '../lib/chat-dispatch';
import { toolsAllowedFor } from '../lib/chat-tools';
import { HttpError } from '../lib/errors';
import { env } from '../env';
import { streamChatCompletion, type OpenRouterMessage } from '../lib/openrouter';

const teamParamsSchema = z.object({ teamId: z.string().uuid() });

/** Bounds how many model↔tool round trips one message can spend — a model
 *  that keeps calling tools forever still terminates the request instead of
 *  running (and billing) indefinitely. */
const MAX_TOOL_ITERATIONS = 4;

function systemPrompt(locale: 'en' | 'he', teamTimezone: string, nowIso: string): string {
  const languageLine =
    locale === 'he'
      ? 'Respond in Hebrew, natural and concise, regardless of what language the user wrote in.'
      : 'Respond in English, natural and concise, regardless of what language the user wrote in.';
  return [
    'You are the chat assistant for the Soccer Carpool Coordinator, a youth soccer carpool scheduling app.',
    'You can answer questions about the schedule and take real actions using ONLY the tools provided to you — never claim an action succeeded unless a tool call actually confirms it.',
    'Keep replies short and mobile-friendly (a couple of sentences), not a long report.',
    `The current date/time is ${nowIso} in the team's timezone (${teamTimezone}) — use this to resolve relative dates like "Wednesday" or "this week".`,
    'If a tool call fails or is refused, explain plainly what happened; do not retry the same call with different arguments hoping it works.',
    languageLine,
  ].join(' ');
}

export default async function chatRoutes(app: FastifyInstance) {
  app.post('/teams/:teamId/chat/message', async (request, reply) => {
    const params = teamParamsSchema.parse(request.params);
    const body = chatMessageRequestSchema.parse(request.body);
    const currentUser = requireAuth(request);
    const membership = await requireTeamRole(app.prisma, currentUser.id, params.teamId, [
      'parent',
      'admin',
    ]);

    const openRouterApiKey = app.openRouterApiKey;
    if (!openRouterApiKey) {
      throw new HttpError(503, 'Assistant temporarily unavailable.');
    }
    await assertChatRateLimit(app, currentUser.id, request.ip);

    const team = await app.prisma.team.findUniqueOrThrow({
      where: { id: params.teamId },
      select: { timezone: true },
    });

    // Everything past this point streams — errors from here on go out as an
    // `event: error` SSE frame, not an HTTP status, since headers are
    // already committed once `writeHead` below runs.
    reply.hijack();
    const res = reply.raw;
    const corsOrigin = reply.getHeader('access-control-allow-origin');
    const corsCredentials = reply.getHeader('access-control-allow-credentials');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
      ...(corsCredentials ? { 'Access-Control-Allow-Credentials': corsCredentials } : {}),
    });

    function safeWrite(event: string, data: unknown) {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    const tools = toolsAllowedFor(membership.role);
    const openRouterTools = tools.map((tool) => ({
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: systemPrompt(body.locale, team.timezone, new Date().toISOString()),
      },
      ...body.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: body.message },
    ];

    try {
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string }>();
        let finishReason: string | null = null;

        for await (const chunk of streamChatCompletion({
          apiKey: openRouterApiKey,
          model: env.OPENROUTER_MODEL,
          messages,
          tools: openRouterTools,
        })) {
          if (chunk.type === 'text') {
            safeWrite('text-delta', { delta: chunk.delta });
          } else if (chunk.type === 'tool_call_start') {
            pendingToolCalls.set(chunk.index, { id: chunk.id, name: chunk.name, argsJson: '' });
          } else if (chunk.type === 'tool_call_delta') {
            const entry = pendingToolCalls.get(chunk.index);
            if (entry) entry.argsJson += chunk.argsDelta;
          } else if (chunk.type === 'finish') {
            finishReason = chunk.reason;
          }
        }

        if (finishReason !== 'tool_calls' || pendingToolCalls.size === 0) break;

        const toolCalls = [...pendingToolCalls.values()];
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.argsJson },
          })),
        });

        for (const call of toolCalls) {
          safeWrite('tool-call', {
            id: call.id,
            name: call.name,
            summary: `Using ${call.name.replace(/_/g, ' ')}…`,
          });

          const outcome = await executeToolCall(
            app,
            currentUser,
            params.teamId,
            membership.role,
            body.message,
            { name: call.name, argsJson: call.argsJson, confirmedToken: body.confirmedToken },
          );

          if (outcome.kind === 'confirmation_required') {
            safeWrite('confirmation-required', { token: outcome.token, summary: outcome.summary });
            safeWrite('done', {});
            res.end();
            return;
          }

          safeWrite('tool-result', { id: call.id, ok: outcome.ok, summary: outcome.summary });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(outcome.data).slice(0, 4000),
          });
        }
      }
    } catch (err) {
      app.log.error(err);
      safeWrite('error', { message: 'Assistant temporarily unavailable.' });
    }

    safeWrite('done', {});
    res.end();
  });
}
