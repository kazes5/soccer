/**
 * Plain hex values for React Native's `StyleSheet`, which has no CSS cascade
 * and can't resolve `var(--color-*)` custom properties the way
 * `apps/web/src/app/globals.css` does. These are a point-in-time copy of that
 * file's light/dark values (2026-08-18), not a generated artifact — keeping
 * them in sync when a web token changes is manual today. Promoting
 * `globals.css` to *generate from* this module (rather than duplicate it) is
 * tracked as Stage 8 follow-up, not attempted in the Checkpoint 1 scaffold.
 */
export interface ColorScheme {
  ink: string;
  inkMuted: string;
  surface: string;
  surfaceSoft: string;
  surfaceBorder: string;
  statusMine: string;
  statusMineSubtle: string;
  statusMineOn: string;
  statusMineContrast: string;
  statusOpen: string;
  statusOpenSubtle: string;
  statusOpenOn: string;
  statusOpenContrast: string;
  statusAttention: string;
  statusAttentionSubtle: string;
  statusAttentionOn: string;
  statusPending: string;
  statusPendingSubtle: string;
  statusPendingOn: string;
}

export const lightColors: ColorScheme = {
  ink: '#14181a',
  inkMuted: '#52605c',
  surface: '#ffffff',
  surfaceSoft: '#f4f6f5',
  surfaceBorder: '#e2e8e5',
  statusMine: '#1f7a4d',
  statusMineSubtle: '#e6f3ec',
  statusMineOn: '#146239',
  statusMineContrast: '#ffffff',
  statusOpen: '#cc3f2f',
  statusOpenSubtle: '#fbe9e7',
  statusOpenOn: '#b53326',
  statusOpenContrast: '#ffffff',
  statusAttention: '#d98c1b',
  statusAttentionSubtle: '#faedd6',
  statusAttentionOn: '#96600e',
  statusPending: '#1d8a93',
  statusPendingSubtle: '#dff1f2',
  statusPendingOn: '#146369',
};

export const darkColors: ColorScheme = {
  ink: '#f3f5f4',
  inkMuted: '#9aa6a1',
  surface: '#101413',
  surfaceSoft: '#171c1b',
  surfaceBorder: '#2a302e',
  statusMine: '#3fb586',
  statusMineSubtle: '#113523',
  statusMineOn: '#7bd6ac',
  statusMineContrast: '#062013',
  statusOpen: '#f17164',
  statusOpenSubtle: '#3a1913',
  statusOpenOn: '#ffab9f',
  statusOpenContrast: '#1a0705',
  statusAttention: '#f0ac4b',
  statusAttentionSubtle: '#392505',
  statusAttentionOn: '#ffc978',
  statusPending: '#3fb5be',
  statusPendingSubtle: '#0e2f32',
  statusPendingOn: '#83d7de',
};

export function colorsFor(scheme: 'light' | 'dark'): ColorScheme {
  return scheme === 'dark' ? darkColors : lightColors;
}
