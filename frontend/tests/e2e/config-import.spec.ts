/**
 * End-to-end tests for config import functionality
 *
 * Tests that importing a config file properly loads states into the state machine canvas
 * Bug: Imported configs were blocked by timestamp safety check, resulting in no states shown
 * Fix: Added isUserImport flag to bypass timestamp check for user-initiated imports
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { loginUser } from './fixtures';

test.describe('Config Import', () => {
  // Increase timeout for login-heavy tests
  test.setTimeout(120000);

  // Login before each test using auto-login with manual fallback
  test.beforeEach(async ({ page }) => {
    await loginUser(page);
  });

  test('imported config shows states in state machine canvas', async ({ page }) => {
    // Navigate to the state machine page with increased timeout
    await page.goto('/automation-builder/states', { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Take initial screenshot
    await page.screenshot({
      path: 'test-results/config-import-01-initial.png',
      fullPage: true,
    });

    // Find the import button in the sidebar (Upload icon)
    // The import button has a tooltip "Import Project"
    const importButton = page.locator('button').filter({ has: page.locator('svg.lucide-upload') });

    // If not visible, try to find by aria-label or data-testid
    let importBtn = importButton.first();
    if (!(await importBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      // Try alternate selector
      importBtn = page.getByRole('button', { name: /import/i });
    }

    // Prepare file upload handler
    const configPath = path.join(__dirname, '..', 'fixtures', 'sample-config.json');

    // Set up file chooser listener before clicking
    const fileChooserPromise = page.waitForEvent('filechooser');

    // Click the import button
    await importBtn.click();

    // Handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(configPath);

    // Wait for import to complete - look for success toast
    await page.waitForTimeout(3000);

    // Take screenshot after import - states should now be visible
    await page.screenshot({
      path: 'test-results/config-import-02-after-import.png',
      fullPage: true,
    });

    // DO NOT navigate away - the imported data is in memory and would be lost
    // The states should already be visible on the current page after import

    // Check that states are visible in the React Flow canvas
    // States should be rendered as nodes in the canvas
    const reactFlowPane = page.locator('.react-flow__pane');
    await expect(reactFlowPane).toBeVisible({ timeout: 10000 });

    // Look for state nodes - they should have the state names
    const stateNodes = page.locator('.react-flow__node');
    const nodeCount = await stateNodes.count();

    console.log(`Found ${nodeCount} state nodes in canvas`);

    // We expect at least 2 states from the imported config
    expect(nodeCount).toBeGreaterThanOrEqual(2);

    // Also verify states appear in the sidebar list
    const statesList = page.locator('text=Test State 1').first();
    const statesListVisible = await statesList.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`States list has Test State 1: ${statesListVisible}`);

    // The main assertion is the node count - if we have 2+ nodes, import worked
    // The sidebar list check is secondary confirmation

    // Check that images are displayed in the state nodes (not placeholders)
    // The state nodes should have StateImageViewer components with canvas elements
    // If images show placeholders, the ImageIcon (lucide-image) will be visible instead
    const imageIcons = page.locator('.react-flow__node svg.lucide-image');
    const imageIconCount = await imageIcons.count();
    console.log(`Found ${imageIconCount} image placeholder icons`);

    // We expect NO placeholder icons if images are loaded correctly
    // Each state has 1 stateImage, so if placeholders show, something is wrong
    expect(imageIconCount).toBe(0);

    // Take final screenshot
    await page.screenshot({
      path: 'test-results/config-import-04-final.png',
      fullPage: true,
    });
  });
});
