/**
 * Custom Playwright fixtures for integration testing
 */

import { test as base, Page, expect as baseExpect } from '@playwright/test';
import { TEST_USER } from './test-credentials';

// Define custom fixture types
type IntegrationTestFixtures = {
  authenticatedPage: Page;
};

/**
 * Extended test with custom fixtures
 */
export const test = base.extend<IntegrationTestFixtures>({
  /**
   * Authenticated page fixture
   * Automatically logs in before each test using centralized credentials
   */
  authenticatedPage: async ({ page }, use) => {
    // Navigate to homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open login dialog
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog and fill credentials
    const dialog = page.getByRole('dialog');
    await baseExpect(dialog).toBeVisible();

    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for login to complete (dialog closes)
    await baseExpect(dialog).not.toBeVisible({ timeout: 15000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';
