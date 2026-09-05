/**
 * End-to-end tests for Execution-related pages
 *
 * Pages tested:
 * - /execute (Execute workflows)
 * - /execution-history (Execution tree event history)
 * - /workflow-viz (Workflow Visualization)
 * - /monitor (Automation Runner monitor)
 * - /discoveries (GUI element discovery approval)
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks (`expect(locator).toBeVisible({ timeout })`), never a
 * `waitForTimeout(N)` followed by a non-waiting `count()` read — that shape
 * asserts on wall-clock. Tolerance is preserved: an `A || B` check becomes
 * `locA.or(locB).first()`, and a conditional `if count > 0` is preceded by a
 * bounded `waitFor(...).catch(() => null)` so a tolerated absence stays
 * tolerated. Timeouts are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";
import { requireRunner } from "../runner-detection";

/** Replaces the old `waitForTimeout(3000)` before a presence read. */
const PAGE_DATA_TIMEOUT = 9000;
/** Replaces the old `waitForTimeout(1000)` after a tab click. */
const TAB_SWITCH_TIMEOUT = 5000;

test.beforeAll(async () => {
  await requireRunner();
});

test.describe("Execute - /execute", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/execute");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-execute.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(page.locator("h1").filter({ hasText: "Execute" })).toBeVisible(
      { timeout: 15000 }
    );
  });

  test("should display workflow list with search input", async ({ page }) => {
    await page.goto("/execute");
    await page.waitForLoadState("domcontentloaded");

    // Check for search input in the workflow selection card. Bounded wait
    // for it or the offline state, tolerated if neither — the conditional
    // below is the test's original tolerance shape.
    const searchInput = page.getByPlaceholder(/search workflows/i);
    await searchInput
      .or(page.locator("text=Runner Offline"))
      .or(page.locator("text=Runner is offline"))
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    if (!hasRunnerOffline) {
      await expect(searchInput).toBeVisible({ timeout: 10000 });
    } else {
      // Runner offline is an acceptable state
      expect(hasRunnerOffline).toBeTruthy();
    }
  });

  test("should display executor status indicator", async ({ page }) => {
    await page.goto("/execute");
    await page.waitForLoadState("domcontentloaded");

    // If runner is connected, either "Runner Connected" badge or "Executor Status" should show
    // Tolerance preserved: any of the four states satisfies the test.
    await expect(
      page
        .locator("text=Runner Connected")
        .or(page.locator("text=Executor Status"))
        .or(page.locator("text=Runner Offline"))
        .or(page.locator("text=Runner is offline"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should display workflow selection card with run button area", async ({
    page,
  }) => {
    await page.goto("/execute");
    await page.waitForLoadState("domcontentloaded");

    // Check for "Select Workflow" card heading. Bounded wait for it or the
    // offline state, tolerated if neither — the conditional below is the
    // test's original tolerance shape.
    await page
      .locator("text=Select Workflow")
      .or(page.locator("text=Runner Offline"))
      .or(page.locator("text=Runner is offline"))
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const hasSelectWorkflow =
      (await page.locator("text=Select Workflow").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    if (!hasRunnerOffline) {
      expect(hasSelectWorkflow).toBeTruthy();

      // Workflow list should show workflows, loading skeleton, error, or empty state
      const hasWorkflows =
        (await page.locator("button").filter({ hasText: /\w+/ }).count()) > 3;
      const hasNoWorkflows =
        (await page.locator("text=No workflows available").count()) > 0 ||
        (await page.locator("text=No workflows match").count()) > 0;
      const hasWorkflowError =
        (await page.locator("text=Failed to load workflows").count()) > 0;
      const hasLoadingSkeleton =
        (await page.locator(".animate-pulse").count()) > 0;

      expect(
        hasWorkflows || hasNoWorkflows || hasWorkflowError || hasLoadingSkeleton
      ).toBeTruthy();
    } else {
      expect(hasRunnerOffline).toBeTruthy();
    }
  });
});

test.describe("Execution History - /execution-history", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/execution-history");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-execution-history.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Execution History" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display tree event visualization area", async ({ page }) => {
    await page.goto("/execution-history");
    await page.waitForLoadState("domcontentloaded");

    // The page should show "Execution Tree Events" info card or the tree view
    // Tolerance preserved: any of the four states satisfies the test.
    await expect(
      page
        .locator("text=Execution Tree Events")
        .or(page.locator("text=Select Execution Run"))
        .or(page.locator("text=requires a project"))
        .or(page.locator("text=select a project"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should display workflow and run selectors", async ({ page }) => {
    await page.goto("/execution-history");
    await page.waitForLoadState("domcontentloaded");

    // Check for "Workflow" and "Execution Run" selector labels. Original
    // shape: (Workflow && Execution Run) || noProject.
    const noProject = page
      .locator("text=requires a project")
      .or(page.locator("text=select a project"));
    await expect(
      page.locator("text=Workflow").or(noProject).first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    if ((await noProject.count()) === 0) {
      await expect(page.locator("text=Execution Run").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
    }
  });
});

test.describe("Workflow Visualization - /workflow-viz", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/workflow-viz");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-workflow-viz.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Workflow Visualization" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display dual-panel design or empty state", async ({ page }) => {
    await page.goto("/workflow-viz");
    await page.waitForLoadState("domcontentloaded");

    // Check for workflow structure panel and active states canvas, or empty
    // state. Original shape: (Workflow && Active States) || selectWorkflow ||
    // noProject.
    const emptyState = page
      .locator("text=Select a workflow to visualize")
      .or(page.locator("text=Loading workflows"))
      .or(page.locator("text=requires a project"))
      .or(page.locator("text=select a project"));
    await expect(
      page.locator("text=Workflow").or(emptyState).first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    if ((await emptyState.count()) === 0) {
      await expect(page.locator("text=Active States").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
    }
  });

  test("should display playback controls when a workflow is selected", async ({
    page,
  }) => {
    await page.goto("/workflow-viz");
    await page.waitForLoadState("domcontentloaded");

    // Playback controls include Play/Pause, Step Forward, Step Back, Reset buttons
    // These are only visible when a workflow is selected
    // Either playback controls exist (workflow selected) or we see empty/loading state
    // Original shape: (Play && StepForward && StepBack && Reset) ||
    // selectWorkflow || noProject.
    const emptyState = page
      .locator("text=Select a workflow to visualize")
      .or(page.locator("text=Loading workflows"))
      .or(page.locator("text=requires a project"))
      .or(page.locator("text=select a project"));
    await expect(
      page
        .locator('button[title="Play"], button[title="Pause"]')
        .or(emptyState)
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    if ((await emptyState.count()) === 0) {
      await expect(
        page.locator('button[title="Step Forward"]').first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
      await expect(
        page.locator('button[title="Step Back"]').first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
      await expect(
        page.locator('button[title="Reset to Start"]').first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    }
  });

  test("should display mode selector (Playback/Live/Historical)", async ({
    page,
  }) => {
    await page.goto("/workflow-viz");
    await page.waitForLoadState("domcontentloaded");

    // The mode selector shows "Playback" or "Live" label, and canvas mode "Perception"/"Config"
    // Mode labels appear when a workflow is selected
    // Tolerance preserved: any of the nine states satisfies the test.
    await expect(
      page
        .locator("text=Playback")
        .or(page.locator("text=Live"))
        .or(page.locator("text=Perception"))
        .or(page.locator("text=Config"))
        .or(page.locator("text=Historical Playback"))
        .or(page.locator("text=Select a workflow to visualize"))
        .or(page.locator("text=Loading workflows"))
        .or(page.locator("text=requires a project"))
        .or(page.locator("text=select a project"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });
});

test.describe("Monitor - /monitor", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/monitor");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-monitor.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Automation Runner" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display two-view system with Live Monitor and Session History tabs", async ({
    page,
  }) => {
    await page.goto("/monitor");
    await page.waitForLoadState("domcontentloaded");

    // Verify both tabs are visible (auto-waiting; the sleep that preceded
    // this added nothing the assertion's own bound does not).
    const liveMonitorTab = page.getByRole("tab", { name: /live monitor/i });
    const sessionHistoryTab = page.getByRole("tab", {
      name: /session history/i,
    });

    await expect(liveMonitorTab).toBeVisible({ timeout: 10000 });
    await expect(sessionHistoryTab).toBeVisible({ timeout: 10000 });
  });

  test("should display navigation to dashboard", async ({ page }) => {
    await page.goto("/monitor");
    await page.waitForLoadState("domcontentloaded");

    // Verify Dashboard navigation button exists (auto-waiting).
    const dashboardButton = page.getByRole("button", { name: /dashboard/i });
    await expect(dashboardButton).toBeVisible({ timeout: 10000 });
  });

  test("should switch between Live Monitor and Session History tabs", async ({
    page,
  }) => {
    await page.goto("/monitor");
    await page.waitForLoadState("domcontentloaded");

    // Click on Session History tab
    const sessionHistoryTab = page.getByRole("tab", {
      name: /session history/i,
    });
    await expect(sessionHistoryTab).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    await sessionHistoryTab.click();

    await expect(sessionHistoryTab).toHaveAttribute("data-state", "active", {
      timeout: TAB_SWITCH_TIMEOUT,
    });

    await page.screenshot({
      path: "test-results/pages-monitor-session-history.png",
      fullPage: true,
    });

    // Click back to Live Monitor tab
    const liveMonitorTab = page.getByRole("tab", { name: /live monitor/i });
    await liveMonitorTab.click();

    await expect(liveMonitorTab).toHaveAttribute("data-state", "active", {
      timeout: TAB_SWITCH_TIMEOUT,
    });
  });
});

test.describe("Discoveries - /discoveries", () => {
  test("should load without errors and display page structure", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-discoveries.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify heading
    await expect(
      page.locator("h1").filter({ hasText: "Discoveries" })
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display three tabs: Pending, Accepted, Rejected", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");

    // Verify all three tabs are present (auto-waiting).
    const pendingTab = page.getByRole("tab", { name: /pending/i });
    const acceptedTab = page.getByRole("tab", { name: /accepted/i });
    const rejectedTab = page.getByRole("tab", { name: /rejected/i });

    await expect(pendingTab).toBeVisible({ timeout: 10000 });
    await expect(acceptedTab).toBeVisible({ timeout: 10000 });
    await expect(rejectedTab).toBeVisible({ timeout: 10000 });
  });

  test("should display Review Discoveries heading and description", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");

    // Verify the "Review Discoveries" section heading
    await expect(
      page.locator("h2").filter({ hasText: "Review Discoveries" })
    ).toBeVisible({ timeout: 10000 });

    // Verify description text
    await expect(
      page.locator("text=Review and approve discoveries").first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should display Pending Discoveries content by default", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");

    // Pending tab should be active by default, showing "Pending Discoveries" heading
    await expect(page.locator("text=Pending Discoveries").first()).toBeVisible({
      timeout: PAGE_DATA_TIMEOUT,
    });
  });

  test("should switch between Pending, Accepted, and Rejected tabs", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");

    // Click on Accepted tab
    const acceptedTab = page.getByRole("tab", { name: /accepted/i });
    await expect(acceptedTab).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    await acceptedTab.click();

    await expect(page.locator("text=Accepted Discoveries").first()).toBeVisible(
      { timeout: TAB_SWITCH_TIMEOUT }
    );

    await page.screenshot({
      path: "test-results/pages-discoveries-accepted.png",
      fullPage: true,
    });

    // Click on Rejected tab
    const rejectedTab = page.getByRole("tab", { name: /rejected/i });
    await rejectedTab.click();

    await expect(page.locator("text=Rejected Discoveries").first()).toBeVisible(
      { timeout: TAB_SWITCH_TIMEOUT }
    );

    await page.screenshot({
      path: "test-results/pages-discoveries-rejected.png",
      fullPage: true,
    });
  });

  test("should display project filter dropdown", async ({ page }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");

    // Check for project filter section. Tolerance preserved (A || B).
    await expect(
      page
        .locator("text=Project:")
        .or(page.locator("text=All Projects"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });
});
