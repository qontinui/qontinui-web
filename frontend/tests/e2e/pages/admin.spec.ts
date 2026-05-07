/**
 * End-to-end tests for Admin pages
 *
 * Pages tested:
 * - /admin/architecture - System architecture diagram display
 * - /admin/datasets - Dataset grid with statistics cards
 * - /admin/datasets/[id] - Dataset detail (test with non-existent ID)
 * - /admin/region-analysis - Three-tab interface (Run, Results, History)
 *
 * The /admin (root) and /admin/mobile routes were removed; the dashboard
 * landing was folded into the sub-pages and there is no mobile-specific
 * variant anymore.
 */

import { test, expect } from "../fixtures";

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

    // The page renders <h1>Architecture</h1> (page.tsx:52); the older
    // "Qontinui Architecture" string lived on the deleted /admin (root)
    // landing.
    const hasArchitectureHeading =
      (await page
        .getByRole("heading", { name: "Architecture", exact: true })
        .count()) > 0;
    const wasRedirected =
      page.url().includes("/build/workflows") ||
      (page.url().includes("/dashboard") && !page.url().includes("/admin"));

    expect(hasArchitectureHeading || wasRedirected).toBeTruthy();
  });

  test("should have navigation back to admin", async ({ page }) => {
    await page.goto("/admin/architecture");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasArchitectureHeading =
      (await page
        .getByRole("heading", { name: "Architecture", exact: true })
        .count()) > 0;

    if (hasArchitectureHeading) {
      // Header is now a breadcrumb: <Button>Admin</Button> / <h1>Architecture</h1>
      // (page.tsx:44-52). The "Back to Admin" copy is gone.
      const hasAdminButton = await page
        .getByRole("button", { name: "Admin", exact: true })
        .isVisible();
      expect(hasAdminButton).toBeTruthy();
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
