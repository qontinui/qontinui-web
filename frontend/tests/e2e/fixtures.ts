/**
 * Custom Playwright fixtures for integration testing
 */

import { test as base, Page } from '@playwright/test';

// Define custom fixture types
type IntegrationTestFixtures = {
  authenticatedPage: Page;
  mockSnapshotData: any;
  pageWithMockSnapshots: Page;
};

/**
 * Create mock snapshot data for testing
 */
function createMockSnapshots() {
  return {
    runs: [
      {
        run_id: 'test-run-1',
        run_name: 'Login Flow Test',
        timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        num_screenshots: 8,
        num_patterns: 12,
        states: ['login', 'dashboard'],
        created_at: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        run_id: 'test-run-2',
        run_name: 'Settings Navigation Test',
        timestamp: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
        num_screenshots: 6,
        num_patterns: 10,
        states: ['settings', 'profile'],
        created_at: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        run_id: 'test-run-3',
        run_name: 'Complete Workflow Test',
        timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        num_screenshots: 10,
        num_patterns: 15,
        states: ['login', 'dashboard', 'settings'],
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
    total: 3,
    limit: 50,
    offset: 0,
  };
}

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
    const mockData = createMockSnapshots();
    await use(mockData);
  },

  /**
   * Page with mock snapshots API
   * Automatically mocks /api/snapshots endpoint before each test
   */
  pageWithMockSnapshots: async ({ page }, use) => {
    const mockSnapshots = createMockSnapshots();

    // Mock the snapshots list endpoint
    await page.route('**/api/snapshots*', async (route) => {
      const url = new URL(route.request().url());
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockSnapshots,
          limit,
          offset,
        }),
      });
    });

    // Mock individual snapshot detail endpoint
    await page.route('**/api/snapshots/test-run-*', async (route) => {
      const runId = route.request().url().split('/').pop();
      const snapshot = mockSnapshots.runs.find((r) => r.run_id === runId);

      if (snapshot) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(snapshot),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Snapshot not found' }),
        });
      }
    });

    await use(page);
  },
});

export { expect } from '@playwright/test';
