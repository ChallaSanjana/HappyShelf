import { test, expect, Page } from '@playwright/test';

/**
 * Overstock / waste-risk: an item projected to outlive its own usage before
 * it expires gets flagged, independent of its stock or expiry status.
 *
 * The scenario is deliberately built so the item is *healthy* on stock (it
 * won't run out) and merely *expiring soon* on date — the exact combination
 * that used to have no surface at all: a household could be sitting on a
 * large surplus with nothing telling them so.
 */

const account = {
  name: 'Waste Risk Tester',
  email: `waste-risk-${Date.now()}@example.com`,
  password: 'waste-risk-password-123',
};

/** 3 days out: soon enough that most of a slow-moving item goes unused. */
const SOON_EXPIRY = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
/** 60 days out, comfortably outside the item's own consumption horizon. */
const FAR_EXPIRY = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const OVERSTOCKED_ITEM = {
  // Deliberately avoids the word "Overstocked" in the fixture name itself --
  // it collided with the badge text of the same word, since getByText does
  // substring matching by default.
  name: `E2E Excess Carrots ${Date.now()}`,
  category: 'Food',
  unit: 'kg',
  // 100kg at 0.2/day over 3 days consumes ~0.6kg — the rest is surplus.
  quantity: '100',
  dailyUsage: '0.2',
  expiry: SOON_EXPIRY,
};

const SAFE_ITEM = {
  name: `E2E Safe Bananas ${Date.now()}`,
  category: 'Food',
  unit: 'pcs',
  // 10 days of runway (comfortably above the 3-day low-stock threshold) and
  // the 20 units are gone in 10 days, well inside a 60-day expiry window —
  // healthy on every axis, not just waste risk.
  quantity: '20',
  dailyUsage: '2',
  expiry: FAR_EXPIRY,
};

async function registerAndAddItems(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  await expect(page.getByRole('heading', { name: /Create Account/i })).toBeVisible();
  await page.locator('#register-full-name').fill(account.name);
  await page.locator('#register-email').fill(account.email);
  await page.locator('#register-password').fill(account.password);
  await page.getByRole('button', { name: /^Create Account$|^Creating/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  for (const item of [OVERSTOCKED_ITEM, SAFE_ITEM]) {
    await page.getByRole('button', { name: 'Add Item' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.locator('#item-item-name').fill(item.name);
    await modal.locator('#item-category').selectOption(item.category);
    await modal.locator('#item-unit').selectOption(item.unit);
    await modal.locator('#item-quantity').fill(item.quantity);
    await modal.locator('#item-daily-usage').fill(item.dailyUsage);
    await modal.locator('#item-expiry-date').fill(item.expiry);
    await modal.getByRole('button', { name: /^Save$|^Saving/i }).click();
    await expect(modal).toBeHidden();
  }
}

test('an overstocked item is flagged in the table and the alerts, a well-matched one is not', async ({ page }) => {
  await registerAndAddItems(page);

  // --- inventory table: the Waste Risk column ----------------------------
  await page.goto('/#/inventory');

  const overstockedRow = page.getByRole('row').filter({ hasText: OVERSTOCKED_ITEM.name });
  await expect(overstockedRow).toBeVisible();
  await expect(overstockedRow.getByText('Overstocked')).toBeVisible();

  // Same row also still shows its real stock/expiry status — waste risk is
  // an addition, not a replacement for either. 500 days of runway is "Good"
  // on stock; 3 days to the expiry date is "Expiring soon".
  await expect(overstockedRow).toContainText('Good');
  await expect(overstockedRow).toContainText('Expiring soon');

  const safeRow = page.getByRole('row').filter({ hasText: SAFE_ITEM.name });
  await expect(safeRow).toBeVisible();
  await expect(safeRow.getByText('Overstocked')).toHaveCount(0);

  // --- dashboard alert card -----------------------------------------------
  await page.goto('/#/dashboard');

  const wasteCard = page.locator('div').filter({
    has: page.getByRole('heading', { name: 'Overstocked — May Go To Waste' }),
  });
  await expect(wasteCard.first()).toBeVisible();
  await expect(wasteCard.first()).toContainText(OVERSTOCKED_ITEM.name);
  await expect(wasteCard.first()).not.toContainText(SAFE_ITEM.name);

  // --- alerts view mirrors it ----------------------------------------------
  await page.goto('/#/alerts');
  const alertsWasteCard = page.locator('div').filter({
    has: page.getByRole('heading', { name: 'Overstocked — May Go To Waste' }),
  });
  await expect(alertsWasteCard.first()).toBeVisible();
  await expect(alertsWasteCard.first()).toContainText(OVERSTOCKED_ITEM.name);
});
