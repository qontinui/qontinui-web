import { test, expect } from '@playwright/test';

test('screenshot-zoom', async ({ page }) => {
  // Navigate to the dashboard
  await page.goto('http://localhost:3001/dashboard');

  // Wait for the dashboard to load
  await page.waitForLoadState('networkidle');

  // Select "civ6" project from the project dropdown in the sidebar
  // The project switcher is a combobox button in the sidebar
  const projectButton = page.locator('button[role="combobox"][aria-label="Select project"]');
  await projectButton.click();

  // Wait for dropdown menu to appear and select the "civ6" project
  const civ6Option = page.locator('[role="menuitem"]').filter({ hasText: 'civ6' });
  await civ6Option.click();

  // Wait for project selection to be applied
  await page.waitForTimeout(500);

  // Navigate to Extract Images feature through the Create menu
  // The Create menu is in the sidebar with a sparkles icon
  const createButton = page.locator('button[data-nav-id="create"]');
  await createButton.click();

  // Wait for the Create submenu to appear and click Extract Images
  const extractImagesOption = page.locator('[role="menuitem"]').filter({ hasText: 'Extract Images' });
  await extractImagesOption.click();

  // Wait for the Image Extraction page to load
  await page.waitForURL(/.*image-extraction.*/);
  await page.waitForLoadState('networkidle');

  // Click "Capture Screen" button to open the monitor selection menu
  const captureButton = page.locator('button').filter({ hasText: 'Capture Screen' });
  await captureButton.click();

  // Wait for the monitor selection popup to appear
  await page.waitForSelector('text=Select Monitors', { timeout: 5000 });

  // Select the first available monitor (monitor #0)
  // Monitors are displayed as buttons with their number (e.g., "#0", "#1")
  const monitorButton = page.locator('button').filter({ hasText: '#0' });
  await monitorButton.click();

  // Set delay to 0 seconds for immediate capture
  const delay0Button = page.locator('button').filter({ hasText: '0s' }).first();
  await delay0Button.click();

  // Click the "Capture" button to initiate screen capture
  // This is the button in the monitor menu that actually triggers the capture
  const captureScreenButton = page.locator('button').filter({ hasText: /^Capture$/ });
  await captureScreenButton.click();

  // Wait for the screenshot to be captured and displayed
  // The screenshot appears in a canvas element
  await page.waitForTimeout(3000);

  // Verify the canvas with the screenshot is visible
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 10000 });

  // Get the canvas bounding box to calculate region selection coordinates
  const boundingBox = await canvas.boundingBox();
  expect(boundingBox).not.toBeNull();

  if (boundingBox) {
    // Select a region on the screenshot by clicking and dragging
    // Draw a rectangle starting from (100, 100) with size 200x200
    const startX = boundingBox.x + 100;
    const startY = boundingBox.y + 100;
    const endX = startX + 200;
    const endY = startY + 200;

    // Perform the mouse drag to select a region
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();
  }

  // Wait for the region selection to be registered
  await page.waitForTimeout(500);

  // Locate the Extract Image button
  const extractButton = page.locator('button').filter({ hasText: 'Extract Image' });

  // Verify the Extract Image button is enabled (turns green when region is selected)
  // When enabled, the button should have bg-[#00FF88] class and be clickable
  await expect(extractButton).toBeEnabled({ timeout: 5000 });

  // Verify the button has the green background color (#00FF88)
  // This confirms the button is in the "ready to extract" state
  const backgroundColor = await extractButton.evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });

  // The green color #00FF88 converts to rgb(0, 255, 136)
  expect(backgroundColor).toBe('rgb(0, 255, 136)');

  // Click the Extract Image button to complete the workflow
  await extractButton.click();

  // Test is successful if we reach this point - the button was green and clicked
  // The extraction process has been initiated
});
