/**
 * Debug test for transition viewer animation issues.
 * Tests the "web-menu to menu-discover" transition in the debugger project.
 */

import { test, expect } from "@playwright/test";

test.describe("Transition Viewer Debug", () => {
  test("should show staysVisible state after transition animation", async ({
    page,
  }) => {
    // Collect console logs
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[TransitionAnimation]")) {
        consoleLogs.push(`${msg.type()}: ${text}`);
        console.log(`CONSOLE: ${text}`);
      }
    });

    // Navigate to states page for debugger project
    await page.goto(
      "http://localhost:3001/automation-builder/states?project=f0816920-92ed-4d18-b6d2-9f6d02b42a38"
    );

    // Wait for page to load - look for the actual tabs
    await page.waitForSelector('button:has-text("Transitions")', {
      timeout: 15000,
    });

    // Take screenshot of initial state
    await page.screenshot({
      path: "test-results/transition-debug-1-initial.png",
    });

    // Click on Transitions tab
    await page.click('button:has-text("Transitions")');

    // Wait for transition list to load
    await page.waitForTimeout(2000);

    // Take screenshot after clicking Transitions tab
    await page.screenshot({
      path: "test-results/transition-debug-2-transitions-tab.png",
    });

    // Look for the OUTGOING transition "web-menu → menu-discover"
    // This is different from the INCOMING transition "→ menu-discover"
    // The outgoing transition has staysVisible=true which is what we want to test

    // First, let's see all available transitions
    const outgoingSection = page.locator("text=/OUTGOING/i");
    await expect(outgoingSection).toBeVisible();

    // Find all clickable rows (transition items)
    const allRows = page.locator(".cursor-pointer");
    const rowCount = await allRows.count();
    console.log(`Total clickable rows: ${rowCount}`);

    // Find the row that contains BOTH "web-menu" AND "menu-discover"
    let targetItem: typeof allRows | null = null;
    let count = 0;

    for (let i = 0; i < rowCount; i++) {
      const rowText = await allRows.nth(i).textContent();
      console.log(`Row ${i}: ${rowText}`);
      // Look for outgoing transition: should have "web-menu" and "menu-discover" but NOT start with just "→ "
      if (
        rowText &&
        rowText.includes("web-menu") &&
        rowText.includes("menu-discover")
      ) {
        console.log(`Found matching outgoing transition row ${i}: ${rowText}`);
        targetItem = allRows.nth(i);
        count = 1;
        break;
      }
    }

    if (count > 0 && targetItem) {
      // Click the target item
      await targetItem.click();
      await page.waitForTimeout(1000);

      // Take screenshot after selecting transition
      await page.screenshot({
        path: "test-results/transition-debug-3-selected.png",
      });

      // Look for a Play button - it's a circular button with SVG play icon
      // The play button has a specific SVG path for the triangle
      const playButton = page.locator(
        'button:has(svg.lucide-play), button:has(svg[class*="play"])'
      );
      let playCount = await playButton.count();
      console.log(`Found ${playCount} play buttons with lucide-play`);

      // Fallback: look for any button in the animation controls area
      if (playCount === 0) {
        // The animation controls should be in a row at the bottom
        // Look for buttons near the progress slider
        const controlButtons = page.locator(
          'button:near(:text("Initial"), 200)'
        );
        playCount = await controlButtons.count();
        console.log(`Found ${playCount} buttons near 'Initial' text`);
      }

      // Another fallback: look for the specific button structure
      if (playCount === 0) {
        const allControlButtons = page.locator("button").filter({
          has: page.locator("svg"),
        });
        const btnCount = await allControlButtons.count();
        console.log(`Found ${btnCount} buttons with SVG icons`);

        // Find the play button by its position in the controls
        for (let i = 0; i < Math.min(btnCount, 20); i++) {
          const btn = allControlButtons.nth(i);
          const box = await btn.boundingBox();
          if (box && box.y > 500) {
            // Buttons in the lower part of the page (animation controls)
            console.log(`Control button ${i} at y=${box.y}`);
          }
        }
      }

      // Click the 5th button which should be in the animation controls (based on screenshot)
      // The play button appears to be a circular button with SVG
      const animationControls = page
        .locator("div:has(> button:has(svg))")
        .filter({
          has: page.locator("text=/Initial|0%/"),
        });
      const playBtn = animationControls.locator("button:has(svg)").nth(2); // Middle button is play

      if (await playBtn.isVisible()) {
        console.log("Found play button in animation controls");
        await playBtn.click();
        console.log("Clicked Play button");

        // Wait for animation to complete (it takes several seconds)
        await page.waitForTimeout(8000);

        // Take screenshot of final state
        await page.screenshot({
          path: "test-results/transition-debug-4-after-animation.png",
        });
      } else {
        console.log("Could not find play button");
        // Take a screenshot to see current state
        await page.screenshot({
          path: "test-results/transition-debug-no-play-button.png",
        });
      }
    } else {
      console.log("No transitions found with 'menu-discover'");
      // Log what's on the page
      const allCards = await page.locator('[class*="card"]').allTextContents();
      console.log("All cards content:", allCards.slice(0, 5));
    }

    // Output collected console logs
    console.log("\n=== TransitionAnimation Console Logs ===");
    consoleLogs.forEach((log) => console.log(log));
    console.log("=== End Console Logs ===\n");

    // Check if any logs indicate staysVisible was properly handled
    const loadedLogs = consoleLogs.filter((log) =>
      log.includes("loadTransition: loaded")
    );
    console.log("Load transition logs:", loadedLogs);

    const staysVisibleLogs = consoleLogs.filter(
      (log) => log.includes("staysVisible") || log.includes("targetStates")
    );
    console.log("Logs about staysVisible:", staysVisibleLogs);
  });
});
