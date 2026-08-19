import type { CollectionPoint } from '@soccer/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import { parseOptionalCoordinate } from './coordinates';
import AdminCollectionPointsPage from './page';

describe('parseOptionalCoordinate', () => {
  it('treats a blank string as absent', () => {
    expect(parseOptionalCoordinate('')).toBeUndefined();
    expect(parseOptionalCoordinate('   ')).toBeUndefined();
  });

  it('parses a valid coordinate', () => {
    expect(parseOptionalCoordinate('32.5')).toBe(32.5);
  });

  it('flags a syntactically-valid but non-finite value (e.g. an overflowing exponent) as invalid', () => {
    // Real browsers accept "1e400" as a syntactically valid <input type="number">
    // value even though it numerically overflows to Infinity — this is the exact
    // shape of value that must not silently become `null` on the wire.
    expect(parseOptionalCoordinate('1e400')).toBeNull();
  });
});

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/collection-points',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      listCollectionPoints: vi.fn(),
      createCollectionPoint: vi.fn(),
      updateCollectionPoint: vi.fn(),
      deleteCollectionPoint: vi.fn(),
    },
  };
});

const adminUser = {
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
      primaryColor: null,
    },
  ],
};

const parentOnlyUser = {
  ...adminUser,
  teamMemberships: [
    {
      teamId: 'team-1',
      teamName: 'U-12 Wildcats',
      role: 'parent' as const,
      timezone: 'Asia/Jerusalem',
      primaryColor: null,
    },
  ],
};

const oakSt: CollectionPoint = {
  id: 'point-1',
  teamId: 'team-1',
  name: 'Oak St',
  address: '123 Oak St',
  gpsLat: null,
  gpsLng: null,
  type: 'pickup',
};

describe('AdminCollectionPointsPage', () => {
  beforeEach(() => {
    replace.mockClear();
    vi.mocked(api.me).mockReset();
    vi.mocked(api.listCollectionPoints).mockReset();
    vi.mocked(api.createCollectionPoint).mockReset();
    vi.mocked(api.updateCollectionPoint).mockReset();
    vi.mocked(api.deleteCollectionPoint).mockReset();
  });

  it('redirects to /login when the session lookup fails', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthenticated'));

    renderWithProviders(<AdminCollectionPointsPage />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?next=%2Fadmin%2Fcollection-points'),
    );
  });

  it('redirects to /home when the user is not an admin on any team', async () => {
    vi.mocked(api.me).mockResolvedValue(parentOnlyUser);

    renderWithProviders(<AdminCollectionPointsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
  });

  it('shows nav links to both admin screens, with this one marked current', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [] });

    renderWithProviders(<AdminCollectionPointsPage />);

    const [currentLink] = await screen.findAllByRole('link', { name: 'Collection points' });
    expect(currentLink).toHaveAttribute('aria-current', 'page');
    const [otherLink] = screen.getAllByRole('link', { name: 'Schedule templates' });
    expect(otherLink).toHaveAttribute('href', '/admin/schedule-templates?team=team-1');
  });

  it('shows an empty state when there are no collection points yet', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [] });

    renderWithProviders(<AdminCollectionPointsPage />);

    expect(await screen.findByText('No collection points yet.')).toBeInTheDocument();
  });

  it('lists existing collection points with their type', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });

    renderWithProviders(<AdminCollectionPointsPage />);

    expect(await screen.findByText('Oak St')).toBeInTheDocument();
    expect(screen.getByText('123 Oak St')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
  });

  it('lets an admin add a new collection point, patching it into the list from the create response', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [] });
    vi.mocked(api.createCollectionPoint).mockResolvedValue(oakSt);

    renderWithProviders(<AdminCollectionPointsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add collection point/i }));
    expect(screen.getByRole('heading', { name: 'Add collection point' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Oak St' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '123 Oak St' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.createCollectionPoint).toHaveBeenCalledWith('team-1', {
        name: 'Oak St',
        address: '123 Oak St',
        type: 'pickup',
        gpsLat: undefined,
        gpsLng: undefined,
      }),
    );
    expect(await screen.findByText('Oak St')).toBeInTheDocument();
    // No refetch — the new row comes straight from the create response.
    expect(api.listCollectionPoints).toHaveBeenCalledTimes(1);
  });

  it("lets an admin edit an existing point's details", async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.updateCollectionPoint).mockResolvedValue({ ...oakSt, name: 'Oak Street' });

    renderWithProviders(<AdminCollectionPointsPage />);
    await screen.findByText('Oak St');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Oak St' }));
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Oak Street' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateCollectionPoint).toHaveBeenCalledWith('team-1', 'point-1', {
        name: 'Oak Street',
        address: '123 Oak St',
        type: 'pickup',
        gpsLat: undefined,
        gpsLng: undefined,
      }),
    );
    expect(await screen.findByText('Oak Street')).toBeInTheDocument();
    // No refetch — the patched row comes straight from the update response.
    expect(api.listCollectionPoints).toHaveBeenCalledTimes(1);
  });

  it('lets an admin delete a point after confirming', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.deleteCollectionPoint).mockResolvedValue(undefined);

    renderWithProviders(<AdminCollectionPointsPage />);
    await screen.findByText('Oak St');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Oak St' }));
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(api.deleteCollectionPoint).toHaveBeenCalledWith('team-1', 'point-1'),
    );
    await waitFor(() => expect(screen.queryByText('Oak St')).not.toBeInTheDocument());
    // No refetch — the row is removed from local state directly.
    expect(api.listCollectionPoints).toHaveBeenCalledTimes(1);
  });

  it('shows the server conflict message when deleting a point that has scheduled sessions', async () => {
    vi.mocked(api.me).mockResolvedValue(adminUser);
    vi.mocked(api.listCollectionPoints).mockResolvedValue({ points: [oakSt] });
    vi.mocked(api.deleteCollectionPoint).mockRejectedValue(
      new ApiError(409, 'This collection point has scheduled sessions and cannot be deleted.'),
    );

    renderWithProviders(<AdminCollectionPointsPage />);
    await screen.findByText('Oak St');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Oak St' }));
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));

    expect(
      await screen.findByText(
        'This collection point has scheduled sessions and cannot be deleted.',
      ),
    ).toBeInTheDocument();
  });
});
