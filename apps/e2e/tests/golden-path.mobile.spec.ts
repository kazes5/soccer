import { test } from '@playwright/test';
import { acceptInviteAndClaimShift } from '../fixtures/scenarios';

/**
 * Same core journey as golden-path.spec.ts, but run at a mobile viewport
 * (the `mobile-chromium` project, see playwright.config.ts) to prove the
 * responsive layout — bottom nav instead of sidebar, no horizontal scroll,
 * touch-sized targets — actually carries the flow through, not just renders.
 * Uses its own seeded parent (english-parent-3-demo) so it never contends
 * with golden-path.spec.ts's english-parent-1-demo for the same invite row
 * when both projects run concurrently, and claims the *last* open shift
 * (rather than the first, like the desktop English journey does) so the
 * two specs — both on the U-12 Wildcats team — never race to claim the
 * same shift.
 */
test('parent accepts an invite and claims a shift on a mobile viewport', async ({
  page,
  baseURL,
}) => {
  await acceptInviteAndClaimShift(page, baseURL, {
    locale: 'en',
    inviteCode: 'english-parent-3-demo',
    teamName: 'U-12 Wildcats',
    parentName: 'Noa Peretz',
    claimButtonName: 'Claim',
    mineStatusText: 'You',
    claimShiftPosition: 'last',
  });
});
