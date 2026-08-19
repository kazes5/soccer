import { focusRingClassName } from '@soccer/ui-tokens';
import type { ReactNode } from 'react';

export const inputClassName = `min-h-11 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:border-status-pending dark:bg-surface-soft ${focusRingClassName}`;

const buttonBaseClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50';

export const buttonClassName = `${buttonBaseClassName} bg-brand text-brand-contrast hover:brightness-95 ${focusRingClassName}`;

export const secondaryButtonClassName = `${buttonBaseClassName} border border-surface-border text-ink hover:bg-surface-soft ${focusRingClassName}`;

export const dangerButtonClassName = `${buttonBaseClassName} bg-status-open text-status-open-contrast hover:brightness-95 ${focusRingClassName}`;

/** For form-level (not single-field) failures — a failed submit, a network error. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-status-open-on">
      {children}
    </p>
  );
}

export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
      {label}
      {children}
      {hint && !error && <span className="text-xs font-normal text-ink-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs font-normal text-status-open-on">
          {error}
        </span>
      )}
    </label>
  );
}

/**
 * For a group of checkboxes/radios, each with its own label — use this instead
 * of `Field`. `Field` wraps its children in a `<label>`, which is correct for a
 * single control but breaks accessible-name computation for children that are
 * themselves individually `<label>`-wrapped: the browser associates each control
 * with *both* labels (its own, and the outer Field's concatenated text), and
 * Chrome's accessible-name algorithm resolves that ambiguity to nothing rather
 * than picking either one. `<fieldset>`/`<legend>` is the semantically correct,
 * unambiguous pattern for a labeled group of separately-labeled controls.
 */
export function FieldsetGroup({
  legend,
  children,
  error,
}: {
  legend: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {children}
      {error && (
        <span role="alert" className="text-xs font-normal text-status-open-on">
          {error}
        </span>
      )}
    </fieldset>
  );
}
