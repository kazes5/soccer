import { test } from '@playwright/test';
import { claimAnOpenShift, loginAsSeededUser } from '../fixtures/scenarios';

/**
 * Same core journey as golden-path.spec.ts, but run at a mobile viewport
 * (the `mobile-chromium` project, see playwright.config.ts) to prove the
 * responsive layout — bottom nav instead of sidebar, no horizontal scroll,
 * touch-sized targets — actually carries the flow through, not just renders.
 * Uses its own seeded parent (Noa Peretz) so it never contends with
 * golden-path.spec.ts's Avi Levi for the same account when both projects
 * run concurrently, and claims the *last* open shift (rather than the
 * second-to-last, like the desktop English journey does) so the two specs —
 * both on the U-12 Wildcats team — never race to claim the same shift.
 */
test('parent logs in and claims a shift on a mobile viewport', async ({ page, baseURL }) => {
  await loginAsSeededUser(page, baseURL, {
    locale: 'en',
    phone: '+15550000004',
    teamName: 'U-12 Wildcats',
    parentName: 'Noa Peretz',
  });
  await claimAnOpenShift(page, {
    claimButtonName: 'Claim',
    mineStatusText: 'You',
    claimShiftPosition: 'last',
  });
});
