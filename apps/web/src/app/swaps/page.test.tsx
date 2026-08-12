import type { SwapRequest, SwapRequestListResponse } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/test/render';
import SwapsPage from './page';

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/swaps',
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listSwapRequests: vi.fn(),
      acceptSwapRequest: vi.fn(),
      declineSwapRequest: vi.fn(),
      cancelSwapRequest: vi.fn(),
    },
  };
});

const currentUser = {
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
      role: 'parent' as const,
      timezone: 'Asia/Jerusalem',
    },
  ],
};

function buildSwapRequest(overrides: Partial<SwapRequest> = {}): SwapRequest {
  return {
    id: 'swap-1',
    teamId: 'team-1',
    shiftId: 'shift-1',
    sessionId: 'session-1',
    sessionStartsAt: '2099-08-10T18:00:00.000Z',
    pointId: 'point-1',
    pointName: 'Oak St',
    direction: 'to_practice',
    requestingUserId: 'user-2',
    requestingUserName: 'Avi Levi',
    currentHolderId: 'user-1',
    currentHolderName: 'Dana Cohen',
    status: 'pending',
    expiresAt: '2099-08-11T18:00:00.000Z',
    createdAt: '2026-08-12T12:00:00.000Z',
    updatedAt: '2026-08-12T12:00:00.000Z',
    ...overrides,
  };
}

const emptyList: SwapRequestListResponse = { swapRequests: [] };

