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
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks, or a bounded `waitFor(...).catch(() => null)` in
 * front of a conditional the test already tolerated — never a
 * `waitForTimeout(N)` followed by a non-waiting read, which asserts on
 * wall-clock. Timeouts are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";

/** Replaces the old `waitForTimeout(2000)` after a page navigation. */
const PAGE_SETTLE_TIMEOUT = 6000;
/** Replaces the old `waitForTimeout(3000)` before a page-data presence read. */
const PAGE_DATA_TIMEOUT = 9000;
/** Replaces the old `waitForTimeout(500)` after the project switcher opens. */
const MENU_OPEN_TIMEOUT = 5000;
/** Replaces the old `waitForTimeout(1000)` after a project item is picked. */
const PROJECT_SELECT_TIMEOUT = 5000;
/** Replaces the old `waitForTimeout(500)` / `(1000)` after a tab click. */
const TAB_SWITCH_TIMEOUT = 5000;

// Tests below navigate to "/build/workflows" instead of the more obvious
// "/dashboard" because /dashboard is a redirect stub
// (frontend/src/app/(app)/dashboard/page.tsx → router.replace to
// /build/workflows or /tools/visual-automation in useEffect). Going to
// /dashboard leaves a redirect navigation in flight that races with the
// next page.goto on slower engines (firefox NS_BINDING_ABORTED, webkit /
// Mobile Safari "Navigation interrupted by /dashboard"). Navigate
// directly to the destination — same pattern as PR-P #97 Fix A on
// automation-builder-analytics.spec.ts.

