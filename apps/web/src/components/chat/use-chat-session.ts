'use client';

import type { ChatTurn } from '@soccer/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { broadcastDataChanged } from '@/lib/data-changed-bus';
import { streamChatMessage, type ChatStreamEvent } from '@/lib/chat-stream';

export interface ChatToolCall {
  id: string;
  name: string;
  summary: string;
  status: 'pending' | 'ok' | 'error';
  resultSummary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ChatToolCall[];
  error?: string;
}

/**
 * History is client-side only and ephemeral by design (PLAN.md's Stage 7
 * AI-chat decision record) — plain React state, reset on unmount/reload, no
 * persistence layer. Capped at the last 10 turns sent as context, matching
 * the server's own cap (chatMessageRequestSchema.history, max 20) with room
 * to spare.
 */
export function useChatSession(teamId: string | null, locale: 'en' | 'he') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const nextId = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  function applyEvent(assistantId: string, event: ChatStreamEvent) {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== assistantId) return message;
        switch (event.type) {
          case 'text-delta':
            return { ...message, content: message.content + event.delta };
          case 'tool-call':
            return {
              ...message,
              toolCalls: [
                ...message.toolCalls,
                {
                  id: event.id,
                  name: event.name,
                  summary: event.summary,
                  status: 'pending' as const,
                },
              ],
            };
          case 'tool-result':
            // A successful action (claim/release/swap — the read-only
            // schedule/stats tools succeed too, but a redundant quiet
            // refetch from those is harmless) means whatever Schedule/Home
            // page happens to be mounted right now is showing stale data —
            // see data-changed-bus.ts for why chat can't just update it
            // directly.
            if (event.ok) broadcastDataChanged();
            return {
              ...message,
              toolCalls: message.toolCalls.map((call) =>
                call.id === event.id
                  ? {
                      ...call,
                      status: event.ok ? ('ok' as const) : ('error' as const),
                      resultSummary: event.summary,
                    }
                  : call,
              ),
            };
          case 'error':
            return { ...message, error: event.message };
          // 'confirmation-required' and 'done' carry no per-message content —
          // no shipped tool sets `confirmationRequired` yet (see
          // chat-tools.ts), so there is nothing to render for it today.
          default:
            return message;
        }
      }),
    );
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!teamId || !trimmed || isStreaming) return;

      const history: ChatTurn[] = messagesRef.current
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content }));

      const userMessage: ChatMessage = {
        id: String(nextId.current++),
        role: 'user',
        content: trimmed,
        toolCalls: [],
      };
      const assistantId = String(nextId.current++);
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        toolCalls: [],
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      try {
        for await (const event of streamChatMessage(teamId, {
          message: trimmed,
          history,
          locale,
        })) {
          applyEvent(assistantId, event);
        }
      } catch {
        applyEvent(assistantId, { type: 'error', message: 'Something went wrong.' });
      } finally {
        setIsStreaming(false);
      }
    },
    [teamId, isStreaming, locale],
  );

  return { messages, isStreaming, sendMessage };
}
