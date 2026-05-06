import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE_PATH } from "./tests/e2e/auth.constants";

/**
 * Playwright configuration for E2E integration testing
 * See https://playwright.dev/docs/test-configuration
 *
 * Authentication Strategy:
 * - The "setup" project runs first and logs in, saving auth state to .auth/user.json
 * - Browser projects for authenticated tests use this saved state (no login needed)
 * - Login tests run separately without the saved state to test the login flow
 *
 * Credentials are configurable via environment variables:
 * - PLAYWRIGHT_TEST_USERNAME: Username or email for login
 * - PLAYWRIGHT_TEST_PASSWORD: Password for login
 */
export default defineConfig({
  testDir: "./tests/e2e",

  // Maximum time one test can run for
  // Increased for development mode where Next.js compiles pages on-demand
  timeout: 60 * 1000,

  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries in CI. The suite is single-worker, so each retry adds another
  // 60s timeout to the wall-clock budget for every flake; with ~300 failing
  // tests that compounds to multi-hour runs (5h+ observed on the post-cascade
  // unblock). Surface failures fast, fix them once, then add retries back if
  // genuine flakes appear.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["list"],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "retain-on-failure",

    // Maximum time each action can take
    actionTimeout: 10 * 1000,

    // Navigation timeout - increased for Next.js dev mode compilation (~23s for dashboard)
    navigationTimeout: 60 * 1000,
  },

  // Configure projects for major browsers
  projects: [
    // === SETUP PROJECT ===
    // Runs once to authenticate and save state
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },

    // === AUTHENTICATED BROWSER PROJECTS ===
    // These use the saved auth state - tests start already logged in
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      // Exclude login tests - they need to test the unauthenticated -> authenticated flow
      testIgnore: /login\.spec\.ts/,
    },

    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: /login\.spec\.ts/,
    },

    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: /login\.spec\.ts/,
    },

    // === UNAUTHENTICATED PROJECTS ===
    // For login tests that need to start without authentication
    {
      name: "chromium-login",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /login\.spec\.ts/,
      // No dependencies on setup, no storageState
    },

    {
      name: "firefox-login",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /login\.spec\.ts/,
    },

    {
      name: "webkit-login",
      use: { ...devices["Desktop Safari"] },
      testMatch: /login\.spec\.ts/,
    },

    // === MOBILE PROJECTS (AUTHENTICATED) ===
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 5"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: /login\.spec\.ts/,
    },
    {
      name: "Mobile Safari",
      use: {
        ...devices["iPhone 12"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: /login\.spec\.ts/,
    },
  ],

  // Run your local dev server before starting the tests
  // Set SKIP_WEB_SERVER=1 to skip when servers are already running
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3001",
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },

  // Global setup/teardown - skip when running against existing servers
  globalSetup: process.env.SKIP_WEB_SERVER
    ? undefined
    : "./tests/e2e/global-setup.ts",
  globalTeardown: process.env.SKIP_WEB_SERVER
    ? undefined
    : "./tests/e2e/global-teardown.ts",

  // Output folder for test artifacts
  outputDir: "test-results",
});
