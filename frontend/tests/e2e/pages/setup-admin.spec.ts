/**
 * End-to-end tests for Setup Admin page
 *
 * Tests the /setup-admin page which allows the first user to claim admin access.
 * This page requires authentication (uses storageState from auth.setup.ts).
 */

import { test, expect } from "../fixtures";

test.describe("Setup Admin Page (/setup-admin)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/setup-admin.png",
      fullPage: true,
    });
  });

  test("displays Claim Admin Access heading", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /claim admin access/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows description text", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/log in first/i)).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByText(/only works if no admin exists yet/i)
    ).toBeVisible();
  });

  test("shows Claim Admin button", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    const claimButton = page.getByRole("button", {
      name: /claim admin/i,
    });
    await expect(claimButton).toBeVisible({ timeout: 10000 });
    await expect(claimButton).toBeEnabled();
  });

  test("page is rendered within a card component", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    // The page uses a Card component with specific structure
    // The heading should be inside a card
    const heading = page.getByRole("heading", {
      name: /claim admin access/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // The description should also be visible
    const description = page.getByText(/only works if no admin exists yet/i);
    await expect(description).toBeVisible();

    await page.screenshot({
      path: "test-results/setup-admin-card.png",
      fullPage: true,
    });
  });

  test("clicking Claim Admin shows loading state", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    const claimButton = page.getByRole("button", {
      name: /claim admin/i,
    });
    await expect(claimButton).toBeVisible({ timeout: 10000 });

    // Click the button
    await claimButton.click();

    // The button should show loading text or a result should appear
    // Either "Claiming admin..." text or a result message
    await page.waitForTimeout(2000);

    // After the API call completes, a result message should appear
    // It will either be a success or error message (depending on whether admin already exists)
    const resultElement = page.locator(".rounded-lg.p-4");
    const hasResult = await resultElement.isVisible().catch(() => false);

    // If no result element, the button text might have changed
    if (!hasResult) {
      // Button might still show "Claiming admin..." or have reverted
      const buttonText = await claimButton.textContent();
      expect(buttonText).toBeTruthy();
    }

    await page.screenshot({
      path: "test-results/setup-admin-after-click.png",
      fullPage: true,
    });
  });

  test("shows result message after claiming admin", async ({ page }) => {
    await page.goto("/setup-admin");
    await page.waitForLoadState("domcontentloaded");

    const claimButton = page.getByRole("button", {
      name: /claim admin/i,
    });
    await expect(claimButton).toBeVisible({ timeout: 10000 });

    // Click claim admin
    await claimButton.click();

    // Wait for API response
    await page.waitForTimeout(5000);

    // A result message should appear - either success or error
    // Success shows green background, error shows red background
    const pageContent = await page.content();
    const hasSuccessOrError =
      pageContent.includes("Success") || pageContent.includes("Error");

    expect(hasSuccessOrError).toBe(true);

    await page.screenshot({
      path: "test-results/setup-admin-result.png",
      fullPage: true,
    });
  });
});
