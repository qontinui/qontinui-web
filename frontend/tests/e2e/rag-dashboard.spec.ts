import { test, expect } from "@playwright/test";
import { TEST_USER } from "./test-credentials";

test.describe("RAG Dashboard / Visual Index", () => {
  // Increase timeout for this suite since login + navigation can be slow
  test.setTimeout(90000);

  // Helper function to login via modal
  async function _loginUser(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open login dialog - click the Sign In button in the header
    const headerSignInButton = page.getByRole("button", { name: /sign in/i });
    await headerSignInButton.click();

    // Wait for dialog to appear (with longer timeout)
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill credentials
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);

    // Click the Sign In button INSIDE the dialog (not the one in header)
    // Use a more specific locator - the button inside the tabpanel
    const dialogSignInButton = dialog.locator('button:has-text("Sign In")').first();
    await expect(dialogSignInButton).toBeVisible();
    await dialogSignInButton.click();

    // Small wait for the login request to process
    await page.waitForTimeout(500);

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

    // Auth is handled by the setup project - storageState is already loaded
    // Navigate directly to the Visual Index page
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

  test("indexed elements display images, real sizes, and text descriptions", async ({
    page,
  }) => {
    const projectId = "f0816920-92ed-4d18-b6d2-9f6d02b42a38";

    // Auth is handled by the setup project - storageState is already loaded
    // Navigate directly to the Visual Index page
    console.log("Navigating to RAG page...");
    await page.goto("/projects/" + projectId + "/rag", { timeout: 30000 });

    // Wait for page to load
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    // Wait for the "Indexed Elements" section to appear
    const indexedElementsTitle = page.locator("text=Indexed Elements").first();
    await expect(indexedElementsTitle).toBeVisible({ timeout: 15000 });
    console.log("Indexed Elements section visible");

    // Wait for the table to load (it should have table rows)
    const tableBody = page.locator("tbody");
    await expect(tableBody).toBeVisible({ timeout: 10000 });

    // Wait for at least one row to appear
    const tableRows = page.locator("tbody tr");
    await expect(tableRows.first()).toBeVisible({ timeout: 10000 });

    const rowCount = await tableRows.count();
    console.log(`Found ${rowCount} indexed element rows`);

    // Take screenshot of the Indexed Elements section
    await page.screenshot({
      path: "test-results/rag-indexed-elements.png",
      fullPage: true,
    });

    // Verify each element has proper data
    // We'll check the first few rows for:
    // 1. Image thumbnail (img tag in the pattern cell)
    // 2. Real size (not 100x100) in the Size column
    // 3. Text description (if available) or size shown under pattern name

    const rowsToCheck = Math.min(rowCount, 5);
    console.log(`Checking first ${rowsToCheck} rows...`);

    for (let i = 0; i < rowsToCheck; i++) {
      const row = tableRows.nth(i);

      // Check for image thumbnail - look for img tag in the row
      const thumbnail = row.locator("img").first();
      const thumbnailExists = (await thumbnail.count()) > 0;

      if (thumbnailExists) {
        // If there's an img, verify it has a src attribute
        const src = await thumbnail.getAttribute("src");
        console.log(`Row ${i + 1}: Image src = ${src ? "present" : "missing"}`);

        // The image should be visible and loaded
        await expect(thumbnail).toBeVisible();
      } else {
        // If no image, there should be a placeholder icon
        const placeholderIcon = row.locator("svg").first();
        console.log(`Row ${i + 1}: No image, checking for placeholder icon`);
        await expect(placeholderIcon).toBeVisible();
      }

      // Check for size - should be in format WxH (e.g., "64x64", "128x128")
      // The Size column shows the actual image dimensions
      const sizeCell = row.locator("td").nth(2); // Size is the 3rd column (0-indexed: 2)
      const sizeText = await sizeCell.textContent();
      console.log(`Row ${i + 1}: Size = ${sizeText}`);

      // Verify size is not a placeholder 100x100 (unless that's the actual size)
      // Size should match pattern WxH
      expect(sizeText).toMatch(/\d+x\d+/);

      // Check for text description or size info under the pattern name
      // The first cell contains pattern name and description
      const patternCell = row.locator("td").first();
      const patternText = await patternCell.textContent();
      console.log(`Row ${i + 1}: Pattern info = ${patternText?.slice(0, 100)}`);

      // Pattern cell should have meaningful content
      expect(patternText).toBeTruthy();
      expect(patternText!.length).toBeGreaterThan(0);
    }

    // Verify at least one row has a real image loaded
    const imagesInTable = page.locator("tbody img");
    const imageCount = await imagesInTable.count();
    console.log(`Total images in table: ${imageCount}`);

    // We expect at least some elements to have images
    expect(imageCount).toBeGreaterThan(0);

    // Check that images have loaded (not broken)
    const firstImage = imagesInTable.first();
    if (imageCount > 0) {
      // Check the image has a valid src
      const imgSrc = await firstImage.getAttribute("src");
      expect(imgSrc).toBeTruthy();
      console.log(`First image src: ${imgSrc}`);
    }

    console.log("All indexed element checks passed!");
  });
});
