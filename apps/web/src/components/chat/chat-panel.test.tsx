import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamChatMessage, type ChatStreamEvent } from '@/lib/chat-stream';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import { ChatPanel } from './chat-panel';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/chat-stream', () => ({
  streamChatMessage: vi.fn(),
}));

function streamOf(events: ChatStreamEvent[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

const COACH_MESSAGE = 'לוז אימונים שבוע הבא\nראשון 17:30 בית דני\nשני 19:00 בית דני';

describe('ChatPanel', () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(streamChatMessage).mockReset();
    window.sessionStorage.clear();
    // jsdom doesn't implement element scrolling; the panel scrolls to the
    // newest message.
    Element.prototype.scrollTo = vi.fn();
  });

  it('keeps a pasted multi-line message intact, adding lines with Shift+Enter and sending with Enter', async () => {
    vi.mocked(streamChatMessage).mockReturnValue(
      streamOf([{ type: 'text-delta', delta: 'Got it.' }, { type: 'done' }]),
    );
    renderWithProviders(<ChatPanel teamId="team-1" onClose={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'Ask something…' });
    fireEvent.change(input, { target: { value: COACH_MESSAGE } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(streamChatMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(streamChatMessage).toHaveBeenCalledWith('team-1', {
        message: COACH_MESSAGE,
        history: [],
        locale: 'en',
      }),
    );
    expect(await screen.findByText('Got it.')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it("offers to review a coach message and opens the Schedule page's import with it", async () => {
    vi.mocked(streamChatMessage).mockReturnValue(
      streamOf([
        { type: 'text-delta', delta: 'Tap Review changes to check them.' },
        { type: 'schedule-import-suggested', message: COACH_MESSAGE },
        { type: 'done' },
      ]),
    );
    const onClose = vi.fn();
    renderWithProviders(<ChatPanel teamId="team-1" onClose={onClose} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask something…' }), {
      target: { value: COACH_MESSAGE },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review changes' }));

    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/schedule?team=team-1');
    expect(JSON.parse(window.sessionStorage.getItem('soccer.coachImportDraft')!)).toEqual({
      teamId: 'team-1',
      message: COACH_MESSAGE,
    });
  });
});
