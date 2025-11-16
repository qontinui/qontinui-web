/**
 * Custom Playwright fixtures for integration testing
 */

import { test as base, Page } from '@playwright/test';

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
   * Automatically logs in before each test
   */
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login page
    await page.goto('/login');

    // Perform login (adjust selectors based on your app)
    // This is a placeholder - update with actual login flow
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'testpassword');
    await page.click('button[type="submit"]');

    // Wait for navigation to complete
    await page.waitForURL('**/dashboard', { timeout: 5000 }).catch(() => {
      // If no redirect, assume we're already on the right page
    });

    await use(page);
  },
});

export { expect } from '@playwright/test';
