/**
 * End-to-end tests for documentation hub pages
 *
 * Tests the public-facing documentation pages:
 * - Docs hub (/docs) - documentation categories, navigation links, quick start
 * - Getting Started (/docs/getting-started) - 3-step workflow, step cards
 *
 * These pages do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Docs Hub (/docs)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-hub.png",
      fullPage: true,
    });
  });

  test("displays main heading and description", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /qontinui documentation/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        "Everything you need to build intelligent GUI automation workflows"
      )
    ).toBeVisible();
  });

  test("shows 4 documentation categories", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    // Verify each documentation category section
    await expect(page.getByText("Qontinui Web")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Qontinui Runner")).toBeVisible();
    await expect(page.getByText("Python API")).toBeVisible();
    await expect(page.getByText("Core Concepts")).toBeVisible();
  });

  test("shows category descriptions", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText(
        "Visual configuration builder for creating automation workflows in your browser"
      )
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        "Desktop application for executing automation workflows on your system"
      )
    ).toBeVisible();

    await expect(
      page.getByText("Use Qontinui programmatically in your Python projects")
    ).toBeVisible();

    await expect(
      page.getByText("Understand the model-based architecture behind Qontinui")
    ).toBeVisible();
  });

  test("has navigation links within each category", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    // Qontinui Web links
    await expect(
      page.getByRole("link", { name: "Working with States" })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("link", { name: "Action Types" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "State Transitions" })
    ).toBeVisible();

    // Qontinui Runner links
    await expect(
      page.getByRole("link", { name: "Installation" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Running Automations" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /monitoring/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /multi-monitor/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Troubleshooting" })
    ).toBeVisible();
  });

  test("shows quick start section with getting started link", async ({
    page,
  }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("New to Qontinui?")).toBeVisible({
      timeout: 10000,
    });

    const getStartedLink = page.getByRole("link", {
      name: /get started/i,
    });
    await expect(getStartedLink).toBeVisible();
    await expect(getStartedLink).toHaveAttribute(
      "href",
      "/docs/getting-started"
    );
  });

  test("shows Documentation Sections heading", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /documentation sections/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows Additional Resources section", async ({ page }) => {
    await page.goto("/docs");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /additional resources/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("GitHub Repositories")).toBeVisible();
    await expect(page.getByText("Example Projects")).toBeVisible();
    await expect(page.getByText("Community Support")).toBeVisible();
  });
});

test.describe("Getting Started (/docs/getting-started)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-getting-started.png",
      fullPage: true,
    });
  });

  test("displays main heading and subtitle", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", { name: /getting started/i });
    await expect(heading).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        "Create your first GUI automation workflow in 3 simple steps"
      )
    ).toBeVisible();
  });

  test("has back to documentation link", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    const backLink = page.getByRole("link", {
      name: /back to documentation/i,
    });
    await expect(backLink).toBeVisible({ timeout: 10000 });
    await expect(backLink).toHaveAttribute("href", "/docs");
  });

  test("shows What You'll Learn section", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("How to build automation workflows in Qontinui Web")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("How to test your automation with mock execution")
    ).toBeVisible();
    await expect(
      page.getByText("How to run your automation with Qontinui Runner")
    ).toBeVisible();
  });

  test("shows 3-step workflow: Build, Test, Run", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    // Step 1: Build
    await expect(
      page.getByRole("heading", {
        name: /build your automation in qontinui web/i,
      })
    ).toBeVisible({ timeout: 10000 });

    // Step 2: Test
    await expect(
      page.getByRole("heading", { name: /test with mock execution/i })
    ).toBeVisible();

    // Step 3: Run
    await expect(
      page.getByRole("heading", { name: /run with qontinui runner/i })
    ).toBeVisible();
  });

  test("Step 1 has sub-sections for building automation", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Create a Free Account")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Create Your First Project")).toBeVisible();
    await expect(page.getByText("Define Your States")).toBeVisible();
    await expect(page.getByText("Add Actions and Transitions")).toBeVisible();
  });

  test("Step 2 has mock testing explanation", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Why Mock Testing?")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Step 3 has runner download and export instructions", async ({
    page,
  }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: "Download Qontinui Runner" })
    ).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Export Your Configuration")).toBeVisible();
    await expect(page.getByText("Load and Execute")).toBeVisible();
  });

  test("shows Next Steps section with cards", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /next steps/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Explore Examples")).toBeVisible();
    await expect(page.getByText("Advanced Features")).toBeVisible();
    await expect(page.getByText("Python API")).toBeVisible();
    await expect(page.getByText("Troubleshooting")).toBeVisible();
  });

  test("has Learn More links to detailed documentation", async ({ page }) => {
    await page.goto("/docs/getting-started");
    await page.waitForLoadState("domcontentloaded");

    // Links within the step cards
    await expect(
      page.getByRole("link", { name: "Working with States" })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("link", { name: "Action Types" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "State Transitions" })
    ).toBeVisible();
  });
});
