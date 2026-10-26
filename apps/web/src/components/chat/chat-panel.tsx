'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale } from '@/components/locale-provider';
import { requestCoachImport } from '@/lib/coach-import-handoff';
import { ChatMessage } from './chat-message';
import { useChatSession } from './use-chat-session';

export function ChatPanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { messages, isStreaming, sendMessage } = useChatSession(teamId, locale);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Grows with its content (a pasted coach message runs several lines) up to
  // the CSS max height, then scrolls. `field-sizing: content` would do this
  // in CSS alone, but iOS Safari doesn't support it yet.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [draft]);

  async function submit() {
    if (!draft.trim() || isStreaming) return;
    const text = draft;
    setDraft('');
    await sendMessage(text);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submit();
  }

  // Enter sends, Shift+Enter adds a line — except while an IME is composing
  // (Enter there confirms the composition, not the message).
  async function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    await submit();
  }

  return (
    // Bottom offset clears the floating chat button (chat-bubble.tsx: 3.5rem
    // tall at bottom-20 below `md`, bottom-4 from `md`), which would
    // otherwise sit on top of the send button on phones.
    <div
      role="dialog"
      aria-label={t('chat.title')}
      className="fixed inset-x-4 bottom-[9.5rem] top-20 z-40 flex flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lg sm:inset-x-auto sm:end-4 sm:top-auto sm:h-[32rem] sm:w-96 md:bottom-20"
    >
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{t('chat.title')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className={`flex min-h-8 min-w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-soft hover:text-ink ${focusRingClassName}`}
        >
          ×
        </button>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-ink-muted">{t('chat.emptyState')}</p>}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            onReviewImport={(coachMessage) => {
              onClose();
              requestCoachImport(teamId, coachMessage, (href) => router.push(href));
            }}
          />
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-surface-border p-3"
      >
        <textarea
          ref={inputRef}
          rows={1}
          dir="auto"
          maxLength={2000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.inputPlaceholder')}
          aria-label={t('chat.inputPlaceholder')}
          disabled={isStreaming}
          className={`max-h-40 min-h-11 flex-1 resize-none rounded-3xl border border-surface-border bg-surface px-4 py-3 text-sm leading-5 text-ink placeholder:text-ink-muted disabled:opacity-60 ${focusRingClassName}`}
        />
        <button
          type="submit"
          disabled={isStreaming || !draft.trim()}
          aria-label={t('chat.send')}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-contrast disabled:opacity-50 ${focusRingClassName}`}
        >
          <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
