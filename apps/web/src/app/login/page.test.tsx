import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { renderWithProviders, screen } from '@/test/render';
import LoginPage from './page';

let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, passwordLogin: vi.fn() },
  };
});

describe('LoginPage', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    vi.mocked(api.passwordLogin).mockReset();
  });

  it('shows the ordinary sign-in heading by default', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+15551234567')).toBeInTheDocument();
  });

  it('shows the system-admin welcome heading and hides the identifier field when next=/system', () => {
    searchParams = new URLSearchParams({ next: '/system' });

    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Welcome back, Roy' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('+15551234567')).not.toBeInTheDocument();
  });
});
