/**
 * End-to-end tests for Tools pages
 *
 * Pages tested:
 * - /tools/error-monitor - Error log monitoring with severity filtering
 *
 * The /tools/accessibility, /tools/run-plan, and /tools/ui-bridge
 * routes were removed. The remaining live `/tools/*` routes
 * (`capture`, `error-monitor`, `inspector`, `visual-automation`)
 * have only error-monitor under e2e coverage so far; the others can
 * be added in a follow-up if needed.
 *
 * ── Why these tests wait for the app shell before asserting ─────────────────
 * This file was the ONLY failing site in the `E2E Integration Tests` workflow's
 * intermittent shard-4 reds on main: sha `4e43505b` (run 31055130610, 2026-08-05)
 * and sha `88f79dd9` (run 31269313203, 2026-08-08). Both failures were this
 * describe block, both were `expect(text=Error Monitor).toBeVisible({15000})`,
 * and both captured the SAME failure snapshot — `- text: Loading...`.
 *
 * That snapshot is NOT this page's own `healthLoading` spinner (which is a bare
 * `<Loader2>` with no text). It is `(app)/layout.tsx`'s `AuthLoadingShell`, the
 * app-group auth gate, which renders the literal word "Loading..." and WITHHOLDS
 * its children entirely. While it is up, none of this page's markup is in the
 * DOM. The older comments in this file blamed `healthLoading`; the artifacts
 * disprove that, so they are corrected below.
 *
 * The gate stayed up because the Next.js DEV server (playwright.config.ts runs
 * `npm run dev`, so routes compile on demand) stopped serving that navigation:
 *
 *   17:33:23.770  test starts, goto /tools/error-monitor
 *   17:33:24      [WebServer] ⨯ [Error: aborted]        <- dev server, twice
 *   17:33:24..44  ZERO backend requests. The page never hydrated.
 *   17:33:44.4    test fails at 20.6s, still on "Loading..."
 *   17:33:46      NEXT test navigates to the SAME url — passes in 2.6s
 *
 * On 2026-08-05 the dev server named the cause outright at the failing
 * navigation: `⨯ uncaughtException: [Error: aborted] { code: 'ECONNRESET' }`.
 * A client-aborted socket (Playwright tearing down a page whose pollers are
 * still in flight) reaches Next dev's uncaughtException path and starves the
 * next navigation for ~20-26s before it recovers.
 *
 * This is environmental, not a product bug, and the control run proves it is
 * not specific to this page: GREEN shard-4 runs (31460622870, 31498698357)
 * carry the same 1-2 abort events per run — they simply land elsewhere in the
 * run, where nothing asserts on a 15s budget. This block reds instead of
 * absorbing it because its four assertions carried the tightest app-shell
 * budget in the shard (15s) against a measured 20-26s starvation.
 *
 * So: wait for the auth gate to clear on its own, generously-budgeted, BEFORE
 * asserting anything about the page — the pattern captures-recordings.spec.ts
 * and style-gate/style-capture.spec.ts already use for `(app)` routes. The
 * product assertions below are unchanged and still enforced; only the wait for
 * "the app finished authenticating" is separated out and sized to the measured
 * environment.
 *
 * The DURABLE fix is to stop running E2E against `next dev` at all (build once,
 * serve with `next start`), which removes on-demand compilation and this whole
 * failure class. That is a workflow-level change to a merge-critical suite and
 * is deliberately NOT bundled here.
 */

import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";

/**
 * The literal copy rendered by `(app)/layout.tsx`'s `AuthLoadingShell` while
 * `useAuth().loading` is unresolved. Kept in sync with that component (and with
 * style-gate/style-capture.spec.ts, which keys on the same string).
 */
const AUTH_LOADING_SHELL_TEXT = "Loading...";

