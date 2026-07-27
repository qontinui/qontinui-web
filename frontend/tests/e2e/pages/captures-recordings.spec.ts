/**
 * End-to-end tests for Captures and Recordings pages
 *
 * Pages tested:
 * - /captures - Capture sessions browsing
 * - /captures/[sessionId] - Capture viewer with video player, event timeline, input sidebar
 * - /recordings - Recordings browsing
 * - /recordings/[id] - Recording detail with three tabs (Overview, Processing, Review)
 * - /recordings/upload - Recording upload form
 *
 * ── Why these tests poll instead of sleeping ────────────────────────────────
 * Every route here lives under the `(app)` route group, whose layout wraps the
 * page in `AppAuthGate` (`src/app/(app)/layout.tsx`). Until `useAuth()` has
 * resolved `GET /api/v1/auth/users/me`, that gate renders `AuthLoadingShell`
 * — a spinner over the word "Loading..." — and the page's own markup is not in
 * the DOM at all.
 *
 * `waitForLoadState("domcontentloaded")` returns long before the gate clears,
 * so the original `waitForTimeout(2000)` + `locator.count()` shape *guessed*
 * that auth had finished and then sampled the DOM exactly once. `count()` does
 * not retry, so losing that guess by a millisecond fails the test on a page
 * that was merely still authenticating. On CI the guess loses regularly: one
 * 4-vCPU runner hosts the Next dev server, uvicorn and Postgres together, and
 * `workers: 1` + `retries: 0` (see playwright.config.ts) means a single lost
 * race reds main and holds coord's merge train.
 *
 * That is exactly what happened on main sha `2b4d49e3` (run 30281421972,
 * shard 2/4, 2026-07-27): the captured failure snapshot was the auth shell,
 * and a re-run of the same sha passed. The tests below that cannot accept the
 * loading shell as a valid state therefore use `expect.poll`, which re-samples
 * the *same* probes until one is true or the timeout expires. This is a wait
 * on a condition, not on a duration: it returns the instant the app is ready,
 * so the fast path is not slowed, and it cannot be outrun when the box is
 * loaded. Tests that already accept a spinner (`animate-spin`) as a valid
 * outcome tolerate the gate by construction and are left as they are.
 */

import type { Locator } from "@playwright/test";

import { test, expect } from "../fixtures";

/**
 * Upper bound for "the app shell finished authenticating and rendered".
 *
 * Sized against the surrounding budget rather than picked by feel: the observed
 * failure was a ~2s guess losing to a multi-second auth round-trip, so the bound
 * has to absorb a saturated runner. Note what it does NOT claim — a gate slower
 * than this still fails. Polling makes the test correct for any latency under
 * the bound and free on the fast path; it does not make it unbounded-correct.
 * The unbounded version would key on a deterministic app-ready signal (a testid
 * on the settled shell, or waitForResponse on /api/v1/auth/users/me).
 */
const APP_READY_TIMEOUT_MS = 30_000;

/**
 * Per-test budget for the polled tests below.
 *
 * The default 60s is not enough to hold BOTH a dev-mode first-hit compile and a
 * full poll: playwright.config.ts sets navigationTimeout to 60s specifically
 * because Next compiles these routes on demand (~23s for the dashboard). If
 * `goto` eats 30s+, a 30s poll gets truncated by the 60s test deadline and the
 * failure surfaces as a bare test-level timeout — losing the diagnostic message
 * that is the point of the poll. Reserve navigation budget and poll budget
 * separately so the assertion always gets to speak.
 */
const POLLED_TEST_TIMEOUT_MS = 90_000;

/**
 * `locator.count() > 0`, hardened for use inside `expect.poll`.
 *
 * `expect.poll` retries the MATCHER, not the callback — the callback is invoked
 * outside the try/catch that drives re-polling. So a probe that *rejects*
 * ("Execution context was destroyed, most likely because of a navigation";
 * "Target page has been closed") escapes the poll and fails the test on the
 * spot, with no retry and without the message below. On a page that is still
 * settling, a transient probe rejection must count as "not present yet", never
 * as a verdict. Mirrors the guard already used in testing-project.spec.ts.
 */
