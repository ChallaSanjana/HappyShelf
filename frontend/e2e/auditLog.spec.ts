import { test, expect, Page } from '@playwright/test';

/**
 * The audit log: an Admin can see who did what, and nobody else can even
 * find the page. The 403 itself is a backend concern already covered by
 * rbac.test.js; what only an E2E run can confirm is that the sidebar
 * genuinely hides the link for a non-Admin rather than just relying on the
 * server to refuse it.
 */

/** 90 days out, as YYYY-MM-DD — Food requires an expiry date to submit. */
const EXPIRY = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * A fresh account per test. All three tests share one backend process (the
 * in-memory store is not reset between tests in a spec file), so a single
 * shared email would make the second registerAdmin() call fail with
 * "Email already registered" and leave the caller stuck off the dashboard.
 */
function newAdmin() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: 'Audit Admin',
    email: `audit-admin-${stamp}@example.com`,
    password: 'audit-admin-password-1',
  };
}

async function registerAdmin(page: Page, admin: ReturnType<typeof newAdmin>) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.getByRole('button', { name: /Don't have an account\? Register/i }).click();
  await expect(page.getByRole('heading', { name: /Create Account/i })).toBeVisible();
  await page.locator('#register-full-name').fill(admin.name);
  await page.locator('#register-email').fill(admin.email);
  await page.locator('#register-password').fill(admin.password);
  await page.getByRole('button', { name: /^Create Account$|^Creating/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();
}

test('an Admin sees registration and item creation in the audit log', async ({ page }) => {
  const admin = newAdmin();
  await registerAdmin(page, admin);

  const itemName = `E2E Audited Flour ${Date.now()}`;
  await page.getByRole('button', { name: 'Add Item' }).first().click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await modal.locator('#item-item-name').fill(itemName);
  await modal.locator('#item-category').selectOption('Food');
  await modal.locator('#item-unit').selectOption('kg');
  await modal.locator('#item-quantity').fill('10');
  await modal.locator('#item-daily-usage').fill('1');
  await modal.locator('#item-expiry-date').fill(EXPIRY);
  await modal.getByRole('button', { name: /^Save$|^Saving/i }).click();
  await expect(modal).toBeHidden();

  await page.goto('/#/auditLog');
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();

  const itemRow = page.getByRole('row').filter({ hasText: itemName });
  await expect(itemRow).toBeVisible();
  await expect(itemRow).toContainText('Item added');
  await expect(itemRow).toContainText(admin.name);

  const registrationRow = page.getByRole('row').filter({ hasText: 'Household registered' });
  await expect(registrationRow).toBeVisible();
  await expect(registrationRow).toContainText(admin.name);
});

test('the audit log is filterable by action', async ({ page }) => {
  const admin = newAdmin();
  await registerAdmin(page, admin);

  await page.goto('/#/auditLog');
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();

  await page.getByLabel('Filter by action').selectOption('item.created');

  // The registration entry is filtered out; only item-creation actions remain.
  await expect(page.getByRole('row').filter({ hasText: 'Household registered' })).toHaveCount(0);
});

test('a Staff member never sees the audit log link, and the API refuses them directly', async ({ page, request }) => {
  const admin = newAdmin();
  await registerAdmin(page, admin);

  const staff = {
    name: 'Just Staff',
    email: `audit-staff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'audit-staff-password-1',
  };

  await page.goto('/#/team');
  await page.getByPlaceholder('Full name').fill(staff.name);
  await page.getByPlaceholder('Email address').fill(staff.email);
  await page.getByPlaceholder(/Password \(min 8 chars\)/).fill(staff.password);
  await page.getByRole('button', { name: 'Add Member' }).click();
  await expect(page.getByText(staff.email)).toBeVisible();

  // Off the team view before logging out: the hash survives the reload, and
  // the Staff session that logs back in next would otherwise land straight
  // on a view with no "Add Item" button rather than the dashboard.
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: /Logout|Sign out/i }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.locator('#login-email').fill(staff.email);
  await page.locator('#login-password').fill(staff.password);
  await page.getByRole('button', { name: /^Sign In$/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  await expect(page.getByRole('menuitem', { name: 'Audit Log' })).toHaveCount(0);

  // Confirmed from this Staff session's own token, not just by reading the
  // backend's unit tests — the two must agree.
  const apiBase = process.env.VITE_API_URL || 'http://127.0.0.1:5178/api';
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const res = await request.get(`${apiBase}/audit-log`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(403);
});
