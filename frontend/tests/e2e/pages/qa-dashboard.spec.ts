/**
 * E2E tests for QA Dashboard pages
 *
 * Pages covered:
 * - /qa-dashboard (main dashboard with view selector)
 * - /qa-dashboard/runs (all test runs list)
 * - /qa-dashboard/runs/[id] (individual run detail)
 * - /qa-dashboard/coverage (coverage trends and stats)
 * - /qa-dashboard/deficiencies (deficiency management)
 * - /qa-dashboard/compare (side-by-side run comparison)
 */

import { test, expect } from "../fixtures";

test.describe("QA Dashboard - Main Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/qa-dashboard");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-qa-dashboard.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the main heading is visible
    await expect(page.locator("h1")).toContainText("QA Dashboard");
  });

  test("should display 4-view selector buttons", async ({ page }) => {
    await page.goto("/qa-dashboard");
    await page.waitForLoadState("domcontentloaded");

    // The view selector has 4 buttons: Test Runs, Live Execution, Coverage Trends, Reliability
    const viewSelector = page.locator(
      '[data-testid="qa-dashboard-view-selector"]'
    );
    await expect(viewSelector).toBeVisible();

    await expect(
      page.locator('[data-testid="qa-dashboard-overview-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="qa-dashboard-live-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="qa-dashboard-trends-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="qa-dashboard-reliability-tab"]')
    ).toBeVisible();
  });

  test("should have navigation links to sub-pages", async ({ page }) => {
    await page.goto("/qa-dashboard");
    await page.waitForLoadState("domcontentloaded");

    // All Runs button
    const allRunsBtn = page.locator(
      '[data-testid="qa-dashboard-all-runs-btn"]'
    );
    await expect(allRunsBtn).toBeVisible();

    // Deficiencies button
    const deficienciesBtn = page.locator(
      '[data-testid="qa-dashboard-deficiencies-btn"]'
    );
    await expect(deficienciesBtn).toBeVisible();
  });

  test("should display welcome section text", async ({ page }) => {
    await page.goto("/qa-dashboard");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Test Results Overview").first()).toBeVisible();
    await expect(
      page.getByText("View historical test results").first()
    ).toBeVisible();
  });

  test("should switch between views when clicking selector buttons", async ({
    page,
  }) => {
    await page.goto("/qa-dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Click Live Execution tab
    await page.locator('[data-testid="qa-dashboard-live-tab"]').click();
    await page.waitForTimeout(500);

    // Click Coverage Trends tab (shows project selection message without project param)
    await page.locator('[data-testid="qa-dashboard-trends-tab"]').click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText("Please select a project").first()
    ).toBeVisible();

    // Click Reliability tab (shows project selection message without project param)
    await page.locator('[data-testid="qa-dashboard-reliability-tab"]').click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText("Please select a project").first()
    ).toBeVisible();
  });
});

test.describe("QA Dashboard - Runs Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/qa-dashboard/runs");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-qa-dashboard-runs.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("All Test Runs");
  });

  test("should display back button to QA dashboard", async ({ page }) => {
    await page.goto("/qa-dashboard/runs");
    await page.waitForLoadState("domcontentloaded");

    const backBtn = page.locator('[data-testid="qa-runs-page-back-btn"]');
    await expect(backBtn).toBeVisible();
  });

  test("should display description text", async ({ page }) => {
    await page.goto("/qa-dashboard/runs");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("View all historical test runs").first()
    ).toBeVisible();
  });
});

test.describe("QA Dashboard - Run Detail Page", () => {
  test("should show error state for non-existent run ID", async ({ page }) => {
    await page.goto("/qa-dashboard/runs/non-existent-id-12345");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-qa-dashboard-run-detail-missing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // The page heading should still render
    await expect(page.locator("h1")).toContainText("Test Run Details");
  });

  test("should display heading and back button", async ({ page }) => {
    await page.goto("/qa-dashboard/runs/non-existent-id-12345");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("h1")).toContainText("Test Run Details");

    const backBtn = page.locator('[data-testid="qa-run-details-back-btn"]');
    await expect(backBtn).toBeVisible();
  });
});

test.describe("QA Dashboard - Coverage Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/qa-dashboard/coverage");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-qa-dashboard-coverage.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Test Coverage");
  });

  test("should display coverage stat cards", async ({ page }) => {
    await page.goto("/qa-dashboard/coverage");
    await page.waitForLoadState("domcontentloaded");

    // Three stat cards: Overall Coverage, Passing Tests, Failing Tests
    await expect(page.getByText("Overall Coverage").first()).toBeVisible();
    await expect(page.getByText("Passing Tests").first()).toBeVisible();
    await expect(page.getByText("Failing Tests").first()).toBeVisible();
  });

  test("should display coverage trend chart area or no-project message", async ({
    page,
  }) => {
    await page.goto("/qa-dashboard/coverage");
    await page.waitForLoadState("domcontentloaded");

    // Without a project param, it shows "No Project Selected"
    await expect(page.getByText("No Project Selected").first()).toBeVisible();
  });

  test("should have navigation buttons to sub-pages", async ({ page }) => {
    await page.goto("/qa-dashboard/coverage");
    await page.waitForLoadState("domcontentloaded");

    // Test Runs and Deficiencies buttons in header
    await expect(
      page.locator('[data-testid="qa-coverage-runs-btn"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="qa-coverage-deficiencies-btn"]')
    ).toBeVisible();
  });
});

test.describe("QA Dashboard - Deficiencies Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/qa-dashboard/deficiencies");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-qa-dashboard-deficiencies.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Deficiency Management");
  });

  test("should display deficiency list section", async ({ page }) => {
    await page.goto("/qa-dashboard/deficiencies");
    await page.waitForLoadState("domcontentloaded");

    // Verify sub-heading and description
    await expect(
      page.getByRole("heading", { name: "Deficiencies" })
    ).toBeVisible();
    await expect(
      page
        .getByText("Track and manage deficiencies found during testing")
        .first()
    ).toBeVisible();
  });

  test("should display back button", async ({ page }) => {
    await page.goto("/qa-dashboard/deficiencies");
    await page.waitForLoadState("domcontentloaded");

    const backBtn = page.locator(
      '[data-testid="qa-deficiencies-page-back-btn"]'
    );
    await expect(backBtn).toBeVisible();
  });
});

test.describe("QA Dashboard - Compare Page", () => {
  test("should load without errors", async ({ page }) => {
    await page.goto("/qa-dashboard/compare");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-qa-dashboard-compare.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should show no-project message when no project_id param", async ({
    page,
  }) => {
    await page.goto("/qa-dashboard/compare");
    await page.waitForLoadState("domcontentloaded");

    // Without project_id, it shows a message asking to select a project
    await expect(page.getByText("No project specified").first()).toBeVisible();
    await expect(page.getByText("Back to QA Dashboard").first()).toBeVisible();
  });

  test("should display comparison interface with project_id param", async ({
    page,
  }) => {
    await page.goto(
      "/qa-dashboard/compare?project_id=test-project-id-placeholder"
    );
    await page.waitForLoadState("domcontentloaded");

    // With project_id, should show the comparison page heading
    await expect(
      page.getByRole("heading", { name: "Compare Test Runs" })
    ).toBeVisible();

    // Should show prompt to select two runs
    await expect(page.getByText("Select two test runs").first()).toBeVisible();

    // Back to Runs button should be visible
    await expect(
      page.locator('[data-testid="qa-compare-back-btn"]')
    ).toBeVisible();
  });
});
