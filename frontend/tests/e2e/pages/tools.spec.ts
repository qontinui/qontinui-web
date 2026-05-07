/**
 * End-to-end tests for Tools pages
 *
 * Pages tested:
 * - /tools/error-monitor - Error log monitoring with severity filtering
 *
 * The /tools/accessibility, /tools/run-plan, and /tools/ui-bridge
 * routes were removed. The remaining live `/tools/*` routes
 * (`capture`, `error-monitor`, `inspector`, `visual-automation`)
 * have only error-monitor under e2e coverage so far; the others can
 * be added in a follow-up if needed.
 */

import { test, expect } from "../fixtures";

test.describe("Tools - Error Monitor", () => {
  test("should load error monitor page without errors", async ({ page }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/tools-error-monitor.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display error monitor heading", async ({ page }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.locator("text=Error Monitor");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have severity filtering controls or offline state", async ({
    page,
  }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");

    // When runner is online, the page shows severity filter buttons (All, Error, Warning, Info)
    // and log entries area. When offline, it shows a runner offline state.
    const hasErrorFilter =
      (await page.locator('button:has-text("Error")').count()) > 0;
    const hasWarningFilter =
      (await page.locator('button:has-text("Warning")').count()) > 0;
    const hasInfoFilter =
      (await page.locator('button:has-text("Info")').count()) > 0;
    const hasAllFilter =
      (await page.locator('button:has-text("All")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;
    const hasLogEntries = (await page.locator("text=Log Entries").count()) > 0;

    // Should have either filter buttons (runner online) or offline state
    const hasFilteringUI =
      hasErrorFilter && hasWarningFilter && hasInfoFilter && hasAllFilter;
    expect(hasFilteringUI || hasOfflineState || hasLogEntries).toBeTruthy();
  });

  test("should show summary cards with counts or offline state", async ({
    page,
  }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");

    // When runner is online, there should be 4 summary cards (Total, Errors, Warnings, Info)
    const hasTotalCard = (await page.locator("text=Total").count()) > 0;
    const hasErrorsCard = (await page.locator("text=Errors").count()) > 0;
    const hasWarningsCard = (await page.locator("text=Warnings").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(
      (hasTotalCard && hasErrorsCard && hasWarningsCard) || hasOfflineState
    ).toBeTruthy();
  });
});