/**
 * Upper bound for "the `(app)` auth gate cleared".
 *
 * Sized from MEASURED starvation, not by feel. The two observed dev-server
 * stalls ran ~20.6s (run 31269313203; a lower bound — the test was torn down
 * still waiting) and ~26s (run 31055130610, abort at 23:15:02 to the recovery
 * recompile at 23:15:28). 45s clears the observed range with roughly 1.7x
 * headroom on the worst sample.
 *
 * Note what this does NOT claim: a gate slower than 45s still fails, and it
 * should — a permanently wedged dev server is a real signal, not something to
 * wait out. The bound buys resilience to the measured stall, it does not make
 * the test unbounded-correct. Costs nothing on the fast path: the wait returns
 * the instant the shell is gone (~2s on every green run).
 */
const APP_SHELL_TIMEOUT_MS = 45_000;

/**
 * Budget for this page's OWN readiness, measured from the moment the auth gate
 * cleared. Past the gate the page still early-returns a `<Loader2>` while
 * `useRunnerHealth()` resolves — in CI no runner exists, so this is however
 * long the backend takes to fail that proxied probe. Unchanged from the
 * original 15s: that budget was never the problem, it was just being asked to
 * cover the auth gate as well.
 */
const PAGE_READY_TIMEOUT_MS = 15_000;

/**
 * Per-test budget for the shell-gated tests below.
 *
 * The default 60s cannot hold BOTH a dev-mode navigation and a full shell wait:
 * playwright.config.ts allows navigationTimeout 60s precisely because Next
 * compiles on demand (~23s for the dashboard). If `goto` eats 30s+, a 45s shell
 * wait gets truncated by the test deadline and the failure surfaces as a bare
 * test-level timeout — losing the diagnostic message that is the point of the
 * wait. Reserve navigation budget and wait budget separately so the assertion
 * always gets to speak. Same reasoning as captures-recordings.spec.ts's
 * POLLED_TEST_TIMEOUT_MS, scaled to the larger bound used here.
 *
 * 150s, not 120s: navigation (60s) + shell (45s) + page (15s) is already 120s
 * exactly, which would reserve the two budgets to the millisecond and leave
 * nothing for fixture setup, the fullPage screenshot and `page.content()`. The
 * margin is only ever consumed on a run that is already failing.
 */
const SHELL_GATED_TEST_TIMEOUT_MS = 150_000;

/**
 * Block until the `(app)` auth gate has cleared.
 *
 * `toBeHidden` passes for "absent" as well as "present but hidden", so on a
 * healthy load — where the shell may never paint at all — this returns
 * immediately rather than waiting for an element that will never exist.
 *
 * Unlike style-capture.spec.ts's best-effort variant, this one THROWS on
 * expiry: here the gate is the precondition for every assertion that follows,
 * so a gate that never clears must be reported as itself instead of resurfacing
 * as a confusing "element(s) not found" on the page's heading — which is
 * exactly how the 2026-08-05/08-08 failures presented.
 */
async function waitForAppShell(page: Page, route: string): Promise<void> {
  await expect(
    page.getByText(AUTH_LOADING_SHELL_TEXT, { exact: true }),
    `${route} never left the (app) auth loading shell within ` +
      `${APP_SHELL_TIMEOUT_MS}ms. This is the app-group auth gate, not this ` +
      `page: while it is up the route's markup is not in the DOM at all. If ` +
      `the job log shows "[WebServer] ⨯ [Error: aborted]" or ` +
      `"uncaughtException: ... ECONNRESET" at this navigation's timestamp, ` +
      `the Next DEV server starved the request — see this file's header.`
  ).toBeHidden({ timeout: APP_SHELL_TIMEOUT_MS });
}

