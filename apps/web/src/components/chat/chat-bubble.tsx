'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { MessageCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/locale-provider';
import { api } from '@/lib/api';
import { ChatPanel } from './chat-panel';

/**
 * Mounted once in AppShell (persistent across every authenticated page, per
 * CLAUDE.md §6.1's "persistent chat bubble" framing) rather than threaded as
 * a prop from each page — self-fetches its own session the same way every
 * page already independently calls `api.me()` (no shared session context
 * exists in this app to plug into instead). Renders nothing until a team is
 * known, and nothing at all for an account with no team membership (e.g. a
 * system-console-only session).
 *
 * Reads the `?team=` query param via `window.location.search` directly
 * rather than `next/navigation`'s `useSearchParams` — AppShell (and so this
 * component) mounts on pages that don't otherwise need a router search-params
 * context in their own tests, and pulling that hook in here would require
 * every one of those pages' existing `next/navigation` mocks to grow a
 * `useSearchParams` export just to satisfy a component they don't otherwise
 * depend on.
 */
export function ChatBubble() {
  const { t } = useLocale();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const requestedTeamId =
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('team');
    api
      .me()
      .then((session) => {
        if (cancelled) return;
        const requested = session.teamMemberships.find((m) => m.teamId === requestedTeamId);
        setTeamId(requested?.teamId ?? session.teamMemberships[0]?.teamId ?? null);
      })
      .catch(() => {
        if (!cancelled) setTeamId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!teamId) return null;

  return (
    <>
      {open && <ChatPanel teamId={teamId} onClose={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? t('common.close') : t('chat.bubbleLabel')}
        aria-expanded={open}
        className={`fixed bottom-20 end-4 z-40 flex size-14 items-center justify-center rounded-full bg-brand text-brand-contrast shadow-lg hover:brightness-95 md:bottom-4 ${focusRingClassName}`}
      >
        {open ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <MessageCircle className="size-6" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
