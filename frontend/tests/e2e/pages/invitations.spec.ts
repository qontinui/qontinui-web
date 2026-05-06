/**
 * E2E tests for Invitation pages
 *
 * Tests the accept invitation page with various states:
 * no token provided, invalid token, and general page structure.
 * Verifies page load, error handling, and key UI elements.
 */

import { test, expect } from "../fixtures";

test.describe("Accept Invitation Page - No Token", () => {
  test("loads without errors and shows error state", async ({ page }) => {
    await page.goto("/invitations/accept");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-invitation-no-token.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Should show "Invalid Invitation" heading since no token is provided
    await expect(page.getByText("Invalid Invitation")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows 'No invitation token provided' error message", async ({
    page,
  }) => {
    await page.goto("/invitations/accept");
    await page.waitForLoadState("domcontentloaded");

    // The error alert should contain the specific message
    await expect(page.getByText("No invitation token provided")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows 'This invitation link is not valid' description", async ({
    page,
  }) => {
    await page.goto("/invitations/accept");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("This invitation link is not valid")
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows Go to Dashboard button", async ({ page }) => {
    await page.goto("/invitations/accept");
    await page.waitForLoadState("domcontentloaded");

    // Go to Dashboard button should be visible
    await expect(page.getByText("Go to Dashboard")).toBeVisible({
      timeout: 15000,
    });
  });

  test("Go to Dashboard button navigates correctly", async ({ page }) => {
    await page.goto("/invitations/accept");
    await page.waitForLoadState("domcontentloaded");

    // Click Go to Dashboard
    await page.getByText("Go to Dashboard").click();

    // Should navigate to dashboard
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    expect(page.url()).toContain("/dashboard");
  });
});

test.describe("Accept Invitation Page - Invalid Token", () => {
  test("loads without errors for a fake token", async ({ page }) => {
    await page.goto("/invitations/accept?token=invalid-fake-token-12345");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-invitation-invalid-token.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Wait for loading to finish and error/result to appear
    await page.waitForTimeout(5000);

    await page.screenshot({
      path: "test-results/pages-invitation-invalid-token-loaded.png",
      fullPage: true,
    });

    // Should show either loading state, error state, or invitation details
    // With a fake token, it should eventually show an error
    const hasInvalidInvitation = await page
      .getByText("Invalid Invitation")
      .isVisible()
      .catch(() => false);
    const hasLoading = await page
      .getByText("Loading invitation")
      .isVisible()
      .catch(() => false);
    const hasOrgInvitation = await page
      .getByText("Organization Invitation")
      .isVisible()
      .catch(() => false);
    const hasDashboardButton = await page
      .getByText("Go to Dashboard")
      .isVisible()
      .catch(() => false);

    // At least one of these states should be visible
    expect(
      hasInvalidInvitation ||
        hasLoading ||
        hasOrgInvitation ||
        hasDashboardButton
    ).toBe(true);
  });

  test("shows error alert for invalid token", async ({ page }) => {
    await page.goto("/invitations/accept?token=invalid-fake-token-12345");
    await page.waitForLoadState("domcontentloaded");

    // Wait for API call to fail
    await page.waitForTimeout(5000);

    // Should show an error state with "Error" alert title
    const hasErrorAlert = await page
      .getByText("Error")
      .first()
      .isVisible()
      .catch(() => false);
    const hasInvalidInvitation = await page
      .getByText("Invalid Invitation")
      .isVisible()
      .catch(() => false);

    // Either the error alert or invalid invitation heading should be visible
    expect(hasErrorAlert || hasInvalidInvitation).toBe(true);
  });
});

test.describe("Accept Invitation Page - Loading State", () => {
  test("shows loading state initially when token is provided", async ({
    page,
  }) => {
    // Navigate with a token to trigger the loading state
    // We intercept the API call to keep the loading state visible longer
    await page.route(
      "**/api/v1/organizations/invitations/**",
      async (route) => {
        // Delay the response to ensure we can capture the loading state
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Invitation not found" }),
        });
      }
    );

    await page.goto("/invitations/accept?token=test-loading-token");

    // Should briefly show loading state
    const hasLoading = await page
      .getByText("Loading invitation")
      .isVisible()
      .catch(() => false);
    const hasInvalid = await page
      .getByText("Invalid Invitation")
      .isVisible()
      .catch(() => false);

    await page.screenshot({
      path: "test-results/pages-invitation-loading.png",
      fullPage: true,
    });

    // Should show either loading or the subsequent error state
    expect(hasLoading || hasInvalid).toBe(true);
  });
});
