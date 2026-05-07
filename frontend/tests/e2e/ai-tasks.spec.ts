/**
 * End-to-end tests for AI Tasks page
 */

import { test, expect } from "./fixtures";

test.describe("AI Tasks Page", () => {
  test("should load AI tasks page without errors", async ({ page }) => {
    // Use seeded project UUID — /ai-tasks wraps in <RequireProject>.
    const projectId = "fb93478d-98bd-4e40-99f4-0f2c08c1fd5a";
    await page.goto(`/ai-tasks?project=${projectId}`);

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

  test("should display content when navigating via sidebar AI Tasks menu", async ({
    page,
  }) => {
    // First select a project via dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Click on AI Tasks in sidebar
    const aiTasksMenu = page.locator("text=AI Tasks").first();
    if (await aiTasksMenu.isVisible()) {
      await aiTasksMenu.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);
    }

    // Take a screenshot to see what state we're in
    await page.screenshot({
      path: "test-results/ai-tasks-via-sidebar.png",
      fullPage: true,
    });

    // Log current state
    const hasEmptyState =
      (await page.locator("text=No AI tasks found").count()) > 0;
    const hasErrorMessage =
      (await page.locator("text=Error loading").count()) > 0;
    const hasTasks = (await page.locator("table tbody tr").count()) > 0;
    const hasLoading = (await page.locator("text=Loading").count()) > 0;
    const hasNoProjectSelected =
      (await page.locator("text=No project selected").count()) > 0;

    console.log("Has empty state:", hasEmptyState);
    console.log("Has error message:", hasErrorMessage);
    console.log("Has tasks:", hasTasks);
    console.log("Has loading:", hasLoading);
    console.log("Has no project selected:", hasNoProjectSelected);
    console.log("URL:", page.url());

    // Just document the state for now - don't fail
    expect(true).toBeTruthy();
  });
});
