/**
 * End-to-end tests for Build Asset pages
 *
 * Pages tested:
 * - /build/api-requests - Saved API request management with two-panel layout
 * - /build/checks - Verification checks list with create button
 * - /build/contexts - AI contexts management with create button
 * - /build/playwright-tests - Playwright tests list with create button
 * - /build/shell-commands - Shell commands list with create button
 * - /build/library - Unified asset browser with type filters and search
 *
 * All pages show RunnerOfflineState when the runner is not connected.
 */

import { test, expect } from "../fixtures";

test.describe("Build - API Requests", () => {
  test("should load API requests page without errors", async ({ page }) => {
    await page.goto("/build/api-requests");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-api-requests.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display heading and key elements or offline state", async ({
    page,
  }) => {
    await page.goto("/build/api-requests");
    await page.waitForLoadState("networkidle");

    // When runner is online: shows "API Requests" heading, search input, "New Request" button
    // When runner is offline: shows RunnerOfflineState
    const hasHeading = (await page.locator("text=API Requests").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show two-panel layout with search input or offline state", async ({
    page,
  }) => {
    await page.goto("/build/api-requests");
    await page.waitForLoadState("networkidle");

    // When online: two-panel layout with search input and "New Request" button
    const hasSearchInput =
      (await page
        .locator('input[placeholder="Search API requests..."]')
        .count()) > 0;
    const hasNewButton =
      (await page.locator('button:has-text("New Request")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasSearchInput && hasNewButton) || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/api-requests");
    await page.waitForLoadState("networkidle");

    // The page should render without crashing regardless of runner status
    const hasContent = (await page.locator("text=API Requests").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;
    const hasStartMessage =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    // One of these must be true - page rendered something meaningful
    expect(hasContent || hasOfflineState || hasStartMessage).toBeTruthy();
  });
});

test.describe("Build - Checks", () => {
  test("should load checks page without errors", async ({ page }) => {
    await page.goto("/build/checks");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-checks.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display verification checks heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/checks");
    await page.waitForLoadState("networkidle");

    const hasHeading =
      (await page.locator("text=Verification Checks").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show checks list area and create button or offline state", async ({
    page,
  }) => {
    await page.goto("/build/checks");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page.locator('input[placeholder="Search checks..."]').count()) > 0;
    const hasNewButton =
      (await page.locator('button:has-text("New Check")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasSearchInput && hasNewButton) || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/checks");
    await page.waitForLoadState("networkidle");

    const hasContent =
      (await page.locator("text=Verification Checks").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Contexts", () => {
  test("should load contexts page without errors", async ({ page }) => {
    await page.goto("/build/contexts");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-contexts.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display AI contexts heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/contexts");
    await page.waitForLoadState("networkidle");

    const hasHeading = (await page.locator("text=AI Contexts").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show contexts management with create button or offline state", async ({
    page,
  }) => {
    await page.goto("/build/contexts");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page.locator('input[placeholder="Search contexts..."]').count()) >
      0;
    const hasNewButton =
      (await page.locator('button:has-text("New Context")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasSearchInput && hasNewButton) || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/contexts");
    await page.waitForLoadState("networkidle");

    const hasContent = (await page.locator("text=AI Contexts").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Playwright Tests", () => {
  test("should load playwright tests page without errors", async ({ page }) => {
    await page.goto("/build/playwright-tests");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-playwright-tests.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Playwright Tests heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/playwright-tests");
    await page.waitForLoadState("networkidle");

    const hasHeading =
      (await page.locator("text=Playwright Tests").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show playwright tests list and create button or offline state", async ({
    page,
  }) => {
    await page.goto("/build/playwright-tests");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page
        .locator('input[placeholder="Search playwright tests..."]')
        .count()) > 0;
    const hasNewButton =
      (await page.locator('button:has-text("New Test")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasSearchInput && hasNewButton) || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/playwright-tests");
    await page.waitForLoadState("networkidle");

    const hasContent =
      (await page.locator("text=Playwright Tests").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Shell Commands", () => {
  test("should load shell commands page without errors", async ({ page }) => {
    await page.goto("/build/shell-commands");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-shell-commands.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display shell commands heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/shell-commands");
    await page.waitForLoadState("networkidle");

    const hasHeading = (await page.locator("text=Shell Commands").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show shell commands list and create button or offline state", async ({
    page,
  }) => {
    await page.goto("/build/shell-commands");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page
        .locator('input[placeholder="Search shell commands..."]')
        .count()) > 0;
    const hasNewButton =
      (await page.locator('button:has-text("New Command")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect((hasSearchInput && hasNewButton) || hasOfflineState).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/shell-commands");
    await page.waitForLoadState("networkidle");

    const hasContent = (await page.locator("text=Shell Commands").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});

test.describe("Build - Library", () => {
  test("should load library page without errors", async ({ page }) => {
    await page.goto("/build/library");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/build-library.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display Asset Library heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/library");
    await page.waitForLoadState("networkidle");

    const hasHeading = (await page.locator("text=Asset Library").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show unified asset browser with search input or offline state", async ({
    page,
  }) => {
    await page.goto("/build/library");
    await page.waitForLoadState("networkidle");

    const hasSearchInput =
      (await page
        .locator('input[placeholder="Search across all assets..."]')
        .count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasSearchInput || hasOfflineState).toBeTruthy();
  });

  test("should show asset type filter buttons or offline state", async ({
    page,
  }) => {
    await page.goto("/build/library");
    await page.waitForLoadState("networkidle");

    // The library page has an "All" filter button plus up to 9 type-specific filters
    // (Workflow, Test, API Request, Check, Context, Playwright Test, Shell Command, Prompt, Prompt Snippet)
    const hasAllFilter =
      (await page.locator('button:has-text("All")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasAllFilter || hasOfflineState).toBeTruthy();
  });

  test("should show responsive grid layout or offline state", async ({
    page,
  }) => {
    await page.goto("/build/library");
    await page.waitForLoadState("networkidle");

    // When online and loaded: shows either a grid of asset cards or an empty state
    // The grid uses "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" classes
    const hasItemCount = (await page.locator("text=/\\d+ items?/").count()) > 0;
    const hasNoAssets = (await page.locator("text=No assets yet").count()) > 0;
    const hasNoMatching =
      (await page.locator("text=No matching assets").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      hasItemCount || hasNoAssets || hasNoMatching || hasOfflineState
    ).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/library");
    await page.waitForLoadState("networkidle");

    const hasContent = (await page.locator("text=Asset Library").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasContent || hasOfflineState).toBeTruthy();
  });
});
