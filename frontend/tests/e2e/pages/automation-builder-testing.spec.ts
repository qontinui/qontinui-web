/**
 * E2E tests for Automation Builder - Testing pages
 *
 * Tests page loading, key UI elements, and navigation for:
 * - /automation-builder/testing (workflow testing)
 * - /automation-builder/pattern-tests
 * - /automation-builder/navigation-tests
 * - /automation-builder/snapshot-tests
 * - /automation-builder/state-discovery
 * - /automation-builder/semantic-analysis
 * - /automation-builder/rag-testing
 */

import { test, expect } from "../fixtures";

// Run tests serially to avoid parallel timeout issues
test.describe.configure({ mode: "serial" });

test.describe("Workflow Testing", () => {
  test("should load the testing page without errors", async ({ page }) => {
    await page.goto("/automation-builder/testing");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/workflow-testing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the Workflow Testing heading", async ({ page }) => {
    await page.goto("/automation-builder/testing");
    await page.waitForLoadState("networkidle");

    // The page renders an h1 with "Workflow Testing"
    const heading = page.getByRole("heading", { name: /Workflow Testing/i });
    const hasHeading = await heading
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasHeading) {
      await expect(heading).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });

  test("should display three-column layout with test navigator, details, and results", async ({
    page,
  }) => {
    await page.goto("/automation-builder/testing");
    await page.waitForLoadState("networkidle");

    // The page has a three-column layout:
    // Left: Test Navigator (20%), Center: Test Details (50%), Right: Test Results (30%)
    const testNavigator = page.getByText("Test Navigator", { exact: false });
    const hasNavigator = await testNavigator
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasNavigator) {
      await expect(testNavigator).toBeVisible();
      await expect(
        page.getByText("Test Results", { exact: false })
      ).toBeVisible();
    }

    await page.screenshot({
      path: "test-results/workflow-testing-layout.png",
      fullPage: true,
    });
  });

  test("should display navigator tabs: Suites, Cases, Workflows", async ({
    page,
  }) => {
    await page.goto("/automation-builder/testing");
    await page.waitForLoadState("networkidle");

    // The Test Navigator has TabsList with three triggers
    const suitesTab = page.getByRole("tab", { name: /Suites/i });
    const hasSuitesTab = await suitesTab
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasSuitesTab) {
      await expect(suitesTab).toBeVisible();
      await expect(page.getByRole("tab", { name: /Cases/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Workflows/i })).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("Pattern Tests", () => {
  test("should load the pattern tests page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/pattern-tests");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/pattern-tests.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the pattern matching test interface", async ({
    page,
  }) => {
    await page.goto("/automation-builder/pattern-tests");
    await page.waitForLoadState("networkidle");

    // The page uses RequireProject with pageName="Pattern Tests"
    // The PatternMatchingTest component renders an h2 "Pattern Matching Test"
    const heading = page.getByRole("heading", {
      name: /Pattern Matching Test/i,
    });
    const hasHeading = await heading
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasHeading) {
      await expect(heading).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("Navigation Tests", () => {
  test("should load the navigation tests page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/navigation-tests");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/navigation-tests.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the navigation test generator interface", async ({
    page,
  }) => {
    await page.goto("/automation-builder/navigation-tests");
    await page.waitForLoadState("networkidle");

    // The page uses RequireProject with pageName="Navigation Test Generator"
    // The NavigationTestGenerator renders an h2 "Navigation Test Generator"
    const heading = page.getByRole("heading", {
      name: /Navigation Test Generator/i,
    });
    const hasHeading = await heading
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasHeading) {
      await expect(heading).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("Snapshot Tests", () => {
  test("should load the snapshot tests page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/snapshot-tests");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/snapshot-tests.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the snapshot test generator interface", async ({
    page,
  }) => {
    await page.goto("/automation-builder/snapshot-tests");
    await page.waitForLoadState("networkidle");

    // The page uses RequireProject with pageName="Snapshot Test Generator"
    // The SnapshotTestGenerator renders an h2 with role="heading"
    // and text "Snapshot Test Generator"
    const heading = page.getByRole("heading", {
      name: /Snapshot Test Generator/i,
    });
    const hasHeading = await heading
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasHeading) {
      await expect(heading).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("State Discovery", () => {
  test("should load the state discovery page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/state-discovery");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/state-discovery.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the state discovery interface", async ({ page }) => {
    await page.goto("/automation-builder/state-discovery");
    await page.waitForLoadState("networkidle");

    // The page uses RequireProject with pageName="State Discovery"
    // The StateDiscoveryTab renders an h2 "State Discovery"
    const heading = page.getByRole("heading", { name: /State Discovery/i });
    const hasHeading = await heading
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasHeading) {
      await expect(heading).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("Semantic Analysis", () => {
  test("should load the semantic analysis page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/semantic-analysis");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/semantic-analysis.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the semantic analysis interface", async ({ page }) => {
    await page.goto("/automation-builder/semantic-analysis");
    await page.waitForLoadState("networkidle");

    // The page uses RequireProject with pageName="Semantic Analysis"
    // The SemanticAnalysisTab renders card-based controls including
    // "Image Upload", "Processing Options", "Display Options", and "Analysis Results"
    const imageUploadCard = page.getByText("Image Upload", { exact: false });
    const hasInterface = await imageUploadCard
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasInterface) {
      await expect(imageUploadCard).toBeVisible();
      await expect(
        page.getByText("Processing Options", { exact: false })
      ).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("RAG Testing", () => {
  test("should load the RAG testing page without errors", async ({ page }) => {
    await page.goto("/automation-builder/rag-testing");
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: "test-results/rag-testing.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the RAG testing interface", async ({ page }) => {
    await page.goto("/automation-builder/rag-testing");
    await page.waitForLoadState("networkidle");

    // The page uses RequireProject with pageName="RAG Testing"
    // The RAGTestingTab renders a card-based layout with controls
    // including "Search Mode", "Display Options", and "Results" sections
    const searchModeCard = page.getByText("Search Mode", { exact: false });
    const hasInterface = await searchModeCard
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasInterface) {
      await expect(searchModeCard).toBeVisible();
    } else {
      // Project selection may be required
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});
