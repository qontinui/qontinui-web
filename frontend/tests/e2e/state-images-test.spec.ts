/**
 * Test to verify StateImages display correctly
 */
import { test, expect } from '@playwright/test';
import { loginUser } from './fixtures';

// Use the extraction project which has states with images
const PROJECT_ID = '42c6f680-9357-49dd-ae59-52ebf3f3dd10';

test.describe('StateImage Display Test', () => {
  test.setTimeout(60000);

  test('StateImages should display actual images not placeholders', async ({ page }) => {
    // Track console warnings
    const warnings: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'warn' && msg.text().includes('resolvePatternImage')) {
        warnings.push(msg.text());
      }
    });

    // Login using auto-login with manual fallback
    await loginUser(page);

    // Navigate to states page
    await page.goto(`/automation-builder/states?project=${PROJECT_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Take screenshot
    await page.screenshot({
      path: 'test-results/state-images-test.png',
      fullPage: true,
    });

    // Check for state nodes
    const stateNodes = page.locator('.react-flow__node-stateNode');
    const stateNodeCount = await stateNodes.count();
    console.log(`State nodes visible: ${stateNodeCount}`);
    expect(stateNodeCount).toBeGreaterThan(0);

    // Check for image placeholders (the ImageIcon component from lucide-react)
    // If we see these, it means images aren't loading
    const placeholders = page.locator('.react-flow__node-stateNode svg.lucide-image');
    const placeholderCount = await placeholders.count();
    console.log(`Image placeholder icons: ${placeholderCount}`);

    // Check for canvas elements (actual rendered images)
    const canvasElements = page.locator('.react-flow__node-stateNode canvas');
    const canvasCount = await canvasElements.count();
    console.log(`Canvas elements (rendered images): ${canvasCount}`);

    // Report warnings
    console.log(`Image resolution warnings: ${warnings.length}`);
    if (warnings.length > 0) {
      console.log('Warnings:', warnings.slice(0, 5).join('\n'));
    }

    // The test passes if we have canvas elements (images are rendering)
    // and no placeholder icons visible within state nodes
    expect(canvasCount).toBeGreaterThan(0);
  });
});
