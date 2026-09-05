/**
 * End-to-end tests for Issues page
 *
 * Page tested:
 * - /issues - Detected issues with stats cards, severity/status filtering, issue list
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks — never a `waitForTimeout(N)` followed by a
 * non-waiting `count()` read, which asserts on wall-clock. Timeouts are the
 * replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";

/** Replaces the old `waitForTimeout(2000)` after a page navigation. */
const PAGE_SETTLE_TIMEOUT = 6000;
/** Replaces the old `waitForTimeout(3000)` before a page-data presence read. */
const PAGE_DATA_TIMEOUT = 9000;

test.describe("Issues Page", () => {
  test("should load issues page without errors", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/issues.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Detected Issues heading", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /detected issues/i, level: 1 })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display stats cards", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    // Stats cards: Total Issues, Unresolved, Critical, Resolved Today.
    // Stats cards should be present (might be loading skeleton initially).
    // Tolerance preserved: any of the four.
    await expect(
      page
        .locator("text=Total Issues")
        .or(page.locator("text=Unresolved"))
        .or(page.locator("text=Critical"))
        .or(page.locator("text=Resolved Today"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should have severity filter dropdown", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    // Should have severity filter with options: All Severity, Critical, High, Medium, Low
    await expect(page.locator("text=All Severity").first()).toBeVisible({
      timeout: PAGE_SETTLE_TIMEOUT,
    });
  });

  test("should have status filter dropdown", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    // Should have status filter with options: All Status, Detected, In Progress, Resolved, Skipped
    await expect(page.locator("text=All Status").first()).toBeVisible({
      timeout: PAGE_SETTLE_TIMEOUT,
    });
  });

  test("should have Filters label", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("text=Filters:").first()).toBeVisible({
      timeout: PAGE_SETTLE_TIMEOUT,
    });
  });

  test("should display issue list or empty state", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    // Either there are issue cards or the "No Issues Found" empty state (or
    // the loading skeleton). Tolerance preserved: any of the three.
    await expect(
      page
        .locator("text=No Issues Found")
        .or(page.locator('[class*="bg-surface-raised"]'))
        .or(page.locator('[class*="animate-pulse"]'))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    await page.screenshot({
      path: "test-results/issues-list.png",
      fullPage: true,
    });
  });

  test("should have refresh button", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.locator('button:has-text("Refresh")').first()
    ).toBeVisible({ timeout: PAGE_SETTLE_TIMEOUT });
  });

  test("should have project filter dropdown", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    // Should have project filter with "All Projects" option
    await expect(page.locator("text=All Projects").first()).toBeVisible({
      timeout: PAGE_SETTLE_TIMEOUT,
    });
  });

  test("should show issue count when issues exist", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("domcontentloaded");

    // If issues exist, there should be a "Showing X of Y issues" text
    // or if no issues, the empty state (or the loading skeleton).
    // Tolerance preserved: any of the three.
    await expect(
      page
        .locator("text=Showing")
        .or(page.locator("text=No Issues Found"))
        .or(page.locator('[class*="animate-pulse"]'))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });
});
