import { brandColorPalette, type BrandColorKey } from '@soccer/ui-tokens';

/**
 * Overrides the `--color-brand-*` custom properties (see globals.css) with
 * the active team's chosen accent color, for both light and dark mode.
 *
 * A plain inline `style` attribute can't do this alone: it has higher
 * specificity than any stylesheet rule *including* `@media` blocks, so a
 * single inline `--color-brand: <light-hex>` would also apply in dark mode,
 * permanently overriding the dark-mode default. Rendering a real `<style>`
 * element instead — with its own `@media (prefers-color-scheme: dark)`
 * block, mirroring globals.css's own structure exactly — keeps light/dark
 * switching working correctly for a team's custom color the same way it
 * already does for the app's default one.
 *
 * Renders nothing for `null`/`undefined` (no team, or the team hasn't
 * chosen a color) — globals.css's own defaults already match the `green`
 * palette entry exactly, so there's nothing to override.
 */
export function TeamBrandStyle({ color }: { color: BrandColorKey | null | undefined }) {
  if (!color || color === 'green') return null;

  const { light, dark } = brandColorPalette[color];
  const css = `:root{--color-brand:${light.base};--color-brand-subtle:${light.subtle};--color-brand-on:${light.on};--color-brand-contrast:${light.contrast};}@media (prefers-color-scheme: dark){:root{--color-brand:${dark.base};--color-brand-subtle:${dark.subtle};--color-brand-on:${dark.on};--color-brand-contrast:${dark.contrast};}}`;

  return <style data-team-brand-style="">{css}</style>;
}
