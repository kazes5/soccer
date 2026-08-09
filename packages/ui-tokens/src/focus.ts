export const focusRing = {
  widthPx: 2,
  offsetPx: 2,
} as const;

/**
 * Shared focus-visible treatment for every interactive primitive. Never relies on
 * color alone — the 2px outline plus offset stays visible against any surface,
 * including in forced-colors / high-contrast modes.
 */
export const focusRingClassName =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]';
