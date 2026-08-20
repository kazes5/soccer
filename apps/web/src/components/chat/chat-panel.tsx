'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale } from '@/components/locale-provider';
import { ChatMessage } from './chat-message';
import { useChatSession } from './use-chat-session';

export function ChatPanel({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const { messages, isStreaming, sendMessage } = useChatSession(teamId, locale);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || isStreaming) return;
    const text = draft;
    setDraft('');
    await sendMessage(text);
  }

  return (
    <div
      role="dialog"
      aria-label={t('chat.title')}
      className="fixed inset-x-4 bottom-20 top-20 z-40 flex flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lg sm:inset-x-auto sm:end-4 sm:top-auto sm:h-[32rem] sm:w-96"
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
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-surface-border p-3"
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('chat.inputPlaceholder')}
          disabled={isStreaming}
          className={`min-h-11 flex-1 rounded-full border border-surface-border bg-surface px-4 text-sm text-ink placeholder:text-ink-muted disabled:opacity-60 ${focusRingClassName}`}
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
