import { expect, test } from '@playwright/test';
import { loginAsSeededUser } from '../fixtures/scenarios';

/**
 * Automated RTL *reading order* check — distinct from what
 * `accessibility.spec.ts`'s axe scan already covers. axe validates `dir`
 * attributes and structural markup, but never checks that elements which
 * are laid out horizontally (not just text-aligned) actually appear in the
 * correct right-to-left visual sequence for a Hebrew reader.
 *
 * `AppShell`'s bottom nav (`shell.tsx`'s `BottomNavLink` row, `flex
 * items-stretch justify-around`, no RTL-specific override classes) is the
 * one horizontally-arranged, multi-item sequence in this app whose order
 * actually matters for reading direction — the sidebar equivalent stacks
 * vertically, where LTR vs RTL make no visual difference. Only visible at
 * the mobile viewport (`md:hidden`), hence `*.mobile.spec.ts`.
 *
 * A correct RTL layout means the *first* DOM element (Home, first in every
 * page's `navItems` array) renders at the rightmost screen position,
 * with each subsequent item appearing further left — the opposite of LTR,
 * and exactly what plain CSS flexbox `flex-direction: row` should already
 * produce once `dir="rtl"` is set correctly, with no bespoke RTL styling
 * needed. This test would catch a regression where some future change
 * hardcodes an LTR-only direction and silently breaks that.
 *
 * Uses דניאל אזולאי (Hebrew parent 6) — every other seeded Hebrew parent is
 * already claimed by an existing spec.
 */
test('the bottom nav reads right-to-left in Hebrew', async ({ page, baseURL }) => {
  await loginAsSeededUser(page, baseURL, {
    locale: 'he',
    phone: '+972507890123',
    teamName: 'נבחרת אריות U-12',
    parentName: 'דניאל אזולאי',
  });
  // Home renders `null` for one tick while its own `api.me()` call is in
  // flight — wait for real content before measuring layout.
  await expect(page.getByText(/^הסעות בקרוב: \d+$/)).toBeVisible();

  const bottomNav = page.getByRole('navigation', { name: 'ניווט ראשי' });
  const links = bottomNav.getByRole('link');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(3);

  const boxes = [];
  for (let i = 0; i < count; i += 1) {
    const box = await links.nth(i).boundingBox();
    expect(box, `link at DOM index ${i} has no bounding box`).not.toBeNull();
    boxes.push(box!);
  }

  // Each item in DOM order must sit strictly to the left of the previous
  // one — the first item (Home) rightmost, matching Hebrew reading order.
  for (let i = 1; i < boxes.length; i += 1) {
    expect(
      boxes[i]!.x,
      `item ${i} (x=${boxes[i]!.x}) should be left of item ${i - 1} (x=${boxes[i - 1]!.x}) in RTL`,
    ).toBeLessThan(boxes[i - 1]!.x);
  }
});
