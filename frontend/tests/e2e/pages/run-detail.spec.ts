/**
 * End-to-end tests for Run Detail page
 *
 * Page tested: /runs/[id]
 *
 * Tests:
 * - Non-existent run ID handling (error/not found)
 * - Tabs structure verification (Overview, Verification, Knowledge, Tests, Output, Actions, AI Data)
 */

import { test, expect } from "../fixtures";

test.describe("Run Detail - /runs/[id]", () => {
  test("should handle non-existent run ID gracefully", async ({ page }) => {
    // Navigate to a run with an ID that almost certainly does not exist
    await page.goto("/runs/999999999");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-run-detail-not-found.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Wait for loading to complete
    await page.waitForTimeout(5000);

    // Should display "Run not found" error or "Back to Runs" navigation
    const hasRunNotFound =
      (await page.locator("text=Run not found").count()) > 0;
    const hasBackToRuns = (await page.locator("text=Back to Runs").count()) > 0;
    const hasNotExist =
      (await page
        .locator("text=The run you are looking for does not exist")
        .count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;
    const hasLoading =
      (await page.locator("text=Loading run details").count()) > 0;

    expect(
      hasRunNotFound ||
        hasBackToRuns ||
        hasNotExist ||
        hasRunnerOffline ||
        hasLoading
    ).toBeTruthy();
  });

  test("should display overview content when a run exists", async ({
    page,
  }) => {
    // Navigate to runs list first
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    const runRows = page.locator("tbody tr");
    const rowCount = await runRows.count();

    if (rowCount > 0) {
      // Click first run to navigate to detail
      await runRows.first().click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);

      // Overview tab should be active and show run details
      const hasStatus = (await page.locator("text=Status").count()) > 0;
      const hasDuration = (await page.locator("text=Duration").count()) > 0;
      const hasIterations = (await page.locator("text=Iterations").count()) > 0;
      const hasDetails = (await page.locator("text=Details").count()) > 0;
      const hasTaskName = (await page.locator("text=Task Name").count()) > 0;

      expect(hasStatus || hasDuration || hasIterations).toBeTruthy();
      expect(hasDetails || hasTaskName).toBeTruthy();
    } else {
      console.log("No runs available to test overview content - skipping");
    }
  });

  test("should navigate between tabs when a run exists", async ({ page }) => {
    // Navigate to runs list first
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    const runRows = page.locator("tbody tr");
    const rowCount = await runRows.count();

    if (rowCount > 0) {
      // Click first run to navigate to detail
      await runRows.first().click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);

      // Click on each tab and verify it becomes active
      const tabsToTest = [
        "Verification",
        "Knowledge",
        "Tests",
        "Output",
        "Actions",
        "AI Data",
      ];

      for (const tabName of tabsToTest) {
        const tab = page.getByRole("tab", { name: tabName });
        if (await tab.isVisible()) {
          await tab.click();
          await page.waitForTimeout(1000);

          // Tab should now be active
          await expect(tab).toHaveAttribute("data-state", "active");

          await page.screenshot({
            path: `test-results/pages-run-detail-tab-${tabName.toLowerCase().replace(/\s+/g, "-")}.png`,
            fullPage: true,
          });
        }
      }
    } else {
      console.log("No runs available to test tab navigation - skipping");
    }
  });
});
