export interface OpenRouterTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export type OpenRouterStreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; argsDelta: string }
  | { type: 'finish'; reason: string | null };

/**
 * Thin hand-rolled client — OpenRouter's chat-completions endpoint is
 * OpenAI-compatible, and this is the one call site in the app, so a full SDK
 * dependency isn't worth adding (matches the codebase's existing preference
 * for small, purpose-built `lib/` wrappers — see web-push.ts, sse.ts —
 * over generic client libraries). Streams tool-call argument fragments
 * exactly as OpenRouter sends them (keyed by `index`, not `id`, since `id`
 * typically only appears on that call's first chunk) — the caller
 * accumulates them into complete JSON per tool call.
 */
export async function* streamChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  tools: OpenRouterTool[];
}): AsyncGenerator<OpenRouterStreamChunk> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Soccer Carpool Coordinator',
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      tools: input.tools.length > 0 ? input.tools : undefined,
      stream: true,
      // CLAUDE.md §6.5: low randomness for consistent actions, concise
      // mobile-friendly responses.
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; buffer any trailing partial
    // frame until the next chunk completes it.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((candidate) => candidate.startsWith('data: '));
      if (!line) continue;
      const data = line.slice('data: '.length).trim();
      if (data === '[DONE]') return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      yield* toChunks(parsed);
    }
  }
}

function toChunks(parsed: unknown): OpenRouterStreamChunk[] {
  if (typeof parsed !== 'object' || parsed === null || !('choices' in parsed)) return [];
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const choice = choices[0] as {
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  };

  const chunks: OpenRouterStreamChunk[] = [];
  if (choice.delta?.content) chunks.push({ type: 'text', delta: choice.delta.content });
  for (const toolCall of choice.delta?.tool_calls ?? []) {
    if (toolCall.id && toolCall.function?.name) {
      chunks.push({
        type: 'tool_call_start',
        index: toolCall.index,
        id: toolCall.id,
        name: toolCall.function.name,
      });
    }
    if (toolCall.function?.arguments) {
      chunks.push({
        type: 'tool_call_delta',
        index: toolCall.index,
        argsDelta: toolCall.function.arguments,
      });
    }
  }
  if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
    chunks.push({ type: 'finish', reason: choice.finish_reason });
  }
  return chunks;
}
