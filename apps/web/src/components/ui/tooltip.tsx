'use client';

import { cloneElement, isValidElement, useId, useState, type ReactElement } from 'react';

interface TooltipProps {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/** Wraps a single focusable child; shows the label on hover *and* keyboard focus. */
export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  if (!isValidElement(children)) {
    return children;
  }

  const trigger = cloneElement(children, { 'aria-describedby': id });

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setVisible(true)}
      onPointerLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute end-0 top-full z-20 mt-1.5 w-max max-w-36 text-end rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface shadow-raised transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
