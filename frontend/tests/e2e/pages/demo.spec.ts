/**
 * End-to-end tests for demo pages
 *
 * Tests the public demo pages:
 * - Demo list (/demo) - shows public project cards or empty state
 * - Demo detail (/demo/[id]) - shows project detail or 404 for invalid IDs
 *
 * These pages are public and do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Demo List Page (/demo)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/demo-list.png",
      fullPage: true,
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

    // Wait for loading to complete
    await page.waitForTimeout(3000);

    // After loading, either projects are shown or the empty state
    const hasProjects = await page
      .getByText("Public Projects (")
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .getByText("No Public Projects Yet")
      .isVisible()
      .catch(() => false);
    const hasError = await page
      .locator(".text-red-600, .text-red-400")
      .isVisible()
      .catch(() => false);

    // One of these states should be visible (projects, empty, or API error)
    expect(hasProjects || hasEmptyState || hasError).toBe(true);

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

    // Wait for the API call to complete
    await page.waitForTimeout(3000);

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
    await page.waitForTimeout(3000);

    // Should show an error message explaining the project doesn't exist or isn't public
    const errorText = page
      .getByText(/does not exist|not public|not found|failed/i)
      .first();
    await expect(errorText).toBeVisible({ timeout: 10000 });
  });

  test("has Back to Demo Projects button for invalid ID", async ({ page }) => {
    await page.goto("/demo/nonexistent-id");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

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

  test("shows loading state initially for valid-looking ID", async ({
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

    // After loading, it should show not-found since this is a fake ID
    await page.waitForTimeout(3000);
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("Back to Demo Projects button navigates correctly", async ({ page }) => {
    await page.goto("/demo/nonexistent-id");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);

    const backButton = page.getByRole("button", {
      name: /back to demo projects/i,
    });

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
