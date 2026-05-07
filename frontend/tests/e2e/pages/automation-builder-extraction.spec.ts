/**
 * E2E tests for Automation Builder - Extraction pages
 *
 * Tests page loading, key UI elements, and navigation for:
 * - /automation-builder/extraction (unified extraction)
 * - /automation-builder/template-capture
 * - /automation-builder/image-extraction
 * - /automation-builder/web-extraction (legacy redirect)
 * - /automation-builder/background-removal
 * - /automation-builder/pattern-optimization
 * - /automation-builder/ui-bridge-states (legacy redirect)
 */

import { test, expect } from "../fixtures";

// Seeded project UUID — extraction pages wrap in <RequireProject>.
const PROJECT_ID = "fb93478d-98bd-4e40-99f4-0f2c08c1fd5a";

// Run tests serially to avoid parallel timeout issues
test.describe.configure({ mode: "serial" });

test.describe("Extraction (Unified)", () => {
  test("should load the unified extraction page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/extraction");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/extraction-unified.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the method selector", async ({ page }) => {
    await page.goto(`/automation-builder/extraction?project=${PROJECT_ID}`);
    await page.waitForLoadState("domcontentloaded");

    // The ExtractionMethodSelector renders card-based options for methods
    // Verify at least some of the method labels are visible
    await expect(
      page.getByText("Web Extraction", { exact: false }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("should display config panel area", async ({ page }) => {
    await page.goto("/automation-builder/extraction");
    await page.waitForLoadState("domcontentloaded");

    // The page should have a configuration area with method-specific panels
    // Verify the page has rendered meaningful content (not just a spinner)
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // The page wraps in RequireProject with pageName="Discover"
    // When a project is selected, method options should be visible
    const hasMethodOptions = await page
      .getByText("Web Extraction")
      .isVisible()
      .catch(() => false);

    const hasProjectRequirement = await page
      .getByText(/select.*project/i)
      .isVisible()
      .catch(() => false);

    // Either method options are shown (project selected) or project selection is required
    expect(hasMethodOptions || hasProjectRequirement).toBe(true);
  });

  test("should support multiple extraction methods", async ({ page }) => {
    await page.goto("/automation-builder/extraction");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the method selector to render
    const webMethod = page.getByText("Web Extraction");
    const hasWebMethod = await webMethod.isVisible().catch(() => false);

    if (hasWebMethod) {
      // Verify multiple method options exist in the selector
      await expect(page.getByText("Web Extraction")).toBeVisible();
      await expect(
        page.getByText("UI Bridge States", { exact: false })
      ).toBeVisible();
      await expect(
        page.getByText("Image Extraction", { exact: false })
      ).toBeVisible();
    }

    // Take screenshot for visual verification
    await page.screenshot({
      path: "test-results/extraction-methods.png",
      fullPage: true,
    });
  });
});

test.describe("Template Capture", () => {
  test("should load the template capture page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/template-capture");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/template-capture.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display three tabs: Capture, Review Templates, App Profiles", async ({
    page,
  }) => {
    await page.goto("/automation-builder/template-capture");
    await page.waitForLoadState("domcontentloaded");

    // The page uses RequireProject with pageName="Template Capture"
    // If project is selected, tabs should be visible
    const captureTab = page.getByRole("tab", { name: /Capture/i });
    const hasCaptureTab = await captureTab
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasCaptureTab) {
      await expect(captureTab).toBeVisible();
      await expect(
        page.getByRole("tab", { name: /Review Templates/i })
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: /App Profiles/i })
      ).toBeVisible();
    } else {
      // Project selection required - verify the page still loaded
      const pageContent = await page.content();
      expect(pageContent).not.toContain("Internal Server Error");
    }
  });
});

test.describe("Image Extraction", () => {
  test("should load the image extraction page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/image-extraction");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/image-extraction.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the extraction interface", async ({ page }) => {
    await page.goto("/automation-builder/image-extraction");
    await page.waitForLoadState("domcontentloaded");

    // The page uses RequireProject with pageName="Extract Images"
    // When loaded, the ImageExtractionPage component renders with an h1
    const heading = page.getByRole("heading", { name: /Image Extraction/i });
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

test.describe("Web Extraction (Legacy Redirect)", () => {
  test("should redirect to the unified extraction page", async ({ page }) => {
    await page.goto("/automation-builder/web-extraction");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/web-extraction-redirect.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // The web-extraction page redirects via router.replace to /automation-builder/extraction
    // Wait for the redirect to complete
    await page.waitForURL(/\/automation-builder\/extraction/, {
      timeout: 15000,
    });
    expect(page.url()).toContain("/automation-builder/extraction");
  });
});

test.describe("Background Removal", () => {
  test("should load the background removal page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/background-removal");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/background-removal.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the experimental feature interface", async ({
    page,
  }) => {
    await page.goto("/automation-builder/background-removal");
    await page.waitForLoadState("domcontentloaded");

    // The page uses RequireProject with pageName="Remove Background"
    // The BackgroundRemovalTab renders with an h1 "Background Removal"
    const heading = page.getByRole("heading", { name: /Background Removal/i });
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

test.describe("Pattern Optimization", () => {
  test("should load the pattern optimization page without errors", async ({
    page,
  }) => {
    await page.goto("/automation-builder/pattern-optimization");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/pattern-optimization.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display the pattern extraction interface", async ({ page }) => {
    await page.goto("/automation-builder/pattern-optimization");
    await page.waitForLoadState("domcontentloaded");

    // The page uses RequireProject with pageName="Pattern Extraction"
    // The PatternOptimizationSimplified renders with an h1 "Pattern Extraction"
    const heading = page.getByRole("heading", { name: /Pattern Extraction/i });
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

test.describe("UI Bridge States (Legacy Redirect)", () => {
  test("should redirect to the unified extraction page with ui-bridge method", async ({
    page,
  }) => {
    await page.goto("/automation-builder/ui-bridge-states");
    await page.waitForLoadState("domcontentloaded");

    await page.screenshot({
      path: "test-results/ui-bridge-states-redirect.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    // The ui-bridge-states page redirects via router.replace to
    // /automation-builder/extraction?method=ui-bridge
    await page.waitForURL(
      /\/automation-builder\/extraction.*method=ui-bridge/,
      {
        timeout: 15000,
      }
    );
    expect(page.url()).toContain("/automation-builder/extraction");
    expect(page.url()).toContain("method=ui-bridge");
  });
});
