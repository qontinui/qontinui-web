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
 * Which frontend the suite runs against — `PLAYWRIGHT_WEB_SERVER`.
 *
 *   `prod` (the DEFAULT, and what CI runs): a PRODUCTION BUILD. `next start`
 *     serves the output of a prior `npm run build`, every route precompiled,
 *     so a route's first hit costs the same ~2 s as every later hit and the
 *     thing under test is the bundle users get.
 *   `dev`: the explicit opt-in for local iteration. `next dev` compiles each
 *     route on its FIRST hit (7-25 s measured), and under a long
 *     single-worker run that compile competes with each test's own timeout:
 *     four consecutive changed-specs lane runs on #1265 each failed a
 *     DIFFERENT test's first `page.goto` before any assertion ran, while the
 *     4-shard runs — a quarter of the routes per server — passed. Plan
 *     2026-09-05-web-e2e-runs-against-next-dev-so-a-first-hit-compile-is-a-test-failure.
 *
 * Any other value is a config error, never a silent fallback to either mode.
 */
const WEB_SERVER_MODE = process.env.PLAYWRIGHT_WEB_SERVER ?? "prod";
if (WEB_SERVER_MODE !== "prod" && WEB_SERVER_MODE !== "dev") {
  throw new Error(
    `PLAYWRIGHT_WEB_SERVER must be "prod" (default) or "dev"; got ${JSON.stringify(WEB_SERVER_MODE)}`
  );
}

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

  // Maximum time one test can run for. 60 s was sized for `next dev`'s
  // on-demand compile; under the default production build nothing compiles
  // at request time, so re-sizing it is Phase 3 of the plan named above.
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
  // shards via PWTEST_SHARD_WEIGHTS in e2e-playwright-stack.yml (see plan
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

    // Navigation timeout. 60 s was sized for `next dev`'s first-hit compile
    // (~23 s for the dashboard); a production-build navigation that still
    // exceeds it is a page defect, not compile latency (plan §5).
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
    // TWO CAPTURE LANES, one project. routes.json's `public` field selects which
    // (capturePathFor() in tests/e2e/style-gate/manifest.ts is the one place it
    // is interpreted):
    //
    //   public: false -> RELAY lane. Uses this project's `page` fixture, i.e.
    //     the setup-minted storageState below, and snapshots through
    //     /api/ui-bridge/control/snapshot. That route is served by the in-page
    //     CommandRelayListener, which never mounts without a resolved
    //     {userId, sessionId} -- so this lane REQUIRES an authed tab; an
    //     unauthenticated route on it would only ever 503. Hence the
    //     `dependencies: ["setup"]` + `storageState` here.
    //
    //   public: true -> INJECTED lane (relay-independent). Does NOT use the
    //     `page` fixture at all: the test builds its own
    //     browser.newContext({ viewport }) with NO storageState -- a genuinely
    //     signed-out tab -- and reads the snapshot IN-PAGE from UI Bridge's
    //     shipped injected runtime (the @qontinui/ui-bridge
    //     injected/bundle.global.js IIFE as a pre-first-paint init script, then
    //     window.__uiBridgeInjected.execute('getControlSnapshot', {})). No
    //     relay, no listener, no session.
    //
    // A public companion PROJECT is therefore still unnecessary -- the lane's
    // independence comes from the context it builds, not from project config.
    // Both lanes emit the same artifact shapes. See
    // tests/e2e/style-gate/routes.json + README.md.
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

  // Start the frontend before the tests — a production build by default,
  // `next dev` under PLAYWRIGHT_WEB_SERVER=dev (see WEB_SERVER_MODE above).
  // Set SKIP_WEB_SERVER=1 to skip when servers are already running.
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : WEB_SERVER_MODE === "dev"
      ? {
          command: "npm run dev",
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI,
          // Sized for `next dev`'s startup plus its first compile.
          timeout: 120 * 1000,
        }
      : {
          // Same port and bind address as `npm run dev`. `next start` needs
          // a prior `npm run build`; without one it exits with "Could not
          // find a production build in the '.next' directory", which
          // Playwright surfaces verbatim — no separate guard needed.
          //
          // `next.config.mjs` sets `output: 'standalone'`, so `next start`
          // logs `"next start" does not work with "output: standalone"
          // configuration`. That line is a WARNING, not an error: Next
          // only warns and then serves the ordinary `.next` build anyway
          // (next/dist/server/next.js — the `output: 'export'` arm beside
          // it is the one that throws). spec-ci.yml has served this same
          // build with `next start` since it was written. Do not "fix" the
          // warning by switching to `.next/standalone/server.js`: that
          // tree needs `public/` and `.next/static` copied in by hand.
          command: "npm run start -- --port 3001 --hostname 0.0.0.0",
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI,
          // A production server is up in ~2 s (measured; nothing compiles).
          // 60 s is a loaded-runner ceiling, not an expectation.
          timeout: 60 * 1000,
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
