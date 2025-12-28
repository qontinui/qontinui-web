import { test, expect } from "@playwright/test";
import { TEST_USER } from "./test-credentials";

test.describe("RAG Dashboard / Visual Index", () => {
  // Increase timeout for this suite since login + navigation can be slow
  test.setTimeout(60000);
  // Helper function to login via modal
  async function loginUser(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open login dialog
    const signInButton = page.getByRole("button", { name: /sign in/i });
    await signInButton.click();

    // Wait for dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Fill credentials and submit
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for dialog to close (indicates successful login)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Wait for authenticated state
    await expect(page.getByText(TEST_USER.email)).toBeVisible({
      timeout: 10000,
    });
  }

  test("should display embeddings data", async ({ page }) => {
    const projectId = "f0816920-92ed-4d18-b6d2-9f6d02b42a38";

    // Collect network requests
    const networkRequests: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/api/v1/")) {
        networkRequests.push(request.method() + " " + request.url());
      }
    });

    page.on("response", (response) => {
      if (response.url().includes("/api/v1/")) {
        networkRequests.push(
          "Response: " + response.status() + " " + response.url()
        );
      }
    });

    // First login via modal
    await loginUser(page);

    // Navigate to the Visual Index page
    console.log("Navigating to RAG page...");
    await page.goto("/projects/" + projectId + "/rag", { timeout: 30000 });

    // Wait for page to load
    console.log("Waiting for network idle...");
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    // Wait a bit more for React Query to make the API call
    await page.waitForTimeout(3000);

    // Take a screenshot
    await page.screenshot({
      path: "test-results/rag-dashboard.png",
      fullPage: true,
    });

    // Log all network requests
    console.log("Network requests:", networkRequests.join("\n"));

    // Check if the dashboard API was called
    const dashboardCalled = networkRequests.some((r) =>
      r.includes("/rag/dashboard")
    );
    console.log("Dashboard API called:", dashboardCalled);

    // Check the response status
    const dashboardResponse = networkRequests.find(
      (r) => r.includes("Response:") && r.includes("/rag/dashboard")
    );
    console.log("Dashboard response:", dashboardResponse);

    // Check the page content for "Embeddings" text
    const embeddingsText = await page.locator("text=Embeddings").first();
    expect(embeddingsText).toBeVisible();

    // We expect the dashboard API to be called
    expect(dashboardCalled).toBe(true);

    // Check that we got data (Embeddings should show 14)
    // Verify the count is 14 (not 0) - look for "14" in the stats card
    const embeddingsCount = await page.locator("text=14").first();
    await expect(embeddingsCount).toBeVisible();
  });
});
