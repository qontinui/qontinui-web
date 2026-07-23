import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE_PATH } from "./tests/e2e/auth.constants";

/**
 * Fixed viewport for the style-gate capture projects. Frames must be
 * byte-reproducible run-to-run for the downstream vision-audit analyzers, so
 * the viewport is pinned here (and defensively re-applied in the spec).
 */
const STYLE_GATE_VIEWPORT = { width: 1280, height: 800 } as const;

/** Matches only the style-gate capture spec. */
const STYLE_GATE_TEST_MATCH = /style-gate\/style-capture\.spec\.ts/;

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

  // Playwright owns `*.spec.ts`; vitest owns `*.test.ts` (vitest.config.ts
  // includes `tests/e2e/**/*.test.ts` for pure helpers like the style-gate
  // snapshot normalizer and excludes `*.spec.ts` — this is the mirror image).
  // Without this, Playwright's default testMatch also collects `.test.ts`
  // and dies at collection requiring vitest from a CJS context
  // ("Vitest cannot be imported in a CommonJS module").
  // The setup project's own `testMatch: /auth\.setup\.ts/` overrides this
  // per-project, so auth setup is unaffected.
  testMatch: "**/*.spec.ts",

  // Maximum time one test can run for
  // Increased for development mode where Next.js compiles pages on-demand
  timeout: 60 * 1000,

  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI stays at 1 worker per shard — but for a MEASURED reason, not the
  // original one. The old rationale ("~300 failing tests at 60s each → 5h+
  // runs") is obsolete: the suite is green (run 29916474400, all 4 shards).
  // A measured workers:2 trial (runs 29937298955 + 29938533765, branch
  // e2e/workers-2-measure, 2026-07-22) showed (a) per-test durations ~2×
  // — each 4-vCPU runner also hosts uvicorn + Postgres + the Next.js dev
  // server, so the box is already CPU-saturated and extra workers buy ~no
  // wall clock — and (b) assertion-shaped cross-test interference failures
  // (admin.spec.ts, ai-tasks-pages.spec.ts): specs share one seeded user +
  // backend + DB and are not parallel-safe. Do not raise workers again
  // until specs get data isolation. Wall clock is instead balanced across
  // shards via PWTEST_SHARD_WEIGHTS in e2e-tests.yml (see plan
  // 2026-07-22-web-playwright-single-worker-stale-rationale).
  // retries stays 0: a retry would add its own timeout to wall clock and
  // give any flake two candidate causes.
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
      // Exclude login tests - they need to test the unauthenticated -> authenticated flow.
      // Exclude the style-gate capture spec - it runs under its own dedicated
      // `style-gate` project (below), not the general cross-browser sweep.
      testIgnore: [/login\.spec\.ts/, STYLE_GATE_TEST_MATCH],
    },

    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: [/login\.spec\.ts/, STYLE_GATE_TEST_MATCH],
    },

    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: [/login\.spec\.ts/, STYLE_GATE_TEST_MATCH],
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
      testIgnore: [/login\.spec\.ts/, STYLE_GATE_TEST_MATCH],
    },
    {
      name: "Mobile Safari",
      use: {
        ...devices["iPhone 12"],
        storageState: STORAGE_STATE_PATH,
      },
      dependencies: ["setup"],
      testIgnore: [/login\.spec\.ts/, STYLE_GATE_TEST_MATCH],
    },

    // === STYLE-GATE CAPTURE PROJECT (Phase 1 of the CI style-gating plan) ===
    // Renders gated routes headlessly and emits, per route, a UI-Bridge snapshot
    // JSON + a deterministic PNG to tests/e2e/style-gate/.artifacts/.
    //
    // AUTHED-ONLY: the capture's snapshot path (/control/snapshot via the relay)
    // requires the in-page CommandRelayListener, which never mounts without a
    // resolved {userId, sessionId} -- so a public/unauthenticated route can't be
    // captured via the relay (it would 503). There is therefore a single authed
    // project (no public companion). Public/unauthenticated routes need a
    // relay-independent capture path (a Playwright in-page SDK eval) -- deferred
    // to a later phase. See tests/e2e/style-gate/routes.json + README.md.
    {
      name: "style-gate",
      testMatch: STYLE_GATE_TEST_MATCH,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE_PATH,
        viewport: STYLE_GATE_VIEWPORT,
      },
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
