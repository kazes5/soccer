import { SPACING_UNIT_PX } from '../spacing';

/** RN `StyleSheet` takes unitless numbers (density-independent pixels), not
 * the `"Npx"` strings `../spacing.ts`'s `spacing()` returns for CSS. */
export function nativeSpacing(multiplier: number): number {
  return multiplier * SPACING_UNIT_PX;
}
