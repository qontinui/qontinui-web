/**
 * End-to-end tests for the Dev Reset page
 *
 * Tests the development-only reset utility:
 * - /dev/reset - Clears all browser state (localStorage, sessionStorage, cookies, IndexedDB)
 *   and shows debug info about what was cleared
 *
 * This page is only available in development mode.
 */

import { test, expect } from "@playwright/test";

test.describe("Dev Reset Page (/dev/reset)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/dev-reset.png",
      fullPage: true,
    });
  });

  test("displays Dev Reset heading", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");

    const heading = page.getByRole("heading", { name: /dev reset/i });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows clearing state or success message", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");

    // Wait for clearing to complete
    await page.waitForTimeout(3000);

    // After clearing, should show success message
    const successText = page.getByText(
      /all browser state cleared successfully/i
    );
    await expect(successText).toBeVisible({ timeout: 10000 });
  });

  test("shows Go to Login button after clearing", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const loginButton = page.getByRole("button", { name: /go to login/i });
    await expect(loginButton).toBeVisible({ timeout: 10000 });
  });

  test("shows Go to Dashboard button after clearing", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const dashboardButton = page.getByRole("button", {
      name: /go to dashboard/i,
    });
    await expect(dashboardButton).toBeVisible({ timeout: 10000 });
  });

  test("displays Actions Taken section with clear operations", async ({
    page,
  }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    await expect(page.getByText("Actions Taken:")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("localStorage.clear()")).toBeVisible();
    await expect(page.getByText("sessionStorage.clear()")).toBeVisible();
  });

  test("displays debug info sections for storage", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should show localStorage section (with item count)
    await expect(page.getByText(/localStorage \(was \d+ items\)/)).toBeVisible({
      timeout: 10000,
    });

    // Should show sessionStorage section
    await expect(
      page.getByText(/sessionStorage \(was \d+ items\)/)
    ).toBeVisible({ timeout: 10000 });

    // Should show cookies section
    await expect(page.getByText(/Cookies \(was \d+ accessible\)/)).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows timestamp of when state was cleared", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should display "Cleared at:" with a timestamp
    await expect(page.getByText(/Cleared at:/)).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows description text about debugging", async ({ page }) => {
    await page.goto("/dev/reset");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(/browser state cleared for debugging/i)
    ).toBeVisible({ timeout: 10000 });
  });
});
