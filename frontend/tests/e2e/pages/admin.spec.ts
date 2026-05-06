/**
 * End-to-end tests for Admin pages
 *
 * Pages tested:
 * - /admin - Admin Dashboard with 8-tab interface (superuser-only)
 * - /admin/architecture - System architecture diagram display
 * - /admin/datasets - Dataset grid with statistics cards
 * - /admin/datasets/[id] - Dataset detail (test with non-existent ID)
 * - /admin/mobile - Responsive admin dashboard with health alerts
 * - /admin/region-analysis - Three-tab interface (Run, Results, History)
 */

import { test, expect } from "../fixtures";

test.describe("Admin Dashboard", () => {
  test("should load admin page without errors", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-dashboard.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Admin Dashboard heading for superusers", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Admin page requires superuser access. Either we see the dashboard
    // or we get redirected to /dashboard due to access denied.
    const hasAdminHeading =
      (await page.locator("text=Admin Dashboard").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");
    const hasAccessDenied =
      (await page.locator("text=Access denied").count()) > 0;

    // One of these should be true
    expect(hasAdminHeading || wasRedirected || hasAccessDenied).toBeTruthy();
  });

  test("should have 8-tab interface for superusers", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // If we have admin access, verify the 8 tabs are present
    const hasAdminHeading =
      (await page.locator("text=Admin Dashboard").count()) > 0;

    if (hasAdminHeading) {
      // Check for all 8 tab triggers
      const hasOverviewTab =
        (await page
          .locator('[data-testid="admin-page-overview-tab"]')
          .count()) > 0;
      const hasUsersTab =
        (await page.locator('[data-testid="admin-page-users-tab"]').count()) >
        0;
      const hasProjectsTab =
        (await page
          .locator('[data-testid="admin-page-projects-tab"]')
          .count()) > 0;
      const hasAnalyticsTab =
        (await page
          .locator('[data-testid="admin-page-analytics-tab"]')
          .count()) > 0;
      const hasHealthTab =
        (await page.locator('[data-testid="admin-page-health-tab"]').count()) >
        0;
      const hasSystemTab =
        (await page.locator('[data-testid="admin-page-system-tab"]').count()) >
        0;
      const hasNotificationsTab =
        (await page
          .locator('[data-testid="admin-page-notifications-tab"]')
          .count()) > 0;
      const hasDownloadsTab =
        (await page
          .locator('[data-testid="admin-page-downloads-tab"]')
          .count()) > 0;

      expect(hasOverviewTab).toBeTruthy();
      expect(hasUsersTab).toBeTruthy();
      expect(hasProjectsTab).toBeTruthy();
      expect(hasAnalyticsTab).toBeTruthy();
      expect(hasHealthTab).toBeTruthy();
      expect(hasSystemTab).toBeTruthy();
      expect(hasNotificationsTab).toBeTruthy();
      expect(hasDownloadsTab).toBeTruthy();
    }
  });

  test("should have navigation buttons to Architecture and Mobile", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasAdminHeading =
      (await page.locator("text=Admin Dashboard").count()) > 0;

    if (hasAdminHeading) {
      const hasArchitectureBtn =
        (await page
          .locator('[data-testid="admin-page-architecture-btn"]')
          .count()) > 0;
      const hasMobileBtn =
        (await page.locator('[data-testid="admin-page-mobile-btn"]').count()) >
        0;

      expect(hasArchitectureBtn).toBeTruthy();
      expect(hasMobileBtn).toBeTruthy();
    }
  });
});

test.describe("Admin - Architecture", () => {
  test("should load architecture page without errors", async ({ page }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-architecture.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display architecture heading or redirect for non-admin", async ({
    page,
  }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasArchitectureHeading =
      (await page.locator("text=Qontinui Architecture").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");

    expect(hasArchitectureHeading || wasRedirected).toBeTruthy();
  });

  test("should have navigation back to admin", async ({ page }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasArchitectureHeading =
      (await page.locator("text=Qontinui Architecture").count()) > 0;

    if (hasArchitectureHeading) {
      const hasBackToAdmin =
        (await page.locator("text=Back to Admin").count()) > 0;
      expect(hasBackToAdmin).toBeTruthy();
    }
  });
});

