import { test } from '@playwright/test';
import { acceptInviteAndClaimShift, type GoldenPathScenario } from '../fixtures/scenarios';

/**
 * The core parent journey CLAUDE.md exists to support: accept a team
 * invite (registering the required passkey along the way — every
 * onboarding path needs one, §9.1), claim an open carpool shift, and see
 * it reflected back on Home. Runs against the seeded demo data
 * (apps/api/prisma/seed.ts) reset fresh by `pnpm run db:setup` before the
 * suite starts, once per locale to prove the flow and its RTL mirroring
 * both actually work end to end, not just in isolated component tests.
 */
const scenarios: GoldenPathScenario[] = [
  {
    locale: 'en',
    inviteCode: 'english-parent-1-demo',
    teamName: 'U-12 Wildcats',
    parentName: 'Avi Levi',
    claimButtonName: 'Claim',
    mineStatusText: 'You',
  },
  {
    locale: 'he',
    inviteCode: 'hebrew-parent-1-demo',
    teamName: 'נבחרת אריות U-12',
    parentName: 'אבי לוי',
    claimButtonName: 'אני אנהג/ת',
    mineStatusText: 'שלכם',
  },
];

for (const scenario of scenarios) {
  test(`parent accepts an invite and claims a shift (${scenario.locale})`, async ({
    page,
    baseURL,
  }) => {
    await acceptInviteAndClaimShift(page, baseURL, scenario);
  });
}
