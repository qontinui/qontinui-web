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
 *
 * No fixed sleeps. Every wait here is an auto-waiting `.or()` assertion on
 * the states the test tolerated (data / empty / loading / runner-offline),
 * with an AND-group's remaining members asserted only once its first member
 * rendered — never a `waitForTimeout(N)` followed by a non-waiting `count()`
 * read, which asserts on wall-clock. Timeouts are the replaced sleep × 3.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";

/** Replaces the old `waitForTimeout(3000)` before a page-data presence read. */
const PAGE_DATA_TIMEOUT = 9000;

/** The two spellings of the runner-offline copy the pages use. */
const runnerOffline = (page: import("@playwright/test").Page) =>
  page
    .locator("text=Runner Offline")
    .or(page.locator("text=Runner is offline"));

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

    // Source of truth: page.tsx renders one of:
    //  - a <table> with the runs (when data present)
    //  - "No runs found" empty state (when query returns [])
    //  - "Loading runs..." (initial fetch)
    //  - <RunnerPartialState> banner ("Runner offline ...") when isRunnerOffline
    // The legacy "Task Runs" heading was removed when the page was simplified
    // to a single table view — the table has no card title now.
    // `text=` is case-insensitive, so this matches "Runner offline" too.
    // Tolerance preserved: any of the four.
    await expect(
      page
        .locator("table")
        .or(page.locator("text=No runs found"))
        .or(page.locator("text=Loading runs"))
        .or(page.locator("text=Runner offline"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
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

    // The page renders one of:
    //  - the dashboard layout for the selected run (when runs exist)
    //  - <IdleState>: "No Active Runs" + (offline) "Runner not connected"
    //  - <CompletedState>: "Run Completed"
    //  - the loading spinner
    // The "Active Dashboard" h1 itself contains the substring "active",
    // so we use a more specific check for the empty/offline branches.
    // When runs are active, the TabBar renders a "dashboard" tab.
    // Tolerance preserved: any of the four.
    await expect(
      page
        .locator("text=No Active Runs")
        .or(page.locator("text=Run Completed"))
        .or(page.locator("text=Runner not connected"))
        .or(page.getByRole("tab", { name: /dashboard/i }))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
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

    // Check for severity levels (Critical/High/Medium/Low), empty state, or
    // runner offline. Tolerance preserved: any of the seven.
    await expect(
      page
        .locator("text=Critical")
        .or(page.locator("text=High"))
        .or(page.locator("text=Medium"))
        .or(page.locator("text=Low"))
        .or(page.locator("text=No Findings Yet"))
        .or(page.locator("text=Loading findings"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should display category filtering when findings exist", async ({
    page,
  }) => {
    await page.goto("/runs/findings");
    await page.waitForLoadState("domcontentloaded");

    // If findings exist, severity and category filter dropdowns should be
    // visible. Filters show when there are findings; otherwise empty/offline
    // state. Tolerance preserved: the severity filter or either fallback,
    // and the category filter is required only once the severity filter
    // rendered (the original AND arm).
    const severityFilter = page.locator("text=All Severities");
    await expect(
      severityFilter
        .or(page.locator("text=No Findings Yet"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    if (await severityFilter.first().isVisible()) {
      await expect(page.locator("text=All Categories").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
    }
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

    // Check for insight sections or empty/offline state. Tolerance
    // preserved: any of the seven.
    await expect(
      page
        .locator("text=Iteration Trend")
        .or(page.locator("text=Pattern Detection"))
        .or(page.locator("text=Top Finding Categories"))
        .or(page.locator("text=Phase Distribution"))
        .or(page.locator("text=No Data for Analysis"))
        .or(page.locator("text=Analyzing patterns"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
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

    // Check for key metrics cards or empty/offline state. Tolerance
    // preserved: the first metric card or any fallback, and the other two
    // cards are required only once the first rendered (the original AND arm).
    const totalRuns = page.locator("text=Total Runs");
    await expect(
      totalRuns
        .or(page.locator("text=No Data Available"))
        .or(page.locator("text=Computing statistics"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    if (await totalRuns.first().isVisible()) {
      await expect(page.locator("text=Success Rate").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
      await expect(page.locator("text=Avg Duration").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
    }
  });

  test("should display status breakdown when data exists", async ({ page }) => {
    await page.goto("/runs/statistics");
    await page.waitForLoadState("domcontentloaded");

    // Check for status breakdown section. Tolerance preserved: the section
    // heading or any fallback, and its Completed / Failed rows are required
    // only once the heading rendered (the original AND arm).
    const statusBreakdown = page.locator("text=Status Breakdown");
    await expect(
      statusBreakdown
        .or(page.locator("text=No Data Available"))
        .or(page.locator("text=Computing statistics"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    if (await statusBreakdown.first().isVisible()) {
      await expect(page.locator("text=Completed").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
      await expect(page.locator("text=Failed").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
    }
  });

  test("should display duration extremes when data exists", async ({
    page,
  }) => {
    await page.goto("/runs/statistics");
    await page.waitForLoadState("domcontentloaded");

    // Check for longest/shortest run cards. Duration extremes only show when
    // there are finished runs with duration data. Tolerance preserved: any
    // of the five.
    await expect(
      page
        .locator("text=Longest Run")
        .or(page.locator("text=Shortest Run"))
        .or(page.locator("text=No Data Available"))
        .or(page.locator("text=Computing statistics"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
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

    // Check for runs list panel, empty state, or runner offline. Tolerance
    // preserved: any of the five.
    await expect(
      page
        .locator("text=Runs (")
        .or(page.locator("text=Select a Run"))
        .or(page.locator("text=No Runs Available"))
        .or(page.locator("text=Loading runs"))
        .or(runnerOffline(page))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });
});
