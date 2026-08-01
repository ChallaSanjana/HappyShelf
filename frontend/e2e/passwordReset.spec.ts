import { test, expect, Page } from '@playwright/test';
import crypto from 'crypto';

/**
 * Forgot/reset password, driven through the real UI against the real E2E
 * backend.
 *
 * The one thing a browser genuinely cannot do here is read the emailed
 * link — the raw token is deliberately never logged or returned by any
 * endpoint (see PasswordResetToken.js: only its hash is ever persisted).
 * The E2E backend runs under NODE_ENV=test-e2e specifically so
 * authController.js can make token *generation* deterministic there and
 * nowhere else — production, ordinary development, and the unit-test
 * harness (NODE_ENV=test, a different value) are unaffected and keep using
 * real randomness. Storage is identical in every mode: only the hash.
 * `expectedRawToken` below recomputes the exact same value independently.
 */
function expectedRawToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto.createHash('sha256').update(`e2e-fixed-reset-token:${normalized}`).digest('hex');
}

function newAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: 'Reset Flow Tester',
    email: `reset-flow-${stamp}@example.com`,
    password: 'OriginalPassw0rd',
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

test('the full journey: forgot password from login, reset, sign in with the new password', async ({ page }) => {
  const account = newAccount();
  await register(page, account);

  // --- log out, land back on the login screen ----------------------------
  await page.getByRole('button', { name: /Logout|Sign out/i }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();

  // --- "Forgot your password?" -------------------------------------------
  await page.getByRole('button', { name: /Forgot your password/i }).click();
  await expect(page.getByRole('heading', { name: /Reset your password/i })).toBeVisible();

  await page.locator('#forgot-email').fill(account.email);
  await page.getByRole('button', { name: /Send reset link/i }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();

  // --- follow the link the email would have contained ---------------------
  const token = expectedRawToken(account.email);
  await page.goto(`/#/reset-password?token=${token}`);
  await expect(page.getByRole('heading', { name: /Choose a new password/i })).toBeVisible();
  // Missing-token warning must NOT show once a real token is present.
  await expect(page.getByText(/missing its reset token/i)).toHaveCount(0);

  const newPassword = 'BrandNewPassw0rd1';
  await page.locator('#reset-password').fill(newPassword);
  await page.locator('#reset-confirm-password').fill(newPassword);
  await page.getByRole('button', { name: /Update password/i }).click();

  await expect(page.getByText(/Password updated/i)).toBeVisible();
  await page.getByRole('button', { name: /Go to sign in/i }).click();

  // --- sign in with the new password --------------------------------------
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(newPassword);
  await page.getByRole('button', { name: /^Sign In$/i }).click();
  await expect(page.getByRole('button', { name: 'Add Item' }).first()).toBeVisible();

  // --- the old password no longer works ------------------------------------
  await page.getByRole('button', { name: /Logout|Sign out/i }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: /^Sign In$/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Item' })).toHaveCount(0);
});

test('a used reset link cannot be used again', async ({ page }) => {
  const account = newAccount();
  await register(page, account);
  await page.getByRole('button', { name: /Logout|Sign out/i }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();

  // The token only exists server-side once a reset is actually requested —
  // computing its expected value client-side does not create it.
  await page.getByRole('button', { name: /Forgot your password/i }).click();
  await page.locator('#forgot-email').fill(account.email);
  await page.getByRole('button', { name: /Send reset link/i }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();

  const token = expectedRawToken(account.email);

  // Spend the token once.
  await page.goto(`/#/reset-password?token=${token}`);
  await page.locator('#reset-password').fill('FirstNewPassw0rd1');
  await page.locator('#reset-confirm-password').fill('FirstNewPassw0rd1');
  await page.getByRole('button', { name: /Update password/i }).click();
  await expect(page.getByText(/Password updated/i)).toBeVisible();

  // The exact same link, used again. A real second click of an emailed link
  // opens a fresh page load; page.goto() to a URL differing only by hash
  // does not (browsers treat that as same-document navigation), so without
  // an explicit reload the still-mounted ResetPassword keeps showing the
  // first attempt's success state rather than genuinely submitting again —
  // the same reason smoke.spec.ts reloads after logout, to prove a state
  // change is real rather than an artifact of the SPA staying mounted.
  await page.goto(`/#/reset-password?token=${token}`);
  await page.reload();
  await page.locator('#reset-password').fill('SecondNewPassw0rd1');
  await page.locator('#reset-confirm-password').fill('SecondNewPassw0rd1');
  await page.getByRole('button', { name: /Update password/i }).click();

  await expect(page.getByRole('alert')).toContainText(/invalid or has expired/i);
});

test('a reset link with no token explains itself rather than showing a broken form', async ({ page }) => {
  await page.goto('/#/reset-password');
  await expect(page.getByText(/missing its reset token/i)).toBeVisible();
  await expect(page.locator('#reset-password')).toBeDisabled();
});
