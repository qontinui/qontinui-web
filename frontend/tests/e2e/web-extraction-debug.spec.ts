/**
 * Debug test for Web Extraction WebSocket issue
 * Captures console logs to diagnose 1005 disconnect
 *
 * Same gating as web-extraction.spec.ts — the page's h1 only
 * renders past the runner-spec-API check, so this debug spec
 * auto-skips when no runner is reachable on :9876.
 *
 * No fixed sleeps. Every wait here is a bounded `waitFor(...).catch(() =>
 * null)` on the state the step produces (the runner combobox, its options,
 * the enabled Start button, the EXTRACTING... label and its return to
 * Start Extraction), tolerated so the diagnostic branches keep their shape
 * — never a `waitForTimeout(N)` followed by a non-waiting read. Timeouts
 * are the replaced sleep × 3, floor 5 s.
 * Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time.
 */

import { test, expect } from "./fixtures";

/** Replaces the old `waitForTimeout(1000)` after the loading spinner hides. */
const RUNNERS_SETTLE_TIMEOUT = 5000;
/** Replaces the old `waitForTimeout(500)` after a select / fill step. */
const STEP_TIMEOUT = 5000;
/** Replaces the old `waitForTimeout(5000)` observation window after Start. */
const EXTRACTION_TIMEOUT = 15000;
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

    // Scroll down to see the Runner section (synchronous; nothing to wait on)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for loading to complete
    await page
      .waitForSelector("text=Loading runners...", {
        state: "hidden",
        timeout: 15000,
      })
      .catch(() => {});

    // Check what runner options we have: bounded wait for the runner select,
    // tolerated — the conditional below is the original diagnostic branch.
    const runnerSelect = page.locator('[role="combobox"]');
    await runnerSelect
      .first()
      .waitFor({ state: "visible", timeout: RUNNERS_SETTLE_TIMEOUT })
      .catch(() => null);
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

    // The click opens the dropdown; wait for an option, tolerated if none.
    const runnerOptions = page.locator('[role="option"]');
    await runnerOptions
      .first()
      .waitFor({ state: "visible", timeout: STEP_TIMEOUT })
      .catch(() => null);

    // Take screenshot of dropdown
    await page.screenshot({ path: "/tmp/runner-dropdown.png", fullPage: true });

    // Check for available runners
    const count = await runnerOptions.count();
    console.log(`\n=== Found ${count} runner options ===`);

    if (count === 0) {
      console.log("No runner options in dropdown");
      return;
    }

    // Select first runner
    await runnerOptions.first().click();
    // Selecting an option closes the dropdown — the state the click produces.
    await runnerOptions
      .first()
      .waitFor({ state: "hidden", timeout: STEP_TIMEOUT })
      .catch(() => null);

    // Add a test URL
    const urlInput = page.locator('input[placeholder="https://example.com"]');
    await urlInput.fill("https://example.com");
    await page.keyboard.press("Enter");

    // Click Start Extraction button
    const startButton = page.locator('button:has-text("Start Extraction")');

    // Adding the URL is what enables the button — bounded wait for that,
    // tolerated (a still-disabled button is the diagnostic branch below).
    await expect(startButton)
      .toBeEnabled({ timeout: STEP_TIMEOUT })
      .catch(() => null);

    // Clear logs before clicking Start Extraction
    logs.length = 0;
    console.log("\n=== Clicking Start Extraction ===");

    // Check if button is enabled
    const isDisabled = await startButton.isDisabled();
    console.log(`Start button disabled: ${isDisabled}`);

    if (!isDisabled) {
      await startButton.click();

      // Capture WebSocket activity across the extraction's lifecycle: the
      // button reads EXTRACTING... while it runs, then Start Extraction again
      // once it completes or the socket drops. Both tolerated.
      const extracting = page.locator('button:has-text("EXTRACTING")');
      await extracting
        .first()
        .waitFor({ state: "visible", timeout: STEP_TIMEOUT })
        .catch(() => null);
      await extracting
        .first()
        .waitFor({ state: "hidden", timeout: EXTRACTION_TIMEOUT })
        .catch(() => null);

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
