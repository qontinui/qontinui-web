/**
 * End-to-end tests for Runs pages
 *
 * Pages tested:
 * - /runs (Run History)
 * - /runs/active (Active Runs)
 * - /runs/findings (Findings)
 * - /runs/learning (Learning Insights)
 * - /runs/statistics (Statistics)
 * - /runs/checkpoints (Checkpoints)
 */

import { test, expect } from "../fixtures";

test.describe("Run History - /runs", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runs.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Run History" })
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("should display search input for filtering runs", async ({ page }) => {
    await page.goto("/runs");
    await page.waitForLoadState("networkidle");

    // Verify search input
    const searchInput = page.getByPlaceholder(
      /search by run name or workflow/i
    );
    await expect(searchInput).toBeVisible({ timeout: 15000 });
  });

  test("should display status filter dropdown", async ({ page }) => {
    await page.goto("/runs");
    await page.waitForLoadState("networkidle");

    // Verify status filter dropdown trigger is present
    const statusFilter = page.locator("text=All Status").first();
    await expect(statusFilter).toBeVisible({ timeout: 15000 });
  });

  test("should display runs table or empty state", async ({ page }) => {
    await page.goto("/runs");
    await page.waitForLoadState("networkidle");

    // Wait for loading to finish
    await page.waitForTimeout(3000);

    // Either runs table with "Task Runs" heading is shown, or empty state, or runner offline
    const hasTaskRunsCard = (await page.locator("text=Task Runs").count()) > 0;
    const hasEmptyState =
      (await page.locator("text=No runs found").count()) > 0;
    const hasLoadingRuns =
      (await page.locator("text=Loading runs").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      hasTaskRunsCard || hasEmptyState || hasLoadingRuns || hasRunnerOffline
    ).toBeTruthy();
  });
});

test.describe("Active Runs - /runs/active", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/active");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runs-active.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Active Runs" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display active executions area or empty state", async ({
    page,
  }) => {
    await page.goto("/runs/active");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Either active run cards, empty state "No Active Runs", loading, or runner offline
    const hasActiveRuns = (await page.locator("text=active").count()) > 0;
    const hasNoActiveRuns =
      (await page.locator("text=No Active Runs").count()) > 0;
    const hasLoading =
      (await page.locator("text=Loading active runs").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      hasActiveRuns || hasNoActiveRuns || hasLoading || hasRunnerOffline
    ).toBeTruthy();
  });

  test("should display executor health metrics when runner is connected", async ({
    page,
  }) => {
    await page.goto("/runs/active");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Executor Status card should be visible if runner is connected
    const hasExecutorStatus =
      (await page.locator("text=Executor Status").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    // Either executor status is shown (runner online) or runner offline state
    expect(hasExecutorStatus || hasRunnerOffline).toBeTruthy();
  });
});

test.describe("Findings - /runs/findings", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/findings");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runs-findings.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Findings" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display findings list with severity badges or empty state", async ({
    page,
  }) => {
    await page.goto("/runs/findings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Check for severity levels (Critical/High/Medium/Low), empty state, or runner offline
    const hasCritical = (await page.locator("text=Critical").count()) > 0;
    const hasHigh = (await page.locator("text=High").count()) > 0;
    const hasMedium = (await page.locator("text=Medium").count()) > 0;
    const hasLow = (await page.locator("text=Low").count()) > 0;
    const hasNoFindings =
      (await page.locator("text=No Findings Yet").count()) > 0;
    const hasLoading =
      (await page.locator("text=Loading findings").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      hasCritical ||
        hasHigh ||
        hasMedium ||
        hasLow ||
        hasNoFindings ||
        hasLoading ||
        hasRunnerOffline
    ).toBeTruthy();
  });

  test("should display category filtering when findings exist", async ({
    page,
  }) => {
    await page.goto("/runs/findings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // If findings exist, severity and category filter dropdowns should be visible
    const hasSeverityFilter =
      (await page.locator("text=All Severities").count()) > 0;
    const hasCategoryFilter =
      (await page.locator("text=All Categories").count()) > 0;
    const hasNoFindings =
      (await page.locator("text=No Findings Yet").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    // Filters show when there are findings; otherwise empty/offline state
    expect(
      (hasSeverityFilter && hasCategoryFilter) ||
        hasNoFindings ||
        hasRunnerOffline
    ).toBeTruthy();
  });
});

