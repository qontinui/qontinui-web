/**
 * End-to-end tests for AI Tasks page
 *
 * The /ai-tasks page renders RunnerOfflineState ("Runner Not
 * Connected") when no runner is reachable on :9876 — the entire
 * page surface depends on runner-driven data. CI never starts a
 * runner, so this spec auto-skips there and runs locally when a
 * runner is up.
 */

import { test, expect } from "./fixtures";
import { requireRunner } from "./runner-detection";
import { TEST_PROJECT_ID } from "./test-project";

test.beforeAll(async () => {
  await requireRunner();
});

test.describe("AI Tasks Page", () => {
  test("should load AI tasks page without errors", async ({ page }) => {
    // Use seeded project UUID — /ai-tasks wraps in <RequireProject>.
    await page.goto(`/ai-tasks?project=${TEST_PROJECT_ID}`);

    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");

    // Take a screenshot
    await page.screenshot({
      path: "test-results/ai-tasks-page.png",
      fullPage: true,
    });

    // Page should not have a 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Check that the page has expected elements
    // Either the "AI Tasks" heading or "Task History" should be visible
    const hasAITasksHeading = (await page.locator("text=AI Tasks").count()) > 0;
    const hasTaskHistoryHeading =
      (await page.locator("text=Task History").count()) > 0;
    expect(hasAITasksHeading || hasTaskHistoryHeading).toBeTruthy();
  });
});
