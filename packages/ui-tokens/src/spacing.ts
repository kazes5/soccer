export const SPACING_UNIT_PX = 4;

export function spacing(multiplier: number): string {
  return `${multiplier * SPACING_UNIT_PX}px`;
}
