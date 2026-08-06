import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Home', () => {
  it('renders the product name', () => {
    render(<Home />);
    expect(
      screen.getByRole('heading', { name: /soccer carpool coordinator/i }),
    ).toBeInTheDocument();
  });
});
