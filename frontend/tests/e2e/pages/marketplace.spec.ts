/**
 * E2E tests for Marketplace pages
 *
 * Tests the marketplace listing, package detail (with invalid slug),
 * and publish form pages. Verifies page load, key elements, and form structure.
 */

import { test, expect } from "../fixtures";

test.describe("Marketplace Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-marketplace.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Community Code Marketplace heading
    await expect(
      page.getByText("Community Code Marketplace").first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows package tabs (All, Popular, Installed)", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("domcontentloaded");

    // Verify the three tabs are present
    await expect(page.getByText("All Packages").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Popular").first()).toBeVisible();
    await expect(page.getByText("Installed").first()).toBeVisible();
  });

  test("shows Publish Package button", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("domcontentloaded");

    // Publish Package button should be visible
    await expect(page.getByText("Publish Package").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows package cards or empty state", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("domcontentloaded");

    // Wait for packages to load
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: "test-results/pages-marketplace-packages.png",
      fullPage: true,
    });

    // Should show either package cards or "No packages found" empty state
    // or loading skeleton cards
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // At least the tab content area should be rendered
    const hasPackages = await page
      .getByText("No packages found")
      .isVisible()
      .catch(() => false);
    const hasCards = await page
      .locator('[class*="grid"]')
      .first()
      .isVisible()
      .catch(() => false);

    // Either empty state or grid should be present
    expect(hasPackages || hasCards).toBe(true);
  });

  test("can switch between tabs", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("domcontentloaded");

    // Wait for initial load
    await page.waitForTimeout(2000);

    // Click on Popular tab
    await page.getByText("Popular").first().click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "test-results/pages-marketplace-popular.png",
      fullPage: true,
    });

    // Click on Installed tab
    await page.getByText("Installed").first().click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: "test-results/pages-marketplace-installed.png",
      fullPage: true,
    });

    // Should not have errors after tab switching
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });
});

test.describe("Package Detail Page", () => {
  test("shows error state for invalid slug", async ({ page }) => {
    await page.goto("/marketplace/non-existent-package-slug-12345");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-marketplace-invalid-slug.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Wait for loading to finish and error to appear
    await page.waitForTimeout(5000);

    // Should show "Package not found" or loading state
    const hasNotFound = await page
      .getByText("Package not found")
      .isVisible()
      .catch(() => false);
    const hasLoading = await page
      .getByText("Loading package details")
      .isVisible()
      .catch(() => false);
    const hasBackButton = await page
      .getByText("Back to Marketplace")
      .isVisible()
      .catch(() => false);

    // Should show either not found, loading, or back button
    expect(hasNotFound || hasLoading || hasBackButton).toBe(true);

    await page.screenshot({
      path: "test-results/pages-marketplace-not-found.png",
      fullPage: true,
    });
  });
});

test.describe("Publish Package Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/marketplace/publish");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-marketplace-publish.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Publish Package heading
    await expect(page.getByText("Publish Package").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows multi-tab form structure", async ({ page }) => {
    await page.goto("/marketplace/publish");
    await page.waitForLoadState("domcontentloaded");

    // Verify the four form tabs are present
    await expect(page.getByText("Package Details").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Code").first()).toBeVisible();
    await expect(page.getByText("README").first()).toBeVisible();
    await expect(page.getByText("Preview").first()).toBeVisible();
  });

  test("shows package details form on default tab", async ({ page }) => {
    await page.goto("/marketplace/publish");
    await page.waitForLoadState("domcontentloaded");

    // Verify basic form fields are visible on the Details tab
    await expect(page.getByText("Basic Information")).toBeVisible({
      timeout: 15000,
    });

    // Package Name field
    await expect(page.getByLabel("Package Name *")).toBeVisible();

    // Description field
    await expect(page.getByLabel("Description *")).toBeVisible();

    // Function Name field
    await expect(page.getByLabel("Function Name *")).toBeVisible();
  });

  test("shows security scan and publishing guidelines in sidebar", async ({
    page,
  }) => {
    await page.goto("/marketplace/publish");
    await page.waitForLoadState("domcontentloaded");

    // Security Scan section
    await expect(page.getByText("Security Scan").first()).toBeVisible({
      timeout: 15000,
    });

    // Publishing Guidelines section
    await expect(page.getByText("Publishing Guidelines")).toBeVisible();

    // Publish button (disabled initially since form is empty)
    const publishButton = page.getByRole("button", {
      name: /Publish Package/i,
    });
    await expect(publishButton).toBeVisible();
    await expect(publishButton).toBeDisabled();
  });

  test("has back to marketplace link", async ({ page }) => {
    await page.goto("/marketplace/publish");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Back to Marketplace")).toBeVisible({
      timeout: 15000,
    });
  });

  test("can navigate between form tabs", async ({ page }) => {
    await page.goto("/marketplace/publish");
    await page.waitForLoadState("domcontentloaded");

    // Click Code tab
    await page.getByText("Code").first().click();
    await page.waitForTimeout(1000);

    // Should show Package Code section
    await expect(page.getByText("Package Code")).toBeVisible({
      timeout: 10000,
    });

    await page.screenshot({
      path: "test-results/pages-marketplace-publish-code.png",
      fullPage: true,
    });

    // Click README tab
    const readmeTab = page
      .locator('[role="tab"]')
      .filter({ hasText: "README" });
    await readmeTab.click();
    await page.waitForTimeout(1000);

    // Should show README section with markdown support
    await expect(page.getByText("README (Markdown)").first()).toBeVisible({
      timeout: 10000,
    });

    // Click Preview tab
    await page.getByText("Preview").first().click();
    await page.waitForTimeout(1000);

    // Should show Package Preview section
    await expect(page.getByText("Package Preview")).toBeVisible({
      timeout: 10000,
    });
  });
});
