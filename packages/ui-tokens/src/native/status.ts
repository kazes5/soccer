import type { StatusIconKey, StatusTone } from '../status';
import { type ColorScheme, colorsFor } from './colors';

export type { StatusIconKey, StatusTone } from '../status';

export interface StatusToneColors {
  background: string;
  onBackground: string;
  border: string;
  dot: string;
  icon: StatusIconKey;
}

function tones(c: ColorScheme): Record<StatusTone, StatusToneColors> {
  return {
    mine: {
      background: c.statusMineSubtle,
      onBackground: c.statusMineOn,
      border: c.statusMine,
      dot: c.statusMine,
      icon: 'check-circle',
    },
    covered: {
      background: c.surfaceSoft,
      onBackground: c.inkMuted,
      border: c.surfaceBorder,
      dot: c.inkMuted,
      icon: 'user',
    },
    open: {
      background: c.statusOpenSubtle,
      onBackground: c.statusOpenOn,
      border: c.statusOpen,
      dot: c.statusOpen,
      icon: 'alert-circle',
    },
    urgent: {
      background: c.statusOpen,
      onBackground: c.statusOpenContrast,
      border: c.statusOpen,
      dot: c.statusOpenContrast,
      icon: 'siren',
    },
    attention: {
      background: c.statusAttentionSubtle,
      onBackground: c.statusAttentionOn,
      border: c.statusAttention,
      dot: c.statusAttention,
      icon: 'clock',
    },
    pending: {
      background: c.statusPendingSubtle,
      onBackground: c.statusPendingOn,
      border: c.statusPending,
      dot: c.statusPending,
      icon: 'timer',
    },
  };
}

/** Same {@link StatusTone}/{@link StatusIconKey} semantics as the web token
 * set (`../status.ts`), resolved to plain colors a native `StyleSheet` can
 * consume directly instead of Tailwind class names. */
export function statusToneColors(
  tone: StatusTone,
  scheme: 'light' | 'dark' = 'light',
): StatusToneColors {
  return tones(colorsFor(scheme))[tone];
}
