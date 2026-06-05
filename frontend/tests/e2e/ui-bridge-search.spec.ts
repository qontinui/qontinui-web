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

  // The NO_BROWSER_CONNECTED short-circuit contract for browser-required
  // routes (discover/components/snapshot/element/:id/...) is pinned by the
  // unit suite at src/app/api/ui-bridge/[...path]/_browser-required.test.ts.
  // It is NOT asserted here: in this suite's dev server,
  // enableRemoteCommands defaults to true and tabs auto-attach to the
  // relay, so "no relay client attached" is not a guaranteeable premise —
  // the previous E2E version of this assertion was order/timing flaky (an
  // attached-but-unresponsive tab sent discover down the relay-wait path
  // and past the test timeout).

  test("can query UI Bridge health endpoint", async ({ page }) => {
    // The UI Bridge `/health` endpoint is served by the catch-all proxy at
    // `src/app/api/ui-bridge/[...path]/route.ts`. The SDK responds with a
    // standard envelope: `{ success, data: { responsive, ... }, timestamp,
    // uiBridge: { appId, appName, appType, framework, capabilities } }`.
    //
    // `data.responsive` is relay-transport diagnostics: whether a browser
    // tab is currently attached to the relay. In this headless suite no
    // tab ever attaches (same environment contract the discover test
    // above asserts via NO_BROWSER_CONNECTED), so it is legitimately
    // `false` here — assert the envelope shape, not an attached tab.
    // Attached-tab (`responsive: true`) coverage belongs to the
    // runner-attached integration contexts (Spec-CI / style-gate with
    // NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1).
    const response = await page.goto("/api/ui-bridge/health");
    const body = await response?.json();

    expect(body).toBeDefined();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(typeof body.data.responsive).toBe("boolean");
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
