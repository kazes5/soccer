import { isRtl, type Locale } from '@soccer/i18n';

/**
 * `I18nManager`/`expo-updates` shaped as narrow interfaces (not imported
 * directly) so this logic is testable with plain mock objects — no native
 * module mocking, no `jest-expo` component-rendering machinery required.
 */
export interface I18nManagerLike {
  isRTL: boolean;
  allowRTL(allow: boolean): void;
  forceRTL(force: boolean): void;
}

export interface UpdatesLike {
  reloadAsync(): Promise<void>;
}

export interface DirectionChangeResult {
  /** Whether the locale's writing direction actually flipped (RTL <-> LTR). */
  changed: boolean;
  /** Whether the app was actually reloaded to apply it. `changed && !restarted`
   * means the direction flag was set for next launch, but nothing could
   * force a reload now (e.g. no `expo-updates` channel configured) — the
   * caller must tell the user to restart manually. */
  restarted: boolean;
}

/**
 * Unlike web (`document.documentElement.dir`, applied instantly via CSS),
 * `I18nManager.forceRTL` only takes effect on native after the JS context
 * reloads — RN's own documented limitation, not something a component can
 * work around by re-rendering.
 */
export async function applyLocaleDirection(
  locale: Locale,
  deps: { i18nManager: I18nManagerLike; updates: UpdatesLike },
): Promise<DirectionChangeResult> {
  const nextIsRtl = isRtl(locale);
  if (deps.i18nManager.isRTL === nextIsRtl) {
    return { changed: false, restarted: false };
  }

  deps.i18nManager.allowRTL(true);
  deps.i18nManager.forceRTL(nextIsRtl);

  try {
    await deps.updates.reloadAsync();
    return { changed: true, restarted: true };
  } catch {
    return { changed: true, restarted: false };
  }
}
