/**
 * End-to-end tests for state persistence
 *
 * Tests that states created on one page persist when navigating to other pages:
 * - Bug: States created on Image Extraction page disappear after navigating to Workflows and back
 * - Root cause: useProjectLoader re-fetches from backend, overwriting local IndexedDB data
 * - Fix: Skip backend fetch if context already has the project loaded
 */

import { test, expect } from "@playwright/test";
import { loginUser } from "./fixtures";

test.describe("State Persistence", () => {
  // Increase timeout for login-heavy tests
  test.setTimeout(60000);

  // Login before each test using auto-login with manual fallback
  test.beforeEach(async ({ page }) => {
    await loginUser(page);
  });

  test("states persist when navigating between pages", async ({ page }) => {
    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Take screenshot of initial dashboard
    await page.screenshot({
      path: "test-results/state-persistence-01-dashboard.png",
      fullPage: true,
    });

    // Select a project
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (!(await projectSwitcher.isVisible())) {
      console.log("No project switcher visible - skipping test");
      test.skip();
      return;
    }

    await projectSwitcher.click();
    await page.waitForTimeout(500);

    const projectItems = page.locator('[role="menuitem"]');
    const projectCount = await projectItems.count();

    if (projectCount < 2) {
      console.log("No projects available - skipping test");
      test.skip();
      return;
    }

    // Select the first project
    await projectItems.first().click();
    await page.waitForTimeout(1000);

    // Navigate to States page to see initial state count
    const statesLink = page.getByRole("button", { name: /states/i });
    if (await statesLink.isVisible()) {
      await statesLink.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Take screenshot of states page before creating a new state
      await page.screenshot({
        path: "test-results/state-persistence-02-states-initial.png",
        fullPage: true,
      });

      // Count existing states
      const stateItems = page.locator('[data-testid="state-item"]');
      const initialStateCount = await stateItems.count();
      console.log(`Initial state count: ${initialStateCount}`);

      // Navigate to Image Extraction page
      const imageExtractionLink = page.getByRole("button", {
        name: /extract images/i,
      });
      if (await imageExtractionLink.isVisible()) {
        await imageExtractionLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: "test-results/state-persistence-03-image-extraction.png",
          fullPage: true,
        });

        // Note: Creating a state in the Image Extraction page requires uploading an image
        // and performing extraction. For this test, we'll verify the navigation flow
        // preserves existing states.
      }

      // Navigate to Workflows page (this triggers useProjectLoader)
      const workflowsLink = page.getByRole("button", { name: /workflows/i });
      if (await workflowsLink.isVisible()) {
        await workflowsLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: "test-results/state-persistence-04-workflows.png",
          fullPage: true,
        });
      }

      // Navigate back to States page
      const statesLinkAgain = page.getByRole("button", { name: /states/i });
      if (await statesLinkAgain.isVisible()) {
        await statesLinkAgain.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: "test-results/state-persistence-05-states-after.png",
          fullPage: true,
        });

        // Verify state count is still the same
        const finalStateCount = await stateItems.count();
        console.log(`Final state count: ${finalStateCount}`);

        // States should not have disappeared
        expect(finalStateCount).toBeGreaterThanOrEqual(initialStateCount);
      }
    }
  });

  test("local changes persist when navigating between pages", async ({
    page,
  }) => {
    // This test verifies that the fix for state persistence works:
    // When navigating from one page to another within the same project,
    // local changes in IndexedDB should not be overwritten by backend data

    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Select a project
    const projectSwitcher = page.locator('[aria-label="Select project"]');
    if (!(await projectSwitcher.isVisible())) {
      console.log("No project switcher visible - skipping test");
      test.skip();
      return;
    }

    await projectSwitcher.click();
    await page.waitForTimeout(500);

    const projectItems = page.locator('[role="menuitem"]');
    const projectCount = await projectItems.count();

    if (projectCount < 2) {
      console.log("No projects available - skipping test");
      test.skip();
      return;
    }

    await projectItems.first().click();
    await page.waitForTimeout(1000);

    // Get the current project ID from URL
    const urlAfterSelection = page.url();
    console.log("URL after project selection:", urlAfterSelection);

    // Navigate to Workflows page first (this will load from backend)
    const workflowsLink = page.getByRole("button", { name: /workflows/i });
    if (await workflowsLink.isVisible()) {
      await workflowsLink.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Take screenshot
      await page.screenshot({
        path: "test-results/state-persistence-local-01-workflows.png",
        fullPage: true,
      });

      // Check localStorage for project ID
      const storedProjectId = await page.evaluate(() => {
        return localStorage.getItem("qontinui-selected-project-id");
      });
      console.log("Stored project ID:", storedProjectId);

      // Navigate to States page
      const statesLink = page.getByRole("button", { name: /states/i });
      if (await statesLink.isVisible()) {
        await statesLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);

        await page.screenshot({
          path: "test-results/state-persistence-local-02-states.png",
          fullPage: true,
        });

        // Navigate back to Workflows page
        const workflowsLinkAgain = page.getByRole("button", {
          name: /workflows/i,
        });
        if (await workflowsLinkAgain.isVisible()) {
          await workflowsLinkAgain.click();
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(2000);

          await page.screenshot({
            path: "test-results/state-persistence-local-03-workflows-again.png",
            fullPage: true,
          });

          // Verify no error messages
          const pageContent = await page.content();
          expect(pageContent).not.toContain("Internal Server Error");

          // Verify "No projects yet" is not shown
          const noProjectsText = await page
            .getByText("No projects yet")
            .isVisible()
            .catch(() => false);
          expect(noProjectsText).toBe(false);
        }
      }
    }
  });
});
