/**
 * End-to-end tests for Tools pages
 *
 * Pages tested:
 * - /tools/accessibility - Accessibility tree inspector
 * - /tools/error-monitor - Error log monitoring with severity filtering
 * - /tools/run-plan - Sequential workflow execution
 * - /tools/ui-bridge - Dual-mode UI element inspector (Control/External)
 */

import { test, expect } from "../fixtures";

test.describe("Tools - Accessibility Explorer", () => {
  test("should load accessibility page without errors", async ({ page }) => {
    await page.goto("/tools/accessibility");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/tools-accessibility.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display accessibility tree inspector interface", async ({
    page,
  }) => {
    await page.goto("/tools/accessibility");
    await page.waitForLoadState("networkidle");

    // Verify heading
    const heading = page.locator("text=Accessibility Explorer");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have URL input for inspection", async ({ page }) => {
    await page.goto("/tools/accessibility");
    await page.waitForLoadState("networkidle");

    // The page shows either the inspector interface (runner online) or
    // a runner offline state. Either is valid.
    const hasUrlInput =
      (await page.locator('input[placeholder="https://example.com"]').count()) >
      0;
    const hasOfflineMessage =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;
    const hasInspectHeading =
      (await page.locator("text=Inspect Page").count()) > 0;

    // Either should have the URL input (runner online) or the offline message
    expect(hasUrlInput || hasOfflineMessage || hasInspectHeading).toBeTruthy();
  });
});

test.describe("Tools - Error Monitor", () => {
  test("should load error monitor page without errors", async ({ page }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/tools-error-monitor.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display error monitor heading", async ({ page }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("text=Error Monitor");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have severity filtering controls or offline state", async ({
    page,
  }) => {
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

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

test.describe("Tools - Run Plan", () => {
  test("should load run plan page without errors", async ({ page }) => {
    await page.goto("/tools/run-plan");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/tools-run-plan.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display run plan heading", async ({ page }) => {
    await page.goto("/tools/run-plan");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("text=Run Plan");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have execution plan interface or offline state", async ({
    page,
  }) => {
    await page.goto("/tools/run-plan");
    await page.waitForLoadState("networkidle");

    // When online: shows "Execution Plan" card, step list, and add step button
    // When offline: shows runner offline message
    const hasExecutionPlan =
      (await page.locator("text=Execution Plan").count()) > 0;
    const hasAddButton =
      (await page.locator('button:has-text("Add")').count()) > 0;
    const hasStepsList = (await page.locator("text=Steps").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(
      (hasExecutionPlan && hasStepsList) || hasAddButton || hasOfflineState
    ).toBeTruthy();
  });

  test("should have workflow selector or offline state", async ({ page }) => {
    await page.goto("/tools/run-plan");
    await page.waitForLoadState("networkidle");

    // When online: shows "Add Workflow Step" section with a selector
    const hasAddWorkflowStep =
      (await page.locator("text=Add Workflow Step").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasAddWorkflowStep || hasOfflineState).toBeTruthy();
  });
});

test.describe("Tools - UI Bridge Inspector", () => {
  test("should load UI bridge page without errors", async ({ page }) => {
    await page.goto("/tools/ui-bridge");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/tools-ui-bridge.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display UI Bridge Inspector heading", async ({ page }) => {
    await page.goto("/tools/ui-bridge");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("text=UI Bridge Inspector");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have dual-mode tabs or offline state", async ({ page }) => {
    await page.goto("/tools/ui-bridge");
    await page.waitForLoadState("networkidle");

    // When online: shows "Control Mode (Runner UI)" and "External Mode (Browser)" tabs
    const hasControlTab =
      (await page.locator("text=Control Mode (Runner UI)").count()) > 0;
    const hasExternalTab =
      (await page.locator("text=External Mode (Browser)").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect((hasControlTab && hasExternalTab) || hasOfflineState).toBeTruthy();
  });

  test("should have element discovery button or offline state", async ({
    page,
  }) => {
    await page.goto("/tools/ui-bridge");
    await page.waitForLoadState("networkidle");

    // When online: shows a "Discover Elements" or "Fetch Elements" button
    const hasDiscoverButton =
      (await page.locator("text=Discover Elements").count()) > 0;
    const hasFetchButton =
      (await page.locator("text=Fetch Elements").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasDiscoverButton || hasFetchButton || hasOfflineState).toBeTruthy();
  });

  test("should show Element Details panel when online", async ({ page }) => {
    await page.goto("/tools/ui-bridge");
    await page.waitForLoadState("networkidle");

    // The Element Details panel text appears when elements are discovered,
    // or a prompt to click on an element. Either way, check for the UI.
    const hasElementDetails =
      (await page.locator("text=Element Details").count()) > 0;
    const hasDiscoverPrompt =
      (await page.locator("text=Discover Runner UI Elements").count()) > 0;
    const hasFetchPrompt =
      (await page.locator("text=Fetch Browser Elements").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(
      hasElementDetails ||
        hasDiscoverPrompt ||
        hasFetchPrompt ||
        hasOfflineState
    ).toBeTruthy();
  });
});
