import type { ReactNode } from 'react';

export const inputClassName =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-900';

export const buttonClassName =
  'rounded-md bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50';

export const secondaryButtonClassName =
  'rounded-md border border-zinc-300 px-4 py-2.5 font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
