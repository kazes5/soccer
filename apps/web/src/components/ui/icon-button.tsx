'use client';

import { focusRingClassName } from '@soccer/ui-tokens';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from './tooltip';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Used as both the visible tooltip text and the accessible name. */
  label: string;
  icon: ReactNode;
  variant?: 'default' | 'danger';
}

export function IconButton({
  label,
  icon,
  variant = 'default',
  className = '',
  ...rest
}: IconButtonProps) {
  const variantClassName =
    variant === 'danger'
      ? 'text-status-open-on hover:bg-status-open-subtle'
      : 'text-ink-muted hover:bg-surface-soft hover:text-ink';

  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className={`inline-flex size-11 items-center justify-center rounded-full ${variantClassName} ${focusRingClassName} ${className}`}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
