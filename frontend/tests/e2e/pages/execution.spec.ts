/**
 * End-to-end tests for Execution-related pages
 *
 * Pages tested:
 * - /execute (Execute workflows)
 * - /execution-history (Execution tree event history)
 * - /workflow-viz (Workflow Visualization)
 * - /monitor (Automation Runner monitor)
 * - /discoveries (GUI element discovery approval)
 */

import { test, expect } from "../fixtures";

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
    await page.waitForTimeout(3000);

    // Check for search input in the workflow selection card
    const searchInput = page.getByPlaceholder(/search workflows/i);
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
    await page.waitForTimeout(3000);

    // If runner is connected, either "Runner Connected" badge or "Executor Status" should show
    const hasRunnerConnected =
      (await page.locator("text=Runner Connected").count()) > 0;
    const hasExecutorStatus =
      (await page.locator("text=Executor Status").count()) > 0;
    const hasRunnerOffline =
      (await page.locator("text=Runner Offline").count()) > 0 ||
      (await page.locator("text=Runner is offline").count()) > 0;

    expect(
      hasRunnerConnected || hasExecutorStatus || hasRunnerOffline
    ).toBeTruthy();
  });

  test("should display workflow selection card with run button area", async ({
    page,
  }) => {
    await page.goto("/execute");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Check for "Select Workflow" card heading
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
    await page.waitForTimeout(3000);

    // The page should show "Execution Tree Events" info card or the tree view
    const hasTreeEvents =
      (await page.locator("text=Execution Tree Events").count()) > 0;
    const hasSelectRunCard =
      (await page.locator("text=Select Execution Run").count()) > 0;
    const hasNoProject =
      (await page.locator("text=requires a project").count()) > 0 ||
      (await page.locator("text=select a project").count()) > 0;

    expect(hasTreeEvents || hasSelectRunCard || hasNoProject).toBeTruthy();
  });

  test("should display workflow and run selectors", async ({ page }) => {
    await page.goto("/execution-history");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Check for "Workflow" and "Execution Run" selector labels
    const hasWorkflowLabel =
      (await page.locator("text=Workflow").first().count()) > 0;
    const hasRunLabel = (await page.locator("text=Execution Run").count()) > 0;
    const hasNoProject =
      (await page.locator("text=requires a project").count()) > 0 ||
      (await page.locator("text=select a project").count()) > 0;

    expect((hasWorkflowLabel && hasRunLabel) || hasNoProject).toBeTruthy();
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
    await page.waitForTimeout(3000);

    // Check for workflow structure panel and active states canvas, or empty state
    const hasWorkflowPanel = (await page.locator("text=Workflow").count()) > 0;
    const hasActiveStates =
      (await page.locator("text=Active States").count()) > 0;
    const hasSelectWorkflow =
      (await page.locator("text=Select a workflow to visualize").count()) > 0 ||
      (await page.locator("text=Loading workflows").count()) > 0;
    const hasNoProject =
      (await page.locator("text=requires a project").count()) > 0 ||
      (await page.locator("text=select a project").count()) > 0;

    expect(
      (hasWorkflowPanel && hasActiveStates) || hasSelectWorkflow || hasNoProject
    ).toBeTruthy();
  });

  test("should display playback controls when a workflow is selected", async ({
    page,
  }) => {
    await page.goto("/workflow-viz");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Playback controls include Play/Pause, Step Forward, Step Back, Reset buttons
    // These are only visible when a workflow is selected
    const hasPlayButton =
      (await page
        .locator('button[title="Play"], button[title="Pause"]')
        .count()) > 0;
    const hasStepForward =
      (await page.locator('button[title="Step Forward"]').count()) > 0;
    const hasStepBack =
      (await page.locator('button[title="Step Back"]').count()) > 0;
    const hasReset =
      (await page.locator('button[title="Reset to Start"]').count()) > 0;
    const hasSelectWorkflow =
      (await page.locator("text=Select a workflow to visualize").count()) > 0 ||
      (await page.locator("text=Loading workflows").count()) > 0;
    const hasNoProject =
      (await page.locator("text=requires a project").count()) > 0 ||
      (await page.locator("text=select a project").count()) > 0;

    // Either playback controls exist (workflow selected) or we see empty/loading state
    expect(
      (hasPlayButton && hasStepForward && hasStepBack && hasReset) ||
        hasSelectWorkflow ||
        hasNoProject
    ).toBeTruthy();
  });

  test("should display mode selector (Playback/Live/Historical)", async ({
    page,
  }) => {
    await page.goto("/workflow-viz");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // The mode selector shows "Playback" or "Live" label, and canvas mode "Perception"/"Config"
    const hasPlaybackLabel = (await page.locator("text=Playback").count()) > 0;
    const hasLiveLabel = (await page.locator("text=Live").count()) > 0;
    const hasPerceptionLabel =
      (await page.locator("text=Perception").count()) > 0;
    const hasConfigLabel = (await page.locator("text=Config").count()) > 0;
    const hasHistoricalPlayback =
      (await page.locator("text=Historical Playback").count()) > 0;
    const hasSelectWorkflow =
      (await page.locator("text=Select a workflow to visualize").count()) > 0 ||
      (await page.locator("text=Loading workflows").count()) > 0;
    const hasNoProject =
      (await page.locator("text=requires a project").count()) > 0 ||
      (await page.locator("text=select a project").count()) > 0;

    // Mode labels appear when a workflow is selected
    expect(
      hasPlaybackLabel ||
        hasLiveLabel ||
        hasPerceptionLabel ||
        hasConfigLabel ||
        hasHistoricalPlayback ||
        hasSelectWorkflow ||
        hasNoProject
    ).toBeTruthy();
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
    await page.waitForTimeout(3000);

    // Verify both tabs are visible
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
    await page.waitForTimeout(3000);

    // Verify Dashboard navigation button exists
    const dashboardButton = page.getByRole("button", { name: /dashboard/i });
    await expect(dashboardButton).toBeVisible({ timeout: 10000 });
  });

  test("should switch between Live Monitor and Session History tabs", async ({
    page,
  }) => {
    await page.goto("/monitor");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Click on Session History tab
    const sessionHistoryTab = page.getByRole("tab", {
      name: /session history/i,
    });
    await sessionHistoryTab.click();
    await page.waitForTimeout(1000);

    await expect(sessionHistoryTab).toHaveAttribute("data-state", "active");

    await page.screenshot({
      path: "test-results/pages-monitor-session-history.png",
      fullPage: true,
    });

    // Click back to Live Monitor tab
    const liveMonitorTab = page.getByRole("tab", { name: /live monitor/i });
    await liveMonitorTab.click();
    await page.waitForTimeout(1000);

    await expect(liveMonitorTab).toHaveAttribute("data-state", "active");
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
    await page.waitForTimeout(3000);

    // Verify all three tabs are present
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
    await page.waitForTimeout(3000);

    // Verify the "Review Discoveries" section heading
    await expect(
      page.locator("h2").filter({ hasText: "Review Discoveries" })
    ).toBeVisible({ timeout: 10000 });

    // Verify description text
    const hasDescription =
      (await page.locator("text=Review and approve discoveries").count()) > 0;
    expect(hasDescription).toBeTruthy();
  });

  test("should display Pending Discoveries content by default", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Pending tab should be active by default, showing "Pending Discoveries" heading
    const hasPendingDiscoveries =
      (await page.locator("text=Pending Discoveries").count()) > 0;

    expect(hasPendingDiscoveries).toBeTruthy();
  });

  test("should switch between Pending, Accepted, and Rejected tabs", async ({
    page,
  }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Click on Accepted tab
    const acceptedTab = page.getByRole("tab", { name: /accepted/i });
    await acceptedTab.click();
    await page.waitForTimeout(1000);

    const hasAcceptedDiscoveries =
      (await page.locator("text=Accepted Discoveries").count()) > 0;
    expect(hasAcceptedDiscoveries).toBeTruthy();

    await page.screenshot({
      path: "test-results/pages-discoveries-accepted.png",
      fullPage: true,
    });

    // Click on Rejected tab
    const rejectedTab = page.getByRole("tab", { name: /rejected/i });
    await rejectedTab.click();
    await page.waitForTimeout(1000);

    const hasRejectedDiscoveries =
      (await page.locator("text=Rejected Discoveries").count()) > 0;
    expect(hasRejectedDiscoveries).toBeTruthy();

    await page.screenshot({
      path: "test-results/pages-discoveries-rejected.png",
      fullPage: true,
    });
  });

  test("should display project filter dropdown", async ({ page }) => {
    await page.goto("/discoveries");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // Check for project filter section
    const hasProjectLabel = (await page.locator("text=Project:").count()) > 0;
    const hasAllProjects =
      (await page.locator("text=All Projects").count()) > 0;

    expect(hasProjectLabel || hasAllProjects).toBeTruthy();
  });
});
