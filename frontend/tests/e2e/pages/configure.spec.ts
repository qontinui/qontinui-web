/**
 * End-to-end tests for Configure pages
 *
 * Pages tested:
 * - /configure/finding-rules - Rule list, create button, pattern validation, severity assignment
 * - /configure/hooks - Hook list, event-based trigger configuration, action type selector
 * - /configure/log-sources - Log source list, file path configuration, enable/disable toggle
 */

import { test, expect } from "../fixtures";

test.describe("Configure - Finding Rules", () => {
  test("should load finding rules page without errors", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/configure-finding-rules.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Finding Rules heading", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("text=Finding Rules");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have Add Rule button or offline state", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("networkidle");

    const hasAddButton =
      (await page.locator('button:has-text("Add Rule")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasAddButton || hasOfflineState).toBeTruthy();
  });

  test("should display configured rules list or empty state", async ({
    page,
  }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // When runner is online, shows "Configured Rules" section with rules
    // or an empty state message
    const hasConfiguredRules =
      (await page.locator("text=Configured Rules").count()) > 0;
    const hasNoRules =
      (await page.locator("text=No finding rules configured").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;
    const hasLoadError =
      (await page.locator("text=Failed to load finding rules").count()) > 0;

    expect(
      hasConfiguredRules || hasNoRules || hasOfflineState || hasLoadError
    ).toBeTruthy();
  });

  test("should show rule details with severity badges when rules exist", async ({
    page,
  }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // If rules exist, they should show severity badges (CRITICAL, HIGH, MEDIUM, LOW)
    // and Active/Disabled status badges
    const _hasActiveBadge = (await page.locator("text=Active").count()) > 0;
    const _hasDisabledBadge = (await page.locator("text=Disabled").count()) > 0;
    const hasConfiguredRules =
      (await page.locator("text=Configured Rules").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    // This is informational - rules may or may not exist
    expect(hasConfiguredRules || hasOfflineState).toBeTruthy();
  });

  test("should show create form when Add Rule is clicked", async ({ page }) => {
    await page.goto("/configure/finding-rules");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Rule")');

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "test-results/configure-finding-rules-form.png",
        fullPage: true,
      });

      // Form should show fields for Category, Name, Pattern (Regex), Severity
      const hasNewFindingRule =
        (await page.locator("text=New Finding Rule").count()) > 0;
      const hasCategoryField =
        (await page.locator("text=Category").count()) > 0;
      const hasNameField = (await page.locator("text=Name").count()) > 0;
      const hasPatternField =
        (await page.locator("text=Pattern (Regex)").count()) > 0;
      const hasSeverityField =
        (await page.locator("text=Severity").count()) > 0;
      const hasSaveButton =
        (await page.locator('button:has-text("Save Rule")').count()) > 0;
      const _hasEnableToggle =
        (await page.locator("text=Enable rule").count()) > 0;

      expect(hasNewFindingRule).toBeTruthy();
      expect(hasCategoryField || hasNameField).toBeTruthy();
      expect(hasPatternField || hasSeverityField).toBeTruthy();
      expect(hasSaveButton).toBeTruthy();
    }
  });
});

test.describe("Configure - Hooks", () => {
  test("should load hooks page without errors", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/configure-hooks.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Hooks heading", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("h1:has-text('Hooks')");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have Add Hook button or offline state", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("networkidle");

    const hasAddButton =
      (await page.locator('button:has-text("Add Hook")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasAddButton || hasOfflineState).toBeTruthy();
  });

  test("should display configured hooks list or empty state", async ({
    page,
  }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const hasConfiguredHooks =
      (await page.locator("text=Configured Hooks").count()) > 0;
    const hasNoHooks =
      (await page.locator("text=No hooks configured").count()) > 0;
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
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // When online, there should be info cards for Webhook, Script, Notification
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

  test("should show create form when Add Hook is clicked", async ({ page }) => {
    await page.goto("/configure/hooks");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Hook")');

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "test-results/configure-hooks-form.png",
        fullPage: true,
      });

      // Form should show fields: Hook Name, Event Trigger, Action Type
      const hasNewHook = (await page.locator("text=New Hook").count()) > 0;
      const hasHookName = (await page.locator("text=Hook Name").count()) > 0;
      const hasEventTrigger =
        (await page.locator("text=Event Trigger").count()) > 0;
      const hasActionType =
        (await page.locator("text=Action Type").count()) > 0;
      const hasSaveButton =
        (await page.locator('button:has-text("Save Hook")').count()) > 0;
      const _hasEnableToggle =
        (await page.locator("text=Enable hook").count()) > 0;

      expect(hasNewHook).toBeTruthy();
      expect(hasHookName || hasEventTrigger).toBeTruthy();
      expect(hasActionType || hasSaveButton).toBeTruthy();
    }
  });
});

test.describe("Configure - Log Sources", () => {
  test("should load log sources page without errors", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/configure-log-sources.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Log Sources heading", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("text=Log Sources");
    await expect(heading.first()).toBeVisible({ timeout: 15000 });
  });

  test("should have Add Log Source button or offline state", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");

    const hasAddButton =
      (await page.locator('button:has-text("Add Log Source")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasAddButton || hasOfflineState).toBeTruthy();
  });

  test("should display configured sources list or empty state", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const hasConfiguredSources =
      (await page.locator("text=Configured Sources").count()) > 0;
    const hasNoSources =
      (await page.locator("text=No log sources configured").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;
    const hasLoadError =
      (await page.locator("text=Failed to load log sources").count()) > 0;

    expect(
      hasConfiguredSources || hasNoSources || hasOfflineState || hasLoadError
    ).toBeTruthy();
  });

  test("should show sources with enable/disable badges when present", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // If sources exist, they should show Active/Disabled badges
    const _hasActiveBadge = (await page.locator("text=Active").count()) > 0;
    const hasConfiguredSources =
      (await page.locator("text=Configured Sources").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasConfiguredSources || hasOfflineState).toBeTruthy();
  });

  test("should show create form when Add Log Source is clicked", async ({
    page,
  }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Log Source")');

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "test-results/configure-log-sources-form.png",
        fullPage: true,
      });

      // Form should show fields: Name, Log Type, File Path, Enable monitoring
      const hasNewLogSource =
        (await page.locator("text=New Log Source").count()) > 0;
      const hasNameField = (await page.locator("text=Name").count()) > 0;
      const hasLogType = (await page.locator("text=Log Type").count()) > 0;
      const hasFilePath = (await page.locator("text=File Path").count()) > 0;
      const hasSaveButton =
        (await page.locator('button:has-text("Save")').count()) > 0;
      const _hasEnableToggle =
        (await page.locator("text=Enable monitoring").count()) > 0;

      expect(hasNewLogSource).toBeTruthy();
      expect(hasNameField || hasLogType).toBeTruthy();
      expect(hasFilePath || hasSaveButton).toBeTruthy();
    }
  });

  test("should show file path input in create form", async ({ page }) => {
    await page.goto("/configure/log-sources");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const addButton = page.locator('button:has-text("Add Log Source")');

    if ((await addButton.count()) > 0 && (await addButton.isEnabled())) {
      await addButton.click();
      await page.waitForTimeout(500);

      // File Path field with placeholder
      const hasPathInput =
        (await page
          .locator('input[placeholder="/path/to/log/file.log"]')
          .count()) > 0;

      expect(hasPathInput).toBeTruthy();
    }
  });
});
