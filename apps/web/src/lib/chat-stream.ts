import {
  chatConfirmationRequiredEventSchema,
  chatErrorEventSchema,
  chatTextDeltaEventSchema,
  chatToolCallEventSchema,
  chatToolResultEventSchema,
  type ChatTurn,
} from '@soccer/contracts';
import { getCsrfToken } from './api';
import { env } from '../env';

export type ChatStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; id: string; name: string; summary: string }
  | { type: 'tool-result'; id: string; ok: boolean; summary: string }
  | { type: 'confirmation-required'; token: string; summary: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * POSTs one chat message and yields each SSE event as it arrives. A plain
 * `fetch` + `ReadableStream` reader, not `EventSource` — the request needs a
 * JSON body and a CSRF header, neither of which `EventSource` supports.
 * Every event is Zod-validated before being yielded and silently dropped if
 * it doesn't match (an unrecognized `event:` name, or a payload that fails
 * its schema) — the same "drop what a stale client build can't render"
 * discipline apps/web/src/lib/sse.ts already applies to notification events.
 */
export async function* streamChatMessage(
  teamId: string,
  input: {
    message: string;
    history: ChatTurn[];
    locale: 'en' | 'he';
    confirmedToken?: string;
  },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const csrfToken = getCsrfToken();
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL}/teams/${encodeURIComponent(teamId)}/chat/message`,
    {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok || !response.body) {
    const data: unknown = await response.json().catch(() => ({}));
    const message =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : 'Something went wrong. Please try again.';
    yield { type: 'error', message };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const lines = frame.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event: '));
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const eventName = eventLine.slice('event: '.length).trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLine.slice('data: '.length));
      } catch {
        continue;
      }

      const chatEvent = toStreamEvent(eventName, parsed);
      if (chatEvent) yield chatEvent;
    }
  }
}

function toStreamEvent(eventName: string, parsed: unknown): ChatStreamEvent | null {
  switch (eventName) {
    case 'text-delta': {
      const result = chatTextDeltaEventSchema.safeParse(parsed);
      return result.success ? { type: 'text-delta', delta: result.data.delta } : null;
    }
    case 'tool-call': {
      const result = chatToolCallEventSchema.safeParse(parsed);
      return result.success ? { type: 'tool-call', ...result.data } : null;
    }
    case 'tool-result': {
      const result = chatToolResultEventSchema.safeParse(parsed);
      return result.success ? { type: 'tool-result', ...result.data } : null;
    }
    case 'confirmation-required': {
      const result = chatConfirmationRequiredEventSchema.safeParse(parsed);
      return result.success ? { type: 'confirmation-required', ...result.data } : null;
    }
    case 'error': {
      const result = chatErrorEventSchema.safeParse(parsed);
      return result.success ? { type: 'error', message: result.data.message } : null;
    }
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}
