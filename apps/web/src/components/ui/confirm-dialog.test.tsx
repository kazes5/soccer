import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/render';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Cancel session?"
        confirmLabel="Yes, cancel it"
        cancelLabel="Never mind"
        closeLabel="Close"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel, not onConfirm, when the cancel button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Cancel session?"
        confirmLabel="Yes, cancel it"
        cancelLabel="Never mind"
        closeLabel="Close"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