test.describe("Learning Insights - /runs/learning", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/learning");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runs-learning.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Learning Insights" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display learning insights area or empty state", async ({
    page,
  }) => {
    await page.goto("/runs/learning");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Check for insight sections or empty/offline state
    const hasIterationTrend =
      (await page.locator("text=Iteration Trend").count()) > 0;
    const hasPatternDetection =
      (await page.locator("text=Pattern Detection").count()) > 0;
    const hasTopCategories =
      (await page.locator("text=Top Finding Categories").count()) > 0;
    const hasPhaseDistribution =
      (await page.locator("text=Phase Distribution").count()) > 0;
    const hasNoData =
      (await page.locator("text=No Data for Analysis").count()) > 0;
    const hasLoading =
      (await page.locator("text=Analyzing patterns").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      hasIterationTrend ||
        hasPatternDetection ||
        hasTopCategories ||
        hasPhaseDistribution ||
        hasNoData ||
        hasLoading ||
        hasRunnerOffline
    ).toBeTruthy();
  });
});

test.describe("Statistics - /runs/statistics", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/statistics");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runs-statistics.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Statistics" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display key metrics or empty state", async ({ page }) => {
    await page.goto("/runs/statistics");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Check for key metrics cards or empty/offline state
    const hasTotalRuns = (await page.locator("text=Total Runs").count()) > 0;
    const hasSuccessRate =
      (await page.locator("text=Success Rate").count()) > 0;
    const hasAvgDuration =
      (await page.locator("text=Avg Duration").count()) > 0;
    const hasNoData =
      (await page.locator("text=No Data Available").count()) > 0;
    const hasLoading =
      (await page.locator("text=Computing statistics").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      (hasTotalRuns && hasSuccessRate && hasAvgDuration) ||
        hasNoData ||
        hasLoading ||
        hasRunnerOffline
    ).toBeTruthy();
  });

  test("should display status breakdown when data exists", async ({ page }) => {
    await page.goto("/runs/statistics");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Check for status breakdown section
    const hasStatusBreakdown =
      (await page.locator("text=Status Breakdown").count()) > 0;
    const hasCompleted = (await page.locator("text=Completed").count()) > 0;
    const hasFailed = (await page.locator("text=Failed").count()) > 0;
    const hasNoData =
      (await page.locator("text=No Data Available").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      (hasStatusBreakdown && hasCompleted && hasFailed) ||
        hasNoData ||
        hasRunnerOffline
    ).toBeTruthy();
  });

  test("should display duration extremes when data exists", async ({
    page,
  }) => {
    await page.goto("/runs/statistics");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Check for longest/shortest run cards
    const hasLongestRun = (await page.locator("text=Longest Run").count()) > 0;
    const hasShortestRun =
      (await page.locator("text=Shortest Run").count()) > 0;
    const hasNoData =
      (await page.locator("text=No Data Available").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    // Duration extremes only show when there are finished runs with duration data
    expect(
      hasLongestRun || hasShortestRun || hasNoData || hasRunnerOffline
    ).toBeTruthy();
  });
});

test.describe("Checkpoints - /runs/checkpoints", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/checkpoints");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-runs-checkpoints.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Checkpoints" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display checkpoint timeline or empty state", async ({
    page,
  }) => {
    await page.goto("/runs/checkpoints");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Check for runs list panel, empty state, or runner offline
    const hasRunsList = (await page.locator("text=Runs (").count()) > 0;
    const hasSelectRunPrompt =
      (await page.locator("text=Select a Run").count()) > 0;
    const hasNoRuns =
      (await page.locator("text=No Runs Available").count()) > 0;
    const hasLoading = (await page.locator("text=Loading runs").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      hasRunsList ||
        hasSelectRunPrompt ||
        hasNoRuns ||
        hasLoading ||
        hasRunnerOffline
    ).toBeTruthy();
  });
});