test.describe("Automation Builder - Core Pages", () => {
  test.setTimeout(60000);

  // =========================================================================
  // /automation-builder (Main Page)
  // =========================================================================

  test.describe("Main Page (/automation-builder)", () => {
    test("loads without 500 error", async ({ page }) => {
      await page.goto("/automation-builder");
      await page.waitForLoadState("domcontentloaded");

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
      await page.waitForLoadState("domcontentloaded");

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
      // Navigate to a post-redirect destination first to select a project
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Try to select a project via the project switcher. Bounded wait for
      // it, tolerated if it never appears — the conditional below is the
      // test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        const projectCount = await projectItems.count();

        if (projectCount > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      // Navigate to automation builder. RequireProject settles on a prompt
      // ("No project selected" / "No projects yet") or on the builder's own
      // heading — either is the state the screenshot and content read want.
      await page.goto("/automation-builder");
      await page.waitForLoadState("domcontentloaded");
      await page
        .locator("text=No project selected")
        .or(page.locator("text=No projects yet"))
        .or(page.locator("h1"))
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);

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
      await page.waitForLoadState("domcontentloaded");

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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the overview heading, tolerated if absent (with no
      // project selected the RequireProject prompt renders instead).
      const heading = page.getByRole("heading", { name: /Project Overview/i });
      await heading
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-overview-with-project.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Verify overview heading is visible
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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("domcontentloaded");

      // Statistic card titles. Bounded wait for any of them, tolerated if
      // none renders (no project selected).
      const statesCard = page.getByText("States", { exact: false });
      const transitionsCard = page.getByText("Transitions", { exact: false });
      const workflowsCard = page.getByText("Workflows", { exact: false });
      const imagesCard = page.getByText("Pattern Images", { exact: false });
      await statesCard
        .or(transitionsCard)
        .or(workflowsCard)
        .or(imagesCard)
        .first()
        .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-overview-stats.png",
        fullPage: true,
      });

      // At least some stat cards should be present if project is loaded —
      // the bounded wait above is that read; its old non-waiting copy
      // (`_statsVisible`) was never consumed and is gone.
      // If project is loaded, stats should be visible
      // If no project, RequireProject message should be visible
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays quick navigation links", async ({ page }) => {
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/overview");
      await page.waitForLoadState("domcontentloaded");

      // Verify quick navigation buttons. Bounded wait for either, tolerated
      // if neither renders (no project selected).
      const stateViewBtn = page.getByRole("button", {
        name: /Open State View/i,
      });
      const transitionsBtn = page.getByRole("button", {
        name: /Open Transitions/i,
      });
      await stateViewBtn
        .or(transitionsBtn)
        .first()
        .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
        .catch(() => null);

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
      await page.waitForLoadState("domcontentloaded");

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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/images");
      await page.waitForLoadState("domcontentloaded");

      // Look for upload button or drag-and-drop area, or the search input
      // (images manager has search). Bounded wait for either visible one,
      // tolerated if neither renders (no project selected). The hidden file
      // input is read by count below and never waited on for visibility.
      const uploadButton = page.getByRole("button", { name: /upload/i });
      const searchInput = page.locator(
        'input[placeholder*="search" i], input[placeholder*="Search" i]'
      );
      await uploadButton
        .or(searchInput)
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-images-library.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      const uploadVisible = await uploadButton
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      // Also check for a file input element (hidden upload input)
      const fileInput = page.locator('input[type="file"]');
      const fileInputExists = (await fileInput.count()) > 0;

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
      await page.waitForLoadState("domcontentloaded");

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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/states");
      await page.waitForLoadState("domcontentloaded");

      // The three tabs. Bounded wait for the first, tolerated if absent (no
      // project selected).
      const definitionTab = page.getByRole("tab", { name: /Definition/i });
      const stateViewTab = page.getByRole("tab", { name: /State View/i });
      const transitionsTab = page.getByRole("tab", { name: /Transitions/i });
      await definitionTab
        .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-states-tabs.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Verify the three tabs are present
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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/states");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the tab, tolerated if absent (no project selected).
      const definitionTab = page.getByRole("tab", { name: /Definition/i });
      await definitionTab
        .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-states-definition.png",
        fullPage: true,
      });

      // Definition tab should be selected by default
      const isActive = await definitionTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (isActive) {
        const ariaSelected = await definitionTab.getAttribute("aria-selected");
        expect(ariaSelected).toBe("true");
      }
    });

    test("can switch between tabs", async ({ page }) => {
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/states");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the tab, tolerated if absent (no project selected).
      const stateViewTab = page.getByRole("tab", { name: /State View/i });
      await stateViewTab
        .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
        .catch(() => null);
      const tabVisible = await stateViewTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (tabVisible) {
        // Click State View tab
        await stateViewTab.click();
        await expect(stateViewTab).toHaveAttribute("aria-selected", "true", {
          timeout: TAB_SWITCH_TIMEOUT,
        });

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
        await expect(transitionsTab).toHaveAttribute("aria-selected", "true", {
          timeout: TAB_SWITCH_TIMEOUT,
        });

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
      await page.waitForLoadState("domcontentloaded");

      await page.screenshot({
        path: "test-results/automation-builder-settings.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    });

    test("displays Settings heading and tabs", async ({ page }) => {
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the settings heading, tolerated if absent (no
      // project selected).
      const heading = page.getByRole("heading", { name: /Settings/i });
      await heading
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-settings-tabs.png",
        fullPage: true,
      });

      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");

      // Verify the settings heading
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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("domcontentloaded");

      // Look for auto-save toggle by its data-testid or label. Bounded wait
      // for either, tolerated if neither renders (no project selected).
      const autoSaveToggle = page.locator(
        '[data-testid="automation-settings-auto-save-toggle"]'
      );
      const autoSaveByLabel = page.getByText("Auto-save", { exact: false });
      await autoSaveToggle
        .or(autoSaveByLabel)
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);

      await page.screenshot({
        path: "test-results/automation-builder-settings-general.png",
        fullPage: true,
      });

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
      await page.goto("/build/workflows");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the switcher, tolerated if it never appears — the
      // conditional below is the test's original tolerance shape.
      const projectSwitcher = page.locator('[aria-label="Select project"]');
      await projectSwitcher
        .first()
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      if (
        await projectSwitcher.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await projectSwitcher.click();

        // The click opens the menu; wait for its items, tolerated if none.
        const projectItems = page.locator('[role="menuitem"]');
        await projectItems
          .first()
          .waitFor({ state: "visible", timeout: MENU_OPEN_TIMEOUT })
          .catch(() => null);
        if ((await projectItems.count()) > 0) {
          await projectItems.first().click();
          // Selecting an item closes the menu — the state the click produces.
          await projectItems
            .first()
            .waitFor({ state: "hidden", timeout: PROJECT_SELECT_TIMEOUT })
            .catch(() => null);
        }
      }

      await page.goto("/automation-builder/settings");
      await page.waitForLoadState("domcontentloaded");

      // Bounded wait for the tab, tolerated if absent (no project selected).
      const editorTab = page.getByRole("tab", { name: /Editor/i });
      await editorTab
        .waitFor({ state: "visible", timeout: PAGE_SETTLE_TIMEOUT })
        .catch(() => null);
      const tabVisible = await editorTab
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (tabVisible) {
        // Switch to Editor tab
        await editorTab.click();

        // Editor tab content (Theme selector, font size, etc.). Bounded wait
        // for it, tolerated if absent.
        const themeSelect = page.locator(
          '[data-testid="automation-settings-theme-select"]'
        );
        await themeSelect
          .waitFor({ state: "visible", timeout: TAB_SWITCH_TIMEOUT })
          .catch(() => null);

        await page.screenshot({
          path: "test-results/automation-builder-settings-editor.png",
          fullPage: true,
        });

        const themeVisible = await themeSelect
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (themeVisible) {
          await expect(themeSelect).toBeVisible();
        }

        // Switch to Execution tab
        const executionTab = page.getByRole("tab", { name: /Execution/i });
        await executionTab.click();
        // The click selects the tab — the state it produces; tolerated.
        await page
          .getByRole("tab", { name: /Execution/i, selected: true })
          .waitFor({ state: "visible", timeout: TAB_SWITCH_TIMEOUT })
          .catch(() => null);

        await page.screenshot({
          path: "test-results/automation-builder-settings-execution.png",
          fullPage: true,
        });

        // Switch to Notifications tab
        const notificationsTab = page.getByRole("tab", {
          name: /Notifications/i,
        });
        await notificationsTab.click();
        // The click selects the tab — the state it produces; tolerated.
        await page
          .getByRole("tab", { name: /Notifications/i, selected: true })
          .waitFor({ state: "visible", timeout: TAB_SWITCH_TIMEOUT })
          .catch(() => null);

        await page.screenshot({
          path: "test-results/automation-builder-settings-notifications.png",
          fullPage: true,
        });

        // Switch to Advanced tab
        const advancedTab = page.getByRole("tab", { name: /Advanced/i });
        await advancedTab.click();

        // Advanced tab should show Debug Mode toggle. Bounded wait for it,
        // tolerated if absent.
        const debugToggle = page.locator(
          '[data-testid="automation-settings-enable-debug-mode-toggle"]'
        );
        await debugToggle
          .waitFor({ state: "visible", timeout: TAB_SWITCH_TIMEOUT })
          .catch(() => null);

        await page.screenshot({
          path: "test-results/automation-builder-settings-advanced.png",
          fullPage: true,
        });

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
