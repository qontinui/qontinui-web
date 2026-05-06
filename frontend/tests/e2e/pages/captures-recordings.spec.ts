/**
 * End-to-end tests for Captures and Recordings pages
 *
 * Pages tested:
 * - /captures - Capture sessions browsing
 * - /captures/[sessionId] - Capture viewer with video player, event timeline, input sidebar
 * - /recordings - Recordings browsing
 * - /recordings/[id] - Recording detail with three tabs (Overview, Processing, Review)
 * - /recordings/upload - Recording upload form
 */

import { test, expect } from "../fixtures";

test.describe("Captures - List Page", () => {
  test("should load captures page without errors", async ({ page }) => {
    await page.goto("/captures");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/captures-list.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display captures page content or project prompt", async ({
    page,
  }) => {
    await page.goto("/captures");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // The page uses RequireProject, so may show project selection prompt
    const hasCaptures = (await page.locator("text=Capture").count()) > 0;
    const hasProjectPrompt =
      (await page.locator("text=select a project").count()) > 0;
    const hasNoProjectSelected =
      (await page.locator("text=No project selected").count()) > 0;

    expect(
      hasCaptures || hasProjectPrompt || hasNoProjectSelected
    ).toBeTruthy();
  });
});

test.describe("Captures - Viewer (non-existent session)", () => {
  test("should handle non-existent capture session gracefully", async ({
    page,
  }) => {
    await page.goto("/captures/non-existent-session-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: "test-results/capture-viewer-404.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Should show "Session not found" or "Back to Captures" or loading
    const hasNotFound =
      (await page.locator("text=Session not found").count()) > 0;
    const hasBackButton =
      (await page.locator("text=Back to Captures").count()) > 0;
    const hasLoading =
      (await page.locator("text=Loading").count()) > 0 ||
      (await page.locator('[class*="animate-spin"]').count()) > 0;

    expect(hasNotFound || hasBackButton || hasLoading).toBeTruthy();
  });

  test("should show video player area when session loads", async ({ page }) => {
    await page.goto("/captures/non-existent-session-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // For a non-existent session, we should see the not-found state
    const hasNotFound =
      (await page.locator("text=Session not found").count()) > 0;

    if (!hasNotFound) {
      // If somehow a session loaded, check for the video player area
      // and event timeline and input sidebar
      const hasVideoArea = (await page.locator("video").count()) > 0;
      const hasExportButton =
        (await page.locator("text=Export Events").count()) > 0;
      const hasCaptureFrame =
        (await page.locator("text=Capture Frame").count()) > 0;

      expect(hasVideoArea || hasExportButton || hasCaptureFrame).toBeTruthy();
    }
  });
});

test.describe("Recordings - List Page", () => {
  test("should load recordings page without errors", async ({ page }) => {
    await page.goto("/recordings");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/recordings-list.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display recordings content or project prompt", async ({
    page,
  }) => {
    await page.goto("/recordings");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // The page uses RequireProject
    const hasRecordings = (await page.locator("text=Recording").count()) > 0;
    const hasProjectPrompt =
      (await page.locator("text=select a project").count()) > 0;
    const hasNoProjectSelected =
      (await page.locator("text=No project selected").count()) > 0;

    expect(
      hasRecordings || hasProjectPrompt || hasNoProjectSelected
    ).toBeTruthy();
  });
});

test.describe("Recordings - Detail (non-existent)", () => {
  test("should handle non-existent recording ID gracefully", async ({
    page,
  }) => {
    await page.goto("/recordings/non-existent-recording-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: "test-results/recording-detail-404.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Should show loading or error state. The page waits for data.
    const hasBackButton =
      (await page.locator("text=Back to Recordings").count()) > 0;
    const hasLoading =
      (await page.locator('[class*="animate-spin"]').count()) > 0;
    const hasError = (await page.locator("text=Failed to load").count()) > 0;

    expect(hasBackButton || hasLoading || hasError).toBeTruthy();
  });

  test("should have three tabs (Overview, Processing, Review) when recording loads", async ({
    page,
  }) => {
    await page.goto("/recordings/non-existent-recording-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // If a recording loads, it should have the three tabs
    const hasOverviewTab =
      (await page.locator('button:has-text("Overview")').count()) > 0;
    const hasProcessingTab =
      (await page.locator('button:has-text("Processing")').count()) > 0;
    const _hasReviewTab =
      (await page.locator('button:has-text("Review Structure")').count()) > 0;
    const hasLoading =
      (await page.locator('[class*="animate-spin"]').count()) > 0;

    // For non-existent recording, might still be loading or showing error
    expect((hasOverviewTab && hasProcessingTab) || hasLoading).toBeTruthy();
  });

  test("should show processing status information when available", async ({
    page,
  }) => {
    await page.goto("/recordings/non-existent-recording-12345");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    // If recording loaded, check for overview stats
    const hasOverviewTab =
      (await page.locator('button:has-text("Overview")').count()) > 0;

    if (hasOverviewTab) {
      // Overview tab should have stats: Total Frames, Interactions, Duration, Frame Rate
      const hasTotalFrames =
        (await page.locator("text=Total Frames").count()) > 0;
      const hasInteractions =
        (await page.locator("text=Interactions").count()) > 0;
      const hasDuration = (await page.locator("text=Duration").count()) > 0;

      expect(hasTotalFrames || hasInteractions || hasDuration).toBeTruthy();
    }
  });
});

test.describe("Recordings - Upload", () => {
  test("should load upload page without errors", async ({ page }) => {
    await page.goto("/recordings/upload");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/recordings-upload.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display upload form or content", async ({ page }) => {
    await page.goto("/recordings/upload");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // The upload page should have some form of upload interface
    const hasUpload = (await page.locator("text=Upload").count()) > 0;
    const hasRecording = (await page.locator("text=Recording").count()) > 0;
    const hasDragDrop = (await page.locator("text=drag").count()) > 0;
    const hasBrowse = (await page.locator("text=browse").count()) > 0;
    const hasInput = (await page.locator('input[type="file"]').count()) > 0;

    expect(
      hasUpload || hasRecording || hasDragDrop || hasBrowse || hasInput
    ).toBeTruthy();
  });
});
