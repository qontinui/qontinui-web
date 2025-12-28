/**
 * End-to-end test for states dropdown in Create Outgoing Transition dialog
 *
 * Tests that states are properly loaded in the outgoing transition builder:
 * - Bug: States dropdown shows empty when navigating directly to the states page
 * - Root cause: useProjectLoader skips backend fetch if projectId matches, even with no data
 * - Fix: Only skip backend fetch if actual data exists in context
 */

import { test, expect } from '@playwright/test';
import { loginUser } from './fixtures';

test.describe('Outgoing Transition States Dropdown', () => {
  // Increase timeout for login-heavy tests
  test.setTimeout(90000);

  // Use slower navigation timeout for CI/WSL environments
  test.use({ navigationTimeout: 60000 });

  // Login before each test using auto-login with manual fallback
  test.beforeEach(async ({ page }) => {
    await loginUser(page);
  });

  test('states appear in Create Outgoing Transition dropdown', async ({ page }) => {
    // Navigate to dashboard first
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Select a project with states
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (!(await projectSwitcher.isVisible())) {
      console.log('No project switcher visible - skipping test');
      test.skip();
      return;
    }

    await projectSwitcher.click();
    await page.waitForTimeout(500);

    const projectItems = page.locator('[role="menuitem"]');
    const projectCount = await projectItems.count();

    if (projectCount < 2) {
      console.log('No projects available - skipping test');
      test.skip();
      return;
    }

    // Select the first project (should have states based on the bug report)
    await projectItems.first().click();
    await page.waitForTimeout(1000);

    // Get the project ID from URL
    const url = page.url();
    console.log('URL after project selection:', url);

    // Extract project ID from URL
    const urlMatch = url.match(/[?&]project=([^&]+)/);
    const projectId = urlMatch ? urlMatch[1] : null;
    console.log('Project ID:', projectId);

    if (!projectId) {
      console.log('No project ID in URL - skipping test');
      test.skip();
      return;
    }

    // Navigate directly to the states page with project ID
    // This simulates navigating directly to the page (the bug scenario)
    await page.goto(`/automation-builder/states?project=${projectId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/outgoing-transition-01-states-page.png',
      fullPage: true,
    });

    // Click the "Create Outgoing Transition" button
    const createTransitionButton = page.getByRole('button', { name: /create outgoing transition/i });

    if (await createTransitionButton.isVisible()) {
      await createTransitionButton.click();
      await page.waitForTimeout(1000);

      // Take screenshot of the dialog
      await page.screenshot({
        path: 'test-results/outgoing-transition-02-dialog.png',
        fullPage: true,
      });

      // Look for the "Select origin state" dropdown
      const originStateSelect = page.getByRole('combobox').first();
      if (await originStateSelect.isVisible()) {
        await originStateSelect.click();
        await page.waitForTimeout(500);

        // Take screenshot showing dropdown contents
        await page.screenshot({
          path: 'test-results/outgoing-transition-03-dropdown-open.png',
          fullPage: true,
        });

        // Count the state options in the dropdown
        const stateOptions = page.locator('[role="option"]');
        const stateCount = await stateOptions.count();
        console.log('State options count:', stateCount);

        // Verify there are states in the dropdown (based on bug report, should be 2)
        expect(stateCount).toBeGreaterThan(0);
      } else {
        console.log('Origin state select not found');
        await page.screenshot({
          path: 'test-results/outgoing-transition-03-no-select.png',
          fullPage: true,
        });
      }

      // Close the dialog
      const cancelButton = page.getByRole('button', { name: /cancel/i });
      if (await cancelButton.isVisible()) {
        await cancelButton.click();
      }
    } else {
      console.log('Create Outgoing Transition button not visible');
      await page.screenshot({
        path: 'test-results/outgoing-transition-02-no-button.png',
        fullPage: true,
      });
    }
  });

  test('states load correctly from backend when navigating directly to states page', async ({ page }) => {
    // Clear localStorage to simulate fresh navigation
    // Note: beforeEach already logged in via loginUser()
    await page.evaluate(() => {
      localStorage.removeItem('qontinui-selected-project-id');
      localStorage.removeItem('qontinui-project-name');
    });

    // Navigate to dashboard to get project ID
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Select a project
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (!(await projectSwitcher.isVisible())) {
      test.skip();
      return;
    }

    await projectSwitcher.click();
    await page.waitForTimeout(500);

    const projectItems = page.locator('[role="menuitem"]');
    const projectCount = await projectItems.count();

    if (projectCount < 2) {
      test.skip();
      return;
    }

    await projectItems.first().click();
    await page.waitForTimeout(1000);

    const url = page.url();
    const urlMatch = url.match(/[?&]project=([^&]+)/);
    const projectId = urlMatch ? urlMatch[1] : null;

    if (!projectId) {
      test.skip();
      return;
    }

    // Clear localStorage again to simulate complete fresh state
    await page.evaluate(() => {
      localStorage.removeItem('qontinui-selected-project-id');
      localStorage.removeItem('qontinui-project-name');
    });

    // Navigate directly to states page - this is the key scenario
    // When localStorage is clear but URL has project ID, it should still load data
    await page.goto(`/automation-builder/states?project=${projectId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000); // Give time for backend fetch

    // Take screenshot
    await page.screenshot({
      path: 'test-results/outgoing-transition-fresh-01-states-page.png',
      fullPage: true,
    });

    // Click Create Outgoing Transition
    const createTransitionButton = page.getByRole('button', { name: /create outgoing transition/i });

    if (await createTransitionButton.isVisible()) {
      await createTransitionButton.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: 'test-results/outgoing-transition-fresh-02-dialog.png',
        fullPage: true,
      });

      // Look for states in the dropdown
      const originStateSelect = page.getByRole('combobox').first();
      if (await originStateSelect.isVisible()) {
        await originStateSelect.click();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: 'test-results/outgoing-transition-fresh-03-dropdown.png',
          fullPage: true,
        });

        const stateOptions = page.locator('[role="option"]');
        const stateCount = await stateOptions.count();
        console.log('Fresh load - state options count:', stateCount);

        // This should now pass with the fix
        expect(stateCount).toBeGreaterThan(0);
      }
    }
  });
});
