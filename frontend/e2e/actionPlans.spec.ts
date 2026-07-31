import { test, expect, Page } from '@playwright/test';

/**
 * Action plans: generate a checklist from current stock, tick a task off,
 * and delete the plan.
 *
 * A plan is only generated when something actually needs attention, so the
 * test first creates an item that is already low on stock — otherwise the
 * endpoint correctly refuses with "Nothing to add right now".
 */

const account = {
  name: 'Plans Tester',
  email: `plans-${Date.now()}@example.com`,
  password: 'plans-password-123',
};

const LOW_ITEM = {
  name: `E2E Low Milk ${Date.now()}`,
  category: 'Dairy',
  unit: 'L',
  // 2 units against 5/day is well under the 3-day low-stock threshold.
  quantity: '2',
  dailyUsage: '5',
  expiry: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
};

async function registerAndAddLowStockItem(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  await expect(page.getByRole('heading', { name: /Create Account/i })).toBeVisible();
  await page.locator('#register-full-name').fill(account.name);
  await page.locator('#register-email').fill(account.email);
  await page.locator('#register-password').fill(account.password);
  await page.getByRole('button', { name: /^Create Account$|^Creating/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Add Item' }).first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await modal.locator('#item-item-name').fill(LOW_ITEM.name);
  await modal.locator('#item-category').selectOption(LOW_ITEM.category);
  await modal.locator('#item-unit').selectOption(LOW_ITEM.unit);
  await modal.locator('#item-quantity').fill(LOW_ITEM.quantity);
  await modal.locator('#item-daily-usage').fill(LOW_ITEM.dailyUsage);
  await modal.locator('#item-expiry-date').fill(LOW_ITEM.expiry);
  await modal.getByRole('button', { name: /^Save$|^Saving/i }).click();
  await expect(modal).toBeHidden();
}

test('action plans: generate from low stock, tick a task, delete the plan', async ({ page }) => {
  await registerAndAddLowStockItem(page);

  await page.goto('/#/sustainability');

  // --- generate ---------------------------------------------------------
  await page.getByRole('button', { name: /Create Action Plan|Creating/i }).click();

  // Tasks are built server-side from live inventory, so the low-stock item
  // must appear by name in the generated checklist.
  await expect(page.getByText(LOW_ITEM.name).first()).toBeVisible();

  const checkbox = page.getByRole('checkbox').first();
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  // --- tick a task off --------------------------------------------------
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // The toggle is persisted, not just local state: reloading must keep it.
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked();

  // --- delete the plan --------------------------------------------------
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Delete$/ }).first().click();

  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
