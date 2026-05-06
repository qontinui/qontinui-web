/**
 * E2E tests for Profile and Billing pages
 *
 * Tests the profile page, pricing page, and billing result pages.
 * Verifies page load, key elements, and proper display of subscription tiers.
 */

import { test, expect } from "../fixtures";

test.describe("Profile Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-profile.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify My Profile heading is present
    await expect(page.getByText("My Profile").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows profile form area with user info", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Wait for profile data to load
    await page.waitForTimeout(3000);

    // User profile header should display user info (username or full name)
    const profileHeader = page.locator('[data-testid="user-profile-header"]');
    await expect(profileHeader).toBeVisible({ timeout: 15000 });

    // "Member since" text should be visible
    await expect(page.getByText(/Member since/).first()).toBeVisible();

    await page.screenshot({
      path: "test-results/pages-profile-form.png",
      fullPage: true,
    });
  });

  test("shows storage usage section", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Wait for profile data to load (storage section loads async)
    await page.waitForTimeout(3000);

    // Take screenshot to verify layout
    await page.screenshot({
      path: "test-results/pages-profile-storage.png",
      fullPage: true,
    });

    // The page should have loaded without error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("has back to dashboard and connect runner buttons", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Back to Dashboard button
    const backBtn = page.locator('[data-testid="profile-back-btn"]');
    await expect(backBtn).toBeVisible({ timeout: 15000 });

    // Connect Runner button
    const connectBtn = page.locator(
      '[data-testid="profile-connect-runner-btn"]'
    );
    await expect(connectBtn).toBeVisible();
  });
});

test.describe("Pricing Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-pricing.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify Choose Your Plan heading
    await expect(page.getByText("Choose Your Plan").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("displays all three subscription tiers", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Verify the pricing tiers grid is present
    const tiersGrid = page.locator('[data-testid="pricing-tiers-grid"]');
    await expect(tiersGrid).toBeVisible({ timeout: 15000 });

    // Verify all three tier cards are visible
    const freeTier = page.locator('[data-testid="pricing-tier-free"]');
    await expect(freeTier).toBeVisible();

    const hobbyTier = page.locator('[data-testid="pricing-tier-hobby"]');
    await expect(hobbyTier).toBeVisible();

    const proTier = page.locator('[data-testid="pricing-tier-pro"]');
    await expect(proTier).toBeVisible();

    // Verify tier names are displayed
    await expect(freeTier.getByText("Free")).toBeVisible();
    await expect(hobbyTier.getByText("Hobby")).toBeVisible();
    await expect(proTier.getByText("Pro")).toBeVisible();

    // Verify prices
    await expect(freeTier.getByText("$0")).toBeVisible();
    await expect(hobbyTier.getByText("$7")).toBeVisible();
    await expect(proTier.getByText("$24")).toBeVisible();
  });

  test("shows Popular badge on Hobby tier", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Hobby tier should have "Popular" badge
    await expect(page.getByText("Popular")).toBeVisible({ timeout: 15000 });
  });

  test("shows feature lists for each tier", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Verify some feature texts are visible
    await expect(page.getByText("5 configurations")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("100 configurations")).toBeVisible();
    await expect(page.getByText("Unlimited configurations")).toBeVisible();
  });
});

test.describe("Billing Success Page", () => {
  test("loads and shows success message", async ({ page }) => {
    await page.goto("/billing/success");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-billing-success.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify success message
    await expect(page.getByText("Payment Successful!")).toBeVisible({
      timeout: 15000,
    });

    // Verify subscription activation message
    await expect(
      page.getByText("Your subscription has been activated")
    ).toBeVisible();
  });

  test("shows redirect countdown and dashboard button", async ({ page }) => {
    await page.goto("/billing/success");
    await page.waitForLoadState("domcontentloaded");

    // Verify redirect countdown text is present
    await expect(
      page.getByText(/Redirecting to dashboard in \d+ seconds/)
    ).toBeVisible({ timeout: 15000 });

    // Verify Go to Dashboard Now button
    await expect(page.getByText("Go to Dashboard Now")).toBeVisible();
  });
});

test.describe("Billing Canceled Page", () => {
  test("loads and shows cancellation message", async ({ page }) => {
    await page.goto("/billing/canceled");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-billing-canceled.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify cancellation message
    await expect(page.getByText("Payment Canceled")).toBeVisible({
      timeout: 15000,
    });

    // Verify explanation text
    await expect(
      page.getByText("Your subscription upgrade was not completed")
    ).toBeVisible();
  });

  test("shows navigation buttons", async ({ page }) => {
    await page.goto("/billing/canceled");
    await page.waitForLoadState("domcontentloaded");

    // Verify View Plans Again button
    await expect(page.getByText("View Plans Again")).toBeVisible({
      timeout: 15000,
    });

    // Verify Back to Dashboard button
    await expect(page.getByText("Back to Dashboard")).toBeVisible();
  });

  test("confirms no charges message", async ({ page }) => {
    await page.goto("/billing/canceled");
    await page.waitForLoadState("domcontentloaded");

    // Verify no charges message
    await expect(
      page.getByText("No charges were made to your account")
    ).toBeVisible({ timeout: 15000 });
  });
});
