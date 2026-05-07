/**
 * E2E tests for Dashboard pages
 *
 * Tests the main dashboard, project dashboard, and analytics pages.
 * Verifies page load, key elements, and basic interactions.
 */

import { test, expect } from "../fixtures";

test.describe("Dashboard Page", () => {
  test("shows runner status area", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Runner connection card should be visible with "Desktop Runner" text
    await expect(page.getByText("Desktop Runner")).toBeVisible({
      timeout: 15000,
    });

    // Status should show either Connected, Checking, or Offline
    const statusText = page.getByText(/(Connected|Checking|Offline)/);
    await expect(statusText.first()).toBeVisible({ timeout: 10000 });
  });

  test("shows quick action buttons", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Wait for Quick Actions section to load
    await expect(page.getByText("Quick Actions")).toBeVisible({
      timeout: 15000,
    });

    // Verify the four quick action buttons are present
    await expect(page.getByText("Execute Workflow")).toBeVisible();
    await expect(page.getByText("Build Workflow")).toBeVisible();
    await expect(page.getByText("View Runs")).toBeVisible();
  });

  test("shows active runs and recent runs sections", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Active Runs card should be visible
    await expect(page.getByText("Active Runs").first()).toBeVisible({
      timeout: 15000,
    });

    // Recent Runs card should be visible
    await expect(page.getByText("Recent Runs").first()).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Project Dashboard Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/project-dashboard");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-project-dashboard.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify the Project Dashboard heading is present
    await expect(page.getByText("Project Dashboard").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows metric cards and resource overview tabs", async ({ page }) => {
    await page.goto("/project-dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Verify metric cards are visible (Total Workflows, Total States, etc.)
    await expect(page.getByText("Total Workflows")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total States")).toBeVisible();
    await expect(page.getByText("Total Images")).toBeVisible();
    await expect(page.getByText("Total Transitions")).toBeVisible();

    // Verify main content tabs exist
    await expect(page.getByText("Overview").first()).toBeVisible();
    await expect(page.getByText("Resources").first()).toBeVisible();
    await expect(page.getByText("Health").first()).toBeVisible();
  });

  test("shows project health score section", async ({ page }) => {
    await page.goto("/project-dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Project Health Score card should be visible
    await expect(page.getByText("Project Health Score").first()).toBeVisible({
      timeout: 15000,
    });

    // Health score label should show (Excellent, Good, Fair, Poor, or Critical)
    const healthLabel = page.getByText(/(Excellent|Good|Fair|Poor|Critical)/);
    await expect(healthLabel.first()).toBeVisible();
  });
});

test.describe("Analytics Page", () => {
  test("loads without errors and shows heading", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-analytics.png",
      fullPage: true,
    });

    // Should not have 500 error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // Verify Analytics Dashboard heading is present
    await expect(page.getByText("Analytics Dashboard").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows metric cards area", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("domcontentloaded");

    // Wait for loading to finish
    await page.waitForTimeout(3000);

    // Verify metric card titles are present
    await expect(page.getByText("API Calls Today").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total Projects").first()).toBeVisible();
    await expect(page.getByText("Storage Used").first()).toBeVisible();
    await expect(page.getByText("Last Active").first()).toBeVisible();
  });

  test("has back to dashboard button", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("domcontentloaded");

    // Back to Dashboard button should be visible
    await expect(page.getByText("Back to Dashboard").first()).toBeVisible({
      timeout: 15000,
    });
  });
});
