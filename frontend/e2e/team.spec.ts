import { test, expect, Page } from '@playwright/test';

/**
 * Team management: add a member, change their role, and remove them.
 *
 * These flows carry the app's access control, so a regression here is a
 * security problem rather than a cosmetic one. The backend rules are unit
 * tested; this covers the UI actually reaching them.
 *
 * Deactivation is deliberately absent. The backend supports it, the row
 * renders a "Deactivated" badge, and the last-Admin safeguard protects it —
 * but no control in the UI can trigger it, so there is nothing to drive.
 */

const admin = {
  name: 'Team Admin',
  email: `team-admin-${Date.now()}@example.com`,
  password: 'admin-password-123',
};

const member = {
  name: 'Staff Member',
  email: `staff-${Date.now()}@example.com`,
  password: 'staff-password-123',
};

async function registerAdmin(page: Page) {
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

test('team management: add a member, change their role, remove them', async ({ page }) => {
  await registerAdmin(page);

  await page.goto('/#/team');
  await expect(page.getByRole('heading', { name: /^Team$/ })).toBeVisible();

  // The registering account is the household's first Admin.
  await expect(page.getByText(admin.email)).toContainText('Admin');

  // --- add a Staff member ----------------------------------------------
  await page.getByPlaceholder('Full name').fill(member.name);
  await page.getByPlaceholder('Email address').fill(member.email);
  await page.getByPlaceholder(/Password \(min 8 chars\)/).fill(member.password);
  await page.getByRole('button', { name: 'Add Member' }).click();

  await expect(page.getByText(member.email)).toBeVisible();

  // --- change their role to Manager ------------------------------------
  // Scope to the div holding BOTH the member's email and a role select.
  // Filtering on the text alone resolves to the innermost element containing
  // it, which is the name/email line and holds no controls.
  const memberRow = () =>
    page
      .locator('div')
      .filter({ hasText: member.email })
      .filter({ has: page.getByRole('combobox') })
      .last();

  await memberRow().getByRole('combobox').selectOption('Manager');

  // Re-read after the refetch rather than trusting the optimistic value.
  await expect(memberRow().getByRole('combobox')).toHaveValue('Manager');

  // --- the sole Admin cannot be removed --------------------------------
  // The safeguard is enforced server-side; the UI withholds the control
  // rather than letting the user hit a 403. With two members on the team
  // exactly one Remove button exists, and it belongs to the member -- the
  // sole Admin's own row offers only "Edit profile".
  //
  // Note the "Last Admin" badge is NOT the signal here: it renders only for
  // *other* admins (`!isSelf`), never on your own row.
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(1);
  await expect(memberRow().getByRole('button', { name: 'Remove' })).toBeVisible();

  // --- remove the member -----------------------------------------------
  page.once('dialog', (dialog) => dialog.accept());
  await memberRow().getByRole('button', { name: 'Remove' }).click();

  await expect(page.getByText(member.email)).toHaveCount(0);
});
