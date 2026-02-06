/**
 * Navigation Test Generator E2E Tests
 *
 * Tests the Navigation Test Generator page functionality:
 * - Page loads correctly with all tabs
 * - Exploration configuration UI is functional
 * - API calls use correct request format
 */

import { test, expect } from "./fixtures";

// Use a known project ID for testing
const PROJECT_ID = "f0816920-92ed-4d18-b6d2-9f6d02b42a38";
const PAGE_URL = `/automation-builder/navigation-tests?project=${PROJECT_ID}`;

// Run tests serially to avoid parallel timeout issues
test.describe.configure({ mode: "serial" });

test.describe("Navigation Test Generator", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to navigation tests page with project ID
    // Use domcontentloaded wait option to avoid timeout
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    // Wait for the page content to appear
    await page.waitForSelector('h2:has-text("Navigation Test Generator")', {
      timeout: 30000,
    });
  });

  test("should display page with all sections", async ({ page }) => {
    // Verify page title
    await expect(page.locator("h2")).toContainText("Navigation Test Generator");

    // Verify tabs are present
    await expect(page.getByRole("button", { name: /Explore/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /State Graph/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Test Specs/i })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Output/i })).toBeVisible();
  });

  test("should show exploration configuration", async ({ page }) => {
    // Verify exploration config section
    await expect(page.getByText("Exploration Configuration")).toBeVisible();

    // Verify input fields
    await expect(page.getByPlaceholder("http://localhost:3000")).toBeVisible();
    await expect(page.locator('label:has-text("Max Depth")')).toBeVisible();
    await expect(page.locator('label:has-text("Max Elements")')).toBeVisible();
  });

  test("should have Start Exploration button disabled without URL", async ({
    page,
  }) => {
    const startButton = page.getByRole("button", {
      name: /Start Exploration/i,
    });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();
  });

  test("should enable Start Exploration button with URL", async ({ page }) => {
    // Enter a target URL
    const urlInput = page.getByPlaceholder("http://localhost:3000");
    await urlInput.fill("http://localhost:3001");

    // Verify button is enabled
    const startButton = page.getByRole("button", {
      name: /Start Exploration/i,
    });
    await expect(startButton).toBeEnabled();
  });

  test("should send correct API request format", async ({ page }) => {
    // Set up route interception to capture the request
    let capturedRequest: {
      connection_url?: string;
      target_type?: string;
      max_depth?: number;
      max_elements_per_page?: number;
      max_total_elements?: number;
    } | null = null;

    await page.route("**/ui-bridge/explore", async (route) => {
      const request = route.request();
      capturedRequest = JSON.parse(request.postData() || "{}");

      // Mock successful response
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            job_id: "test-job-123",
            status: "started",
          },
        }),
      });
    });

    // Also mock the status endpoint
    await page.route("**/ui-bridge/explore/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            status: "completed",
            elements_found: 5,
            states_found: 2,
          },
        }),
      });
    });

    // Mock results endpoint
    await page.route("**/ui-bridge/explore/results", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            states: [],
            transitions: [],
          },
        }),
      });
    });

    // Enter a target URL
    const urlInput = page.getByPlaceholder("http://localhost:3000");
    await urlInput.fill("http://localhost:3001");

    // Click start exploration
    const startButton = page.getByRole("button", {
      name: /Start Exploration/i,
    });
    await startButton.click();

    // Wait for the request to be made
    await page.waitForTimeout(1000);

    // Verify the request format
    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest?.connection_url).toBe("http://localhost:3001");
    expect(capturedRequest?.target_type).toBe("web");
    expect(typeof capturedRequest?.max_depth).toBe("number");
    expect(typeof capturedRequest?.max_elements_per_page).toBe("number");
    expect(typeof capturedRequest?.max_total_elements).toBe("number");

    // Verify old fields are NOT present
    expect(
      (capturedRequest as Record<string, unknown>)?.target_url
    ).toBeUndefined();
    expect(
      (capturedRequest as Record<string, unknown>)?.max_elements
    ).toBeUndefined();
  });

  test("should switch to State Graph tab", async ({ page }) => {
    // Click on State Graph tab
    await page.getByRole("button", { name: /State Graph/i }).click();

    // Verify empty state message
    await expect(page.getByText(/No states discovered yet/i)).toBeVisible();
  });

  test("should show Source selector with New Exploration button", async ({
    page,
  }) => {
    // Verify source selector is present
    await expect(page.getByText("Source:")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /New Exploration/i })
    ).toBeVisible();
  });
});
