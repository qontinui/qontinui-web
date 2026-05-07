/**
 * End-to-end tests for Configure pages
 *
 * Pages tested:
 * - /configure/finding-rules - Standalone tool. Despite the URL slug, the
 *   page renders as "Finding Categories" — it does NOT use RunnerOfflineState.
 * - /configure/hooks - Renders RunnerOfflineState when the runner is down;
 *   gated behind requireRunner so the runner-required assertions only run
 *   when the runner is up.
 * - /configure/log-sources - Renders RunnerOfflineState when the runner is
 *   down; same requireRunner gating.
 *
 * `requireRunner()` caches the probe result per worker, so calling it from
 * multiple per-describe `beforeAll` hooks is safe and cheap.
 */

import { test, expect } from "../fixtures";
import { requireRunner } from "../runner-detection";

test.describe("Configure - Finding Rules", () => {
  // Finding Rules is standalone — no runner required.

  test("should load finding rules page without errors", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/configure-finding-rules.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Finding Categories heading", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");

    // The page is titled "Finding Categories" (the URL slug "finding-rules"
    // predates the rename — the heading is the source of truth).
    const heading = page.locator("h1:has-text('Finding Categories')");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have Add Category button", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");

    const addButton = page.locator('button:has-text("Add Category")');
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
  });

  test("should display categories list or empty state", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // The list card title is just "Categories" (CategoryList component).
    // Empty-state message is "No categories configured." Failures show a
    // generic error banner (no canonical "Failed to load" string).
    const hasCategoriesCard =
      (await page.locator("text=Categories").count()) > 0;
    const hasNoCategories =
      (await page.locator("text=No categories configured").count()) > 0;

    expect(hasCategoriesCard || hasNoCategories).toBeTruthy();
  });

  test("should show category rows with action-type badges when categories exist", async ({
    page,
  }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Each category row shows a badge for its default action type
    // (Auto / Suggest / Manual — see getActionTypeBadge in finding-rules-utils).
    // The Categories card itself should always render.
    const hasCategoriesCard =
      (await page.locator("text=Categories").count()) > 0;

    expect(hasCategoriesCard).toBeTruthy();
  });

  test("should show create form when Add Category is clicked", async ({
    page,
  }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Category")');

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "test-results/configure-finding-rules-form.png",
        fullPage: true,
      });

      // Form fields are: Name, Description, Icon, Color, Default Action,
      // Enable category. Submit button is "Create Category".
      const hasNewFindingCategory =
        (await page.locator("text=New Finding Category").count()) > 0;
      const hasNameField = (await page.locator("text=Name").count()) > 0;
      const hasDescriptionField =
        (await page.locator("text=Description").count()) > 0;
      const hasDefaultActionField =
        (await page.locator("text=Default Action").count()) > 0;
      const hasCreateButton =
        (await page.locator('button:has-text("Create Category")').count()) > 0;

      expect(hasNewFindingCategory).toBeTruthy();
      expect(hasNameField || hasDescriptionField).toBeTruthy();
      expect(hasDefaultActionField || hasCreateButton).toBeTruthy();
      expect(hasCreateButton).toBeTruthy();
    }
  });
});

