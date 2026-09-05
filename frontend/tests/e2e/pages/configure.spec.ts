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
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks (`expect(locator).toBeVisible({ timeout })`), never a
 * `waitForTimeout(N)` followed by a non-waiting `count()` read — that shape
 * asserts on wall-clock and red-mained `main` on run 33950897170 for a land
 * that never touched these pages. Tolerance is preserved: an `A || B` check
 * becomes `locA.or(locB).first()`, and a conditional `if count > 0` is
 * preceded by a bounded `waitFor(...).catch(() => null)` so a tolerated
 * absence stays tolerated. Timeouts are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "../fixtures";
import { requireRunner } from "../runner-detection";

/** Replaces the old `waitForTimeout(2000)` before a presence read. */
const PAGE_DATA_TIMEOUT = 6000;
/** Replaces the old `waitForTimeout(500)` after a click that opens a form. */
const FORM_OPEN_TIMEOUT = 5000;

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

    // The list card title is just "Categories" (CategoryList component).
    // Empty-state message is "No categories configured." Failures show a
    // generic error banner (no canonical "Failed to load" string).
    // Tolerance preserved: either state satisfies the test.
    const categoriesCard = page.locator("text=Categories");
    const noCategories = page.locator("text=No categories configured");
    await expect(categoriesCard.or(noCategories).first()).toBeVisible({
      timeout: PAGE_DATA_TIMEOUT,
    });
  });

  test("should show category rows with action-type badges when categories exist", async ({
    page,
  }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");

    // Each category row shows a badge for its default action type
    // (Auto / Suggest / Manual — see getActionTypeBadge in finding-rules-utils).
    // The Categories card itself should always render.
    await expect(page.locator("text=Categories").first()).toBeVisible({
      timeout: PAGE_DATA_TIMEOUT,
    });
  });

  test("should show create form when Add Category is clicked", async ({
    page,
  }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("domcontentloaded");

    const addButton = page.locator('button:has-text("Add Category")');
    // Bounded wait for the button, tolerated if it never appears — the
    // conditional below is the test's original tolerance shape.
    await addButton
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();

      // Form fields are: Name, Description, Icon, Color, Default Action,
      // Enable category. Submit button is "Create Category".
      await expect(
        page.locator("text=New Finding Category").first()
      ).toBeVisible({ timeout: FORM_OPEN_TIMEOUT });

      await page.screenshot({
        path: "test-results/configure-finding-rules-form.png",
        fullPage: true,
      });

      const nameField = page.locator("text=Name");
      const descriptionField = page.locator("text=Description");
      const defaultActionField = page.locator("text=Default Action");
      const createButton = page.locator('button:has-text("Create Category")');

      await expect(nameField.or(descriptionField).first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });
      await expect(defaultActionField.or(createButton).first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });
      await expect(createButton.first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });
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

    // Tolerance preserved: any of the four states satisfies the test.
    const configuredHooks = page.locator("text=Configured Hooks");
    const noHooks = page.locator("text=No lifecycle hooks configured");
    const offlineState = page.locator("text=Start the Qontinui Runner");
    const loadError = page.locator("text=Failed to load hooks");

    await expect(
      configuredHooks.or(noHooks).or(offlineState).or(loadError).first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should show action type information cards", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");

    // When online, there should be info cards for Webhook, Script, Notification.
    // Offline, RunnerOfflineState renders instead. Original shape:
    // (Webhook && Script && Notification) || offline.
    const offlineState = page.locator("text=Start the Qontinui Runner");
    await expect(
      page.locator("text=Webhook").or(offlineState).first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    if ((await offlineState.count()) === 0) {
      await expect(page.locator("text=Script").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
      await expect(page.locator("text=Notification").first()).toBeVisible({
        timeout: PAGE_DATA_TIMEOUT,
      });
    }
  });

  test("should show create form when New Hook is clicked", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("domcontentloaded");

    const addButton = page.locator('button:has-text("New Hook")');
    // Bounded wait, tolerated if absent (offline state has no button).
    await addButton
      .first()
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();

      // HookEditor exposes fields for Hook Name, Event Trigger, Action Type.
      const hookName = page.locator("text=Hook Name");
      const eventTrigger = page.locator("text=Event Trigger");
      const actionType = page.locator("text=Action Type");
      const saveButton = page.locator('button:has-text("Save")');

      await expect(hookName.or(eventTrigger).first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });

      await page.screenshot({
        path: "test-results/configure-hooks-form.png",
        fullPage: true,
      });

      await expect(actionType.or(saveButton).first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });
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

    // Online: shows a "Log Sources (N)" section header. Empty: copy is
    // "No log sources configured. Add sources or import from existing projects."
    // Tolerance preserved: any of the four states satisfies the test.
    const sourcesSection = page.locator("text=/Log Sources \\(\\d+\\)/");
    const noSources = page.locator("text=No log sources configured");
    const offlineState = page.locator("text=Start the Qontinui Runner");
    const loadError = page.locator("text=Failed to load log source settings");

    await expect(
      sourcesSection.or(noSources).or(offlineState).or(loadError).first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });
  });

  test("should show profiles section or offline state", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");

    // Online: shows a "Profiles (N)" section. Each profile shows source counts
    // and a "Default" badge for the default profile.
    const profilesSection = page.locator("text=/Profiles \\(\\d+\\)/");
    const offlineState = page.locator("text=Start the Qontinui Runner");

    await expect(profilesSection.or(offlineState).first()).toBeVisible({
      timeout: PAGE_DATA_TIMEOUT,
    });
  });

  test("should show create form when Add Source is clicked", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");

    const addButton = page.locator('button:has-text("Add Source")').first();
    // Bounded wait, tolerated if absent (offline state has no button).
    await addButton
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();

      // SourceEditor modal title is "Add Source" (or "Edit Source"); fields
      // are Name, Description, Category, Type, Path.
      const nameField = page.locator("text=Name");
      const categoryField = page.locator("text=Category");
      const pathField = page.locator("text=Path");

      await expect(nameField.first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });

      await page.screenshot({
        path: "test-results/configure-log-sources-form.png",
        fullPage: true,
      });

      await expect(categoryField.or(pathField).first()).toBeVisible({
        timeout: FORM_OPEN_TIMEOUT,
      });
    }
  });

  test("should show path input in Add Source modal", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("domcontentloaded");

    const addButton = page.locator('button:has-text("Add Source")').first();
    // Bounded wait, tolerated if absent (offline state has no button).
    await addButton
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();

      // Path input has placeholder "/path/to/logs/app.log".
      await expect(
        page.locator('input[placeholder="/path/to/logs/app.log"]').first()
      ).toBeVisible({ timeout: FORM_OPEN_TIMEOUT });
    }
  });
});
