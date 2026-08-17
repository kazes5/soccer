export { typeScale, type TypeScaleKey, type TypeStyle } from '../typography';

/**
 * Web pins one variable font (`--font-heebo`) covering both Latin and Hebrew
 * glyphs so the UI never swaps fonts on locale change (CLAUDE.md §3.10). RN
 * has no CSS `var()` / `@font-face` — a real Heebo family needs its `.ttf`
 * files bundled via `expo-font` and registered under this same name, which
 * is Stage 8 Checkpoint 6 (native RTL/accessibility polish) work, not this
 * scaffold. `undefined` here means "use the platform default" (San
 * Francisco / Roboto), both of which already render Hebrew glyphs natively
 * per CLAUDE.md §3.10 — an acceptable placeholder, not silently broken.
 */
export const nativeFontFamily: { sans: string | undefined } = {
  sans: undefined,
};