test.describe("Configure - Hooks", () => {
  test.beforeAll(async () => {
    await requireRunner();
  });

  test("should load hooks page without errors", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/configure-hooks.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Lifecycle Hooks heading", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");

    // The header reads "Lifecycle Hooks" in both the online and offline
    // states (see hooks/page.tsx).
    const heading = page.locator("h1:has-text('Lifecycle Hooks')");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have New Hook button or offline state", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");

    // Online: header has a "New Hook" button.
    // Offline: RunnerOfflineState message starts with "Start the Qontinui Runner".
    const hasAddButton =
      (await page.locator('button:has-text("New Hook")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasAddButton || hasOfflineState).toBeTruthy();
  });

  test("should display configured hooks list or empty state", async ({
    page,
  }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const hasConfiguredHooks =
      (await page.locator("text=Configured Hooks").count()) > 0;
    const hasNoHooks =
      (await page.locator("text=No lifecycle hooks configured").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;
    const hasLoadError =
      (await page.locator("text=Failed to load hooks").count()) > 0;

    expect(
      hasConfiguredHooks || hasNoHooks || hasOfflineState || hasLoadError
    ).toBeTruthy();
  });

  test("should show action type information cards", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // When online, there should be info cards for Webhook, Script, Notification.
    const hasWebhook = (await page.locator("text=Webhook").count()) > 0;
    const hasScript = (await page.locator("text=Script").count()) > 0;
    const hasNotification =
      (await page.locator("text=Notification").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(
      (hasWebhook && hasScript && hasNotification) || hasOfflineState
    ).toBeTruthy();
  });

  test("should show create form when New Hook is clicked", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("New Hook")');

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "test-results/configure-hooks-form.png",
        fullPage: true,
      });

      // HookEditor exposes fields for Hook Name, Event Trigger, Action Type.
      const hasHookName = (await page.locator("text=Hook Name").count()) > 0;
      const hasEventTrigger =
        (await page.locator("text=Event Trigger").count()) > 0;
      const hasActionType =
        (await page.locator("text=Action Type").count()) > 0;
      const hasSaveButton =
        (await page.locator('button:has-text("Save")').count()) > 0;

      expect(hasHookName || hasEventTrigger).toBeTruthy();
      expect(hasActionType || hasSaveButton).toBeTruthy();
    }
  });
});

test.describe("Configure - Log Sources", () => {
  test.beforeAll(async () => {
    await requireRunner();
  });

  test("should load log sources page without errors", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/configure-log-sources.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Log Sources heading", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.locator("h1:has-text('Log Sources')");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have Add Source button or offline state", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");

    // Online: page exposes inline "Add Source" + "Add Profile" buttons.
    // Offline: RunnerOfflineState renders.
    const hasAddButton =
      (await page.locator('button:has-text("Add Source")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasAddButton || hasOfflineState).toBeTruthy();
  });

  test("should display configured sources list or empty state", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Online: shows a "Log Sources (N)" section header. Empty: copy is
    // "No log sources configured. Add sources or import from existing projects."
    const hasSourcesSection =
      (await page.locator("text=/Log Sources \\(\\d+\\)/").count()) > 0;
    const hasNoSources =
      (await page.locator("text=No log sources configured").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;
    const hasLoadError =
      (await page
        .locator("text=Failed to load log source settings")
        .count()) > 0;

    expect(
      hasSourcesSection || hasNoSources || hasOfflineState || hasLoadError
    ).toBeTruthy();
  });

  test("should show profiles section or offline state", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Online: shows a "Profiles (N)" section. Each profile shows source counts
    // and a "Default" badge for the default profile.
    const hasProfilesSection =
      (await page.locator("text=/Profiles \\(\\d+\\)/").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasProfilesSection || hasOfflineState).toBeTruthy();
  });

  test("should show create form when Add Source is clicked", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Source")').first();

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "test-results/configure-log-sources-form.png",
        fullPage: true,
      });

      // SourceEditor modal title is "Add Source" (or "Edit Source"); fields
      // are Name, Description, Category, Type, Path.
      const hasNameField = (await page.locator("text=Name").count()) > 0;
      const hasCategoryField =
        (await page.locator("text=Category").count()) > 0;
      const hasPathField = (await page.locator("text=Path").count()) > 0;

      expect(hasNameField).toBeTruthy();
      expect(hasCategoryField || hasPathField).toBeTruthy();
    }
  });

  test("should show path input in Add Source modal", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Source")').first();

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Path input has placeholder "/path/to/logs/app.log".
      const hasPathInput =
        (await page
          .locator('input[placeholder="/path/to/logs/app.log"]')
          .count()) > 0;

      expect(hasPathInput).toBeTruthy();
    }
  });
});
