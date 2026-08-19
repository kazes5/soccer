import { test } from '@playwright/test';
import { acceptInvite, claimAnOpenShift, loginAsSeededUser } from '../fixtures/scenarios';

/**
 * The core parent journey CLAUDE.md exists to support: get into the app,
 * claim an open carpool shift, and see it reflected back on Home. Runs
 * against the seeded demo data (apps/api/prisma/seed.ts) reset fresh by
 * `pnpm run db:setup` before the suite starts, once per locale to prove the
 * flow and its RTL mirroring both actually work end to end, not just in
 * isolated component tests.
 *
 * The two locales deliberately exercise the two different ways a parent
 * gets into the app: the English scenario logs in directly as an
 * already-seeded user (the common case), while the Hebrew scenario drives
 * the real invite-link + code + password onboarding flow from scratch — so
 * this one spec still proves onboarding itself works, without needing a
 * separate dedicated spec for it.
 */
test('parent logs in and claims a shift (en)', async ({ page, baseURL }) => {
  await loginAsSeededUser(page, baseURL, {
    locale: 'en',
    phone: '+15550000002',
    teamName: 'U-12 Wildcats',
    parentName: 'Avi Levi',
  });
  await claimAnOpenShift(page, {
    claimButtonName: 'Claim',
    mineStatusText: 'You',
    // Not 'first' (see claimAnOpenShift's doc comment) and not 'last'
    // either, since golden-path.mobile.spec.ts shares this team and already
    // claims 'last'.
    claimShiftPosition: 'secondToLast',
  });
});

test('parent onboards via invite link and claims a shift (he)', async ({ page, baseURL }) => {
  await acceptInvite(page, baseURL, {
    locale: 'he',
    inviteCode: 'hebrew-new-parent-demo',
    onboardingCode: '000000',
    teamName: 'נבחרת אריות U-12',
    parentName: 'E2E בדיקה',
  });
  await claimAnOpenShift(page, {
    claimButtonName: 'אני אנהג/ת',
    mineStatusText: 'שלכם',
    claimShiftPosition: 'last',
  });
});
