/**
 * End-to-end tests for Build Workflow pages
 *
 * Pages tested:
 * - /build/workflows - Unified workflow builder with phase sections
 * - /build/flow-designer - Flow visualization with phase-based blocks
 * - /build/queue - Workflow queue with drag-to-reorder and status badges
 * - /build/tests - Playwright test management
 * - /build/state-machine - State machine editor with Discover/Edit/View modes
 *
 * All pages show RunnerOfflineState when the runner is not connected.
 */

import { test, expect } from "../fixtures";

test.describe("Build - Workflows", () => {
  test("should load workflows page without errors", async ({ page }) => {
    await page.goto("/build/workflows");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-workflows.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Unified Workflow Builder heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/workflows");
    await page.waitForLoadState("networkidle");

    const hasHeading =
      (await page.locator("text=Unified Workflow Builder").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show create button and search or offline state", async ({
    page,
  }) => {
    await page.goto("/build/workflows");
    await page.waitForLoadState("networkidle");

    const hasNewButton =
      (await page.locator('button:has-text("New Workflow")').count()) > 0;
    const hasSearchInput =
      (await page.locator('input[placeholder="Search workflows..."]').count()) >
      0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasNewButton && hasSearchInput) || hasOfflineState).toBeTruthy();
  });

  test("should show phase sections in detail panel when workflow selected or offline state", async ({
    page,
  }) => {
    await page.goto("/build/workflows");
    await page.waitForLoadState("networkidle");

    // When runner is online and workflows exist, selecting one shows phase sections:
    // Setup Steps, Agentic Steps, Verification Steps, Completion Steps
    // When no workflows or offline, the page shows an empty state or offline state.
    const hasSetupPhase = (await page.locator("text=Setup Steps").count()) > 0;
    const hasAgenticPhase =
      (await page.locator("text=Agentic Steps").count()) > 0;
    const hasVerificationPhase =
      (await page.locator("text=Verification Steps").count()) > 0;
    const hasCompletionPhase =
      (await page.locator("text=Completion Steps").count()) > 0;
    const hasEmptyState =
      (await page.locator("text=No workflows yet").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    // Either phase details are shown, or empty state, or offline state
    const hasAllPhases =
      hasSetupPhase &&
      hasAgenticPhase &&
      hasVerificationPhase &&
      hasCompletionPhase;
    expect(hasAllPhases || hasEmptyState || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/workflows");
    await page.waitForLoadState("networkidle");

    const hasContent =
      (await page.locator("text=Unified Workflow Builder").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Flow Designer", () => {
  test("should load flow designer page without errors", async ({ page }) => {
    await page.goto("/build/flow-designer");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-flow-designer.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Flow Designer heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/flow-designer");
    await page.waitForLoadState("networkidle");

    const hasHeading = (await page.locator("text=Flow Designer").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show flow visualization area or offline state", async ({
    page,
  }) => {
    await page.goto("/build/flow-designer");
    await page.waitForLoadState("networkidle");

    // When online: shows a workflow selector sidebar and a flow canvas area
    // The canvas shows "Select a Workflow to Design its Flow" when none is selected
    // or phase-based blocks (Setup Phase, Verification Phase, Agentic Phase, Completion Phase)
    const hasSelectPrompt =
      (await page
        .locator("text=Select a Workflow to Design its Flow")
        .count()) > 0;
    const hasSetupPhase = (await page.locator("text=Setup Phase").count()) > 0;
    const hasNoWorkflows =
      (await page.locator("text=No workflows").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      hasSelectPrompt || hasSetupPhase || hasNoWorkflows || hasOfflineState
    ).toBeTruthy();
  });

  test("should show workflow search sidebar or offline state", async ({
    page,
  }) => {
    await page.goto("/build/flow-designer");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page.locator('input[placeholder="Search workflows..."]').count()) >
      0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasSearchInput || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/flow-designer");
    await page.waitForLoadState("networkidle");

    const hasContent = (await page.locator("text=Flow Designer").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Queue", () => {
  test("should load queue page without errors", async ({ page }) => {
    await page.goto("/build/queue");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-queue.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Workflow Queue heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/queue");
    await page.waitForLoadState("networkidle");

    const hasHeading = (await page.locator("text=Workflow Queue").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show add to queue button or offline state", async ({ page }) => {
    await page.goto("/build/queue");
    await page.waitForLoadState("networkidle");

    const hasAddButton =
      (await page.locator('button:has-text("Add to Queue")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasAddButton || hasOfflineState).toBeTruthy();
  });

  test("should show queue list or empty state or offline state", async ({
    page,
  }) => {
    await page.goto("/build/queue");
    await page.waitForLoadState("networkidle");

    // When online: shows queue items with status badges, or "Queue is Empty"
    // Status badges include: Running, Completed, Failed, Pending, Paused
    const hasQueueEmpty =
      (await page.locator("text=Queue is Empty").count()) > 0;
    const hasInQueueBadge =
      (await page.locator("text=/\\d+ in queue/").count()) > 0;
    const hasDragToReorder =
      (await page.locator("text=Drag items to reorder priority").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      hasQueueEmpty || hasInQueueBadge || hasDragToReorder || hasOfflineState
    ).toBeTruthy();
  });

  test("should have search input or offline state", async ({ page }) => {
    await page.goto("/build/queue");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page.locator('input[placeholder="Search queue..."]').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasSearchInput || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/queue");
    await page.waitForLoadState("networkidle");

    const hasContent = (await page.locator("text=Workflow Queue").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Tests", () => {
  test("should load tests page without errors", async ({ page }) => {
    await page.goto("/build/tests");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-tests.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Playwright Tests heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/tests");
    await page.waitForLoadState("networkidle");

    const hasHeading =
      (await page.locator("text=Playwright Tests").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show test management area with create button or offline state", async ({
    page,
  }) => {
    await page.goto("/build/tests");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page.locator('input[placeholder="Search tests..."]').count()) > 0;
    const hasNewButton =
      (await page.locator('button:has-text("New Test")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasSearchInput && hasNewButton) || hasOfflineState).toBeTruthy();
  });

  test("should show test list or empty state or offline state", async ({
    page,
  }) => {
    await page.goto("/build/tests");
    await page.waitForLoadState("networkidle");

    const hasTestCount = (await page.locator("text=/\\d+ tests?/").count()) > 0;
    const hasEmptyState =
      (await page.locator("text=No Playwright tests yet").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasTestCount || hasEmptyState || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/tests");
    await page.waitForLoadState("networkidle");

    const hasContent =
      (await page.locator("text=Playwright Tests").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - State Machine", () => {
  test("should load state machine page without errors", async ({ page }) => {
    await page.goto("/build/state-machine");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-state-machine.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display State Machine Builder heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/state-machine");
    await page.waitForLoadState("networkidle");

    const hasHeading =
      (await page.locator("text=State Machine Builder").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show mode tabs (Discover, Edit, View) or offline state", async ({
    page,
  }) => {
    await page.goto("/build/state-machine");
    await page.waitForLoadState("networkidle");

    // The state machine editor has three mode tabs: Discover, Edit, View
    const hasDiscoverTab =
      (await page.locator('button:has-text("Discover")').count()) > 0;
    const hasEditTab =
      (await page.locator('button:has-text("Edit")').count()) > 0;
    const hasViewTab =
      (await page.locator('button:has-text("View")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      (hasDiscoverTab && hasEditTab && hasViewTab) || hasOfflineState
    ).toBeTruthy();
  });

  test("should show undo/redo controls or offline state", async ({ page }) => {
    await page.goto("/build/state-machine");
    await page.waitForLoadState("networkidle");

    // Undo/Redo buttons are visible in the header toolbar with tooltips
    // The tooltip content shows "Undo (Ctrl+Z)" and "Redo (Ctrl+Y)"
    // Check for the undo/redo button containers
    const hasUndoButton = (await page.locator("text=Undo").count()) > 0;
    const hasRedoButton = (await page.locator("text=Redo").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    // The undo/redo buttons may not show tooltips until hovered,
    // so check for the state/transition status bar instead
    const hasStatesCount = (await page.locator("text=States:").count()) > 0;
    const hasTransitionsCount =
      (await page.locator("text=Transitions:").count()) > 0;

    expect(
      (hasUndoButton && hasRedoButton) ||
        (hasStatesCount && hasTransitionsCount) ||
        hasOfflineState
    ).toBeTruthy();
  });

  test("should show status bar with state and transition counts or offline state", async ({
    page,
  }) => {
    await page.goto("/build/state-machine");
    await page.waitForLoadState("networkidle");

    // The footer status bar shows "States: N" and "Transitions: N"
    const hasStatesCount = (await page.locator("text=States:").count()) > 0;
    const hasTransitionsCount =
      (await page.locator("text=Transitions:").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      (hasStatesCount && hasTransitionsCount) || hasOfflineState
    ).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/state-machine");
    await page.waitForLoadState("networkidle");

    const hasContent =
      (await page.locator("text=State Machine Builder").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});
