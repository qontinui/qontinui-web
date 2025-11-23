/**
 * End-to-end tests for software testing system
 *
 * Tests complete user flows using Playwright:
 * - View test run list
 * - Open test run details
 * - View deficiencies
 * - Filter and assign deficiencies
 * - Export reports
 */

import { test, expect } from '@playwright/test';

test.describe('Software Testing System E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Login or set up authentication
    await page.goto('/login');
    // Add authentication steps
  });

  test.describe('Test Runs List', () => {
    test('should display test runs list', async ({ page }) => {
      await page.goto('/testing/runs');

      // Verify page loaded
      await expect(page.locator('h1')).toContainText('Test Runs');

      // Verify table is visible
      await expect(page.locator('table')).toBeVisible();
    });

    test('should filter test runs by status', async ({ page }) => {
      await page.goto('/testing/runs');

      // Select filter
      await page.selectOption('select[name="status"]', 'completed');

      // Verify filtered results
      await page.waitForLoadState('networkidle');
      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
    });

    test('should search test runs by name', async ({ page }) => {
      await page.goto('/testing/runs');

      // Type in search box
      await page.fill('input[placeholder="Search test runs..."]', 'nightly');

      // Verify search results
      await page.waitForLoadState('networkidle');
      await expect(page.locator('tbody tr')).toBeVisible();
    });

    test('should navigate to test run details', async ({ page }) => {
      await page.goto('/testing/runs');

      // Click on first test run
      await page.locator('tbody tr').first().click();

      // Verify navigation to details page
      await expect(page).toHaveURL(/\/testing\/runs\/[a-f0-9-]+/);
      await expect(page.locator('h1')).toContainText('Test Run');
    });
  });

  test.describe('Test Run Details', () => {
    test('should display test run information', async ({ page }) => {
      // Navigate to a test run details page
      await page.goto('/testing/runs/test-run-id-123');

      // Verify run information is displayed
      await expect(page.locator('[data-testid="run-status"]')).toBeVisible();
      await expect(page.locator('[data-testid="run-coverage"]')).toBeVisible();
      await expect(page.locator('[data-testid="run-duration"]')).toBeVisible();
    });

    test('should display transitions timeline', async ({ page }) => {
      await page.goto('/testing/runs/test-run-id-123');

      // Click on transitions tab
      await page.click('button:has-text("Transitions")');

      // Verify transitions are displayed
      await expect(page.locator('[data-testid="transitions-list"]')).toBeVisible();
    });

    test('should display deficiencies', async ({ page }) => {
      await page.goto('/testing/runs/test-run-id-123');

      // Click on deficiencies tab
      await page.click('button:has-text("Deficiencies")');

      // Verify deficiencies are displayed
      await expect(page.locator('[data-testid="deficiencies-list"]')).toBeVisible();
    });

    test('should display coverage metrics', async ({ page }) => {
      await page.goto('/testing/runs/test-run-id-123');

      // Click on coverage tab
      await page.click('button:has-text("Coverage")');

      // Verify coverage chart is displayed
      await expect(page.locator('[data-testid="coverage-chart"]')).toBeVisible();
    });
  });

  test.describe('Deficiencies Management', () => {
    test('should list all deficiencies', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Verify deficiencies list is displayed
      await expect(page.locator('[data-testid="deficiency-card"]').first()).toBeVisible();
    });

    test('should filter deficiencies by severity', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Select severity filter
      await page.selectOption('select[name="severity"]', 'critical');

      // Verify filtered results
      await page.waitForLoadState('networkidle');
      const criticalDeficiencies = page.locator(
        '[data-testid="severity-badge"]:has-text("critical")'
      );
      await expect(criticalDeficiencies.first()).toBeVisible();
    });

    test('should open deficiency details', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Click on first deficiency
      await page.locator('[data-testid="deficiency-card"]').first().click();

      // Verify details modal opened
      await expect(page.locator('[data-testid="deficiency-modal"]')).toBeVisible();
      await expect(page.locator('[data-testid="deficiency-title"]')).toBeVisible();
    });

    test('should update deficiency status', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Open deficiency details
      await page.locator('[data-testid="deficiency-card"]').first().click();

      // Change status
      await page.selectOption('select[name="status"]', 'in_progress');

      // Click save
      await page.click('button:has-text("Save")');

      // Verify success message
      await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    });

    test('should assign deficiency to user', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Open deficiency details
      await page.locator('[data-testid="deficiency-card"]').first().click();

      // Click assign button
      await page.click('button:has-text("Assign")');

      // Select user from dropdown
      await page.click('[data-testid="user-select"]');
      await page.click('li:has-text("John Doe")');

      // Verify assignment
      await expect(page.locator('[data-testid="assigned-user"]')).toContainText('John Doe');
    });

    test('should add comment to deficiency', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Open deficiency details
      await page.locator('[data-testid="deficiency-card"]').first().click();

      // Add comment
      await page.fill('textarea[name="comment"]', 'This is a test comment');
      await page.click('button:has-text("Add Comment")');

      // Verify comment appears
      await expect(page.locator('[data-testid="comment"]').last()).toContainText(
        'This is a test comment'
      );
    });

    test('should view reproduction steps', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Open deficiency details
      await page.locator('[data-testid="deficiency-card"]').first().click();

      // Verify reproduction steps are displayed
      await expect(page.locator('[data-testid="reproduction-steps"]')).toBeVisible();
      await expect(page.locator('[data-testid="step"]').first()).toBeVisible();
    });

    test('should view associated screenshots', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Open deficiency details
      await page.locator('[data-testid="deficiency-card"]').first().click();

      // Click screenshots tab
      await page.click('button:has-text("Screenshots")');

      // Verify screenshots are displayed
      await expect(page.locator('[data-testid="screenshot"]').first()).toBeVisible();
    });
  });

  test.describe('Export and Reporting', () => {
    test('should export test run report', async ({ page }) => {
      await page.goto('/testing/runs/test-run-id-123');

      // Click export button
      const downloadPromise = page.waitForEvent('download');
      await page.click('button:has-text("Export")');

      // Verify download started
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('.pdf');
    });

    test('should export deficiencies to CSV', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Select some deficiencies
      await page.check('[data-testid="deficiency-checkbox"]');

      // Click export button
      const downloadPromise = page.waitForEvent('download');
      await page.click('button:has-text("Export CSV")');

      // Verify download
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('.csv');
    });

    test('should generate PDF report', async ({ page }) => {
      await page.goto('/testing/runs/test-run-id-123');

      // Click generate report
      await page.click('button:has-text("Generate Report")');

      // Wait for report generation
      await expect(page.locator('[data-testid="report-status"]')).toContainText(
        'Generating...'
      );

      // Wait for completion
      await expect(page.locator('[data-testid="download-report"]')).toBeVisible({
        timeout: 30000,
      });
    });
  });

  test.describe('Analytics and Trends', () => {
    test('should display coverage trends', async ({ page }) => {
      await page.goto('/testing/analytics/coverage');

      // Verify chart is displayed
      await expect(page.locator('[data-testid="coverage-trend-chart"]')).toBeVisible();
    });

    test('should display reliability statistics', async ({ page }) => {
      await page.goto('/testing/analytics/reliability');

      // Verify reliability stats are displayed
      await expect(page.locator('[data-testid="reliability-stats"]')).toBeVisible();
    });

    test('should filter analytics by date range', async ({ page }) => {
      await page.goto('/testing/analytics/coverage');

      // Select date range
      await page.fill('input[name="startDate"]', '2025-11-01');
      await page.fill('input[name="endDate"]', '2025-11-23');
      await page.click('button:has-text("Apply")');

      // Verify chart updates
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="coverage-trend-chart"]')).toBeVisible();
    });
  });

  test.describe('Bulk Operations', () => {
    test('should select multiple deficiencies', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Check select all
      await page.check('[data-testid="select-all-checkbox"]');

      // Verify all checkboxes are checked
      const checkboxes = page.locator('[data-testid="deficiency-checkbox"]');
      const count = await checkboxes.count();
      for (let i = 0; i < count; i++) {
        await expect(checkboxes.nth(i)).toBeChecked();
      }
    });

    test('should bulk update deficiency status', async ({ page }) => {
      await page.goto('/testing/deficiencies');

      // Select multiple deficiencies
      await page.check('[data-testid="deficiency-checkbox"]');

      // Click bulk actions
      await page.click('button:has-text("Bulk Actions")');

      // Select status update
      await page.click('button:has-text("Update Status")');
      await page.selectOption('select[name="bulkStatus"]', 'triaged');

      // Confirm
      await page.click('button:has-text("Confirm")');

      // Verify success
      await expect(page.locator('[data-testid="success-toast"]')).toBeVisible();
    });
  });
});
