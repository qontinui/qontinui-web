/**
 * E2E tests for global Testing pages (non-project-scoped)
 *
 * Pages covered:
 * - /testing (main testing dashboard with view selector)
 * - /testing/runs (all test runs list)
 * - /testing/runs/[id] (individual run detail)
 * - /testing/deficiencies (deficiency tracking)
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks, or a bounded `waitFor(...).catch(() => null)` in
 * front of a read the test already tolerated — never a `waitForTimeout(N)`
 * followed by a non-waiting read, which asserts on wall-clock. Timeouts are
 * the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";
import { TEST_PROJECT_ID } from "../test-project";

// `/testing/*` pages all wrap in <RequireProject>; the URL `?project=`
// param is the cheapest way to mark the project as selected
// (`src/components/require-project.tsx:37`). Backed by the seeded test
// project (`backend/tests/utils/seed_test_project.py`).
const TESTING_URL = `/testing?project=${TEST_PROJECT_ID}`;
const TESTING_RUNS_URL = `/testing/runs?project=${TEST_PROJECT_ID}`;
const TESTING_DEFICIENCIES_URL = `/testing/deficiencies?project=${TEST_PROJECT_ID}`;

/** Replaces the old `waitForTimeout(500)` after a view-selector click. */
const VIEW_SWITCH_TIMEOUT = 5000;

/**
 * The view selector is a row of plain buttons; the selected one carries
 * `bg-primary` (page.tsx). Bounded wait for that, tolerated — the test only
 * asserts that switching does not error.
 */
async function waitForSelectedView(
  page: import("@playwright/test").Page,
  key: string
): Promise<void> {
  await page
    .locator(`[data-testid="testing-page-${key}-tab"].bg-primary`)
    .waitFor({ state: "visible", timeout: VIEW_SWITCH_TIMEOUT })
    .catch(() => null);
}

test.describe("Testing Dashboard - Main Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(TESTING_URL);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-testing-global.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Testing Dashboard");
  });

  test("should display view selector with 3 tabs", async ({ page }) => {
    await page.goto(TESTING_URL);
    await page.waitForLoadState("domcontentloaded");

    // The view selector has 3 buttons: Test Runs, Coverage Trends, Reliability
    const viewSelector = page.locator(
      '[data-testid="testing-page-view-selector"]'
    );
    await expect(viewSelector).toBeVisible();

    await expect(
      page.locator('[data-testid="testing-page-overview-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="testing-page-trends-tab"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="testing-page-reliability-tab"]')
    ).toBeVisible();
  });

  test("should have navigation buttons to sub-pages", async ({ page }) => {
    await page.goto(TESTING_URL);
    await page.waitForLoadState("domcontentloaded");

    // All Runs button
    await expect(
      page.locator('[data-testid="testing-page-all-runs-btn"]')
    ).toBeVisible();

    // Deficiencies button
    await expect(
      page.locator('[data-testid="testing-page-deficiencies-btn"]')
    ).toBeVisible();
  });

  test("should display welcome section content", async ({ page }) => {
    await page.goto(TESTING_URL);
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("View historical test results, coverage trends").first()
    ).toBeVisible();
  });

  test("should switch views when clicking selector tabs", async ({ page }) => {
    await page.goto(TESTING_URL);
    await page.waitForLoadState("domcontentloaded");

    // Click Coverage Trends tab — with a project selected the chart
    // mounts (it may fetch data, but that's not what we're asserting).
    await page.locator('[data-testid="testing-page-trends-tab"]').click();
    await waitForSelectedView(page, "trends");

    // Click Reliability tab
    await page.locator('[data-testid="testing-page-reliability-tab"]').click();
    await waitForSelectedView(page, "reliability");

    // Click back to Test Runs tab
    await page.locator('[data-testid="testing-page-overview-tab"]').click();
    await waitForSelectedView(page, "overview");
  });
});

test.describe("Testing - Runs Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(TESTING_RUNS_URL);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-testing-global-runs.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("All Test Runs");
  });

  test("should display back button and description", async ({ page }) => {
    await page.goto(TESTING_RUNS_URL);
    await page.waitForLoadState("domcontentloaded");

    const backBtn = page.locator('[data-testid="testing-page-runs-back-btn"]');
    await expect(backBtn).toBeVisible();

    await expect(
      page.getByText("View all historical test runs").first()
    ).toBeVisible();
  });
});

test.describe("Testing - Run Detail Page", () => {
  const RUN_DETAIL_URL = `/testing/runs/non-existent-run-id-99999?project=${TEST_PROJECT_ID}`;

  test("should show error/loading for non-existent run ID", async ({
    page,
  }) => {
    await page.goto(RUN_DETAIL_URL);
    await page.waitForLoadState("domcontentloaded");

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
    await page.goto(RUN_DETAIL_URL);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("h1")).toContainText("Test Run Details");

    const backBtn = page.locator(
      '[data-testid="testing-page-run-details-back-btn"]'
    );
    await expect(backBtn).toBeVisible();
  });
});

test.describe("Testing - Deficiencies Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(TESTING_DEFICIENCIES_URL);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-testing-global-deficiencies.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Deficiency Management");
  });

  test("should display deficiency list section", async ({ page }) => {
    await page.goto(TESTING_DEFICIENCIES_URL);
    await page.waitForLoadState("domcontentloaded");

    // The page has a single h1 ("Deficiency Management") asserted in the
    // sibling test; only the description copy is sub-heading-equivalent.
    await expect(
      page
        .getByText("Track and manage deficiencies found during testing")
        .first()
    ).toBeVisible();
  });

  test("should display back button to testing dashboard", async ({ page }) => {
    await page.goto(TESTING_DEFICIENCIES_URL);
    await page.waitForLoadState("domcontentloaded");

    const backBtn = page.locator(
      '[data-testid="testing-page-deficiencies-back-btn"]'
    );
    await expect(backBtn).toBeVisible();
  });
});