describe('SwapsPage', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listSwapRequests).mockReset().mockResolvedValue(emptyList);
    vi.mocked(api.acceptSwapRequest).mockReset();
    vi.mocked(api.declineSwapRequest).mockReset();
    vi.mocked(api.cancelSwapRequest).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<SwapsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fswaps'));
  });

  it('shows empty states for all three sections when there is no swap activity', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);

    renderWithProviders(<SwapsPage />);

    expect(await screen.findByText('No one has requested one of your shifts.')).toBeInTheDocument();
    expect(screen.getByText("You haven't requested any swaps.")).toBeInTheDocument();
    expect(screen.getByText('No other swap activity yet.')).toBeInTheDocument();
  });

  it('shows no team selector for a single-team parent and ignores an unknown team query', async () => {
    searchParams = new URLSearchParams({ team: 'uninvited-team' });
    vi.mocked(api.me).mockResolvedValue(currentUser);

    renderWithProviders(<SwapsPage />);

    expect(await screen.findByText('No one has requested one of your shifts.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Switch team' })).not.toBeInTheDocument();
    expect(api.listSwapRequests).toHaveBeenCalledWith('team-1');
    expect(api.listSwapRequests).not.toHaveBeenCalledWith('uninvited-team');
  });

  it("sorts requests into the right section based on the viewer's role", async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [
        // Needs this user's response (they hold the shift).
        buildSwapRequest({ id: 'swap-needs-response', currentHolderId: 'user-1' }),
        // This user's own sent request.
        buildSwapRequest({
          id: 'swap-sent',
          requestingUserId: 'user-1',
          currentHolderId: 'user-3',
          currentHolderName: 'Noa Peretz',
        }),
        // Neither party — read-only team activity.
        buildSwapRequest({
          id: 'swap-other',
          requestingUserId: 'user-2',
          currentHolderId: 'user-3',
          currentHolderName: 'Noa Peretz',
        }),
      ],
    });

    renderWithProviders(<SwapsPage />);

    const needsResponse = (await screen.findByText('Needs your response')).closest('section');
    expect(within(needsResponse!).getByText('Requested by Avi Levi')).toBeInTheDocument();
    expect(within(needsResponse!).getAllByRole('listitem')).toHaveLength(1);

    const yourRequests = screen.getByText('Your requests').closest('section');
    expect(within(yourRequests!).getByText('Held by Noa Peretz')).toBeInTheDocument();

    const teamActivity = screen.getByText('Team activity').closest('section');
    expect(within(teamActivity!).getByText(/Requested by Avi Levi/)).toBeInTheDocument();
    expect(within(teamActivity!).getByText(/Held by Noa Peretz/)).toBeInTheDocument();
  });

  it('lets the holder accept a request in "Needs your response"', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [buildSwapRequest()],
    });
    vi.mocked(api.acceptSwapRequest).mockResolvedValue(buildSwapRequest({ status: 'accepted' }));

    renderWithProviders(<SwapsPage />);
    await screen.findByText('Requested by Avi Levi');

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));

    await waitFor(() => expect(api.acceptSwapRequest).toHaveBeenCalledWith('team-1', 'swap-1'));
    // Accepted requests move out of "needs your response" (status is no
    // longer pending) without a full refetch — patched in place.
    expect(await screen.findByText('No one has requested one of your shifts.')).toBeInTheDocument();
  });

  it('lets the holder decline a request in "Needs your response"', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [buildSwapRequest()],
    });
    vi.mocked(api.declineSwapRequest).mockResolvedValue(buildSwapRequest({ status: 'declined' }));

    renderWithProviders(<SwapsPage />);
    await screen.findByText('Requested by Avi Levi');

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));

    await waitFor(() => expect(api.declineSwapRequest).toHaveBeenCalledWith('team-1', 'swap-1'));
    expect(await screen.findByText('No one has requested one of your shifts.')).toBeInTheDocument();
  });

  it('lets the requester cancel their own pending request from "Your requests"', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [
        buildSwapRequest({
          id: 'swap-sent',
          requestingUserId: 'user-1',
          currentHolderId: 'user-3',
          currentHolderName: 'Noa Peretz',
        }),
      ],
    });
    vi.mocked(api.cancelSwapRequest).mockResolvedValue(
      buildSwapRequest({
        id: 'swap-sent',
        requestingUserId: 'user-1',
        currentHolderId: 'user-3',
        currentHolderName: 'Noa Peretz',
        status: 'cancelled',
      }),
    );

    renderWithProviders(<SwapsPage />);
    await screen.findByText('Held by Noa Peretz');

    fireEvent.click(screen.getByRole('button', { name: /^cancel request$/i }));

    await waitFor(() => expect(api.cancelSwapRequest).toHaveBeenCalledWith('team-1', 'swap-sent'));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    // A cancelled request has nothing left to cancel.
    expect(screen.queryByRole('button', { name: /^cancel request$/i })).not.toBeInTheDocument();
  });

  it('does not offer a cancel button once a sent request is no longer pending', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [
        buildSwapRequest({
          id: 'swap-sent',
          requestingUserId: 'user-1',
          currentHolderId: 'user-3',
          currentHolderName: 'Noa Peretz',
          status: 'accepted',
        }),
      ],
    });

    renderWithProviders(<SwapsPage />);

    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel request$/i })).not.toBeInTheDocument();
  });

  it('shows a resolved request in "Team activity" once accepted, even though this user was the original holder', async () => {
    // Regression test: buildSwapRequest()'s default currentHolderId is
    // 'user-1' (this viewer). Once accepted, the request is no longer
    // `pending`, so it must not stay in "Needs your response" (pending-only)
    // — but it must not vanish either. It has nowhere else to land (this
    // user isn't the requester), so it belongs in "Team activity".
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [buildSwapRequest({ status: 'accepted' })],
    });

    renderWithProviders(<SwapsPage />);

    expect(await screen.findByText('No one has requested one of your shifts.')).toBeInTheDocument();
    const teamActivity = screen.getByText('Team activity').closest('section');
    expect(within(teamActivity!).getByText(/Requested by Avi Levi/)).toBeInTheDocument();
    expect(within(teamActivity!).getByText('Accepted')).toBeInTheDocument();
  });

  it('shows a conflict message and reloads if an action loses a race', async () => {
    vi.mocked(api.me).mockResolvedValue(currentUser);
    vi.mocked(api.listSwapRequests).mockResolvedValue({
      swapRequests: [buildSwapRequest()],
    });
    vi.mocked(api.acceptSwapRequest).mockRejectedValue(
      new ApiError(409, 'This swap request is no longer pending.'),
    );

    renderWithProviders(<SwapsPage />);
    await screen.findByText('Requested by Avi Levi');

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));

    expect(await screen.findByText('This swap request is no longer pending.')).toBeInTheDocument();
    await waitFor(() => expect(api.listSwapRequests).toHaveBeenCalledTimes(2));
  });
});
