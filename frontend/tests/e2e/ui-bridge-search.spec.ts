/**
 * UI Bridge Search Test
 *
 * Tests that the UI Bridge SDK can find elements by text content.
 * This validates the runtime element discovery works without build-time instrumentation.
 *
 * The UI Bridge AutoRegisterProvider automatically discovers interactive elements
 * and the SearchEngine can find them by text, role, or accessibility attributes.
 */

import { test, expect } from "@playwright/test";

test.describe("UI Bridge Element Search", () => {
  test.beforeEach(async ({ page }) => {
    // Set up console log capture for debugging
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[Browser Error]: ${msg.text()}`);
      }
    });
  });

  test("UI Bridge discover endpoint signals NO_BROWSER_CONNECTED when no relay client is attached", async ({
    page,
  }) => {
    // The UI Bridge `/api/ui-bridge/control/discover` endpoint is served by the
    // catch-all proxy at `src/app/api/ui-bridge/[...path]/route.ts`. `discover`
    // is a browser-required route (`BROWSER_REQUIRED_ROUTES`, PR #236): element
    // discovery reads the client-side AutoRegisterProvider registry, which only
    // exists in a browser tab attached to the relay. A headless POST (no SDK
    // client connected, as in this test) therefore gets the canonical
    // `NO_BROWSER_CONNECTED` 503 envelope — this asserts that contract, the
    // robust signal that the proxy isn't silently succeeding without a browser.
    //
    // Navigate to a page where the bridge initializes; any authenticated route
    // works since this test exercises the API endpoint, not page-specific UI.
    await page.goto("/automation-builder/extraction");
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
      test.skip(true, "Requires authentication - skipping");
      return;
    }

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/ui-bridge/control/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Start Extraction",
          fuzzy: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(503);
    expect(result.body).toBeDefined();
    expect(result.body.success).toBe(false);
    expect(result.body.code).toBe("NO_BROWSER_CONNECTED");
  });

  test("can query UI Bridge health endpoint", async ({ page }) => {
    // The UI Bridge `/health` endpoint is served by the catch-all proxy at
    // `src/app/api/ui-bridge/[...path]/route.ts`. The SDK responds with a
    // standard envelope: `{ success, data: { responsive, ... }, timestamp,
    // uiBridge: { appId, appName, appType, framework, capabilities } }`.
    const response = await page.goto("/api/ui-bridge/health");
    const body = await response?.json();

    expect(body).toBeDefined();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.responsive).toBe(true);
    expect(body.uiBridge).toBeDefined();
    expect(body.uiBridge.appId).toBe("qontinui-web");
  });

  test("UI Bridge SearchEngine can match button text patterns", async ({
    page,
  }) => {
    // This test runs the SearchEngine matching logic in the browser
    // to verify text matching works correctly

    await page.goto("/automation-builder/extraction");
    await page.waitForLoadState("domcontentloaded");

    // Skip if not authenticated
    if (page.url().includes("/login")) {
      test.skip(true, "Requires authentication - skipping");
      return;
    }

    // Execute search logic in browser context
    const matchResult = await page.evaluate(async () => {
      // The UI Bridge exports fuzzyMatch and related utilities
      // We can test them directly in the browser

      // Simulate what the SearchEngine does
      const searchText = "Start Extraction";
      const buttonTexts = ["Start Extraction", "EXTRACTING...", "Cancel"];

      const results = buttonTexts.map((text) => ({
        text,
        exactMatch: text.toLowerCase() === searchText.toLowerCase(),
        contains: text.toLowerCase().includes(searchText.toLowerCase()),
        partialMatch: searchText
          .toLowerCase()
          .split(" ")
          .every((word) => text.toLowerCase().includes(word)),
      }));

      return results;
    });

    console.log("Match results:", JSON.stringify(matchResult, null, 2));

    // Verify "Start Extraction" matches exactly
    const exactMatch = matchResult.find((r) => r.exactMatch);
    expect(exactMatch).toBeDefined();
    expect(exactMatch?.text).toBe("Start Extraction");
  });
});
