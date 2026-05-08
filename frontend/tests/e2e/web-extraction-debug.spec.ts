/**
 * Debug test for Web Extraction WebSocket issue
 * Captures console logs to diagnose 1005 disconnect
 *
 * Same gating as web-extraction.spec.ts — the page's h1 only
 * renders past the runner-spec-API check, so this debug spec
 * auto-skips when no runner is reachable on :9876.
 */

import { test } from "./fixtures";
import { requireRunner } from "./runner-detection";
import { TEST_PROJECT_ID as PROJECT_ID } from "./test-project";

test.beforeAll(async () => {
  await requireRunner();
});

test.describe("Web Extraction Debug", () => {
  test.beforeEach(async ({ page }) => {
    // Capture console logs
    const logs: string[] = [];
    page.on("console", (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`;
      logs.push(text);
      console.log(text);
    });

    // Store logs on page context for later
    (page as unknown as { __consoleLogs?: string[] }).__consoleLogs = logs;
  });

  test("capture WebSocket logs when starting extraction", async ({ page }) => {
    const logs = (page as unknown as { __consoleLogs?: string[] })
      .__consoleLogs as string[];

    // Navigate to web extraction page with project
    await page.goto(`/automation-builder/web-extraction?project=${PROJECT_ID}`);

    // Wait for the page to load
    await page.waitForSelector('h1:has-text("Web Extraction")', {
      timeout: 10000,
    });

    // Log all useRealtimeConnections logs
    console.log("\n=== Console logs after page load ===");
    logs
      .filter(
        (l) =>
          l.includes("useRealtimeConnections") || l.includes("RunnerWebSocket")
      )
      .forEach((l) => console.log(l));

    // Scroll down to see the Runner section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Wait for loading to complete
    await page
      .waitForSelector("text=Loading runners...", {
        state: "hidden",
        timeout: 15000,
      })
      .catch(() => {});
    await page.waitForTimeout(1000);

    // Check what runner options we have
    const runnerSelect = page.locator('[role="combobox"]');
    const hasRunnerSelect = await runnerSelect
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (!hasRunnerSelect) {
      console.log("\n=== No runners available ===");
      console.log("Cannot test Start Extraction without a connected runner.");
      console.log(
        "Verify the Qontinui Runner desktop app is running and connected."
      );

      // Print all console logs for debugging
      console.log("\n=== All console logs ===");
      logs.forEach((l) => console.log(l));

      return;
    }

    // Click on runner select to open dropdown
    await runnerSelect.click();
    await page.waitForTimeout(500);

    // Take screenshot of dropdown
    await page.screenshot({ path: "/tmp/runner-dropdown.png", fullPage: true });

    // Check for available runners
    const runnerOptions = page.locator('[role="option"]');
    const count = await runnerOptions.count();
    console.log(`\n=== Found ${count} runner options ===`);

    if (count === 0) {
      console.log("No runner options in dropdown");
      return;
    }

    // Select first runner
    await runnerOptions.first().click();
    await page.waitForTimeout(500);

    // Add a test URL
    const urlInput = page.locator('input[placeholder="https://example.com"]');
    await urlInput.fill("https://example.com");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // Clear logs before clicking Start Extraction
    logs.length = 0;
    console.log("\n=== Clicking Start Extraction ===");

    // Click Start Extraction button
    const startButton = page.locator('button:has-text("Start Extraction")');

    // Check if button is enabled
    const isDisabled = await startButton.isDisabled();
    console.log(`Start button disabled: ${isDisabled}`);

    if (!isDisabled) {
      await startButton.click();

      // Wait a bit to capture WebSocket activity
      await page.waitForTimeout(5000);

      // Print logs related to WebSocket
      console.log("\n=== WebSocket logs after Start Extraction ===");
      logs.forEach((l) => console.log(l));

      // Take screenshot after extraction attempt
      await page.screenshot({
        path: "/tmp/after-start-extraction.png",
        fullPage: true,
      });
    } else {
      console.log("Start button is disabled. Reasons:");
      console.log("- No URLs added");
      console.log("- No runner selected");
      console.log("- Runner not ws_connected");

      // Print all console logs for debugging
      console.log("\n=== All console logs ===");
      logs.forEach((l) => console.log(l));
    }
  });
});
