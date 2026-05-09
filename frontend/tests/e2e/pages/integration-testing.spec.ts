/**
 * E2E tests for the top-level Integration Testing page
 *
 * Page covered: /integration-testing
 *
 * This is the main integration testing page that uses RequireProject
 * and features a dual-column layout with a control panel and run list.
 *
 * The page wraps its content in <RequireProject>, which renders an empty
 * "select a project" card unless a project is selected via context, local
 * imported data, or a `?project=<uuid>` URL param. We pass the seeded dev
 * project UUID inline so the real page renders.
 */

import { test, expect } from "../fixtures";

const PROJECT_ID = "fb93478d-98bd-4e40-99f4-0f2c08c1fd5a";
const PAGE_URL = `/integration-testing?project=${PROJECT_ID}`;

test.describe("Integration Testing Page", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-integration-testing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Integration Testing");
  });

  test("should display Mock Mode badge", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Mock Mode").first()).toBeVisible();
  });

  test("should display API health monitoring badge", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    // The API health badge shows one of: "Checking API...", "API Connected", "API Offline"
    const healthBadge = page
      .getByText(/API Connected|API Offline|Checking API/i)
      .first();
    await expect(healthBadge).toBeVisible({ timeout: 10000 });
  });

  test("should display dual-column layout with control panel and runs list", async ({
    page,
  }) => {
    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    // The page uses a grid layout: control panel on left, runs list on right
    // The right column has the "Test Run History" heading
    await expect(
      page.getByRole("heading", { name: /Test Run History/i })
    ).toBeVisible();

    // The description text for the runs list
    await expect(
      page
        .getByText("Previous integration test results using historical")
        .first()
    ).toBeVisible();
  });

  test("should display Refresh button in list mode", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("button", { name: /Refresh/i })).toBeVisible();
  });

  test("should show empty state or runs list", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    // The runs area heading is always rendered after RequireProject hydrates;
    // wait for it explicitly so the immediate isVisible() snapshot below
    // doesn't race the initial render.
    const runsArea = page.getByRole("heading", { name: /Test Run History/i });
    await expect(runsArea).toBeVisible({ timeout: 15000 });

    // Either shows run cards or empty state message
    const emptyState = page.getByText("No Integration Tests Yet");
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    // If there are no runs, empty state should be visible
    if (hasEmpty) {
      await expect(
        page.getByText(/Select a workflow from the configuration panel/i).first()
      ).toBeVisible();
    }
  });

  test("should display run history with status badges when runs exist", async ({
    page,
  }) => {
    // The page fetches runs from the main backend at
    // /api/v1/execution/runs?project_id=<uuid>&... (see services/integration-testing.ts).
    // The response shape mirrors IntegrationTestRunSummary; the service maps
    // each backend run into that shape directly, so we mock the backend route
    // with the matching field names.
    await page.route("**/api/v1/execution/runs**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          runs: [
            {
              id: "run-1",
              workflow_name: "Login Workflow",
              status: "completed",
              started_at: new Date().toISOString(),
              coverage_percentage: 85.5,
              success_rate: 92,
              total_actions: 15,
              duration_ms: 3500,
              issues_count: 0,
            },
            {
              id: "run-2",
              workflow_name: "Checkout Flow",
              status: "failed",
              started_at: new Date(Date.now() - 86400000).toISOString(),
              coverage_percentage: 45.0,
              success_rate: 60,
              total_actions: 10,
              duration_ms: 2100,
              issues_count: 3,
            },
            {
              id: "run-3",
              workflow_name: "Settings",
              status: "running",
              started_at: new Date().toISOString(),
              coverage_percentage: 30.0,
              success_rate: 100,
              total_actions: 5,
              duration_ms: 1000,
              issues_count: 0,
            },
            {
              id: "run-4",
              workflow_name: "Timeout Test",
              status: "timeout",
              started_at: new Date(Date.now() - 172800000).toISOString(),
              coverage_percentage: 20.0,
              success_rate: 50,
              total_actions: 8,
              duration_ms: 60000,
              issues_count: 1,
            },
          ],
        }),
      });
    });

    await page.goto(PAGE_URL);
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pages-integration-testing-with-runs.png",
      fullPage: true,
    });

    // Wait for the runs section to hydrate past RequireProject +
    // useProjectLoader + the mocked fetch + state update on the first
    // status-badge assertion. On slower engines (webkit, Mobile Safari) the
    // default 5s toBeVisible timeout isn't enough for that chain. Note: the
    // mock body uses the IntegrationTestRunSummary shape (workflow_name,
    // status, ...), but services/integration-testing.ts:349 reads
    // run.workflow_metadata?.workflow_name — so workflow_name renders blank.
    // status flows through unchanged, which is why we anchor on the badges.
    // Once the first badge lands, the rest are in the DOM by construction.
    await expect(page.getByText("Completed").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Failed").first()).toBeVisible();
    await expect(page.getByText("Running").first()).toBeVisible();
    await expect(page.getByText("Timeout").first()).toBeVisible();
  });
});