test.describe("Admin - Datasets", () => {
  test("should load datasets page without errors", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-datasets.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display datasets heading or access denied", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasDatasetsHeading =
      (await page.locator("text=Training Datasets").count()) > 0;
    const hasAccessRequired =
      (await page.locator("text=Admin Access Required").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");

    expect(
      hasDatasetsHeading || hasAccessRequired || wasRedirected
    ).toBeTruthy();
  });

  test("should have import button for admin users", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasDatasetsHeading =
      (await page.locator("text=Training Datasets").count()) > 0;

    if (hasDatasetsHeading) {
      // Import button should be visible (either in header or empty state)
      const hasImportButton =
        (await page.locator("text=Import Dataset").count()) > 0;
      const hasImportFirstButton =
        (await page.locator("text=Import Your First Dataset").count()) > 0;

      expect(hasImportButton || hasImportFirstButton).toBeTruthy();
    }
  });

  test("should show dataset grid or empty state for admin users", async ({
    page,
  }) => {
    await page.goto("/admin/datasets");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    const hasDatasetsHeading =
      (await page.locator("text=Training Datasets").count()) > 0;

    if (hasDatasetsHeading) {
      // Either a grid of datasets with statistics (Images, Annotations, Reviewed)
      // or the empty state message
      const hasNoDatasets =
        (await page.locator("text=No datasets yet").count()) > 0;
      const hasDatasetGrid =
        (await page.locator("text=Images").count()) > 0 ||
        (await page.locator("text=Review Progress").count()) > 0;
      const hasLoading =
        (await page.locator("text=Loading datasets").count()) > 0;

      expect(hasNoDatasets || hasDatasetGrid || hasLoading).toBeTruthy();
    }
  });
});

test.describe("Admin - Dataset Detail (non-existent)", () => {
  test("should handle non-existent dataset ID gracefully", async ({ page }) => {
    await page.goto("/admin/datasets/non-existent-id-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: "test-results/admin-dataset-detail-404.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Should show "Dataset Not Found" or "Back to Datasets" or redirect
    const hasNotFound =
      (await page.locator("text=Dataset Not Found").count()) > 0;
    const hasBackButton =
      (await page.locator("text=Back to Datasets").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");
    const hasLoading = (await page.locator("text=Loading").count()) > 0;

    expect(
      hasNotFound || hasBackButton || wasRedirected || hasLoading
    ).toBeTruthy();
  });
});

test.describe("Admin - Mobile", () => {
  test("should load mobile admin page without errors", async ({ page }) => {
    await page.goto("/admin/mobile");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-mobile.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display mobile admin heading or redirect", async ({ page }) => {
    await page.goto("/admin/mobile");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasMobileHeading =
      (await page.locator("text=Admin Mobile").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");

    expect(hasMobileHeading || wasRedirected).toBeTruthy();
  });

  test("should display health status or activity section", async ({ page }) => {
    await page.goto("/admin/mobile");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasMobileHeading =
      (await page.locator("text=Admin Mobile").count()) > 0;

    if (hasMobileHeading) {
      // Should show either "Health Alerts" (problems) or "All Systems Healthy" (no problems)
      // and an "Activity" section
      const hasHealthAlerts =
        (await page.locator("text=Health Alerts").count()) > 0;
      const hasAllHealthy =
        (await page.locator("text=All Systems Healthy").count()) > 0;
      const hasActivity = (await page.locator("text=Activity").count()) > 0;

      expect(hasHealthAlerts || hasAllHealthy || hasActivity).toBeTruthy();
    }
  });
});

test.describe("Admin - Region Analysis", () => {
  test("should load region analysis page without errors", async ({ page }) => {
    await page.goto("/admin/region-analysis");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/admin-region-analysis.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Region Analysis heading or redirect", async ({
    page,
  }) => {
    await page.goto("/admin/region-analysis");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasRegionHeading =
      (await page.locator("text=Region Analysis").count()) > 0;
    const wasRedirected =
      page.url().includes("/dashboard") && !page.url().includes("/admin");

    expect(hasRegionHeading || wasRedirected).toBeTruthy();
  });

  test("should have three-tab interface (Run, Results, History)", async ({
    page,
  }) => {
    await page.goto("/admin/region-analysis");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasRegionHeading =
      (await page.locator("text=Region Analysis").count()) > 0;

    if (hasRegionHeading) {
      // The tabs are only visible when an annotation set is selected.
      // Check for either the tab interface or the annotation set selector.
      const hasRunTab =
        (await page.locator('button:has-text("Run Analysis")').count()) > 0;
      const hasResultsTab =
        (await page.locator('button:has-text("Results")').count()) > 0;
      const hasHistoryTab =
        (await page.locator('button:has-text("History")').count()) > 0;
      const hasAnnotationSetSelector =
        (await page.locator("text=Select Annotation Set").count()) > 0;
      const hasNoSets =
        (await page.locator("text=No annotation sets found").count()) > 0;

      expect(
        (hasRunTab && hasResultsTab && hasHistoryTab) ||
          hasAnnotationSetSelector ||
          hasNoSets
      ).toBeTruthy();
    }
  });
});
