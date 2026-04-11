/**
 * Playwright configuration for the static grounding-data capture pipeline.
 *
 * Stripped-down config: no auth, chromium only, targets scripts/ directory.
 *
 * Usage:
 *   npx playwright test scripts/capture-grounding-data.ts \
 *     --config=playwright.grounding.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts",
  testMatch: "capture-grounding-data.ts",

  // Component rendering + screenshot capture can be slow
  timeout: 120_000,

  fullyParallel: false, // sequential to avoid viewport race conditions
  retries: 0,
  workers: 1,

  reporter: [["list"]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001",
    screenshot: "off", // we capture manually in the script
    trace: "off",
  },

  projects: [
    {
      name: "grounding",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3001",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
