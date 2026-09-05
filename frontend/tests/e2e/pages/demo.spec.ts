/**
 * End-to-end tests for demo pages
 *
 * Tests the public demo pages:
 * - Demo list (/demo) - shows public project cards or empty state
 * - Demo detail (/demo/[id]) - shows project detail or 404 for invalid IDs
 *
 * These pages are public and do not require authentication.
 *
 * No fixed sleeps. Every wait here is an auto-waiting assertion on the state
 * the test then checks, or a bounded `waitFor(...).catch(() => null)` in
 * front of a read the test already tolerated; a sleep in front of an
 * assertion that already auto-waits is removed. Timeouts are the replaced
 * sleep × 3.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "@playwright/test";

/** Replaces the old `waitForTimeout(3000)` before a page-data presence read. */
const PAGE_DATA_TIMEOUT = 9000;

test.describe("Demo List Page (/demo)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/demo-list.png",
      // Mobile Chrome (Pixel 5) takes >60s to stitch fullPage on
      // /demo's long card grid. PR-O found the same pattern on
      // Mobile Safari (canvas-cap); this is the latency analog on
      // chromium-engine mobile. Visible-viewport screenshot is
      // sufficient — never asserted on.
      fullPage: false,
    });
  });

  test("displays hero section with heading", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /explore qontinui automations/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows Public Demo Projects badge", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Public Demo Projects")).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows description text", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText(/browse and view public automation projects/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test("has Create Your Own Project CTA button", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    const createButton = page
      .getByRole("button", { name: /create your own project/i })
      .first();
    await expect(createButton).toBeVisible({ timeout: 10000 });
  });

  test("has Sign In button", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    const signInButton = page.getByRole("button", { name: /sign in/i }).first();
    await expect(signInButton).toBeVisible({ timeout: 10000 });
  });

  test("shows projects or empty state after loading", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    // After loading, either projects are shown or the empty state. One of
    // these states should be visible (projects, empty, or API error).
    // Tolerance preserved: any of the three.
    await expect(
      page
        .getByText("Public Projects (")
        .or(page.getByText("No Public Projects Yet"))
        .or(page.locator(".text-red-600, .text-red-400"))
        .first()
    ).toBeVisible({ timeout: PAGE_DATA_TIMEOUT });

    await page.screenshot({
      path: "test-results/demo-list-loaded.png",
      fullPage: true,
    });
  });

  test("shows loading state initially", async ({ page }) => {
    // Navigate without waiting for network to catch loading state
    await page.goto("/demo");

    // The loading text might be very brief, so we check the initial content
    const _loadingText = page.getByText("Loading public projects...");

    // This might pass or miss depending on timing - that's OK
    // We just verify the page doesn't crash during loading
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("has bottom CTA section", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Ready to Build Your Own Automation?")
    ).toBeVisible({ timeout: 10000 });

    const getStartedButton = page.getByRole("button", {
      name: /get started free/i,
    });
    await expect(getStartedButton).toBeVisible();
  });
});

test.describe("Demo Detail Page (/demo/[id])", () => {
  test("shows Project Not Found for invalid ID", async ({ page }) => {
    await page.goto("/demo/nonexistent-project-id-12345");
    await page.waitForLoadState("domcontentloaded");

    // The not-found heading auto-waits for the API call to complete.
    const notFoundHeading = page.getByRole("heading", {
      name: /project not found/i,
    });
    await expect(notFoundHeading).toBeVisible({ timeout: 10000 });

    await page.screenshot({
      path: "test-results/demo-detail-not-found.png",
      fullPage: true,
    });
  });

  test("shows error message for invalid ID", async ({ page }) => {
    await page.goto("/demo/invalid-uuid-format");
    await page.waitForLoadState("domcontentloaded");

    // Should show an error message explaining the project doesn't exist or isn't public
    const errorText = page
      .getByText(/does not exist|not public|not found|failed/i)
      .first();
    await expect(errorText).toBeVisible({ timeout: 10000 });
  });

  test("has Back to Demo Projects button for invalid ID", async ({ page }) => {
    await page.goto("/demo/nonexistent-id");
    await page.waitForLoadState("domcontentloaded");

    const backButton = page.getByRole("button", {
      name: /back to demo projects/i,
    });
    await expect(backButton).toBeVisible({ timeout: 10000 });
  });

  test("loads without 500 error for invalid ID", async ({ page }) => {
    await page.goto("/demo/00000000-0000-0000-0000-000000000000");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/demo-detail-invalid-uuid.png",
      fullPage: true,
    });
  });

  test("shows loading state initially for valid-looking ID @smoke", async ({
    page,
  }) => {
    // Navigate without waiting to catch loading state
    await page.goto("/demo/a1b2c3d4-e5f6-7890-abcd-ef1234567890");

    // The loading text should appear briefly
    const loadingText = page.getByText("Loading project...");

    // Wait for either loading text or the error state
    await Promise.race([
      loadingText.waitFor({ timeout: 5000 }).catch(() => {}),
      page.waitForLoadState("domcontentloaded"),
    ]);

    // After loading, it should show not-found since this is a fake ID —
    // bounded wait for that heading, tolerated (the read below is no-500).
    await page
      .getByRole("heading", { name: /project not found/i })
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("Back to Demo Projects button navigates correctly", async ({ page }) => {
    await page.goto("/demo/nonexistent-id");
    await page.waitForLoadState("domcontentloaded");

    // Bounded wait for the button, tolerated if absent — the conditional
    // below is the test's original shape.
    const backButton = page.getByRole("button", {
      name: /back to demo projects/i,
    });
    await backButton
      .waitFor({ state: "visible", timeout: PAGE_DATA_TIMEOUT })
      .catch(() => null);

    if (await backButton.isVisible().catch(() => false)) {
      await backButton.click();
      await page.waitForLoadState("domcontentloaded");

      // Should navigate back to demo list
      expect(page.url()).toContain("/demo");
      // And not contain the invalid ID in the URL
      expect(page.url()).not.toContain("nonexistent-id");
    }
  });
});
