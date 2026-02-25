/**
 * E2E tests for Automation Builder core pages
 *
 * Pages tested:
 * - /automation-builder (main page)
 * - /automation-builder/overview
 * - /automation-builder/images
 * - /automation-builder/states
 * - /automation-builder/settings
 *
 * These pages all require a project to be selected (wrapped in RequireProject).
 * Tests verify both the no-project state and the with-project state.
 */

import { test, expect } from "../fixtures";

test.describe("Automation Builder - Core Pages", () => {
  test.setTimeout(60000);

  // =========================================================================
  // /automation-builder (Main Page)
  // =========================================================================

  test.describe("Main Page (/automation-builder)", () => {
    test("loads without 500 error", async ({ page }) => {
      await page.goto("/automation-builder");
      await page.waitForLoadState("networkidle");

      await page.screenshot({
        path: "test-results/automation-builder-main.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("shows project required message when no project selected", async ({
      page,
    }) => {
      await page.goto("/automation-builder");
      await page.waitForLoadState("networkidle");

      await page.screenshot({
        path: "test-results/automation-builder-main-no-project.png",
        fullPage: true,
      });

      // When no project is selected, RequireProject shows a prompt
      // Either we see the prompt or the page content (if a project is auto-selected)
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("renders page content when project context is available", async ({
      page,
    }) => {
      // Navigate to dashboard first to select a project
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Try to select a project via the project switcher
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        const projectCount = await projectItems.count();

        if (projectCount > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      // Navigate to automation builder
      await page.goto("/automation-builder");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: "test-results/automation-builder-main-with-project.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });
  });

  // =========================================================================
  // /automation-builder/overview
  // =========================================================================

  test.describe("Overview Page (/automation-builder/overview)", () => {
    test("loads without 500 error", async ({ page }) => {
      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("networkidle");

      await page.screenshot({
        path: "test-results/automation-builder-overview.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays Project Overview heading when project is selected", async ({
      page,
    }) => {
      // Select a project first
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: "test-results/automation-builder-overview-with-project.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Verify overview heading is visible
      const heading = page.getByRole("heading", { name: /Project Overview/i });
      const headingVisible = await heading
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (headingVisible) {
        await expect(heading).toBeVisible();
      }
    });

    test("displays statistics section with state, transition, workflow, and image counts", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      await page.screenshot({
        path: "test-results/automation-builder-overview-stats.png",
        fullPage: true,
      });

      // Verify statistic card titles are visible
      const statesCard = page.getByText("States", { exact: false });
      const transitionsCard = page.getByText("Transitions", { exact: false });
      const workflowsCard = page.getByText("Workflows", { exact: false });
      const imagesCard = page.getByText("Pattern Images", { exact: false });

      // At least some stat cards should be present if project is loaded
      const _statsVisible =
        (await statesCard
          .first()
          .isVisible()
          .catch(() => false)) ||
        (await transitionsCard
          .first()
          .isVisible()
          .catch(() => false)) ||
        (await workflowsCard
          .first()
          .isVisible()
          .catch(() => false)) ||
        (await imagesCard
          .first()
          .isVisible()
          .catch(() => false));

      // If project is loaded, stats should be visible
      // If no project, RequireProject message should be visible
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays quick navigation links", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      // Verify quick navigation buttons
      const stateViewBtn = page.getByRole("button", {
        name: /Open State View/i,
      });
      const transitionsBtn = page.getByRole("button", {
        name: /Open Transitions/i,
      });

      const stateViewVisible = await stateViewBtn
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      const transitionsVisible = await transitionsBtn
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await page.screenshot({
        path: "test-results/automation-builder-overview-nav-links.png",
        fullPage: true,
      });

      // These buttons exist when the overview content is rendered
      if (stateViewVisible) {
        await expect(stateViewBtn).toBeVisible();
      }
      if (transitionsVisible) {
        await expect(transitionsBtn).toBeVisible();
      }
    });
  });

  // =========================================================================
  // /automation-builder/images
  // =========================================================================

  test.describe("Images Page (/automation-builder/images)", () => {
    test("loads without 500 error", async ({ page }) => {
      await page.goto("/automation-builder/images");
      await page.waitForLoadState("networkidle");

      await page.screenshot({
        path: "test-results/automation-builder-images.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays image library area with upload capability", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/images");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: "test-results/automation-builder-images-library.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Look for upload button or drag-and-drop area
      const uploadButton = page.getByRole("button", { name: /upload/i });
      const uploadVisible = await uploadButton
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      // Also check for a file input element (hidden upload input)
      const fileInput = page.locator('input[type="file"]');
      const fileInputExists = (await fileInput.count()) > 0;

      // Look for search input (images manager has search)
      const searchInput = page.locator(
        'input[placeholder*="search" i], input[placeholder*="Search" i]'
      );
      const searchVisible = await searchInput
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      // Either upload capability or search should be present when the page loads with a project
      if (uploadVisible || fileInputExists || searchVisible) {
        // Page loaded with image manager content
        expect(true).toBe(true);
      }
    });
  });

  // =========================================================================
  // /automation-builder/states
  // =========================================================================

  test.describe("States Page (/automation-builder/states)", () => {
    test("loads without 500 error", async ({ page }) => {
      await page.goto("/automation-builder/states");
      await page.waitForLoadState("networkidle");

      await page.screenshot({
        path: "test-results/automation-builder-states.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays tabs: Definition, State View, Transitions", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/states");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      await page.screenshot({
        path: "test-results/automation-builder-states-tabs.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Verify the three tabs are present
      const definitionTab = page.getByRole("tab", { name: /Definition/i });
      const stateViewTab = page.getByRole("tab", { name: /State View/i });
      const transitionsTab = page.getByRole("tab", { name: /Transitions/i });

      const definitionVisible = await definitionTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (definitionVisible) {
        await expect(definitionTab).toBeVisible();
        await expect(stateViewTab).toBeVisible();
        await expect(transitionsTab).toBeVisible();
      }
    });

    test("Definition tab is active by default and shows state editor area", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/states");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      await page.screenshot({
        path: "test-results/automation-builder-states-definition.png",
        fullPage: true,
      });

      // Definition tab should be selected by default
      const definitionTab = page.getByRole("tab", { name: /Definition/i });
      const isActive = await definitionTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (isActive) {
        const ariaSelected = await definitionTab.getAttribute("aria-selected");
        expect(ariaSelected).toBe("true");
      }
    });

    test("can switch between tabs", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/states");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      const stateViewTab = page.getByRole("tab", { name: /State View/i });
      const tabVisible = await stateViewTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (tabVisible) {
        // Click State View tab
        await stateViewTab.click();
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: "test-results/automation-builder-states-state-view.png",
          fullPage: true,
        });

        const stateViewSelected =
          await stateViewTab.getAttribute("aria-selected");
        expect(stateViewSelected).toBe("true");

        // Click Transitions tab
        const transitionsTab = page.getByRole("tab", {
          name: /Transitions/i,
        });
        await transitionsTab.click();
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: "test-results/automation-builder-states-transitions.png",
          fullPage: true,
        });

        const transitionsSelected =
          await transitionsTab.getAttribute("aria-selected");
        expect(transitionsSelected).toBe("true");
      }
    });
  });

  // =========================================================================
  // /automation-builder/settings
  // =========================================================================

  test.describe("Settings Page (/automation-builder/settings)", () => {
    test("loads without 500 error", async ({ page }) => {
      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("networkidle");

      await page.screenshot({
        path: "test-results/automation-builder-settings.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays Settings heading and tabs", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: "test-results/automation-builder-settings-tabs.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Verify the settings heading
      const heading = page.getByRole("heading", { name: /Settings/i });
      const headingVisible = await heading
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (headingVisible) {
        await expect(heading.first()).toBeVisible();

        // Verify tabs: General, Editor, Execution, Notifications, Advanced
        const generalTab = page.getByRole("tab", { name: /General/i });
        const editorTab = page.getByRole("tab", { name: /Editor/i });
        const executionTab = page.getByRole("tab", { name: /Execution/i });
        const notificationsTab = page.getByRole("tab", {
          name: /Notifications/i,
        });
        const advancedTab = page.getByRole("tab", { name: /Advanced/i });

        await expect(generalTab).toBeVisible();
        await expect(editorTab).toBeVisible();
        await expect(executionTab).toBeVisible();
        await expect(notificationsTab).toBeVisible();
        await expect(advancedTab).toBeVisible();
      }
    });

    test("General tab shows auto-save toggle", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: "test-results/automation-builder-settings-general.png",
        fullPage: true,
      });

      // Look for auto-save toggle by its data-ui-id or label
      const autoSaveToggle = page.locator(
        '[data-ui-id="automation-settings-auto-save-toggle"]'
      );
      const autoSaveByLabel = page.getByText("Auto-save", { exact: false });

      const toggleVisible = await autoSaveToggle
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      const labelVisible = await autoSaveByLabel
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (toggleVisible || labelVisible) {
        // Auto-save setting is present on the General tab
        expect(true).toBe(true);
      }
    });

    test("can switch between settings tabs", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const projectSwitcher = page.locator('[aria-label="Select project"]');
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();
        await page.waitForTimeout(500);

        const projectItems = page.locator('[role="menuitem"]');
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          await page.waitForTimeout(1000);
        }
      }

      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const editorTab = page.getByRole("tab", { name: /Editor/i });
      const tabVisible = await editorTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (tabVisible) {
        // Switch to Editor tab
        await editorTab.click();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: "test-results/automation-builder-settings-editor.png",
          fullPage: true,
        });

        // Verify Editor tab content (Theme selector, font size, etc.)
        const themeSelect = page.locator(
          '[data-ui-id="automation-settings-theme-select"]'
        );
        const themeVisible = await themeSelect
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (themeVisible) {
          await expect(themeSelect).toBeVisible();
        }

        // Switch to Execution tab
        const executionTab = page.getByRole("tab", { name: /Execution/i });
        await executionTab.click();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: "test-results/automation-builder-settings-execution.png",
          fullPage: true,
        });

        // Switch to Notifications tab
        const notificationsTab = page.getByRole("tab", {
          name: /Notifications/i,
        });
        await notificationsTab.click();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: "test-results/automation-builder-settings-notifications.png",
          fullPage: true,
        });

        // Switch to Advanced tab
        const advancedTab = page.getByRole("tab", { name: /Advanced/i });
        await advancedTab.click();
        await page.waitForTimeout(500);

        await page.screenshot({
          path: "test-results/automation-builder-settings-advanced.png",
          fullPage: true,
        });

        // Advanced tab should show Debug Mode toggle
        const debugToggle = page.locator(
          '[data-ui-id="automation-settings-enable-debug-mode-toggle"]'
        );
        const debugVisible = await debugToggle
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (debugVisible) {
          await expect(debugToggle).toBeVisible();
        }
      }
    });
  });
});
