import { forwardRef, type ReactNode } from 'react';

export function DataList({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  return (
    <ul role="list" aria-label={ariaLabel} className="flex flex-col gap-3">
      {children}
    </ul>
  );
}

export const DataListItem = forwardRef<HTMLLIElement, { children: ReactNode; className?: string }>(
  function DataListItem({ children, className = '' }, ref) {
    return (
      <li
        ref={ref}
        className={`rounded-xl border border-surface-border bg-surface p-4 shadow-raised ${className}`}
      >
        {children}
      </li>
    );
  },
);
