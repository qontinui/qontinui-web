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
 * Per-test and per-navigation bounds, sized PER WEB-SERVER MODE.
 *
 * Both were a flat 60 s until Phase 3 of the plan named above, because both
 * were sized for `next dev`'s on-demand first-hit compile. Under the default
 * production build nothing compiles at request time, and a 60 s navigation
 * bound sitting ~92x above the measured maximum cannot tell "slow" from
 * "hung" — which is the only job a timeout has. The comment on
 * `navigationTimeout` already asserted that a production-build navigation
 * exceeding it is a page defect rather than compile latency; at 60 s that
 * sentence had no teeth.
 *
 * Measured across TWO INDEPENDENT full-suite production-build runs — the
 * workflow_dispatch gate 34042283673 (2026-09-06) and the nightly `main` run
 * 34082373155 (2026-09-07), 491 passed / 0 failed each — reading per-step
 * durations out of the shards' own Playwright report artifacts:
 *
 *   navigations  ~1040 | median 243-259 ms | p99 404-437 ms | SLOWEST 652 ms
 *                | none over 2 s | none carrying an error
 *   tests          982 | median 721-816 ms | p99 12.8-15.6 s | SLOWEST 16.2 s
 *                | none over 20 s
 *
 * NAVIGATION: 15 s, i.e. 23x the slowest of ~1040 measured navigations.
 *
 * PER TEST: 45 s, and the binding constraint is NOT the measured maximum.
 * The suite's slowest tests — every one of the five slowest in both runs is in
 * `pages/automation-builder-*.spec.ts` — pin their own budget with
 * `test.setTimeout(60000)` (e.g. automation-builder-core.spec.ts), and
 * `docs-runner.spec.ts` uses `describe.configure({ timeout: 90_000 })`. A
 * suite-level pin WINS over this value, so those files are not governed here
 * at all. The population this bound actually governs finishes under 13 s.
 *
 * What sets 45 s is the largest WAIT the budget has to contain, because a test
 * budget must exceed the waits inside it or the wait's diagnostic is replaced
 * by a bare "Test timeout exceeded" — the opposite of the point. The tree
 * holds 30_000 ms waits inside ungoverned hooks:
 * `navigation-test-generator.spec.ts`'s `beforeEach` is a `goto` plus a
 * 30_000 ms `waitForSelector`, charged to the test's own slot, and
 * `annotation-editor.spec.ts`'s helper is a `goto` plus 15_000 ms. 30 s would
 * have silenced both.
 *
 * Be precise about the margin, because the first of those is the tight one:
 * its NOMINAL worst case is the navigation bound plus the wait, 15_000 +
 * 30_000 = exactly 45_000 — a tie with zero room, before the test body starts.
 * It clears because a production-build navigation is ~250 ms (652 ms slowest
 * of ~1040 measured), not because the sum fits. `dashboard.spec.ts:41` has the
 * same shape. So the real headroom here is empirical, and if navigation ever
 * gets slow this bound is the second thing to break. If you tighten it
 * further, re-check those waits first.
 *
 * ALSO RE-SIZED, less obviously: `beforeAll`/`afterAll` and worker-fixture
 * setup each get their own time slot sized from this same project timeout, so
 * this cuts those budgets by the same 25%. Every such hook in the tree is
 * either cheap (`requireRunner()` self-caps at 2 s) or self-pinned, but a new
 * expensive `beforeAll` now has 45 s rather than 60 s.
 *
 * `dev` keeps 60 s unchanged. `next dev` compiles a route on its FIRST hit
 * (7-25 s measured, and past 60 s under load — see WEB_SERVER_MODE above), and
 * two lanes still run that way on purpose: `cross-browser-survey.yml` and
 * `style-gate.yml`. Shrinking their bounds would manufacture exactly the
 * failures this plan removed.
 *
 * NOTE for local runs: these follow PLAYWRIGHT_WEB_SERVER, not what is
 * actually listening. Driving this config against a hand-started `next dev`
 * (e.g. with SKIP_WEB_SERVER=1, as tests/e2e/style-gate/README.md documents)
 * without also setting PLAYWRIGHT_WEB_SERVER=dev gets the production bounds.
 */
const IS_PRODUCTION_SERVER = WEB_SERVER_MODE === "prod";
const TEST_TIMEOUT_MS = IS_PRODUCTION_SERVER ? 45 * 1000 : 60 * 1000;
const NAVIGATION_TIMEOUT_MS = IS_PRODUCTION_SERVER ? 15 * 1000 : 60 * 1000;

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

  // Maximum time one test can run for, and the budget `beforeAll`/`afterAll`
  // hooks are sized from. Mode-keyed — see TEST_TIMEOUT_MS above for what
  // actually sizes it (the largest in-tree wait, not the measured maximum),
  // which spec files pin past it, and why `dev` keeps 60 s.
  timeout: TEST_TIMEOUT_MS,

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

    // Navigation timeout. Mode-keyed — see NAVIGATION_TIMEOUT_MS above. On the
    // production build the slowest of ~1040 measured navigations was 652 ms,
    // so a navigation that exceeds this bound is a page defect, not compile
    // latency (plan §5) — which is the claim the old flat 60 s could not
    // support.
    navigationTimeout: NAVIGATION_TIMEOUT_MS,
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
