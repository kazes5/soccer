import type { ReactNode } from 'react';

export function DataList({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  return (
    <ul role="list" aria-label={ariaLabel} className="flex flex-col gap-3">
      {children}
    </ul>
  );
}

export function DataListItem({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={`rounded-xl border border-surface-border bg-surface p-4 shadow-raised ${className}`}
    >
      {children}
    </li>
  );
}
