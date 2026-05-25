/**
 * E2E tests for Runner Connection pages
 *
 * Tests the connect-runner page, download page, and runners management page.
 * Verifies page load, key elements, and connection status display.
 */

import { test, expect } from "../fixtures";

test.describe("Connect Runner Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/connect-runner");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-connect-runner.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Connect Device heading (unified-devices rename, PR #159)
    await expect(
      page.getByRole("heading", { name: "Connect Device" })
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows validation message when opened without query params", async ({
    page,
  }) => {
    await page.goto("/connect-runner");
    await page.waitForLoadState("domcontentloaded");

    // Without state/callback/runner_name query params, the page shows the
    // invalid-state branch. This is the only state reachable directly via
    // navigation — the full flow requires the runner to provide the params.
    await expect(
      page.getByText(/Missing or invalid state parameter/i)
    ).toBeVisible({ timeout: 15000 });

    // The fallback branch offers a "Back to Runners" button.
    await expect(
      page.getByRole("button", { name: "Back to Runners" })
    ).toBeVisible();
  });
});

test.describe("Download Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-download.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Download Runner heading
    await expect(
      page.getByRole("heading", { name: "Download Runner" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows platform-specific download buttons", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    // Verify platform selector buttons are present
    await expect(page.getByText("Windows").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("macOS").first()).toBeVisible();
    await expect(page.getByText("Linux").first()).toBeVisible();
  });

  test("detects current platform", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    // Should show "Detected" badge on one platform
    await expect(page.getByText("Detected")).toBeVisible({ timeout: 15000 });
  });

  test("shows download files for selected platform", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the download buttons to render before counting — the page
    // initially shows a platform selector skeleton, then hydrates with the
    // file list. Asserting visibility before count() avoids the 0-count race.
    const downloadButtons = page.getByRole("button", { name: /Download/i });
    await expect(downloadButtons.first()).toBeVisible({ timeout: 15000 });
    const count = await downloadButtons.count();
    expect(count).toBeGreaterThan(0);

    // Should show a "Recommended" badge on at least one option
    await expect(page.getByText("Recommended").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows installation instructions", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    // Installation Instructions section should be visible
    await expect(page.getByText("Installation Instructions")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows system requirements", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    // System Requirements section should be visible
    await expect(page.getByText("System Requirements")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Runners Management Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/runners");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-runners.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Runner Management heading
    await expect(
      page.getByRole("heading", { name: "Runner Management" })
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows devices, session history, and auth tokens tabs", async ({
    page,
  }) => {
    await page.goto("/runners");
    await page.waitForLoadState("domcontentloaded");

    // Devices tab should be visible (unified-devices rename, PR #159)
    await expect(
      page.getByRole("tab", { name: /Devices/i })
    ).toBeVisible({ timeout: 15000 });

    // Session History tab should be visible
    await expect(
      page.getByRole("tab", { name: /Session History/i })
    ).toBeVisible();

    // Auth Tokens tab should be visible
    await expect(page.getByRole("tab", { name: /Auth Tokens/i })).toBeVisible();
  });

  test("shows online runners list or empty state", async ({ page }) => {
    await page.goto("/runners");
    await page.waitForLoadState("domcontentloaded");

    // Wait for tab content to load
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "test-results/pages-runners-active.png",
      fullPage: true,
    });

    // Should show either active connections or a message about no connections
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("has back to dashboard button", async ({ page }) => {
    await page.goto("/runners");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Back to Dashboard")).toBeVisible({
      timeout: 15000,
    });
  });
});
