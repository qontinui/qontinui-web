import { test, expect } from "@playwright/test";

test("screenshot-zoom-simple", async ({ page }) => {
  // Enable console logging
  page.on("console", (msg) => console.log("BROWSER:", msg.text()));

  // Navigate to the target URL
  await page.goto("http://localhost:3001");

  // Click "Go to Dashboard" button
  await page.getByRole("button", { name: /go to dashboard/i }).click();
  await page.waitForURL(/.*dashboard.*/);

  // Select a project
  await page.getByRole("combobox", { name: /select project/i }).click();
  const projectMenuItem = page.getByRole("menuitem", { name: /civ6/i });
  await expect(projectMenuItem).toBeVisible({ timeout: 5000 });
  await projectMenuItem.click();
  await page.waitForTimeout(500);

  // Navigate to Extract Images
  await page.getByRole("button", { name: /create/i }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole("button", {
      name: "Extract Images Cut pattern images from screenshots",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Image Extraction", level: 1 })
  ).toBeVisible({ timeout: 10000 });

  // Click "Capture Screen" button to expand options
  await page
    .getByRole("button", { name: /capture screen/i })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /#1 Left 1920/i })).toBeVisible(
    { timeout: 5000 }
  );

  // Select just one monitor
  await page.getByRole("button", { name: /#1 Left 1920/i }).click();
  await page.waitForTimeout(300);

  // Click capture button
  const captureButton = page.getByRole("button", { name: /capture.*monitor/i });
  await expect(captureButton).toBeVisible({ timeout: 3000 });
  await captureButton.click();

  // Wait for zoom indicator
  const zoomIndicator = page.locator("div[data-zoom-value]");
  await expect(zoomIndicator).toBeVisible({ timeout: 15000 });

  // Wait a bit for any async operations to settle
  await page.waitForTimeout(2000);

  // Get initial zoom
  const initialZoom = parseFloat(
    (await zoomIndicator.getAttribute("data-zoom-value")) || "0"
  );
  const initialText = await zoomIndicator.textContent();
  console.log(`INITIAL: zoom=${initialZoom}, text=${initialText}`);

  // Take screenshot before zoom
  await page.screenshot({ path: "before-zoom.png", fullPage: true });

  // Find zoom in button
  const zoomInButton = page.getByRole("button", { name: "Zoom In" });
  await expect(zoomInButton).toBeVisible({ timeout: 5000 });

  // Click zoom in ONCE
  console.log("Clicking zoom in button...");
  await zoomInButton.click();

  // Wait for state to update
  await page.waitForTimeout(1000);

  // Get zoom after click
  const afterZoom = parseFloat(
    (await zoomIndicator.getAttribute("data-zoom-value")) || "0"
  );
  const afterText = await zoomIndicator.textContent();
  console.log(`AFTER: zoom=${afterZoom}, text=${afterText}`);

  // Take screenshot after zoom
  await page.screenshot({ path: "after-zoom.png", fullPage: true });

  // Log the comparison
  console.log(
    `COMPARISON: initial=${initialZoom}, after=${afterZoom}, increased=${afterZoom > initialZoom}`
  );

  // Assert zoom increased
  expect(afterZoom).toBeGreaterThan(initialZoom);
});
