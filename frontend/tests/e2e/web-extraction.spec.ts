/**
 * E2E test for Web Extraction page
 *
 * The /automation-builder/web-extraction page renders an h1 "Web
 * Extraction" only after the page reaches the runner's spec API.
 * Without a runner the surface is gated upstream of the heading,
 * so the spec auto-skips when no runner is reachable on :9876.
 * Locally with a runner up, the tests exercise the
 * "no runners connected" fallback (Connect Runner link / project
 * parameter preservation) — those branches still need the page to
 * render past the gate.
 */

import { test, expect } from "./fixtures";
import { requireRunner } from "./runner-detection";
import { TEST_PROJECT_ID as PROJECT_ID } from "./test-project";

test.beforeAll(async () => {
  await requireRunner();
});

test.describe("Web Extraction Page", () => {
  test("displays Connect Runner link when no runner is connected", async ({
    page,
  }) => {
    // Navigate to web extraction page with project
    await page.goto(`/automation-builder/web-extraction?project=${PROJECT_ID}`);

    // Wait for the page to load
    await page.waitForSelector('h1:has-text("Web Extraction")', {
      timeout: 10000,
    });

    // Scroll down to see the Runner section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Wait for loading to complete - either "No runners connected" or runner select appears
    // First wait for loading spinner to disappear
    await page
      .waitForSelector("text=Loading runners...", {
        state: "hidden",
        timeout: 15000,
      })
      .catch(() => {
        // Loading might have completed before we started waiting
      });

    // Wait a moment for the UI to stabilize
    await page.waitForTimeout(1000);

    // Scroll the Runner card into view
    const runnerCardTitle = page.locator(
      "text=Select a connected runner to perform the extraction"
    );
    await runnerCardTitle.scrollIntoViewIfNeeded();

    // Verify the description text is visible
    await expect(runnerCardTitle).toBeVisible();

    // Check if no runners are connected - look for the alert message
    const noRunnersAlert = page.locator("text=No runners connected");
    const isNoRunners = await noRunnersAlert
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (isNoRunners) {
      // Verify the "Go to Connect Runner" link is displayed
      const connectRunnerLink = page.locator(
        'a:has-text("Go to Connect Runner")'
      );
      await expect(connectRunnerLink).toBeVisible();

      // Verify the link href includes the project parameter
      // Wait for the href to be updated after hydration
      await expect(connectRunnerLink).toHaveAttribute(
        "href",
        new RegExp(`/connect-runner.*project=${PROJECT_ID}`),
        { timeout: 10000 }
      );
    } else {
      // If runners are connected, the select dropdown should be visible
      // The select trigger button contains "Select a runner" placeholder text
      const runnerSelect = page.locator(
        '[role="combobox"]:has-text("Select a runner")'
      );
      await expect(runnerSelect).toBeVisible({ timeout: 5000 });
    }
  });

  test("Connect Runner link preserves project parameter", async ({ page }) => {
    // Navigate to web extraction page with project
    await page.goto(`/automation-builder/web-extraction?project=${PROJECT_ID}`);

    // Wait for the page to load
    await page.waitForSelector('h1:has-text("Web Extraction")', {
      timeout: 10000,
    });

    // Scroll down to see the Runner section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Wait for loading to complete
    await page
      .waitForSelector("text=Loading runners...", {
        state: "hidden",
        timeout: 15000,
      })
      .catch(() => {
        // Loading might have completed before we started waiting
      });

    // Wait a moment for the UI to stabilize
    await page.waitForTimeout(1000);

    // Scroll the Runner card into view
    const runnerCardTitle = page.locator(
      "text=Select a connected runner to perform the extraction"
    );
    await runnerCardTitle.scrollIntoViewIfNeeded();

    // Check if no runners are connected
    const noRunnersAlert = page.locator("text=No runners connected");
    const isNoRunners = await noRunnersAlert
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (isNoRunners) {
      // Verify the "Go to Connect Runner" link is displayed
      const connectRunnerLink = page.locator(
        'a:has-text("Go to Connect Runner")'
      );
      await expect(connectRunnerLink).toBeVisible();

      // The link should preserve the project parameter
      // Wait for the href to be updated after hydration
      await expect(connectRunnerLink).toHaveAttribute(
        "href",
        new RegExp(`/connect-runner.*project=${PROJECT_ID}`),
        { timeout: 10000 }
      );
    }
  });
});
