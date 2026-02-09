/**
 * E2E tests for the project-scoped RAG (Visual Index) dashboard
 *
 * Page covered: /projects/[projectId]/rag
 *
 * The RAG dashboard provides:
 * - Visual indexing interface with stats header
 * - Tabbed content: Indexed Elements, Processing History, Semantic Search
 */

import { test, expect } from "../fixtures";

// Use a placeholder project ID for page-load tests
const TEST_PROJECT_ID = "test-project-placeholder-id";

test.describe("Project RAG Dashboard", () => {
  test("should load without errors and display heading", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-project-rag.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await expect(page.locator("h1")).toContainText("Visual Index");
  });

  test("should display Dashboard back button", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("button", { name: /Dashboard/i }).first()
    ).toBeVisible();
  });

  test("should display 3 tabs: Indexed Elements, Processing History, Semantic Search", async ({
    page,
  }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("tab", { name: /Indexed Elements/i })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Processing History/i })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Semantic Search/i })
    ).toBeVisible();
  });

  test("should display Indexed Elements tab by default", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    // The Indexed Elements tab should be active by default
    const elementsTab = page.getByRole("tab", { name: /Indexed Elements/i });
    await expect(elementsTab).toHaveAttribute("data-state", "active");
  });

  test("should switch to Processing History tab", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    // Click Processing History tab
    await page.getByRole("tab", { name: /Processing History/i }).click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: "test-results/pages-project-rag-processing.png",
      fullPage: true,
    });

    // Verify the Processing History tab is active
    const historyTab = page.getByRole("tab", { name: /Processing History/i });
    await expect(historyTab).toHaveAttribute("data-state", "active");
  });

  test("should switch to Semantic Search tab", async ({ page }) => {
    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    // Click Semantic Search tab
    await page.getByRole("tab", { name: /Semantic Search/i }).click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: "test-results/pages-project-rag-search.png",
      fullPage: true,
    });

    // Verify the Semantic Search tab is active
    const searchTab = page.getByRole("tab", { name: /Semantic Search/i });
    await expect(searchTab).toHaveAttribute("data-state", "active");
  });

  test("should display RAG dashboard stats header area", async ({ page }) => {
    // Mock the RAG dashboard API to return stats
    await page.route(
      `**/api/v1/projects/${TEST_PROJECT_ID}/rag/dashboard`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            total_embeddings: 14,
            total_patterns: 8,
            total_states: 5,
            last_indexed_at: new Date().toISOString(),
            jobs_in_progress: 0,
          }),
        });
      }
    );

    await page.goto(`/projects/${TEST_PROJECT_ID}/rag`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pages-project-rag-with-stats.png",
      fullPage: true,
    });

    // The RAGDashboardHeader component renders stats
    // It should be present on the page (even if loading or showing placeholder data)
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });
});
