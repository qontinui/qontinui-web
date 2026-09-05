/**
 * End-to-end tests for Run Detail page
 *
 * Page tested: /runs/[id]
 *
 * Tests:
 * - Non-existent run ID handling (error/not found)
 * - Tabs structure verification (Overview, Verification, Knowledge, Tests, Output, Actions, AI Data)
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks, or a bounded `waitFor(...).catch(() => null)` in
 * front of a conditional the test already tolerated — never a
 * `waitForTimeout(N)` followed by a non-waiting `count()` read, which
 * asserts on wall-clock. Timeouts are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";

/** Replaces the old `waitForTimeout(3000)` before a page-data presence read. */
const PAGE_DATA_TIMEOUT = 9000;
/** Replaces the old `waitForTimeout(5000)` before the not-found read. */
const NOT_FOUND_TIMEOUT = 15000;
/** Replaces the old `waitForTimeout(1000)` after a tab click. */
const TAB_SWITCH_TIMEOUT = 5000;

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

    // Should display "Run not found" error or "Back to Runs" navigation (or
    // the offline / loading copy). Tolerance preserved: any of the six.
    await expect(
      page
        .locator("text=Run not found")
        .or(page.locator("text=Back to Runs"))
        .or(page.locator("text=The run you are looking for does not exist"))
        .or(page.locator("text=Runner Offline"))
        .or(page.locator("text=Runner is offline"))
        .or(page.locator("text=Loading run details"))
        .first()
    ).toBeVisible({ timeout: NOT_FOUND_TIMEOUT });
  });

  test("should display overview content when a run exists", async ({
    page,
  }) => {
    // Navigate to runs list first. Bounded wait for a run row, tolerated if
    // none — the conditional below is the test's original shape.
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");

    const runRows = page.locator("tbody tr");
    await runRows
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const rowCount = await runRows.count();

    if (rowCount > 0) {
      // Click first run to navigate to detail
      await runRows.first().click();
      await page.waitForLoadState("domcontentloaded");

      // Overview tab should be active and show run details. Tolerance
      // preserved: the same two OR-groups.
      await expect(
        page
          .locator("text=Status")
          .or(page.locator("text=Duration"))
          .or(page.locator("text=Iterations"))
          .first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
      await expect(
        page.locator("text=Details").or(page.locator("text=Task Name")).first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    } else {
      console.log("No runs available to test overview content - skipping");
    }
  });

  test("should navigate between tabs when a run exists", async ({ page }) => {
    // Navigate to runs list first. Bounded wait for a run row, tolerated if
    // none — the conditional below is the test's original shape.
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");

    const runRows = page.locator("tbody tr");
    await runRows
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const rowCount = await runRows.count();

    if (rowCount > 0) {
      // Click first run to navigate to detail
      await runRows.first().click();
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the tab strip, tolerated if absent — each tab is
      // read through the same `isVisible` conditional as before.
      await page
        .getByRole("tab")
        .first()
        .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
        .catch(() => null);

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

          // Tab should now be active (auto-waits)
          await expect(tab).toHaveAttribute("data-state", "active", {
            timeout: TAB_SWITCH_TIMEOUT,
          });

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
