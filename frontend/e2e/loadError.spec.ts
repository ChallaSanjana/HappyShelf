import { test, expect, Page } from '@playwright/test';

/**
 * The load-failure banners and their Retry buttons.
 *
 * These paths only appear when a fetch fails for a reason other than an
 * expired session, which is exactly the case that never occurs in a normal
 * run — so the failure is injected by aborting the request at the network
 * layer, then lifted to prove Retry genuinely recovers.
 *
 * Before this handling existed, each of these rendered as an empty screen
 * indistinguishable from having no data at all.
 */

/**
 * A fresh account per test. A single shared address would be rejected as
 * already registered by the second test, leaving it stuck on the register
 * form rather than testing anything.
 */
function newAccount() {
  return {
    name: 'Retry Tester',
    email: `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'retry-password-123',
  };
}

async function register(page: Page, account: ReturnType<typeof newAccount>) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  await expect(page.getByRole('heading', { name: /Create Account/i })).toBeVisible();
  await page.locator('#register-full-name').fill(account.name);
  await page.locator('#register-email').fill(account.email);
  await page.locator('#register-password').fill(account.password);
  await page.getByRole('button', { name: /^Create Account$|^Creating/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();
}

test('inventory load failure shows a banner, and Retry recovers', async ({ page }) => {
  await register(page, newAccount());

  // Fail only the item list. A 500 rather than an abort, so this exercises a
  // server error rather than a dropped connection — and specifically not a
  // 401, which would end the session instead of showing a banner.
  let failing = true;
  await page.route('**/api/inventory/items*', async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected failure' }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/#/dashboard');
  await page.reload();

  const banner = page.getByRole('alert').filter({ hasText: 'Could not load your inventory' });
  await expect(banner).toBeVisible();
  // The underlying reason is surfaced, not just a generic message.
  await expect(banner).toContainText(/Injected failure|failed/i);

  // Still signed in: a 500 must not be mistaken for an expired session.
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  // --- lift the failure and retry --------------------------------------
  failing = false;
  await banner.getByRole('button', { name: /Retry/i }).click();

  await expect(banner).toHaveCount(0);
});

test('team load failure shows its own banner, and Retry recovers', async ({ page }) => {
  const account = newAccount();
  await register(page, account);

  let failing = true;
  await page.route('**/api/team', async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected team failure' }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/#/team');

  const banner = page.getByRole('alert').filter({ hasText: 'Could not load your team members' });
  await expect(banner).toBeVisible();

  failing = false;
  await banner.getByRole('button', { name: /Retry/i }).click();

  await expect(banner).toHaveCount(0);
  // Recovery is real: the household's own Admin row comes back.
  await expect(page.getByText(account.email)).toBeVisible();
});

test('action plan load failure shows its own banner, and Retry recovers', async ({ page }) => {
  await register(page, newAccount());

  let failing = true;
  await page.route('**/api/action-plans', async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected plans failure' }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/#/sustainability');

  const banner = page.getByRole('alert').filter({ hasText: 'Could not load your action plans' });
  await expect(banner).toBeVisible();

  failing = false;
  await banner.getByRole('button', { name: /Retry/i }).click();

  await expect(banner).toHaveCount(0);
});