test.describe("Tools - Error Monitor", () => {
  test("should load error monitor page without errors", async ({ page }) => {
    test.setTimeout(SHELL_GATED_TEST_TIMEOUT_MS);
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the auth gate BEFORE the screenshot. Without this the artifact
    // is a picture of the "Loading..." spinner, and the assertion below is
    // near-vacuous — an un-hydrated shell trivially contains no "Internal
    // Server Error". This test previously finished in ~3.6s while the page was
    // still authenticating, i.e. it was passing without ever seeing the page.
    await waitForAppShell(page, "/tools/error-monitor");

    // Clearing the gate is necessary but NOT sufficient: `AppAuthGate` also
    // shows the shell when auth resolved with no user, and that branch
    // `router.replace`s to /login — where the shell is absent, so the wait
    // above passes and /login trivially contains no "Internal Server Error"
    // either. Pin the URL so this test cannot pass without having actually
    // stayed on the route under test.
    await expect(page).toHaveURL(/\/tools\/error-monitor/);

    await page.screenshot({
      path: "test-results/tools-error-monitor.png",
      fullPage: true,
    });

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("should display error monitor heading", async ({ page }) => {
    test.setTimeout(SHELL_GATED_TEST_TIMEOUT_MS);
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");
    await waitForAppShell(page, "/tools/error-monitor");

    // Past the auth gate this is a real product assertion: the route renders
    // its heading once `useRunnerHealth()` settles.
    const heading = page.locator("text=Error Monitor");
    await expect(heading.first()).toBeVisible({
      timeout: PAGE_READY_TIMEOUT_MS,
    });
  });

  test("should have severity filtering controls or offline state", async ({
    page,
  }) => {
    test.setTimeout(SHELL_GATED_TEST_TIMEOUT_MS);
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");
    await waitForAppShell(page, "/tools/error-monitor");

    // The page returns a centered <Loader2> while useRunnerHealth is loading;
    // wait for the "Error Monitor" heading to land so we're past that early
    // return before snapshotting visibility.
    await expect(page.locator("text=Error Monitor").first()).toBeVisible({
      timeout: PAGE_READY_TIMEOUT_MS,
    });

    // The severity filter buttons (Error/Warning/Info/All) live inside a
    // showFilters && (...) conditional and only render after a Filters click.
    // The "Log Entries" CardTitle always renders past healthLoading, and the
    // RunnerPartialState banner ("Runner offline — ...") shows when isOffline.
    // Accept any of those as a healthy structural signal.
    const hasErrorFilter =
      (await page.locator('button:has-text("Error")').count()) > 0;
    const hasWarningFilter =
      (await page.locator('button:has-text("Warning")').count()) > 0;
    const hasInfoFilter =
      (await page.locator('button:has-text("Info")').count()) > 0;
    const hasAllFilter =
      (await page.locator('button:has-text("All")').count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner offline").count()) > 0;
    const hasLogEntries = (await page.locator("text=Log Entries").count()) > 0;

    const hasFilteringUI =
      hasErrorFilter && hasWarningFilter && hasInfoFilter && hasAllFilter;
    expect(hasFilteringUI || hasOfflineState || hasLogEntries).toBeTruthy();
  });

  test("should show summary cards with counts or offline state", async ({
    page,
  }) => {
    test.setTimeout(SHELL_GATED_TEST_TIMEOUT_MS);
    await page.goto("/tools/error-monitor");
    await page.waitForLoadState("domcontentloaded");
    await waitForAppShell(page, "/tools/error-monitor");

    // Wait past the healthLoading early-return spinner (see sibling test).
    await expect(page.locator("text=Error Monitor").first()).toBeVisible({
      timeout: PAGE_READY_TIMEOUT_MS,
    });

    // Summary cards (Total, Critical, Errors, Warnings, Info) always render
    // once past healthLoading. The RunnerPartialState banner ("Runner offline
    // — ...") sits above them when isOffline. The "Failed to load error
    // entries" message renders inside the Log Entries card when the runner
    // is reachable but the log source isn't configured.
    const hasTotalCard = (await page.locator("text=Total").count()) > 0;
    const hasErrorsCard = (await page.locator("text=Errors").count()) > 0;
    const hasWarningsCard = (await page.locator("text=Warnings").count()) > 0;
    const hasOfflineState =
      (await page.locator("text=Runner offline").count()) > 0;
    const hasLoadFailure =
      (await page.locator("text=Failed to load error entries").count()) > 0;

    expect(
      (hasTotalCard && hasErrorsCard && hasWarningsCard) ||
        hasOfflineState ||
        hasLoadFailure
    ).toBeTruthy();
  });
});
