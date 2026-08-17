import type { ElevationKey } from '../elevation';

export type { ElevationKey } from '../elevation';

/** Per-platform shadow props for RN `StyleSheet` — iOS reads the
 * `shadow*` props, Android reads `elevation` instead; there's no single
 * cross-platform shadow property the way CSS `box-shadow` is on web.
 * Callers pick via `Platform.select` (kept out of this package so
 * `@soccer/ui-tokens` stays dependency-free, matching its web-side scope). */
export interface NativeElevationStyle {
  ios: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
  };
  android: { elevation: number };
}

export const nativeElevation: Record<ElevationKey, NativeElevationStyle> = {
  none: {
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
    },
    android: { elevation: 0 },
  },
  raised: {
    ios: {
      shadowColor: '#14181a',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 2,
    },
    android: { elevation: 2 },
  },
  overlay: {
    ios: {
      shadowColor: '#14181a',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
    },
    android: { elevation: 8 },
  },
};
