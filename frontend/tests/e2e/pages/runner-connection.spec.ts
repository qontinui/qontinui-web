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
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-connect-runner.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Connect Desktop Runner heading
    await expect(page.getByText("Connect Desktop Runner")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows step-by-step connection guide", async ({ page }) => {
    await page.goto("/connect-runner");
    await page.waitForLoadState("networkidle");

    // Verify "How to Connect" section
    await expect(page.getByText("How to Connect")).toBeVisible({
      timeout: 15000,
    });

    // Verify the four numbered steps are present
    await expect(page.getByText("Download Qontinui Runner")).toBeVisible();
    await expect(
      page.getByText("Log in with your Qontinui account")
    ).toBeVisible();
    await expect(
      page.getByText("Select a project in the runner")
    ).toBeVisible();
    await expect(page.getByText("Start automating!")).toBeVisible();
  });

  test("shows connection status indicator", async ({ page }) => {
    await page.goto("/connect-runner");
    await page.waitForLoadState("networkidle");

    // Connection status should show either "Runner Connected" or "No Runner Connected"
    const statusText = page.getByText(/(Runner Connected|No Runner Connected)/);
    await expect(statusText.first()).toBeVisible({ timeout: 15000 });
  });

  test("has Download Runner button", async ({ page }) => {
    await page.goto("/connect-runner");
    await page.waitForLoadState("networkidle");

    // Download Runner button should be visible
    await expect(page.getByText("Download Runner").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("has Manage Runners link", async ({ page }) => {
    await page.goto("/connect-runner");
    await page.waitForLoadState("networkidle");

    // Manage Runners button/link should be visible
    await expect(page.getByText("Manage Runners")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Download Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-download.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Download Qontinui Runner heading
    await expect(
      page.getByText("Download Qontinui Runner").first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows platform-specific download buttons", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("networkidle");

    // Verify platform selector buttons are present
    await expect(page.getByText("Windows")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("macOS")).toBeVisible();
    await expect(page.getByText("Linux")).toBeVisible();
  });

  test("detects current platform", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("networkidle");

    // Should show "Detected" badge on one platform
    await expect(page.getByText("Detected")).toBeVisible({ timeout: 15000 });
  });

  test("shows download files for selected platform", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("networkidle");

    // Should show at least one Download button for files
    const downloadButtons = page.getByRole("button", { name: /Download/i });
    const count = await downloadButtons.count();
    expect(count).toBeGreaterThan(0);

    // Should show a "Recommended" badge on at least one option
    await expect(page.getByText("Recommended").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows installation instructions", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("networkidle");

    // Installation Instructions section should be visible
    await expect(page.getByText("Installation Instructions")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows system requirements", async ({ page }) => {
    await page.goto("/download");
    await page.waitForLoadState("networkidle");

    // System Requirements section should be visible
    await expect(page.getByText("System Requirements")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Runners Management Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/runners");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runners.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Runner Management heading
    await expect(page.getByText("Manage Desktop Runners").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows active connections and history tabs", async ({ page }) => {
    await page.goto("/runners");
    await page.waitForLoadState("networkidle");

    // Active Connections tab should be visible
    await expect(page.getByText("Active Connections").first()).toBeVisible({
      timeout: 15000,
    });

    // Connection History tab should be visible
    await expect(page.getByText("Connection History").first()).toBeVisible();
  });

  test("shows active connections list or empty state", async ({ page }) => {
    await page.goto("/runners");
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Back to Dashboard")).toBeVisible({
      timeout: 15000,
    });
  });
});
