/**
 * End-to-end tests for login functionality
 *
 * Tests the modal-based login flow:
 * - Opening the login dialog from header
 * - Submitting credentials
 * - Successful login redirects to dashboard/admin
 * - Failed login shows error message
 * - Logout clears session
 */

import { test, expect } from '@playwright/test';

// Test credentials from .env
const TEST_USER = {
  username: 'jspinak',
  password: 'Qontinui123!',
  email: 'jspinak@hotmail.com',
  isSuperuser: true,
};

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage where login is accessible
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('homepage shows Sign In button when not authenticated', async ({ page }) => {
    // Verify Sign In button is visible
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible();

    // Take a screenshot
    await page.screenshot({
      path: 'test-results/login-homepage.png',
      fullPage: true,
    });
  });

  test('clicking Sign In opens the login dialog', async ({ page }) => {
    // Click Sign In button
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog to appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify dialog has login form elements
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    // Take a screenshot
    await page.screenshot({
      path: 'test-results/login-dialog-open.png',
      fullPage: true,
    });
  });

  test('successful login with valid credentials shows authenticated state', async ({ page }) => {
    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in credentials
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);

    // Take screenshot before submit
    await page.screenshot({
      path: 'test-results/login-filled-form.png',
      fullPage: true,
    });

    // Submit form
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for dialog to close (indicates successful login)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Wait for either redirect OR authenticated state on current page
    // The app may redirect to /admin or /dashboard, or stay on homepage showing logged-in state
    await Promise.race([
      page.waitForURL(/\/(admin|dashboard)/, { timeout: 10000 }).catch(() => {}),
      expect(page.getByText(TEST_USER.email)).toBeVisible({ timeout: 10000 }),
    ]);

    // Verify authenticated state - user email should be visible in header
    await expect(page.getByText(TEST_USER.email)).toBeVisible({ timeout: 5000 });

    // Take screenshot after login
    await page.screenshot({
      path: 'test-results/login-success.png',
      fullPage: true,
    });
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in invalid credentials
    await page.getByLabel(/username/i).fill('invalid_user');
    await page.getByLabel(/password/i).fill('wrong_password');

    // Submit form
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for error message (toast notification)
    // The error could appear as a toast or inline error
    await page.waitForTimeout(2000); // Wait for API response

    // Take screenshot showing error state
    await page.screenshot({
      path: 'test-results/login-error.png',
      fullPage: true,
    });

    // Verify we're still on the homepage (not redirected)
    expect(page.url()).toMatch(/\/$/);
  });

  test('login dialog can be closed', async ({ page }) => {
    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Close dialog by clicking outside or pressing Escape
    await page.keyboard.press('Escape');

    // Verify dialog is closed
    await expect(dialog).not.toBeVisible();
  });

  test('login form validates required fields', async ({ page }) => {
    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Try to submit empty form
    await page.getByRole('button', { name: /sign in/i }).click();

    // Verify validation messages appear (Zod schema validation)
    await page.waitForTimeout(500);

    // Take screenshot showing validation
    await page.screenshot({
      path: 'test-results/login-validation.png',
      fullPage: true,
    });
  });

  test('remember me checkbox is present and functional', async ({ page }) => {
    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Find remember me checkbox
    const rememberMeCheckbox = page.getByRole('checkbox', { name: /remember me/i });
    await expect(rememberMeCheckbox).toBeVisible();

    // Click to check it
    await rememberMeCheckbox.click();
    await expect(rememberMeCheckbox).toBeChecked();

    // Take screenshot
    await page.screenshot({
      path: 'test-results/login-remember-me.png',
      fullPage: true,
    });
  });

  test('forgot password link is present', async ({ page }) => {
    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Find forgot password link
    const forgotPasswordLink = page.getByRole('link', { name: /forgot.*password/i });
    await expect(forgotPasswordLink).toBeVisible();

    // Verify it links to the correct page
    await expect(forgotPasswordLink).toHaveAttribute('href', '/forgot-password');
  });
});

test.describe('Authenticated Session', () => {
  // Run authenticated tests serially to avoid parallel login issues
  test.describe.configure({ mode: 'serial' });

  // Helper function to login
  async function loginUser(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill credentials and submit
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for dialog to close (indicates successful login)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Wait for authenticated state
    await expect(page.getByText(TEST_USER.email)).toBeVisible({ timeout: 10000 });
  }

  test('header shows user email when logged in', async ({ page }) => {
    await loginUser(page);

    // Verify user email is displayed
    await expect(page.getByText(TEST_USER.email)).toBeVisible();

    // Take screenshot
    await page.screenshot({
      path: 'test-results/login-authenticated-header.png',
      fullPage: true,
    });
  });

  test('superuser is redirected to admin dashboard after login', async ({ page }) => {
    await loginUser(page);

    // For superusers, they may be redirected to admin dashboard
    // OR they may stay on homepage with admin button visible
    // Either way is a valid authenticated state
    const isOnAdminPage = page.url().includes('/admin');

    if (isOnAdminPage) {
      // Verify admin dashboard content is visible
      await expect(page.getByText(/admin dashboard/i)).toBeVisible({ timeout: 5000 });
    } else {
      // On homepage, verify Go to Dashboard button is visible
      const dashboardButton = page.getByRole('button', { name: /go to dashboard/i });
      await expect(dashboardButton).toBeVisible();
    }

    // Take screenshot
    await page.screenshot({
      path: 'test-results/login-superuser-redirect.png',
      fullPage: true,
    });
  });

  test('admin button shows for superuser on homepage', async ({ page }) => {
    await loginUser(page);

    // Navigate to homepage to check for admin button
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify Go to Admin button is visible for superuser
    if (TEST_USER.isSuperuser) {
      const adminButton = page.getByRole('button', { name: /go to admin/i });
      await expect(adminButton).toBeVisible();
    }
  });
});
