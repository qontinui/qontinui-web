/**
 * End-to-end tests for Build Discover page
 *
 * Page tested:
 * - /build/discover - AI-powered automation discovery interface
 *
 * The page provides AI-powered analysis of target URLs and descriptions
 * to suggest automation workflows, steps, and verification checks.
 * Shows RunnerOfflineState when the runner is not connected.
 */

import { test, expect } from "../fixtures";

test.describe("Build - Discover", () => {
  test("should load discover page without errors", async ({ page }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/build-discover.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display AI Spec Discovery heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    const hasHeading =
      (await page.locator("text=AI Spec Discovery").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasHeading || hasOfflineState).toBeTruthy();
  });

  test("should show AI-Powered badge or offline state", async ({ page }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    const hasAIPoweredBadge =
      (await page.locator("text=AI-Powered").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasAIPoweredBadge || hasOfflineState).toBeTruthy();
  });

  test("should show URL input for analysis or offline state", async ({
    page,
  }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    // The page has a "Target URL" input field with placeholder "https://example.com"
    const hasUrlInput =
      (await page.locator('input[placeholder="https://example.com"]').count()) >
      0;
    const hasTargetUrlLabel =
      (await page.locator("text=Target URL").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasUrlInput || hasTargetUrlLabel || hasOfflineState).toBeTruthy();
  });

  test("should show description input for analysis or offline state", async ({
    page,
  }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    // The page has a "Description" input field for describing what to automate
    const hasDescriptionInput =
      (await page
        .locator(
          'input[placeholder="Describe the workflow you want to automate..."]'
        )
        .count()) > 0;
    const hasDescriptionLabel =
      (await page.locator("text=Description").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      hasDescriptionInput || hasDescriptionLabel || hasOfflineState
    ).toBeTruthy();
  });

  test("should show Discover button or offline state", async ({ page }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    const hasDiscoverButton =
      (await page.locator('button:has-text("Discover")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasDiscoverButton || hasOfflineState).toBeTruthy();
  });

  test("should show AI-Powered Automation Discovery hint area or offline state", async ({
    page,
  }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    // The initial state shows a hint section with:
    // - "AI-Powered Automation Discovery" heading
    // - Three capability cards: "Suggest complete workflows", "Identify individual steps", "Generate verification checks"
    const hasDiscoveryHint =
      (await page.locator("text=AI-Powered Automation Discovery").count()) > 0;
    const hasSuggestWorkflows =
      (await page.locator("text=Suggest complete workflows").count()) > 0;
    const hasIdentifySteps =
      (await page.locator("text=Identify individual steps").count()) > 0;
    const hasGenerateChecks =
      (await page.locator("text=Generate verification checks").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      (hasDiscoveryHint &&
        hasSuggestWorkflows &&
        hasIdentifySteps &&
        hasGenerateChecks) ||
        hasOfflineState
    ).toBeTruthy();
  });

  test("should show Discover Automation Specs card heading or offline state", async ({
    page,
  }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    const hasCardHeading =
      (await page.locator("text=Discover Automation Specs").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(hasCardHeading || hasOfflineState).toBeTruthy();
  });

  test("should show runner connection status indicator or offline state", async ({
    page,
  }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    // The header shows a runner connection indicator:
    // "Runner Connected" (green), "Connecting..." (yellow), or "Runner Offline" (red)
    const hasConnected =
      (await page.locator("text=Runner Connected").count()) > 0;
    const hasConnecting =
      (await page.locator("text=Connecting...").count()) > 0;
    const hasRunnerOfflineLabel =
      (await page.locator("text=Runner Offline").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;

    expect(
      hasConnected || hasConnecting || hasRunnerOfflineLabel || hasOfflineState
    ).toBeTruthy();
  });

  test("should gracefully handle runner offline state", async ({ page }) => {
    await page.goto("/build/discover");
    await page.waitForLoadState("domcontentloaded");

    // When runner is offline, the page shows RunnerOfflineState
    // with "Runner Not Connected" and "Start the Qontinui Runner" message
    const hasContent =
      (await page.locator("text=AI Spec Discovery").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner Not Connected").count()) > 0;
    const hasStartMessage =
      (await page.locator("text=Start the Qontinui Runner").count()) > 0;

    expect(hasContent || hasOfflineState || hasStartMessage).toBeTruthy();
  });
});
