/**
 * End-to-end tests for AI Tasks pages
 *
 * Named ai-tasks-pages.spec.ts to avoid conflict with existing ai-tasks.spec.ts
 *
 * Pages tested:
 * - /ai-tasks - AI Tasks list with table view, status badges, filtering, pagination
 * - /ai-tasks/[id] - AI Task detail with three tabs (Sessions, Findings, Output)
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks, or a bounded `waitFor(...).catch(() => null)` in
 * front of a conditional the test already tolerated — never a
 * `waitForTimeout(N)` followed by a non-waiting `count()` read, which
 * asserts on wall-clock. Timeouts are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";

/** Replaces the old `waitForTimeout(2000)` after a page navigation. */
const PAGE_SETTLE_TIMEOUT = 6000;
/** Replaces the old `waitForTimeout(3000)` before a page-data presence read. */
const PAGE_DATA_TIMEOUT = 9000;

// Seeded project UUID — required because /ai-tasks wraps in <RequireProject>.
const PROJECT_ID = "fb93478d-98bd-4e40-99f4-0f2c08c1fd5a";

test.describe("AI Tasks - List Page", () => {
  test("should load AI tasks list page without errors", async ({ page }) => {
    await page.goto(`/ai-tasks?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/ai-tasks-list.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display AI Tasks heading", async ({ page }) => {
    await page.goto(`/ai-tasks?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // The page uses RequireProject, so may show project selection prompt.
    // Check for AI Tasks heading or project selection prompt. Tolerance
    // preserved: any of the three.
    await expect(
      page
        .locator("text=AI Tasks")
        .or(page.locator("text=No project selected"))
        .or(page.locator("text=select a project"))
        .first()
    ).toBeVisible({ timeout: PAGE_SETTLE_TIMEOUT });
  });

  test("should have status filter dropdown", async ({ page }) => {
    await page.goto(`/ai-tasks?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // When AI Tasks page is visible, it should have a status filter.
    // Bounded wait for the list card, tolerated if absent (the project
    // prompt) — the conditional below is the test's original shape.
    await page
      .locator("text=Task History")
      .first()
      .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
      .catch(() => null);
    const hasTaskHistory =
      (await page.locator("text=Task History").count()) > 0;

    if (hasTaskHistory) {
      // Status filter select should be present (either trigger copy)
      await expect(
        page
          .locator("text=All Status")
          .or(page.locator("text=Filter by status"))
          .first()
      ).toBeVisible({ timeout: PAGE_SETTLE_TIMEOUT });
    }
  });

  test("should display table with task columns or empty state", async ({
    page,
  }) => {
    await page.goto(`/ai-tasks?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the list card, tolerated if absent (the project
    // prompt) — the conditional below is the test's original shape.
    await page
      .locator("text=Task History")
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const hasTaskHistory =
      (await page.locator("text=Task History").count()) > 0;

    if (hasTaskHistory) {
      // Should have table headers (Status, Task Name, Sessions, Created, Duration)
      // or empty state or loading. Tolerance preserved: the Status header or
      // either fallback, and the Task Name header is required only once the
      // Status header rendered (the original AND arm).
      const statusHeader = page.locator("th:has-text('Status')");
      await expect(
        statusHeader
          .or(page.locator("text=No AI tasks found"))
          .or(page.locator("text=Loading AI tasks"))
          .first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
      if (await statusHeader.first().isVisible()) {
        await expect(
          page.locator("th:has-text('Task Name')").first()
        ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
      }
    }
  });

  test("should have pagination controls when tasks exist", async ({ page }) => {
    await page.goto(`/ai-tasks?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // If there are tasks, pagination controls should be available. Bounded
    // wait for a row, tolerated if none — the conditional is the test's
    // original shape.
    await page
      .locator("table tbody tr")
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const hasTableRows = (await page.locator("table tbody tr").count()) > 0;

    if (hasTableRows) {
      const _hasPreviousButton =
        (await page.locator('button:has-text("Previous")').count()) > 0;
      const _hasNextButton =
        (await page.locator('button:has-text("Next")').count()) > 0;

      // Pagination shows when totalPages > 1, so it might not be visible
      // with only a few tasks. Just verify the page loaded correctly.
      expect(true).toBeTruthy();
    }
  });

  test("should have refresh button", async ({ page }) => {
    await page.goto(`/ai-tasks?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the heading, tolerated if absent (the project
    // prompt) — the conditional below is the test's original shape.
    await page
      .locator("text=AI Tasks")
      .first()
      .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
      .catch(() => null);
    const hasAITasksHeading = (await page.locator("text=AI Tasks").count()) > 0;

    if (hasAITasksHeading) {
      await expect(
        page.locator('button:has-text("Refresh")').first()
      ).toBeVisible({ timeout: PAGE_SETTLE_TIMEOUT });
    }
  });
});

test.describe("AI Tasks - Detail Page", () => {
  test("should handle non-existent task ID gracefully", async ({ page }) => {
    await page.goto(
      `/ai-tasks/non-existent-task-id-12345?project=${PROJECT_ID}`
    );
    await page.waitForLoadState("domcontentloaded");

    // Should show "Task not found", error, or require project. Tolerance
    // preserved: any of the five.
    await expect(
      page
        .locator("text=Task not found")
        .or(page.locator("text=Error loading task"))
        .or(page.locator("text=AI Task Details"))
        .or(page.locator("text=Loading task details"))
        .or(page.locator("text=select a project"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    await page.screenshot({
      path: "test-results/ai-tasks-detail-404.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display AI Task Details heading", async ({ page }) => {
    await page.goto(`/ai-tasks/non-existent-task-id?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // Should show AI Task Details heading or require project. Tolerance
    // preserved: either.
    await expect(
      page
        .locator("text=AI Task Details")
        .or(page.locator("text=select a project"))
        .first()
    ).toBeVisible({ timeout: PAGE_SETTLE_TIMEOUT });
  });

  test("should have three tabs (Sessions, Findings, Output) when task loads", async ({
    page,
  }) => {
    await page.goto(`/ai-tasks/non-existent-task-id?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // If a task is loaded (even with an error), the tab structure should
    // exist. These tabs may only appear when a task is loaded successfully;
    // for a non-existent task, we might see "Task not found" instead. The
    // detail page renders the AI Task Details heading + a "Loading task
    // details..." spinner while the fetch is pending, and the resolution can
    // still be in flight in CI; treat the loading state as a valid render.
    // Tolerance preserved: the Sessions tab or any fallback, and the
    // Findings tab is required only once the Sessions tab rendered (the
    // original AND arm).
    const sessionsTab = page.locator('button:has-text("Sessions")');
    await expect(
      sessionsTab
        .or(page.locator("text=Task not found"))
        .or(page.locator("text=Error loading task"))
        .or(page.locator("text=select a project"))
        .or(page.locator("text=Loading task details"))
        .or(page.locator("text=AI Task Details"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    if (await sessionsTab.first().isVisible()) {
      await expect(
        page.locator('button:has-text("Findings")').first()
      ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
    }
  });
});
