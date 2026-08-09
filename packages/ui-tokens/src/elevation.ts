/**
 * Kept deliberately low-contrast — the fieldside utility aesthetic favors flat
 * surfaces and borders over heavy drop shadows.
 */
export const elevation = {
  none: 'none',
  raised: '0 1px 2px rgba(20, 24, 26, 0.06), 0 1px 1px rgba(20, 24, 26, 0.04)',
  overlay: '0 12px 32px rgba(20, 24, 26, 0.18), 0 4px 12px rgba(20, 24, 26, 0.08)',
} as const;

export type ElevationKey = keyof typeof elevation;
