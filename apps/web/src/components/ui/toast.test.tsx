import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@/test/render';
import { ToastProvider, useToast } from './toast';

function Trigger() {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast('Saved successfully', 'success')}>
      Trigger
    </button>
  );
}

describe('ToastProvider / useToast', () => {
  it('announces the toast message in a polite live region', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
  });

  it('throws a clear error when useToast is called outside a provider', () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow('useToast must be used within a ToastProvider');
  });
});
