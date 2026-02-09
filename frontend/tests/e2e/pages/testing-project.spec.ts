/**
 * E2E tests for project-scoped Testing pages
 *
 * Pages covered:
 * - /projects/[projectId]/testing (project testing dashboard)
 * - /projects/[projectId]/testing/coverage (project coverage analysis)
 * - /projects/[projectId]/testing/deficiencies (project deficiency tracking)
 * - /projects/[projectId]/testing/integration (integration testing hub)
 * - /projects/[projectId]/testing/live (live testing with tabbed history)
 * - /projects/[projectId]/testing/runs/[runId] (run detail with timeline)
 */

import { test, expect } from "../fixtures";

// Use a placeholder project ID for page-load tests
const TEST_PROJECT_ID = "test-project-placeholder-id";

test.describe("Project Testing Dashboard", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-project-dashboard.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Testing Dashboard");
  });

  test("should display 4-view selector buttons", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing`);
    await page.waitForLoadState("networkidle");

    // View selector buttons: Test Runs, Live Execution, Coverage Trends, Reliability
    await expect(
      page.getByRole("button", { name: /Test Runs/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Live Execution/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Coverage Trends/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Reliability/i })
    ).toBeVisible();
  });

  test("should have navigation links to sub-pages", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing`);
    await page.waitForLoadState("networkidle");

    // Coverage button in header
    await expect(
      page.getByRole("button", { name: /Coverage/i }).first()
    ).toBeVisible();

    // Deficiencies button in header
    await expect(
      page.getByRole("button", { name: /Deficiencies/i }).first()
    ).toBeVisible();

    // Integration Tests button in header
    await expect(
      page.getByRole("button", { name: /Integration Tests/i })
    ).toBeVisible();
  });

  test("should display welcome section text", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Test Results Overview").first()).toBeVisible();
  });
});

test.describe("Project Testing - Coverage Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/coverage`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-project-coverage.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Test Coverage");
  });

  test("should display coverage stat cards", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/coverage`);
    await page.waitForLoadState("networkidle");

    // Three stat cards: Overall Coverage, Passing Tests, Failing Tests
    await expect(page.getByText("Overall Coverage").first()).toBeVisible();
    await expect(page.getByText("Passing Tests").first()).toBeVisible();
    await expect(page.getByText("Failing Tests").first()).toBeVisible();
  });

  test("should display coverage analysis heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/coverage`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Coverage Analysis" })
    ).toBeVisible();
    await expect(
      page.getByText("Track test coverage trends").first()
    ).toBeVisible();
  });

  test("should display navigation buttons", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/coverage`);
    await page.waitForLoadState("networkidle");

    // Test Runs and Deficiencies buttons in header
    await expect(
      page.getByRole("button", { name: /Test Runs/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Deficiencies/i }).first()
    ).toBeVisible();
  });
});

test.describe("Project Testing - Deficiencies Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/deficiencies`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-project-deficiencies.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Deficiency Management");
  });

  test("should display deficiency tracking list", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/deficiencies`);
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

  test("should display navigation buttons", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/deficiencies`);
    await page.waitForLoadState("networkidle");

    // Test Runs and Coverage buttons in header
    await expect(
      page.getByRole("button", { name: /Test Runs/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Coverage/i }).first()
    ).toBeVisible();
  });
});

test.describe("Project Testing - Integration Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/integration`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-project-integration.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Integration Testing");
  });

  test("should display Mock Mode badge", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/integration`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Mock Mode").first()).toBeVisible();
  });

  test("should display API health indicator", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/integration`);
    await page.waitForLoadState("networkidle");

    // API health badge shows one of: "Checking API...", "API Connected", "API Offline"
    const healthBadge = page
      .getByText(/API Connected|API Offline|Checking API/i)
      .first();
    await expect(healthBadge).toBeVisible({ timeout: 10000 });
  });

  test("should display integration test runs heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/integration`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Integration Test Runs" })
    ).toBeVisible();
  });

  test("should display Run Test button", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/integration`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: /Run Test/i })).toBeVisible();
  });

  test("should show empty state or run list", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/integration`);
    await page.waitForLoadState("networkidle");

    // Either shows run list or empty state with "No Integration Tests Yet"
    const emptyState = page.getByText("No Integration Tests Yet");
    const runsList = page.locator(
      '[class*="space-y"] > [class*="cursor-pointer"]'
    );

    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasRuns = (await runsList.count()) > 0;

    // One of the two should be true
    expect(hasEmpty || hasRuns).toBeTruthy();
  });
});

test.describe("Project Testing - Live Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/live`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-project-live.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Live Testing Dashboard");
  });

  test("should display tabs for Live Execution and Test History", async ({
    page,
  }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/live`);
    await page.waitForLoadState("networkidle");

    // Tabs: Live Execution and Test History
    await expect(
      page.getByRole("tab", { name: /Live Execution/i })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Test History/i })
    ).toBeVisible();
  });

  test("should show no-active-test message on Live tab", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/live`);
    await page.waitForLoadState("networkidle");

    // When no test run is selected, shows "No Active Test" message
    await expect(page.getByText("No Active Test").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Start New Test/i }).first()
    ).toBeVisible();
  });

  test("should switch to Test History tab and show filters", async ({
    page,
  }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/testing/live`);
    await page.waitForLoadState("networkidle");

    // Click Test History tab
    await page.getByRole("tab", { name: /Test History/i }).click();
    await page.waitForTimeout(500);

    // Verify filters section appears
    await expect(page.getByText("Test History").first()).toBeVisible();
    await expect(page.getByText("Filters").first()).toBeVisible();
    await expect(page.getByPlaceholder("Search test runs...")).toBeVisible();
  });
});

test.describe("Project Testing - Run Detail Page", () => {
  test("should load without errors for non-existent run", async ({ page }) => {
    await page.goto(
      `/projects/${TEST_PROJECT_ID}/testing/runs/non-existent-run-id`
    );
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-testing-project-run-detail-missing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display heading", async ({ page }) => {
    await page.goto(
      `/projects/${TEST_PROJECT_ID}/testing/runs/non-existent-run-id`
    );
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText("Test Run Details");
  });

  test("should show not-found message for invalid run", async ({ page }) => {
    await page.goto(
      `/projects/${TEST_PROJECT_ID}/testing/runs/non-existent-run-id`
    );
    await page.waitForLoadState("networkidle");

    // When run is not found, it shows "Test run not found"
    await expect(page.getByText("Test run not found").first()).toBeVisible({
      timeout: 15000,
    });
  });
});
