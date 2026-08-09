'use client';

import { buttonClassName, dangerButtonClassName, secondaryButtonClassName } from '../form-controls';
import { Dialog } from './dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

/** Mirrors the confirmation standard CLAUDE.md §6.4 sets for destructive AI-chat actions. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      closeLabel={closeLabel}
    >
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={danger ? dangerButtonClassName : buttonClassName}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
