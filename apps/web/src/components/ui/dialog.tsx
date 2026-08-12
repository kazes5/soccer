'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  closeLabel: string;
}

/**
 * Built on the native `<dialog>` element: `showModal()` gives us a focus trap,
 * Escape-to-close, and backdrop dimming for free, with no extra dependency.
 */
export function Dialog({
  open,
  onClose,
  closeDisabled = false,
  title,
  description,
  children,
  closeLabel,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Falls back to the plain `open` attribute where `showModal`/`close` aren't
    // implemented (e.g. jsdom in tests) — no focus trap there, but no crash either.
    if (open && !node.open) {
      if (typeof node.showModal === 'function') node.showModal();
      else node.setAttribute('open', '');
    }
    if (!open && node.open) {
      if (typeof node.close === 'function') node.close();
      else node.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        // Keep the native dialog controlled by React. In particular, Escape
        // must not dismiss a confirmation while its mutation is in flight.
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-surface-border bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/40"
    >
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={closeLabel}
          className={`-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-soft hover:text-ink ${focusRingClassName}`}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="px-5 pb-5">{children}</div>
    </dialog>
  );
}
