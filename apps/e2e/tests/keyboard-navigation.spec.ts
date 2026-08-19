import { expect, test } from '@playwright/test';

/**
 * CLAUDE.md §3.8 requires the app be operable without relying on precise
 * pointer interaction. This exercises the login page's tab order and
 * keyboard activation end to end — no mouse, no seeded account, so it can
 * run in any order alongside every other spec without touching shared
 * fixture state.
 */
test('login page is fully operable via keyboard alone', async ({ page }) => {
  await page.goto('/login');

  // No locale cookie is set, so the page renders in the default locale
  // (English) — see @soccer/i18n's defaultLocale.
  const identifierInput = page.getByLabel(/phone number or email/i);
  // The identifier input carries autoFocus, so it already has focus on load.
  await expect(identifierInput).toBeFocused();
  await page.keyboard.type('+15559998888');

  await page.keyboard.press('Tab'); // -> password field
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type('irrelevant-password-value');

  await page.keyboard.press('Tab'); // -> "Log in" submit button
  await expect(page.getByRole('button', { name: 'Log in' })).toBeFocused();

  await page.keyboard.press('Enter');

  // The identifier isn't a registered account, so the server returns the
  // same generic failure it would for a wrong password (enumeration
  // resistance — see apps/api/src/routes/auth.ts) — proving both keyboard
  // activation and the resulting request/response round-trip actually
  // worked, without depending on seeded data.
  await expect(page.getByText('Invalid username or password.')).toBeVisible();
});
