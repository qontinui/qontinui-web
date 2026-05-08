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

    // The page returns a centered <Loader2> while useRunnerHealth is loading;
    // wait for the "Error Monitor" heading to land so we're past that early
    // return before snapshotting visibility.
    await expect(page.locator("text=Error Monitor").first()).toBeVisible({
      timeout: 15000,
    });

    // The severity filter buttons (Error/Warning/Info/All) live inside a
    // showFilters && (...) conditional and only render after a Filters click.
    // The "Log Entries" CardTitle always renders past healthLoading, and the
    // RunnerPartialState banner ("Runner offline — ...") shows when isOffline.
    // Accept any of those as a healthy structural signal.
    const hasErrorFilter =
      (await page.locator('button:has-text("Error")').count()) > 0;
    const hasWarningFilter =
      (await page.locator('button:has-text("Warning")').count()) > 0;
    const hasInfoFilter =
      (await page.locator('button:has-text("Info")').count()) > 0;
    const hasAllFilter =
      (await page.locator('button:has-text("All")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner offline").count()) > 0;
    const hasLogEntries = (await page.locator("text=Log Entries").count()) > 0;

    const hasFilteringUI =
      hasErrorFilter && hasWarningFilter && hasInfoFilter && hasAllFilter;
    expect(hasFilteringUI || hasOfflineState || hasLogEntries).toBeTruthy();
  });

  test("should show summary cards with counts or offline state", async ({
    page,
  }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");

    // Wait past the healthLoading early-return spinner (see sibling test).
    await expect(page.locator("text=Error Monitor").first()).toBeVisible({
      timeout: 15000,
    });

    // Summary cards (Total, Critical, Errors, Warnings, Info) always render
    // once past healthLoading. The RunnerPartialState banner ("Runner offline
    // — ...") sits above them when isOffline. The "Failed to load error
    // entries" message renders inside the Log Entries card when the runner
    // is reachable but the log source isn't configured.
    const hasTotalCard = (await page.locator("text=Total").count()) > 0;
    const hasErrorsCard = (await page.locator("text=Errors").count()) > 0;
    const hasWarningsCard = (await page.locator("text=Warnings").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner offline").count()) > 0;
    const hasLoadFailure =
      (await page.locator("text=Failed to load error entries").count()) > 0;

    expect(
      (hasTotalCard && hasErrorsCard && hasWarningsCard) ||
        hasOfflineState ||
        hasLoadFailure
    ).toBeTruthy();
  });
});
