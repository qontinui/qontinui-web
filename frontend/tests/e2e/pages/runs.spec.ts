/**
 * End-to-end tests for Runs pages
 *
 * Pages tested:
 * - /runs - Run History. Heading "Run History". No <RequireProject> wrap.
 *   The legacy "Task Runs" heading is gone — when runs exist they render
 *   directly into a table; when empty an "Empty State" panel shows
 *   "No runs found"; when offline `RunnerPartialState` shows "Runner offline".
 * - /runs/active - Active Runs. Heading "Active Dashboard" (renamed from
 *   "Active Runs" — the URL slug stayed). Does NOT use `RunnerPartialState`;
 *   instead `IdleState` shows "No Active Runs" + "Runner not connected" when
 *   offline. There is no "Executor Status" widget on this page anymore.
 * - /runs/findings - Findings. Heading "Findings". `RunnerPartialState` on
 *   offline.
 * - /runs/learning - Learning Insights. Heading "Learning Insights".
 *   `RunnerPartialState` on offline.
 * - /runs/statistics - Statistics. Heading "Statistics". `RunnerPartialState`
 *   on offline.
 * - /runs/checkpoints - Checkpoints. Heading "Checkpoints". `RunnerPartialState`
 *   on offline.
 *
 * None of these routes wrap in <RequireProject>, so no `?project=` query
 * param is needed for navigation.
 */

import { test, expect } from "../fixtures";

test.describe("Run History - /runs", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");

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
    await page.waitForLoadState("domcontentloaded");

    // Verify search input
    const searchInput = page.getByPlaceholder(
      /search by run name or workflow/i
    );
    await expect(searchInput).toBeVisible({ timeout: 15000 });
  });

  test("should display status filter dropdown", async ({ page }) => {
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");

    // Verify status filter dropdown trigger is present
    const statusFilter = page.locator("text=All Status").first();
    await expect(statusFilter).toBeVisible({ timeout: 15000 });
  });

  test("should display runs table or empty state", async ({ page }) => {
    await page.goto("/runs");
    await page.waitForLoadState("domcontentloaded");

    // Wait for loading to finish
    await page.waitForTimeout(3000);

    // Source of truth: page.tsx renders one of:
    //  - a <table> with the runs (when data present)
    //  - "No runs found" empty state (when query returns [])
    //  - "Loading runs..." (initial fetch)
    //  - <RunnerPartialState> banner ("Runner offline ...") when isRunnerOffline
    // The legacy "Task Runs" heading was removed when the page was simplified
    // to a single table view — the table has no card title now.
    const hasRunsTable = (await page.locator("table").count()) > 0;
    const hasEmptyState =
      (await page.locator("text=No runs found").count()) > 0;
    const hasLoadingRuns =
      (await page.locator("text=Loading runs").count()) > 0;
    // `text=` is case-insensitive, so this matches "Runner offline" too.
    const hasRunnerOffline =
      (await page.locator("text=Runner offline").count()) > 0;

    expect(
      hasRunsTable || hasEmptyState || hasLoadingRuns || hasRunnerOffline
    ).toBeTruthy();
  });
});

test.describe("Active Runs - /runs/active", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/active");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-runs-active.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Heading is "Active Dashboard" (the page was renamed; URL slug stayed
    // /runs/active). See ActiveRunsContent.tsx line ~157.
    await expect(
      page.locator("h1").filter({ hasText: "Active Dashboard" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display active executions area or empty state", async ({
    page,
  }) => {
    await page.goto("/runs/active");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // The page renders one of:
    //  - the dashboard layout for the selected run (when runs exist)
    //  - <IdleState>: "No Active Runs" + (offline) "Runner not connected"
    //  - <CompletedState>: "Run Completed"
    //  - the loading spinner
    // The "Active Dashboard" h1 itself contains the substring "active",
    // so we use a more specific check for the empty/offline branches.
    const hasNoActiveRuns =
      (await page.locator("text=No Active Runs").count()) > 0;
    const hasRunCompleted =
      (await page.locator("text=Run Completed").count()) > 0;
    const hasRunnerNotConnected =
      (await page.locator("text=Runner not connected").count()) > 0;
    // When runs are active, the TabBar renders a "dashboard" tab.
    const hasDashboardTab =
      (await page.getByRole("tab", { name: /dashboard/i }).count()) > 0;

    expect(
      hasNoActiveRuns ||
        hasRunCompleted ||
        hasRunnerNotConnected ||
        hasDashboardTab
    ).toBeTruthy();
  });
});

// Removed: "should display executor health metrics when runner is connected".
// The page no longer has an "Executor Status" widget — the active-runs
// dashboard surfaces health via per-widget panels (timeline, AI conversation,
// findings, verification, command, ui-bridge), none of which use that label.
// When offline the page shows <IdleState> with "Runner not connected" rather
// than the "Runner offline" copy used by other pages, so the original
// fallback assertion couldn't match either branch.

test.describe("Findings - /runs/findings", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/runs/findings");
    await page.waitForLoadState("domcontentloaded");

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
    await page.waitForLoadState("domcontentloaded");
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
    await page.waitForLoadState("domcontentloaded");
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
    await page.waitForLoadState("domcontentloaded");

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
    await page.waitForLoadState("domcontentloaded");
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
    await page.waitForLoadState("domcontentloaded");

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
    await page.waitForLoadState("domcontentloaded");
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
    await page.waitForLoadState("domcontentloaded");
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
    await page.waitForLoadState("domcontentloaded");
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
    await page.waitForLoadState("domcontentloaded");

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
    await page.waitForLoadState("domcontentloaded");
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
