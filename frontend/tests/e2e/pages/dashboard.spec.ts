/**
 * E2E tests for Dashboard pages
 *
 * Pages tested:
 * - /project-dashboard - Renders the DashboardContent (mock data); does NOT
 *   wrap in <RequireProject> so no `?project=` query param is required. The
 *   page heading is "Project Dashboard" and exposes Overview/Resources/Health
 *   tabs plus metric cards (Total Workflows, Total States, Total Images,
 *   Total Transitions) and a "Project Health Score" panel.
 * - /analytics - Standalone page (auth-gated only); the heading is just
 *   "Analytics" — there is no "Analytics Dashboard" copy and no
 *   "Back to Dashboard" button on this page.
 *
 * The /dashboard route itself is a redirect-only stub (to /build/workflows or
 * /tools/visual-automation depending on product mode), so it has no tests.
 */

import { test, expect } from "../fixtures";

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
    // firefox occasionally hits ERR_CONNECTION_REFUSED on the first
    // goto of this test under CI load even though the dev server is
    // up (other tests in this file succeed). One retry papers over
    // the browser-init timing window.
    try {
      await page.goto("/project-dashboard");
    } catch (e) {
      if (e instanceof Error && /CONNECTION_REFUSED/i.test(e.message)) {
        await page.waitForTimeout(1000);
        await page.goto("/project-dashboard");
      } else {
        throw e;
      }
    }
    await page.waitForLoadState("domcontentloaded");

    // Verify metric cards are visible (rendered by MetricsOverview).
    await expect(page.getByText("Total Workflows")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total States")).toBeVisible();
    await expect(page.getByText("Total Images")).toBeVisible();
    await expect(page.getByText("Total Transitions")).toBeVisible();

    // Verify main content tabs exist (DashboardContent has six tabs; the
    // first three are asserted as a representative sample).
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

    // Health score label should show (Excellent, Good, Fair, Poor, or Critical
    // — see HealthScoreGauge.getScoreLabel).
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

    // The heading is "Analytics" (not "Analytics Dashboard" — that copy
    // belongs to the workflow-analytics component on a different page).
    await expect(
      page.locator("h1:has-text('Analytics')").first()
    ).toBeVisible({
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

  // Removed: "has back to dashboard button" — /analytics has no
  // "Back to Dashboard" control. The page header is just an h1 + the user's
  // name/email, and the body renders metric cards + charts only.
});