async function present(locator: Locator): Promise<boolean> {
  return (await locator.count().catch(() => 0)) > 0;
}

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
    test.setTimeout(POLLED_TEST_TIMEOUT_MS);
    await page.goto("/captures");
    await page.waitForLoadState("domcontentloaded");

    // None of these three states is the auth shell, so this assertion must
    // outlast the gate — see the file header.
    await expect
      .poll(
        async () => {
          // The page uses RequireProject, so may show project selection prompt
          const hasCaptures = await present(page.locator("text=Capture"));
          const hasProjectPrompt = await present(
            page.locator("text=select a project")
          );
          const hasNoProjectSelected = await present(
            page.locator("text=No project selected")
          );

          return hasCaptures || hasProjectPrompt || hasNoProjectSelected;
        },
        {
          timeout: APP_READY_TIMEOUT_MS,
          message:
            "/captures never left the (app) auth loading shell — no captures, " +
            "project prompt, or no-project-selected state appeared. NOTE: " +
            "`text=Capture` is a case-insensitive substring match over the " +
            "whole page and also matches the sidebar's Captures nav item, so " +
            "this effectively asserts the app shell rendered at all; it does " +
            "not police the page body.",
        }
      )
      .toBeTruthy();
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
    test.setTimeout(POLLED_TEST_TIMEOUT_MS);
    await page.goto("/captures/non-existent-session-12345");
    await page.waitForLoadState("domcontentloaded");

    // The auth shell shows neither the not-found state nor the viewer chrome,
    // so sampling once would take the `!hasNotFound` branch and then find no
    // viewer either — failing on a page that had not finished authenticating.
    // Polling the whole predicate keeps the accepted states identical (the
    // original's skip-arm was an implicit pass, so not-found returns true here)
    // while outlasting the gate.
    await expect
      .poll(
        async () => {
          // For a non-existent session, we should see the not-found state
          const hasNotFound = await present(
            page.locator("text=Session not found")
          );
          if (hasNotFound) return true;

          // If somehow a session loaded, check for the video player area
          // and event timeline and input sidebar
          const hasVideoArea = await present(page.locator("video"));
          const hasExportButton = await present(
            page.locator("text=Export Events")
          );
          const hasCaptureFrame = await present(
            page.locator("text=Capture Frame")
          );

          return hasVideoArea || hasExportButton || hasCaptureFrame;
        },
        {
          timeout: APP_READY_TIMEOUT_MS,
          message:
            "/captures/<id> showed neither the not-found state nor any capture " +
            "viewer chrome (video / Export Events / Capture Frame) — the page " +
            "is still on the (app) auth loading shell, or the viewer regressed",
        }
      )
      .toBeTruthy();
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
    test.setTimeout(POLLED_TEST_TIMEOUT_MS);
    await page.goto("/recordings");
    await page.waitForLoadState("domcontentloaded");

    // None of these three states is the auth shell, so this assertion must
    // outlast the gate — see the file header.
    await expect
      .poll(
        async () => {
          // The page uses RequireProject
          const hasRecordings = await present(page.locator("text=Recording"));
          const hasProjectPrompt = await present(
            page.locator("text=select a project")
          );
          const hasNoProjectSelected = await present(
            page.locator("text=No project selected")
          );

          return hasRecordings || hasProjectPrompt || hasNoProjectSelected;
        },
        {
          timeout: APP_READY_TIMEOUT_MS,
          message:
            "/recordings never left the (app) auth loading shell — no " +
            "recordings, project prompt, or no-project-selected state " +
            "appeared. NOTE: `text=Recording` is a case-insensitive substring " +
            "match over the whole page and also matches the sidebar's " +
            "Recordings nav item, so this effectively asserts the app shell " +
            "rendered at all; it does not police the page body.",
        }
      )
      .toBeTruthy();
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
    test.setTimeout(POLLED_TEST_TIMEOUT_MS);
    await page.goto("/recordings/upload");
    await page.waitForLoadState("domcontentloaded");

    // This is the test that actually reddened main on 2b4d49e3 (run
    // 30281421972): none of the five probes below matches the auth shell, so
    // sampling them once at a fixed 2s failed while the page was still
    // authenticating. The probes are unchanged — only the sampling is.
    await expect
      .poll(
        async () => {
          // The upload page should have some form of upload interface
          const hasUpload = await present(page.locator("text=Upload"));
          const hasRecording = await present(page.locator("text=Recording"));
          const hasDragDrop = await present(page.locator("text=drag"));
          const hasBrowse = await present(page.locator("text=browse"));
          const hasInput = await present(page.locator('input[type="file"]'));

          return (
            hasUpload || hasRecording || hasDragDrop || hasBrowse || hasInput
          );
        },
        {
          timeout: APP_READY_TIMEOUT_MS,
          message:
            "/recordings/upload never left the (app) auth loading shell — no " +
            "upload affordance (Upload / Recording / drag / browse / file " +
            "input) appeared. NOTE: `text=Recording` is a case-insensitive " +
            "substring match over the whole page and also matches the " +
            "sidebar's Recordings nav item, so this effectively asserts the " +
            "app shell rendered at all; it does not police the upload form.",
        }
      )
      .toBeTruthy();
  });
});
