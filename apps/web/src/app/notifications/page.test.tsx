import type { Notification } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useNotificationStream } from '@/lib/use-notification-stream';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import NotificationsPage from './page';

const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/notifications',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listNotifications: vi.fn(),
      markNotificationRead: vi.fn(),
      dismissNotification: vi.fn(),
      markAllNotificationsRead: vi.fn(),
    },
  };
});

// jsdom has no EventSource/BroadcastChannel/Web Locks; the live-stream
// wiring itself is covered by src/lib/sse.test.ts (pure dedupe logic) and
// manual browser verification, not here.
vi.mock('@/lib/use-notification-stream', () => ({
  useNotificationStream: vi.fn(),
}));

const user = {
  user: {
    id: 'user-1',
    name: 'Dana Cohen',
    phone: '+15550001111',
    email: null,
    languagePreference: 'en' as const,
  },
  teamMemberships: [
    {
      teamId: 'team-1',
      teamName: 'U-12 Wildcats',
      role: 'admin' as const,
      timezone: 'Asia/Jerusalem',
    },
  ],
};

const unreadNotification: Notification = {
  id: 'notif-1',
  teamId: 'team-1',
  eventType: 'shift_claimed',
  category: 'shift_changes',
  severity: 'normal',
  payload: {
    sessionId: 'session-1',
    shiftId: 'shift-1',
    pointName: 'Oak St',
    direction: 'to_practice',
    sessionStartsAt: '2026-08-12T15:00:00.000Z',
    byUserName: 'Avi Levi',
  },
  readAt: null,
  dismissedAt: null,
  createdAt: '2026-08-12T15:05:00.000Z',
};

const readNotification: Notification = {
  ...unreadNotification,
  id: 'notif-2',
  readAt: '2026-08-12T16:00:00.000Z',
  payload: { userId: 'user-2', userName: 'Sarah Katz' },
  eventType: 'member_removed',
  category: 'admin_changes',
};

describe('NotificationsPage', () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listNotifications).mockReset();
    vi.mocked(api.markNotificationRead).mockReset();
    vi.mocked(api.dismissNotification).mockReset();
    vi.mocked(api.markAllNotificationsRead).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<NotificationsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fnotifications'));
  });

  it('shows an empty state when there are no notifications', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [],
      nextCursor: null,
      unreadCount: 0,
    });

    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it('renders unread and read notifications with the unread count', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [unreadNotification, readNotification],
      nextCursor: null,
      unreadCount: 1,
    });

    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByText('1 unread')).toBeInTheDocument();
    expect(screen.getByText(/Avi Levi claimed/)).toBeInTheDocument();
    expect(screen.getByText('Sarah Katz was removed from the team')).toBeInTheDocument();
  });

  it('prepends a live-pushed notification and bumps the unread count', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [readNotification],
      nextCursor: null,
      unreadCount: 0,
    });

    renderWithProviders(<NotificationsPage />);
    await screen.findByText('Sarah Katz was removed from the team');
    expect(screen.getByText('0 unread')).toBeInTheDocument();

    const [, onLiveNotification] = vi.mocked(useNotificationStream).mock.calls.at(-1)!;
    onLiveNotification(unreadNotification);

    expect(await screen.findByText(/Avi Levi claimed/)).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('does not duplicate a live-pushed notification already in the list', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [unreadNotification],
      nextCursor: null,
      unreadCount: 1,
    });

    renderWithProviders(<NotificationsPage />);
    await screen.findByText('1 unread');

    const [, onLiveNotification] = vi.mocked(useNotificationStream).mock.calls.at(-1)!;
    onLiveNotification(unreadNotification);

    expect(screen.getAllByText(/Avi Levi claimed/)).toHaveLength(1);
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('marks a notification read and navigates to its deep link on click', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [unreadNotification],
      nextCursor: null,
      unreadCount: 1,
    });
    vi.mocked(api.markNotificationRead).mockResolvedValue(undefined);

    renderWithProviders(<NotificationsPage />);

    const item = await screen.findByText(/Avi Levi claimed/);
    fireEvent.click(item);

    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith('team-1', 'notif-1'));
    expect(push).toHaveBeenCalledWith('/schedule?team=team-1&session=session-1&shift=shift-1');
  });

  it('dismisses a notification and removes it from the list', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [unreadNotification],
      nextCursor: null,
      unreadCount: 1,
    });
    vi.mocked(api.dismissNotification).mockResolvedValue(undefined);

    renderWithProviders(<NotificationsPage />);
    await screen.findByText(/Avi Levi claimed/);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    await waitFor(() => expect(api.dismissNotification).toHaveBeenCalledWith('team-1', 'notif-1'));
    expect(screen.queryByText(/Avi Levi claimed/)).not.toBeInTheDocument();
  });

  it('marks all notifications read via the button', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockResolvedValue({
      notifications: [unreadNotification],
      nextCursor: null,
      unreadCount: 1,
    });
    vi.mocked(api.markAllNotificationsRead).mockResolvedValue(undefined);

    renderWithProviders(<NotificationsPage />);
    await screen.findByText('1 unread');

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalledWith('team-1'));
    expect(await screen.findByText('0 unread')).toBeInTheDocument();
  });

  it('loads more notifications with the cursor from the previous page', async () => {
    vi.mocked(api.me).mockResolvedValue(user);
    vi.mocked(api.listNotifications).mockImplementation((_teamId, options) => {
      if (options?.cursor) {
        return Promise.resolve({
          notifications: [readNotification],
          nextCursor: null,
          unreadCount: 1,
        });
      }
      return Promise.resolve({
        notifications: [unreadNotification],
        nextCursor: 'notif-1',
        unreadCount: 1,
      });
    });

    renderWithProviders(<NotificationsPage />);
    await screen.findByText(/Avi Levi claimed/);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() =>
      expect(api.listNotifications).toHaveBeenCalledWith('team-1', { cursor: 'notif-1' }),
    );
    expect(await screen.findByText('Sarah Katz was removed from the team')).toBeInTheDocument();
  });
});
