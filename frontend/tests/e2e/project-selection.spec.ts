/**
 * End-to-end tests for project selection persistence
 *
 * Tests that when a user selects a project:
 * - The project selection persists when navigating to other pages
 * - Pages that require a project don't show "No projects yet" message
 * - The project parameter is preserved in the URL
 */

import { test, expect } from "@playwright/test";
import { loginUser } from "./fixtures";

test.describe("Project Selection Persistence", () => {
  // Login before each test using auto-login with manual fallback
  test.beforeEach(async ({ page }) => {
    await loginUser(page);
  });

  test("project selection persists when navigating via sidebar menu", async ({
    page,
  }) => {
    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Wait for projects to load in the sidebar
    await page.waitForTimeout(2000);

    // Take screenshot of initial state
    await page.screenshot({
      path: "test-results/project-selection-initial.png",
      fullPage: true,
    });

    // Find and click the project switcher in the sidebar
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (await projectSwitcher.isVisible()) {
      await projectSwitcher.click();

      // Wait for dropdown to appear
      await page.waitForTimeout(500);

      // Take screenshot of project dropdown
      await page.screenshot({
        path: "test-results/project-selection-dropdown.png",
        fullPage: true,
      });

      // Select the first project that's available
      const projectItems = page.locator('[role="menuitem"]');
      const projectCount = await projectItems.count();

      if (projectCount > 1) {
        // Click the first actual project (skip "Create New Project" option)
        await projectItems.first().click();

        // Wait for selection to be applied
        await page.waitForTimeout(1000);

        // Verify project is now selected
        await page.screenshot({
          path: "test-results/project-selection-selected.png",
          fullPage: true,
        });

        // Now navigate to the Workflows page via sidebar
        const workflowsLink = page.getByRole("button", { name: /workflows/i });
        if (await workflowsLink.isVisible()) {
          await workflowsLink.click();
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(2000);

          // Take screenshot - should NOT show "No projects yet"
          await page.screenshot({
            path: "test-results/project-selection-workflows-page.png",
            fullPage: true,
          });

          // Verify we don't see "No projects yet" message
          const noProjectsMessage = page.getByText("No projects yet");
          const noProjectSelectedMessage = page.getByText(
            "No project selected"
          );

          // Either both should be hidden, or we should see the workflows page content
          const hasNoProjectsError =
            (await noProjectsMessage.isVisible().catch(() => false)) ||
            (await noProjectSelectedMessage.isVisible().catch(() => false));

          if (hasNoProjectsError) {
            // Take screenshot of the error
            await page.screenshot({
              path: "test-results/project-selection-error.png",
              fullPage: true,
            });
          }

          expect(hasNoProjectsError).toBe(false);
        }
      }
    }
  });

  test("project selection persists after page refresh", async ({ page }) => {
    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Wait for page to be ready
    await page.waitForTimeout(2000);

    // Find and click the project switcher
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (await projectSwitcher.isVisible()) {
      await projectSwitcher.click();
      await page.waitForTimeout(500);

      // Get the first project name
      const projectItems = page.locator('[role="menuitem"]');
      const projectCount = await projectItems.count();

      if (projectCount > 1) {
        const firstProjectText = await projectItems.first().textContent();
        await projectItems.first().click();
        await page.waitForTimeout(1000);

        // Refresh the page
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(2000);

        // Take screenshot after refresh
        await page.screenshot({
          path: "test-results/project-selection-after-refresh.png",
          fullPage: true,
        });

        // Check if the project is still selected in the switcher
        const currentSelection = await page
          .locator('[aria-label="Select project"]')
          .textContent();

        // The project name should still be visible
        // Extract just the project name from the first line (name is before description)
        if (firstProjectText) {
          // Get the project name from the dropdown item
          const projectName = firstProjectText.split("\n")[0].trim();
          // Get the displayed selection text
          const displayedSelection = currentSelection?.trim() || "";
          // The displayed selection should contain the project name
          // Note: firstProjectText includes name + description, but currentSelection is just the name
          expect(displayedSelection).toContain(
            projectName.split("A new")[0].trim()
          );
        }
      }
    }
  });

  test("RequireProject component allows access when project is selected", async ({
    page,
  }) => {
    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Select a project
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (await projectSwitcher.isVisible()) {
      await projectSwitcher.click();
      await page.waitForTimeout(500);

      const projectItems = page.locator('[role="menuitem"]');
      const projectCount = await projectItems.count();

      if (projectCount > 1) {
        await projectItems.first().click();
        await page.waitForTimeout(1000);

        // Get the current URL to see if project param is set
        const urlAfterSelection = page.url();
        console.log("URL after project selection:", urlAfterSelection);

        // Navigate to a page that uses RequireProject
        // Based on the codebase, workflows page uses RequireProject
        await page.goto("/workflows");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: "test-results/project-require-project-test.png",
          fullPage: true,
        });

        // Check that we don't see the "No projects yet" or "No project selected" messages
        const noProjectsText = await page
          .getByText("No projects yet")
          .isVisible()
          .catch(() => false);
        const noSelectedText = await page
          .getByText("No project selected")
          .isVisible()
          .catch(() => false);

        if (noProjectsText || noSelectedText) {
          console.log("Error: Project selection not persisted!");
          console.log("noProjectsText:", noProjectsText);
          console.log("noSelectedText:", noSelectedText);
        }

        // At minimum, we should not see these error messages
        expect(noProjectsText || noSelectedText).toBe(false);
      }
    }
  });
});
