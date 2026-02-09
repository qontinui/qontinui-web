/**
 * E2E tests for global Testing pages (non-project-scoped)
 *
 * Pages covered:
 * - /testing (main testing dashboard with view selector)
 * - /testing/runs (all test runs list)
 * - /testing/runs/[id] (individual run detail)
 * - /testing/deficiencies (deficiency tracking)
 */

import { test, expect } from "../fixtures";

test.describe("Testing Dashboard - Main Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/testing");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-global.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Testing Dashboard");
  });

  test("should display view selector with 3 tabs", async ({ page }) => {
    await page.goto("/testing");
    await page.waitForLoadState("networkidle");

    // The view selector has 3 buttons: Test Runs, Coverage Trends, Reliability
    const viewSelector = page.locator(
      '[data-ui-id="testing-page-view-selector"]'
    );
    await expect(viewSelector).toBeVisible();

    await expect(
      page.locator('[data-ui-id="testing-page-overview-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-ui-id="testing-page-trends-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-ui-id="testing-page-reliability-tab"]')
    ).toBeVisible();
  });

  test("should have navigation buttons to sub-pages", async ({ page }) => {
    await page.goto("/testing");
    await page.waitForLoadState("networkidle");

    // All Runs button
    await expect(
      page.locator('[data-ui-id="testing-page-all-runs-btn"]')
    ).toBeVisible();

    // Deficiencies button
    await expect(
      page.locator('[data-ui-id="testing-page-deficiencies-btn"]')
    ).toBeVisible();
  });

  test("should display welcome section content", async ({ page }) => {
    await page.goto("/testing");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Test Results Overview").first()).toBeVisible();
    await expect(
      page.getByText("View historical test results").first()
    ).toBeVisible();
  });

  test("should switch views when clicking selector tabs", async ({ page }) => {
    await page.goto("/testing");
    await page.waitForLoadState("networkidle");

    // Click Coverage Trends tab - without project, shows message
    await page.locator('[data-ui-id="testing-page-trends-tab"]').click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText("Please select a project").first()
    ).toBeVisible();

    // Click Reliability tab - without project, shows message
    await page.locator('[data-ui-id="testing-page-reliability-tab"]').click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText("Please select a project").first()
    ).toBeVisible();

    // Click back to Test Runs tab
    await page.locator('[data-ui-id="testing-page-overview-tab"]').click();
    await page.waitForTimeout(500);
  });
});

test.describe("Testing - Runs Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/testing/runs");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-global-runs.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("All Test Runs");
  });

  test("should display back button and description", async ({ page }) => {
    await page.goto("/testing/runs");
    await page.waitForLoadState("networkidle");

    const backBtn = page.locator('[data-ui-id="testing-page-runs-back-btn"]');
    await expect(backBtn).toBeVisible();

    await expect(
      page.getByText("View all historical test runs").first()
    ).toBeVisible();
  });
});

test.describe("Testing - Run Detail Page", () => {
  test("should show error/loading for non-existent run ID", async ({
    page,
  }) => {
    await page.goto("/testing/runs/non-existent-run-id-99999");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-global-run-detail-missing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // The page heading should still be present
    await expect(page.locator("h1")).toContainText("Test Run Details");
  });

  test("should display heading and back button", async ({ page }) => {
    await page.goto("/testing/runs/non-existent-run-id-99999");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText("Test Run Details");

    const backBtn = page.locator(
      '[data-ui-id="testing-page-run-details-back-btn"]'
    );
    await expect(backBtn).toBeVisible();
  });
});

test.describe("Testing - Deficiencies Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto("/testing/deficiencies");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-global-deficiencies.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Deficiency Management");
  });

  test("should display deficiency list section", async ({ page }) => {
    await page.goto("/testing/deficiencies");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Deficiencies" })
    ).toBeVisible();
    await expect(
      page
        .getByText("Track and manage deficiencies found during testing")
        .first()
    ).toBeVisible();
  });

  test("should display back button to testing dashboard", async ({ page }) => {
    await page.goto("/testing/deficiencies");
    await page.waitForLoadState("networkidle");

    const backBtn = page.locator(
      '[data-ui-id="testing-page-deficiencies-back-btn"]'
    );
    await expect(backBtn).toBeVisible();
  });
});
