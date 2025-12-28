/**
 * E2E test for Connect Runner page
 * Tests that the connection string displays correctly when a project is selected
 */

import { test, expect } from '@playwright/test';
import { TEST_USER } from './test-credentials';

test.describe('Connect Runner Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login flow
    await page.goto('/');

    // Click Sign In button to open auth dialog
    await page.click('button:has-text("Sign In")');

    // Wait for dialog to appear
    await page.waitForSelector('[role="dialog"]');

    // Fill login form
    await page.fill('#login-username', TEST_USER.username);
    await page.fill('#login-password', TEST_USER.password);

    // Submit login
    await page.click('button[type="submit"]:has-text("Sign In")');

    // Wait for redirect after login (dashboard for normal users, admin for superusers)
    await page.waitForURL(/\/(dashboard|admin)/, { timeout: 10000 });
  });

  test('displays connection string when project is selected', async ({ page }) => {
    // Navigate to connect-runner page
    await page.goto('/connect-runner');

    // Wait for the page to load (loading spinner should disappear)
    await page.waitForSelector('text=Select Project', { timeout: 10000 });

    // Verify page title
    await expect(page.locator('h2:has-text("Connect Desktop Runner")')).toBeVisible();

    // Find the project dropdown and select "civ"
    const projectSelect = page.locator('select').filter({ hasText: 'Select a project' });
    await expect(projectSelect).toBeVisible();

    // Select the "civ" project
    await projectSelect.selectOption({ label: 'civ' });

    // Wait for the connection string to appear
    const connectionStringPre = page.locator('pre code');
    await expect(connectionStringPre).toBeVisible();

    // Get the connection string text
    const connectionString = await connectionStringPre.textContent();

    // Verify the connection string is valid JSON
    expect(connectionString).toBeTruthy();
    const parsed = JSON.parse(connectionString!);

    // Verify required fields are present
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('url');
    expect(parsed).toHaveProperty('token');
    expect(parsed).toHaveProperty('userId');
    expect(parsed).toHaveProperty('projectId');
    expect(parsed).toHaveProperty('backendUrl');

    // Verify projectId is set (not null)
    expect(parsed.projectId).toBeTruthy();

    // Verify Copy button is enabled when project is selected
    const copyButton = page.locator('button:has-text("Copy Connection String")');
    await expect(copyButton).toBeEnabled();

    // Verify Download button is enabled
    const downloadButton = page.locator('button:has-text("Download")');
    await expect(downloadButton).toBeEnabled();

    // Verify QR code is displayed
    const qrCode = page.locator('svg').filter({ has: page.locator('rect') });
    await expect(qrCode.first()).toBeVisible();
  });

  test('shows warning when no project is selected', async ({ page }) => {
    await page.goto('/connect-runner');

    // Wait for page to load
    await page.waitForSelector('text=Select Project', { timeout: 10000 });

    // Verify warning message is shown
    await expect(page.locator('text=Please select a project to enable copy and download')).toBeVisible();

    // Verify Copy button is disabled
    const copyButton = page.locator('button:has-text("Copy Connection String")');
    await expect(copyButton).toBeDisabled();

    // Verify Download button is disabled
    const downloadButton = page.locator('button:has-text("Download")');
    await expect(downloadButton).toBeDisabled();
  });
});
