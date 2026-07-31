import { test, expect, Page } from '@playwright/test';

/**
 * One ordered pass through the critical path:
 * register/login -> add item -> consume -> reorder -> search/filter -> report.
 *
 * Deliberately a single journey rather than independent tests: the backend
 * runs on an in-memory store, so state has to accumulate in order. Splitting
 * it would either need re-registration per test or shared mutable state
 * between them.
 */

/** 90 days out, as YYYY-MM-DD for the date input. */
const EXPIRY = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ITEM = {
  name: `E2E Basmati Rice ${Date.now()}`,
  category: 'Food',
  unit: 'kg',
  quantity: '40',
  dailyUsage: '2',
  // Required for every category except Cleaning / Personal Care. Omitting it
  // leaves the browser blocking submit on the empty required field, which
  // looks exactly like the Save button doing nothing.
  expiry: EXPIRY,
};

const account = {
  name: 'E2E Tester',
  email: `e2e-${Date.now()}@example.com`,
  password: 'e2e-password-123',
};

/**
 * Registration also signs you in, which is how a first Admin is created.
 *
 * Each transition is awaited explicitly. The app renders a loading state
 * first, and the auth screen swaps between Login and Register purely in
 * component state with no navigation, so there is no implicit signal for
 * Playwright to wait on — without these the toggle click can land before
 * React has the form mounted and is silently lost.
 */
async function register(page: Page) {
  await page.goto('/');

  // Login is the default screen; wait for it before touching anything.
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();

  await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  await expect(page.getByRole('heading', { name: /Create Account/i })).toBeVisible();

  await page.locator('#register-full-name').fill(account.name);
  await page.locator('#register-email').fill(account.email);
  await page.locator('#register-password').fill(account.password);
  await page.getByRole('button', { name: /^Create Account$|^Creating/i }).click();
}

test.describe.configure({ mode: 'serial' });

test('critical path: register, add, consume, reorder, search, report', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // --- register + land on the dashboard --------------------------------
  await register(page);
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  // The inventory-load error banner must not be showing: reaching the
  // dashboard means the first fetch succeeded.
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load' })).toHaveCount(0);

  // --- log out and back in, to cover the login form ---------------------
  await page.getByRole('button', { name: /Logout|Sign out/i }).click();
  // App keeps which auth form to show in component state, and registering
  // above left it on the Register form. Reloading resets that to Login and
  // also proves the session was genuinely cleared, not just hidden.
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: /^Sign In$/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  // --- add an item ------------------------------------------------------
  await page.getByRole('button', { name: 'Add Item' }).first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();

  await modal.locator('#item-item-name').fill(ITEM.name);
  await modal.locator('#item-category').selectOption(ITEM.category);
  await modal.locator('#item-unit').selectOption(ITEM.unit);
  await modal.locator('#item-quantity').fill(ITEM.quantity);
  await modal.locator('#item-daily-usage').fill(ITEM.dailyUsage);
  await modal.locator('#item-expiry-date').fill(ITEM.expiry);
  await modal.getByRole('button', { name: /^Save$|^Saving/i }).click();
  await expect(modal).toBeHidden();

  // --- it shows up in the inventory ------------------------------------
  await page.goto('/#/inventory');
  const row = page.getByRole('row').filter({ hasText: ITEM.name });
  await expect(row).toBeVisible();

  // --- consume: 40 - 5 = 35 --------------------------------------------
  await page.getByRole('button', { name: `Consume ${ITEM.name}` }).click();
  const consumeModal = page.getByRole('dialog');
  await expect(consumeModal).toBeVisible();
  await consumeModal.getByRole('spinbutton').fill('5');
  await consumeModal.getByRole('button', { name: /Confirm Consume|Consuming/i }).click();
  await expect(consumeModal).toBeHidden();
  await expect(row).toContainText('35');

  // --- reorder: 35 + 10 = 45 -------------------------------------------
  await page.getByRole('button', { name: `Reorder ${ITEM.name}` }).click();
  const reorderModal = page.getByRole('dialog');
  await expect(reorderModal).toBeVisible();
  await reorderModal.getByRole('spinbutton').fill('10');
  await reorderModal.getByRole('button', { name: /Confirm Reorder|Reordering/i }).click();
  await expect(reorderModal).toBeHidden();
  await expect(row).toContainText('45');

  // --- search finds it, and a miss filters it out ----------------------
  const search = page.getByPlaceholder(/Search by name, category/i);
  await search.fill('Basmati');
  await expect(row).toBeVisible();

  await search.fill('definitely-no-such-item-xyz');
  await expect(page.getByRole('row').filter({ hasText: ITEM.name })).toHaveCount(0);

  await search.fill('');
  await expect(row).toBeVisible();

  // --- generate the PDF report -----------------------------------------
  await page.goto('/#/dashboard');
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: /Download Inventory Report/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  // Nothing above should have produced an uncaught error. Failed requests to
  // the absent ML service are expected and handled, so they are excluded.
  const unexpected = consoleErrors.filter(
    (e) => !/ML Service|predictions|favicon|Failed to load resource/i.test(e)
  );
  expect(unexpected, `unexpected console errors:\n${unexpected.join('\n')}`).toHaveLength(0);
});
