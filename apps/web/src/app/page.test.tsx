import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen } from '@/test/render';
import Home from './page';

describe('Home', () => {
  it('renders the product name', () => {
    renderWithProviders(<Home />);
    expect(
      screen.getByRole('heading', { name: /soccer carpool coordinator/i }),
    ).toBeInTheDocument();
  });
});
