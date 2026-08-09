import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/render';
import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('exposes the label as the accessible name and links it via aria-describedby', () => {
    render(<IconButton label="Delete" icon={<span data-testid="icon" />} />);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete');
  });

  it('forwards click handlers', () => {
    const onClick = vi.fn();
    render(<IconButton label="Delete" icon={<span />} onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
