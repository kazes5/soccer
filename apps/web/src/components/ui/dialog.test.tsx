import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/render';
import { Dialog } from './dialog';

describe('Dialog', () => {
  it('is not in the accessibility tree while closed', () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hello" closeLabel="Close">
        Body
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the title, description, and content while open', () => {
    render(
      <Dialog open description="More detail" onClose={() => {}} title="Hello" closeLabel="Close">
        Body content
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('More detail')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('calls onClose when the close button is activated', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Hello" closeLabel="Close">
        Body
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prevents Escape and close-button dismissal while closing is disabled', () => {
    const onClose = vi.fn();
    render(
      <Dialog open closeDisabled onClose={onClose} title="Hello" closeLabel="Close">
        Body
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog');
    const cancelEvent = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
