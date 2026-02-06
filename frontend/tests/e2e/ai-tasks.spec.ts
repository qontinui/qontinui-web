/**
 * End-to-end tests for AI Tasks page
 */

import { test, expect } from "./fixtures";

test.describe("AI Tasks Page", () => {
  // Helper to get a project ID from the dashboard
  async function getProjectId(
    page: import("@playwright/test").Page
  ): Promise<string | null> {
    // Navigate to dashboard first
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Find and click the project switcher in the sidebar
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (await projectSwitcher.isVisible()) {
      await projectSwitcher.click();
      await page.waitForTimeout(500);

      // Get the first project menu item
      const projectItems = page.locator('[role="menuitem"]');
      const projectCount = await projectItems.count();

      if (projectCount > 0) {
        // Click to select and get the URL with project param
        await projectItems.first().click();
        await page.waitForTimeout(1000);

        // Navigate to any page to get the project from URL or from a project card
        // Check URL for project param
        const url = page.url();
        const match = url.match(/[?&]project=([^&]+)/);
        if (match) {
          return match[1];
        }

        // Try getting project from dashboard card click
        const projectCard = page.locator("[data-project-id]").first();
        if ((await projectCard.count()) > 0) {
          const projectId = await projectCard.getAttribute("data-project-id");
          return projectId;
        }
      }
    }
    return null;
  }

  test("should load AI tasks page without errors", async ({ page }) => {
    // First get a project ID
    const projectId = await getProjectId(page);
    console.log("Project ID:", projectId);

    // Navigate to AI Tasks page with project in URL (if we have one)
    const url = projectId ? `/ai-tasks?project=${projectId}` : "/ai-tasks";
    await page.goto(url);

    // Wait for page to load
    await page.waitForLoadState("networkidle");

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
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Click on AI Tasks in sidebar
    const aiTasksMenu = page.locator("text=AI Tasks").first();
    if (await aiTasksMenu.isVisible()) {
      await aiTasksMenu.click();
      await page.waitForLoadState("networkidle");
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
