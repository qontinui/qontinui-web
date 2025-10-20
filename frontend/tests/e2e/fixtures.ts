/**
 * Custom Playwright fixtures for integration testing
 */

import { test as base } from '@playwright/test';

// Define custom fixture types
type IntegrationTestFixtures = {
  authenticatedPage: any;
  mockSnapshotData: any;
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

  /**
   * Mock snapshot data fixture
   * Provides test snapshot data for tests
   */
  mockSnapshotData: async ({}, use) => {
    const mockData = {
      run_id: 'test-run-123',
      run_name: 'Test Snapshot Run',
      screenshots: [
        {
          screenshot_path: 'screenshot_1.png',
          active_states: ['login'],
          timestamp: new Date().toISOString(),
          width: 1920,
          height: 1080,
          state_hash: 'hash_1',
        },
        {
          screenshot_path: 'screenshot_2.png',
          active_states: ['dashboard'],
          timestamp: new Date().toISOString(),
          width: 1920,
          height: 1080,
          state_hash: 'hash_2',
        },
      ],
      patterns: [],
      states: ['login', 'dashboard'],
    };

    await use(mockData);
  },
});

export { expect } from '@playwright/test';
