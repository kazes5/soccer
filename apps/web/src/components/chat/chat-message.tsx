import { Check, Loader2, X } from 'lucide-react';
import { useLocale } from '@/components/locale-provider';
import type { ChatMessage as ChatMessageData } from './use-chat-session';

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const { t } = useLocale();
  const isUser = message.role === 'user';

  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      {message.content && (
        <div
          // `dir="auto"` — the model's reply language doesn't always exactly
          // match the UI locale (see chat.ts's system prompt), so alignment
          // is derived from the text itself, the same way the audit-log
          // detail dialog already handles arbitrary bilingual content.
          dir="auto"
          className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
            isUser ? 'bg-brand text-brand-contrast' : 'bg-surface-soft text-ink'
          }`}
        >
          {message.content}
        </div>
      )}
      {message.toolCalls.map((call) => (
        <div
          key={call.id}
          className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-ink-muted"
        >
          {call.status === 'pending' && (
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
          )}
          {call.status === 'ok' && (
            <Check className="size-3 shrink-0 text-status-mine-on" aria-hidden="true" />
          )}
          {call.status === 'error' && (
            <X className="size-3 shrink-0 text-status-open-on" aria-hidden="true" />
          )}
          <span>
            {call.status === 'pending' ? call.summary : (call.resultSummary ?? call.summary)}
          </span>
        </div>
      ))}
      {message.error && (
        <div className="max-w-[85%] rounded-2xl bg-status-open-subtle px-3.5 py-2 text-sm text-status-open-on">
          {message.error === 'Something went wrong.' ? t('chat.genericError') : message.error}
        </div>
      )}
    </div>
  );
}
