/**
 * End-to-end tests for Issues page
 *
 * Page tested:
 * - /issues - Detected issues with stats cards, severity/status filtering, issue list
 */

import { test, expect } from "../fixtures";

test.describe("Issues Page", () => {
  test("should load issues page without errors", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/issues.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Detected Issues heading", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const hasHeading = (await page.locator("text=Detected Issues").count()) > 0;

    expect(hasHeading).toBeTruthy();
  });

  test("should display stats cards", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Stats cards: Total Issues, Unresolved, Critical, Resolved Today
    const hasTotalIssues =
      (await page.locator("text=Total Issues").count()) > 0;
    const hasUnresolved = (await page.locator("text=Unresolved").count()) > 0;
    const hasCritical = (await page.locator("text=Critical").count()) > 0;
    const hasResolvedToday =
      (await page.locator("text=Resolved Today").count()) > 0;

    // Stats cards should be present (might be loading skeleton initially)
    expect(
      hasTotalIssues || hasUnresolved || hasCritical || hasResolvedToday
    ).toBeTruthy();
  });

  test("should have severity filter dropdown", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have severity filter with options: All Severity, Critical, High, Medium, Low
    const hasSeverityFilter =
      (await page.locator("text=All Severity").count()) > 0;

    expect(hasSeverityFilter).toBeTruthy();
  });

  test("should have status filter dropdown", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have status filter with options: All Status, Detected, In Progress, Resolved, Skipped
    const hasStatusFilter = (await page.locator("text=All Status").count()) > 0;

    expect(hasStatusFilter).toBeTruthy();
  });

  test("should have Filters label", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const hasFiltersLabel = (await page.locator("text=Filters:").count()) > 0;

    expect(hasFiltersLabel).toBeTruthy();
  });

  test("should display issue list or empty state", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: "test-results/issues-list.png",
      fullPage: true,
    });

    // Either there are issue cards or the "No Issues Found" empty state
    const hasNoIssues =
      (await page.locator("text=No Issues Found").count()) > 0;
    const hasIssueCards =
      (await page.locator('[class*="bg-surface-raised"]').count()) > 0;
    const hasLoading =
      (await page.locator('[class*="animate-pulse"]').count()) > 0;

    expect(hasNoIssues || hasIssueCards || hasLoading).toBeTruthy();
  });

  test("should have refresh button", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const hasRefreshButton =
      (await page.locator('button:has-text("Refresh")').count()) > 0;

    expect(hasRefreshButton).toBeTruthy();
  });

  test("should have project filter dropdown", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have project filter with "All Projects" option
    const hasProjectFilter =
      (await page.locator("text=All Projects").count()) > 0;

    expect(hasProjectFilter).toBeTruthy();
  });

  test("should show issue count when issues exist", async ({ page }) => {
    await page.goto("/issues");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // If issues exist, there should be a "Showing X of Y issues" text
    // or if no issues, the empty state
    const hasShowingText = (await page.locator("text=Showing").count()) > 0;
    const hasNoIssues =
      (await page.locator("text=No Issues Found").count()) > 0;
    const hasLoading =
      (await page.locator('[class*="animate-pulse"]').count()) > 0;

    expect(hasShowingText || hasNoIssues || hasLoading).toBeTruthy();
  });
});
